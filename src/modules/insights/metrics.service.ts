import { Injectable } from '@nestjs/common';
import { Prisma, type InvoiceStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { MetricsQueryDto } from './dto/insights.dto';
import { RollupsService } from './rollups.service';
import { type RollupCounters, averageOf, rateOf } from './domain/rollup-cells';
import { resolveWindow, round2 } from './domain/window';

const OPEN_BALANCES: InvoiceStatus[] = ['ISSUED', 'PARTIALLY_PAID'];

/**
 * Org metrics (brief Phase 11 §7.2–§7.8). The time series and the summary read
 * the daily rollup projection (dashboards never scan raw tables); point-in-time
 * snapshots (outstanding invoices, bed occupancy, claim aging, emergency
 * intake, provider utilization) are read from current state and every metric
 * carries a label. No clinical claims are made — values are measurements.
 */
@Injectable()
export class MetricsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly rollups: RollupsService,
  ) {}

  async metrics(query: MetricsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const { from, to } = resolveWindow(query.from, query.to);
    const branchId = query.branchId;
    const departmentId = query.departmentId;

    const days = await this.rollups.readDays({
      organizationId,
      from,
      to,
      branchId,
      departmentId,
    });

    const series = days.map((d) => ({
      date: d.date,
      patientVolume: d.visitsRegistered,
      appointmentVolume: d.appointmentsBooked,
      noShowRate: rateOf(d.appointmentsNoShow, d.appointmentsBooked),
      cancellationRate: rateOf(d.appointmentsCancelled, d.appointmentsBooked),
      rescheduleRate: rateOf(d.appointmentsRescheduled, d.appointmentsBooked),
      avgWaitingMinutes: averageOf(Number(d.waitMinutes), d.waitSamples),
      avgConsultationMinutes: averageOf(Number(d.consultationMinutes), d.consultationSamples),
      revenue: d.paymentsTotal,
      invoicesIssued: d.invoicesIssued,
      invoicesTotal: d.invoicesTotal,
      refundsTotal: d.refundsTotal,
      labTatAvgMinutes: averageOf(Number(d.labTatMinutes), d.labTatSamples),
      admissions: d.admissionsCreated,
      discharges: d.admissionsDischarged,
      emergencyArrivals: d.emergencyArrivals,
      feedbackSubmitted: d.feedbackSubmitted,
    }));

    const noShowBucket = days.reduce((a, d) => a + d.appointmentsNoShow, 0);
    const cancelledBucket = days.reduce((a, d) => a + d.appointmentsCancelled, 0);
    const rescheduledBucket = days.reduce((a, d) => a + d.appointmentsRescheduled, 0);
    const bookedBucket = days.reduce((a, d) => a + d.appointmentsBooked, 0);
    const waitMinutes = days.reduce((a, d) => a + Number(d.waitMinutes), 0);
    const waitSamples = days.reduce((a, d) => a + d.waitSamples, 0);
    const consultationMinutes = days.reduce((a, d) => a + Number(d.consultationMinutes), 0);
    const consultationSamples = days.reduce((a, d) => a + d.consultationSamples, 0);
    const labTatMinutes = days.reduce((a, d) => a + Number(d.labTatMinutes), 0);
    const labTatSamples = days.reduce((a, d) => a + d.labTatSamples, 0);

    const summary = {
      patientVolume: totalOf(days, (d) => d.visitsRegistered),
      visitsCompleted: totalOf(days, (d) => d.visitsCompleted),
      appointmentVolume: bookedBucket,
      appointmentsCompleted: totalOf(days, (d) => d.appointmentsCompleted),
      noShowRate: rateOf(noShowBucket, bookedBucket),
      cancellationRate: rateOf(cancelledBucket, bookedBucket),
      rescheduleRate: rateOf(rescheduledBucket, bookedBucket),
      avgWaitingMinutes: averageOf(waitMinutes, waitSamples),
      avgConsultationMinutes: averageOf(consultationMinutes, consultationSamples),
      revenue: sumOf(days, (d) => d.paymentsTotal),
      invoicesIssued: totalOf(days, (d) => d.invoicesIssued),
      invoicesTotal: sumOf(days, (d) => d.invoicesTotal),
      refundsTotal: sumOf(days, (d) => d.refundsTotal),
      labTatAvgMinutes: averageOf(labTatMinutes, labTatSamples),
      admissions: totalOf(days, (d) => d.admissionsCreated),
      discharges: totalOf(days, (d) => d.admissionsDischarged),
      emergencyArrivals: totalOf(days, (d) => d.emergencyArrivals),
      prescriptionsDispensed: totalOf(days, (d) => d.prescriptionsDispensed),
      feedbackSubmitted: totalOf(days, (d) => d.feedbackSubmitted),
    };

    const snapshots = await this.snapshots(from, to, branchId, summary.revenue);

    return {
      scope: { branchId: branchId ?? null, departmentId: departmentId ?? null },
      period: { from: from.toISOString(), to: to.toISOString() },
      granularity: query.granularity ?? 'day',
      series,
      summary,
      snapshots,
      label:
        'Time-series values are read from the daily rollup projection; point-in-time snapshots are read from current state. All values are measurements or labelled estimates.',
    };
  }

  private async snapshots(from: Date, to: Date, branchId?: string, revenue = '0.00') {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const branchFilter = branchId ? { branchId } : {};

    const outstanding = await db.invoice.aggregate({
      where: { organizationId, status: { in: OPEN_BALANCES }, ...branchFilter },
      _sum: { balanceDue: true },
      _count: true,
    });

    const wastage = await db.inventoryLedgerEntry.findMany({
      where: {
        organizationId,
        operation: 'WASTAGE',
        occurredAt: { gte: from, lte: to },
        ...branchFilter,
      },
      select: { quantity: true, unitCost: true },
    });
    let wastageValue = new Prisma.Decimal(0);
    let wastageUnits = 0;
    for (const row of wastage) {
      const units = Math.abs(row.quantity);
      wastageUnits += units;
      if (row.unitCost) wastageValue = wastageValue.add(row.unitCost.mul(units));
    }

    const stockOnHand = await db.stockBatch.aggregate({
      where: { organizationId, ...branchFilter },
      _sum: { onHand: true },
    });

    const dispensedWindow = await db.inventoryLedgerEntry.aggregate({
      where: { organizationId, operation: 'DISPENSED', occurredAt: { gte: from, lte: to }, ...branchFilter },
      _sum: { quantity: true },
    });

    const providers = await Promise.all([
      db.appointment.aggregate({
        where: { organizationId, status: 'COMPLETED', startsAt: { gte: from, lte: to }, ...branchFilter },
        _count: true,
      }),
      db.appointment.count({
        where: {
          organizationId,
          startsAt: { gte: from, lte: to },
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          ...branchFilter,
        },
      }),
    ]);

    const [occupiedBeds, totalBeds] = await Promise.all([
      db.bedAssignment.count({ where: { organizationId, releasedAt: null } }),
      db.bed.count({ where: { organizationId } }),
    ]);

    const aging = await db.insuranceClaim.findMany({
      where: { organizationId, status: { in: ['SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED'] } },
      select: { submittedAt: true },
    });
    const now = Date.now();
    const buckets = { current: 0, d30: 0, d60: 0, d90: 0, plus: 0 };
    for (const row of aging) {
      const submittedAt = row.submittedAt;
      if (!submittedAt) continue;
      const age = Math.floor((now - submittedAt.getTime()) / 86_400_000);
      if (age <= 30) buckets.current += 1;
      else if (age <= 60) buckets.d30 += 1;
      else if (age <= 90) buckets.d60 += 1;
      else buckets.d90 += 1;
    }

    const emergency = await db.emergencyVisit.findMany({
      where: { organizationId, arrivedAt: { gte: from, lte: to } },
      select: { branchId: true, arrivedAt: true, triagedAt: true },
    });
    const untriagedNow = await db.emergencyVisit.count({
      where: {
        organizationId,
        triagedAt: null,
        dispositionAt: null,
        ...branchFilter,
      },
    });
    const perBranch = new Map<string, number>();
    let triageMinutes = 0;
    let triageSamples = 0;
    for (const row of emergency) {
      perBranch.set(row.branchId, (perBranch.get(row.branchId) ?? 0) + 1);
      if (row.triagedAt) {
        triageMinutes += (row.triagedAt.getTime() - row.arrivedAt.getTime()) / 60000;
        triageSamples += 1;
      }
    }
    const perHour = new Map<string, number>();
    for (const row of emergency) {
      const hour = `${String(row.arrivedAt.getUTCHours()).padStart(2, '0')}:00`;
      perHour.set(hour, (perHour.get(hour) ?? 0) + 1);
    }

    const completed = providers[0]?._count ?? 0;
    const booked = (providers[1] ?? 0) > 0;
    const utilization = booked ? round2((completed / (providers[1] ?? 1)) * 100) : null;
    const onHand = Number(stockOnHand._sum?.onHand ?? 0);
    const dispensed = Math.abs(Number(dispensedWindow._sum?.quantity ?? 0));
    const windowDays = Math.max(1, Math.round((to.getTime() - from.getTime()) / 86_400_000) + 1);

    return {
      outstandingInvoices: {
        count: outstanding._count,
        balanceDue: outstanding._sum?.balanceDue?.toFixed(2) ?? '0.00',
        label: 'Sum of ISSUED/PARTIALLY_PAID invoice balances due, current state.',
      },
      medicationWastage: {
        events: wastage.length,
        units: wastageUnits,
        value: wastageValue.toFixed(2),
        label: 'Inventory write-offs in the window (WASTAGE ledger rows).',
      },
      stockTurnover: {
        onHandUnits: onHand,
        dispensedUnits: dispensed,
        avgDispensedPerDay: round2(dispensed / windowDays),
        turnover: onHand > 0 ? round2(dispensed / onHand) : null,
        label: 'Estimate: units dispensed in window divided by current on-hand stock.',
      },
      providerUtilization: {
        completedAppointments: completed,
        scheduledNonCancelled: providers[1] ?? 0,
        percent: utilization,
        label:
          'Booking fill estimate = completed appointments / scheduled-and-not-cancelled appointments in the window.',
      },
      bedOccupancy: {
        occupied: occupiedBeds,
        total: totalBeds,
        percent: totalBeds > 0 ? round2((occupiedBeds / totalBeds) * 100) : null,
        label: 'Point-in-time bed occupancy (active admissions in beds).',
      },
      claimAging: {
        buckets,
        label: 'Open insurance claims by age from submission (days).',
      },
      emergencyIntake: {
        arrivals: emergency.length,
        avgTimeToTriageMinutes: averageOf(triageMinutes, triageSamples),
        untriagedNow,
        perBranch: [...perBranch.entries()].map(([branchId, count]) => ({ branchId, count })),
        perHour: [...perHour.entries()].map(([hour, count]) => ({ hour, count })).sort((a, b) => a.hour.localeCompare(b.hour)),
        label:
          'Emergency department intake from EmergencyVisit timestamps (arrivedAt → triagedAt). Intake-request metrics (acknowledgement/escalation) arrive with the public emergency-intake flow.',
      },
      revenue,
    };
  }
}

type RollupDay = RollupCounters & { date: string };

function totalOf(days: RollupDay[], pick: (d: RollupDay) => number): number {
  return days.reduce((a, d) => a + pick(d), 0);
}
function sumOf(days: RollupDay[], pick: (d: RollupDay) => string): string {
  let total = new Prisma.Decimal(0);
  for (const d of days) total = total.add(pick(d));
  return total.toFixed(2);
}