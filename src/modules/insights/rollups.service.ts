import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { newId } from '../../common/lib/uuidv7';
import { resolveWindow } from './domain/window';
import type { RebuildRollupsDto } from './dto/insights.dto';
import {
  addUTCDays,
  businessDay,
  cellKeyOf,
  type RollupCellKey,
  type RollupCounters,
  emptyCounters,
} from './domain/rollup-cells';

/**
 * The daily rollup projection: dashboards read these tables instead of
 * scanning raw clinical/billing rows (brief Phase 11 §7.1). `recomputeDay`
 * rebuilds one org-day across ALL scopes (org-wide, per-branch, per
 * branch+department) from the raw source rows in that window, then upserts —
 * ids idempotently by the unique (organizationId, date, branchId,
 * departmentId) key. The rollup touch consumer calls recomputeDay per event;
 * `rebuild` backfills/repairs a whole window on demand.
 */
@Injectable()
export class RollupsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async recomputeDay(organizationId: string, date: Date): Promise<void> {
    const db = this.prisma.tenantFor(organizationId);
    const day = businessDay(date);
    const start = day;
    const end = addUTCDays(day, 1);
    const window: Prisma.DateTimeFilter = { gte: start, lt: end };
    const inDay = (value: Date | null | undefined): boolean =>
      value != null && value >= start && value < end;

    const cells = new Map<string, RollupCounters>();
    const touch = (branchId: string | null | undefined, departmentId: string | null | undefined):
      RollupCounters => {
      const key = cellKeyOf(branchId ?? '', departmentId ?? '');
      let cell = cells.get(key);
      if (!cell) {
        cell = emptyCounters();
        cells.set(key, cell);
      }
      return cell;
    };
    // The org-wide cell is always present so reads fill zeros without scans.
    touch('', '');

    // ── Patient flow ────────────────────────────────────────────────────────
    const visits = await db.visit.findMany({
      where: { organizationId, OR: [{ createdAt: window }, { completedAt: window }] },
      select: { branchId: true, departmentId: true, createdAt: true, completedAt: true },
    });
    for (const row of visits) {
      if (inDay(row.createdAt)) touch(row.branchId, row.departmentId).visitsRegistered += 1;
      if (inDay(row.completedAt)) touch(row.branchId, row.departmentId).visitsCompleted += 1;
    }

    const queue = await db.queueEntry.findMany({
      where: { organizationId, enteredAt: window },
      select: {
        branchId: true,
        departmentId: true,
        status: true,
        enteredAt: true,
        serviceStartedAt: true,
        completedAt: true,
      },
    });
    for (const row of queue) {
      const cell = touch(row.branchId, row.departmentId);
      cell.queueTickets += 1;
      if (row.status === 'NO_SHOW') cell.queueNoShow += 1;
      if (row.status === 'COMPLETED') {
        cell.queueServed += 1;
        if (row.serviceStartedAt && row.completedAt) {
          cell.waitMinutes = new Prisma.Decimal(cell.waitMinutes)
            .add((row.serviceStartedAt.getTime() - row.enteredAt.getTime()) / 60000)
            .toFixed(2);
          cell.waitSamples += 1;
        }
      }
    }

    // ── Appointments (each transition buckets to its own timestamp day) ─────
    const appointments = await db.appointment.findMany({
      where: {
        organizationId,
        OR: [
          { createdAt: window },
          { completedAt: window },
          { cancelledAt: window },
          { noShowAt: window },
          { rescheduledAt: window },
        ],
      },
      select: {
        branchId: true,
        departmentId: true,
        createdAt: true,
        completedAt: true,
        cancelledAt: true,
        noShowAt: true,
        rescheduledAt: true,
      },
    });
    for (const row of appointments) {
      const cell = touch(row.branchId, row.departmentId);
      if (inDay(row.createdAt)) cell.appointmentsBooked += 1;
      if (inDay(row.completedAt)) cell.appointmentsCompleted += 1;
      if (inDay(row.cancelledAt)) cell.appointmentsCancelled += 1;
      if (inDay(row.noShowAt)) cell.appointmentsNoShow += 1;
      if (inDay(row.rescheduledAt)) cell.appointmentsRescheduled += 1;
    }

    // ── Clinical ────────────────────────────────────────────────────────────
    const encounters = await db.encounter.findMany({
      where: { organizationId, OR: [{ openedAt: window }, { completedAt: window }] },
      select: {
        branchId: true,
        departmentId: true,
        openedAt: true,
        inProgressAt: true,
        completedAt: true,
      },
    });
    for (const row of encounters) {
      const cell = touch(row.branchId, row.departmentId);
      if (inDay(row.openedAt)) cell.encountersOpened += 1;
      if (inDay(row.completedAt)) {
        cell.encountersCompleted += 1;
        if (row.inProgressAt && row.completedAt) {
          cell.consultationMinutes = new Prisma.Decimal(cell.consultationMinutes)
            .add((row.completedAt.getTime() - row.inProgressAt.getTime()) / 60000)
            .toFixed(2);
          cell.consultationSamples += 1;
        }
      }
    }

    const diagnoses = await db.diagnosis.count({
      where: { organizationId, createdAt: window },
    });
    touch('', '').diagnosesRecorded += diagnoses;

    const tasks = await db.task.count({
      where: { organizationId, status: 'DONE', completedAt: window },
    });
    touch('', '').tasksCompleted += tasks;

    // ── Pharmacy / inventory ────────────────────────────────────────────────
    const prescriptions = await db.prescription.findMany({
      where: { organizationId, OR: [{ issuedAt: window }, { dispensedAt: window }] },
      select: { branchId: true, issuedAt: true, dispensedAt: true, items: {
        select: { dispensedQuantity: true },
      } },
    });
    for (const row of prescriptions) {
      const cell = touch(row.branchId, '');
      if (inDay(row.issuedAt)) cell.prescriptionsIssued += 1;
      if (inDay(row.dispensedAt)) {
        cell.prescriptionsDispensed += 1;
        cell.unitsDispensed += row.items.reduce((sum, item) => sum + item.dispensedQuantity, 0);
      }
    }

    const received = await db.stockBatch.findMany({
      where: { organizationId, receivedAt: window },
      select: { branchId: true },
    });
    for (const row of received) touch(row.branchId, '').stockReceivedLots += 1;

    // ── Laboratory + radiology ──────────────────────────────────────────────
    const labOrders = await db.labOrder.findMany({
      where: { organizationId, OR: [{ createdAt: window }, { releasedAt: window }] },
      select: { branchId: true, createdAt: true, orderedAt: true, releasedAt: true },
    });
    for (const row of labOrders) {
      const cell = touch(row.branchId, '');
      if (inDay(row.createdAt)) cell.labOrdersCreated += 1;
      const releasedAt = row.releasedAt;
      if (releasedAt && inDay(releasedAt)) {
        cell.labOrdersReleased += 1;
        const origin = row.orderedAt ?? row.createdAt;
        cell.labTatMinutes = new Prisma.Decimal(cell.labTatMinutes)
          .add((releasedAt.getTime() - origin.getTime()) / 60000)
          .toFixed(2);
        cell.labTatSamples += 1;
      }
    }

    const rejectedSamples = await db.labSample.findMany({
      where: { organizationId, rejectedAt: window },
      select: { branchId: true },
    });
    for (const row of rejectedSamples) touch(row.branchId, '').labSamplesRejected += 1;

    const radiologyOrders = await db.radiologyOrder.findMany({
      where: { organizationId, OR: [{ createdAt: window }, { releasedAt: window }] },
      select: { branchId: true, createdAt: true, releasedAt: true },
    });
    for (const row of radiologyOrders) {
      const cell = touch(row.branchId, '');
      if (inDay(row.createdAt)) cell.radiologyOrdersCreated += 1;
      if (inDay(row.releasedAt)) cell.radiologyReportsReleased += 1;
    }

    // ── Inpatient & emergency ───────────────────────────────────────────────
    const admissions = await db.admission.findMany({
      where: { organizationId, admittedAt: window },
      select: { branchId: true, departmentId: true },
    });
    for (const row of admissions) touch(row.branchId, row.departmentId).admissionsCreated += 1;

    const discharges = await db.discharge.findMany({
      where: { organizationId, dischargedAt: window },
      select: { id: true },
    });
    for (const _row of discharges) touch('', '').admissionsDischarged += 1;

    const emergencies = await db.emergencyVisit.findMany({
      where: { organizationId, OR: [{ arrivedAt: window }, { triagedAt: window }] },
      select: { branchId: true, arrivedAt: true, triagedAt: true },
    });
    for (const row of emergencies) {
      const cell = touch(row.branchId, '');
      if (inDay(row.arrivedAt)) {
        cell.emergencyArrivals += 1;
        if (row.triagedAt) {
          cell.emergencyTimeToTriageMinutes = new Prisma.Decimal(
            cell.emergencyTimeToTriageMinutes,
          )
            .add((row.triagedAt.getTime() - row.arrivedAt.getTime()) / 60000)
            .toFixed(2);
          cell.emergencySamples += 1;
        }
      }
      if (inDay(row.triagedAt)) cell.emergencyTriaged += 1;
    }

    // ── Billing & insurance ─────────────────────────────────────────────────
    const invoices = await db.invoice.findMany({
      where: { organizationId, issuedAt: window },
      select: { branchId: true, total: true },
    });
    for (const row of invoices) {
      const cell = touch(row.branchId, '');
      cell.invoicesIssued += 1;
      cell.invoicesTotal = new Prisma.Decimal(cell.invoicesTotal).add(row.total).toFixed(2);
    }

    const payments = await db.payment.findMany({
      where: {
        organizationId,
        status: 'COMPLETED',
        OR: [{ recordedAt: window }, { createdAt: window }],
      },
      select: { amount: true, recordedAt: true, createdAt: true },
    });
    for (const row of payments) {
      if (!inDay(row.recordedAt ?? row.createdAt)) continue;
      const cell = touch('', '');
      cell.paymentsCompleted += 1;
      cell.paymentsTotal = new Prisma.Decimal(cell.paymentsTotal).add(row.amount).toFixed(2);
    }

    const refunds = await db.payment.findMany({
      where: {
        organizationId,
        status: 'REFUNDED',
        OR: [{ refundedAt: window }, { createdAt: window }],
      },
      select: { amount: true, refundedAt: true, createdAt: true },
    });
    for (const row of refunds) {
      if (!inDay(row.refundedAt ?? row.createdAt)) continue;
      const cell = touch('', '');
      cell.refundsCount += 1;
      cell.refundsTotal = new Prisma.Decimal(cell.refundsTotal).add(row.amount).toFixed(2);
    }

    const claims = await db.insuranceClaim.findMany({
      where: {
        organizationId,
        OR: [{ submittedAt: window }, { paidAt: window }],
      },
      select: { submittedAt: true, paidAt: true, approvedAmount: true, amount: true },
    });
    for (const row of claims) {
      const cell = touch('', '');
      if (inDay(row.submittedAt)) cell.claimsSubmitted += 1;
      if (inDay(row.paidAt)) {
        cell.claimsPaid += 1;
        cell.claimsPaidTotal = new Prisma.Decimal(cell.claimsPaidTotal)
          .add(row.approvedAmount ?? row.amount)
          .toFixed(2);
      }
    }

    // ── Quality ─────────────────────────────────────────────────────────────
    const feedback = await db.feedback.findMany({
      where: { organizationId, createdAt: window },
      select: { branchId: true, rating: true },
    });
    for (const row of feedback) {
      const cell = touch(row.branchId, '');
      cell.feedbackSubmitted += 1;
      cell.feedbackRatingSum += row.rating;
    }

    // ── Upsert every touched cell ───────────────────────────────────────────
    for (const [key, counters] of cells) {
      const { branchId, departmentId } = toCellKey(key);
      await db.dailyRollup.upsert({
        where: {
          organizationId_date_branchId_departmentId: {
            organizationId,
            date: day,
            branchId,
            departmentId,
          },
        },
        create: { id: newId(), organizationId, date: day, branchId, departmentId, ...counters },
        update: counters,
      });
    }

    // Roll every scope up into the org-wide cell so un-scoped reads (branch ''
    // / department '') see the whole org for the day. The '' cell is itself a
    // cell here, so org-wide-only events (payments, claims, diagnoses, ...)
    // are included exactly once.
    const aggregate = emptyCounters();
    for (const counters of cells.values()) addCountersInto(aggregate, counters);
    await db.dailyRollup.upsert({
      where: {
        organizationId_date_branchId_departmentId: {
          organizationId,
          date: day,
          branchId: '',
          departmentId: '',
        },
      },
      create: { id: newId(), organizationId, date: day, branchId: '', departmentId: '', ...aggregate },
      update: aggregate,
    });
  }

  async rebuild(organizationId: string, from: Date, to: Date): Promise<number> {
    const start = businessDay(from);
    const end = businessDay(to);
    let days = 0;
    for (let d = start; d <= end; d = addUTCDays(d, 1)) {
      await this.recomputeDay(organizationId, d);
      days += 1;
    }
    return days;
  }

  /** Backfill/repair from the API: resolves the window and rebuilds in-scope. */
  async rebuildWindow(dto: RebuildRollupsDto): Promise<{ days: number; from: string; to: string }> {
    const organizationId = this.tenantContext.requireOrg();
    const { from, to } = resolveWindow(dto.from, dto.to, 30);
    const days = await this.rebuild(organizationId, from, to);
    return { days, from: from.toISOString(), to: to.toISOString() };
  }

  /**
   * Read the rollup series for a window, zero-filling missing days so callers
   * never see gaps. Rows are plain DTO objects (Decimal→string for sums).
   */
  async readDays(args: {
    organizationId: string;
    from: Date;
    to: Date;
    branchId?: string;
    departmentId?: string;
  }): Promise<Array<RollupCounters & { date: string }>> {
    const { organizationId, from, to, branchId, departmentId } = args;
    const db = this.prisma.tenantFor(organizationId);
    const start = businessDay(from);
    const end = businessDay(to);

    const rows = await db.dailyRollup.findMany({
      where: {
        organizationId,
        date: { gte: start, lte: end },
        branchId: branchId ?? '',
        departmentId: departmentId ?? '',
      },
      orderBy: { date: 'asc' },
    });

    const byDate = new Map<string, typeof rows[number]>();
    for (const row of rows) byDate.set(row.date.toISOString().slice(0, 10), row);

    const out: (RollupCounters & { date: string })[] = [];
    for (let d = start; d <= end; d = addUTCDays(d, 1)) {
      const key = d.toISOString().slice(0, 10);
      const row = byDate.get(key);
      if (row) {
        out.push({
          date: key,
          ...toCounterDto(row),
        });
      } else {
        out.push({ date: key, ...emptyCounters() });
      }
    }
    return out;
  }
}

function toCellKey(key: string): RollupCellKey {
  const [branchId = '', departmentId = ''] = key.split('\u0000');
  return { branchId, departmentId };
}

/** Sum `source`'s counters into `target` (counts add once; sums add). */
function addCountersInto(target: RollupCounters, source: RollupCounters): void {
  target.visitsRegistered += source.visitsRegistered;
  target.visitsCompleted += source.visitsCompleted;
  target.queueTickets += source.queueTickets;
  target.queueServed += source.queueServed;
  target.queueNoShow += source.queueNoShow;
  target.waitMinutes = new Prisma.Decimal(target.waitMinutes).add(source.waitMinutes).toFixed(2);
  target.waitSamples += source.waitSamples;
  target.appointmentsBooked += source.appointmentsBooked;
  target.appointmentsCompleted += source.appointmentsCompleted;
  target.appointmentsCancelled += source.appointmentsCancelled;
  target.appointmentsNoShow += source.appointmentsNoShow;
  target.appointmentsRescheduled += source.appointmentsRescheduled;
  target.encountersOpened += source.encountersOpened;
  target.encountersCompleted += source.encountersCompleted;
  target.consultationMinutes = new Prisma.Decimal(target.consultationMinutes).add(source.consultationMinutes).toFixed(2);
  target.consultationSamples += source.consultationSamples;
  target.diagnosesRecorded += source.diagnosesRecorded;
  target.tasksCompleted += source.tasksCompleted;
  target.prescriptionsIssued += source.prescriptionsIssued;
  target.prescriptionsDispensed += source.prescriptionsDispensed;
  target.unitsDispensed += source.unitsDispensed;
  target.stockReceivedLots += source.stockReceivedLots;
  target.labOrdersCreated += source.labOrdersCreated;
  target.labOrdersReleased += source.labOrdersReleased;
  target.labSamplesRejected += source.labSamplesRejected;
  target.labTatMinutes = new Prisma.Decimal(target.labTatMinutes).add(source.labTatMinutes).toFixed(2);
  target.labTatSamples += source.labTatSamples;
  target.radiologyOrdersCreated += source.radiologyOrdersCreated;
  target.radiologyReportsReleased += source.radiologyReportsReleased;
  target.admissionsCreated += source.admissionsCreated;
  target.admissionsDischarged += source.admissionsDischarged;
  target.emergencyArrivals += source.emergencyArrivals;
  target.emergencyTriaged += source.emergencyTriaged;
  target.emergencyTimeToTriageMinutes = new Prisma.Decimal(target.emergencyTimeToTriageMinutes)
    .add(source.emergencyTimeToTriageMinutes)
    .toFixed(2);
  target.emergencySamples += source.emergencySamples;
  target.invoicesIssued += source.invoicesIssued;
  target.invoicesTotal = new Prisma.Decimal(target.invoicesTotal).add(source.invoicesTotal).toFixed(2);
  target.paymentsCompleted += source.paymentsCompleted;
  target.paymentsTotal = new Prisma.Decimal(target.paymentsTotal).add(source.paymentsTotal).toFixed(2);
  target.refundsCount += source.refundsCount;
  target.refundsTotal = new Prisma.Decimal(target.refundsTotal).add(source.refundsTotal).toFixed(2);
  target.claimsSubmitted += source.claimsSubmitted;
  target.claimsPaid += source.claimsPaid;
  target.claimsPaidTotal = new Prisma.Decimal(target.claimsPaidTotal).add(source.claimsPaidTotal).toFixed(2);
  target.feedbackSubmitted += source.feedbackSubmitted;
  target.feedbackRatingSum += source.feedbackRatingSum;
}

function toCounterDto(
  row: {
    visitsRegistered: number;
    visitsCompleted: number;
    queueTickets: number;
    queueServed: number;
    queueNoShow: number;
    waitMinutes: Prisma.Decimal;
    waitSamples: number;
    appointmentsBooked: number;
    appointmentsCompleted: number;
    appointmentsCancelled: number;
    appointmentsNoShow: number;
    appointmentsRescheduled: number;
    encountersOpened: number;
    encountersCompleted: number;
    consultationMinutes: Prisma.Decimal;
    consultationSamples: number;
    diagnosesRecorded: number;
    tasksCompleted: number;
    prescriptionsIssued: number;
    prescriptionsDispensed: number;
    unitsDispensed: number;
    stockReceivedLots: number;
    labOrdersCreated: number;
    labOrdersReleased: number;
    labSamplesRejected: number;
    labTatMinutes: Prisma.Decimal;
    labTatSamples: number;
    radiologyOrdersCreated: number;
    radiologyReportsReleased: number;
    admissionsCreated: number;
    admissionsDischarged: number;
    emergencyArrivals: number;
    emergencyTriaged: number;
    emergencyTimeToTriageMinutes: Prisma.Decimal;
    emergencySamples: number;
    invoicesIssued: number;
    invoicesTotal: Prisma.Decimal;
    paymentsCompleted: number;
    paymentsTotal: Prisma.Decimal;
    refundsCount: number;
    refundsTotal: Prisma.Decimal;
    claimsSubmitted: number;
    claimsPaid: number;
    claimsPaidTotal: Prisma.Decimal;
    feedbackSubmitted: number;
    feedbackRatingSum: number;
  },
): RollupCounters {
  const toStr = (d: Prisma.Decimal): string => d.toFixed(2);
  return {
    visitsRegistered: row.visitsRegistered,
    visitsCompleted: row.visitsCompleted,
    queueTickets: row.queueTickets,
    queueServed: row.queueServed,
    queueNoShow: row.queueNoShow,
    waitMinutes: toStr(row.waitMinutes),
    waitSamples: row.waitSamples,
    appointmentsBooked: row.appointmentsBooked,
    appointmentsCompleted: row.appointmentsCompleted,
    appointmentsCancelled: row.appointmentsCancelled,
    appointmentsNoShow: row.appointmentsNoShow,
    appointmentsRescheduled: row.appointmentsRescheduled,
    encountersOpened: row.encountersOpened,
    encountersCompleted: row.encountersCompleted,
    consultationMinutes: toStr(row.consultationMinutes),
    consultationSamples: row.consultationSamples,
    diagnosesRecorded: row.diagnosesRecorded,
    tasksCompleted: row.tasksCompleted,
    prescriptionsIssued: row.prescriptionsIssued,
    prescriptionsDispensed: row.prescriptionsDispensed,
    unitsDispensed: row.unitsDispensed,
    stockReceivedLots: row.stockReceivedLots,
    labOrdersCreated: row.labOrdersCreated,
    labOrdersReleased: row.labOrdersReleased,
    labSamplesRejected: row.labSamplesRejected,
    labTatMinutes: toStr(row.labTatMinutes),
    labTatSamples: row.labTatSamples,
    radiologyOrdersCreated: row.radiologyOrdersCreated,
    radiologyReportsReleased: row.radiologyReportsReleased,
    admissionsCreated: row.admissionsCreated,
    admissionsDischarged: row.admissionsDischarged,
    emergencyArrivals: row.emergencyArrivals,
    emergencyTriaged: row.emergencyTriaged,
    emergencyTimeToTriageMinutes: toStr(row.emergencyTimeToTriageMinutes),
    emergencySamples: row.emergencySamples,
    invoicesIssued: row.invoicesIssued,
    invoicesTotal: toStr(row.invoicesTotal),
    paymentsCompleted: row.paymentsCompleted,
    paymentsTotal: toStr(row.paymentsTotal),
    refundsCount: row.refundsCount,
    refundsTotal: toStr(row.refundsTotal),
    claimsSubmitted: row.claimsSubmitted,
    claimsPaid: row.claimsPaid,
    claimsPaidTotal: toStr(row.claimsPaidTotal),
    feedbackSubmitted: row.feedbackSubmitted,
    feedbackRatingSum: row.feedbackRatingSum,
  };
}