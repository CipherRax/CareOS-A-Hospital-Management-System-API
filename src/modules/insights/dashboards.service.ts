import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { DashboardQueryDto, DashboardRole } from './dto/insights.dto';
import { RollupsService } from './rollups.service';
import { MetricsService } from './metrics.service';
import { BottleneckService } from './bottleneck.service';
import { CapacityService } from './capacity.service';
import { ForecastsService } from './forecasts.service';
import { PatientExperienceService } from './patient-experience.service';
import { type RollupCounters } from './domain/rollup-cells';
import { resolveWindow } from './domain/window';

interface Widget {
  key: string;
  label: string;
  value: number | string | null;
  unit?: string;
  delta?: number | string | null;
}

/**
 * Role-shaped dashboards (brief Phase 11 §7.14). Each endpoint returns the
 * widgets that role operates day-to-day; time series read the daily rollup
 * projection and point-in-time values are read live. Every value is a
 * measurement or a labelled estimate.
 */
@Injectable()
export class DashboardsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly rollups: RollupsService,
    private readonly metrics: MetricsService,
    private readonly bottleneck: BottleneckService,
    private readonly capacity: CapacityService,
    private readonly forecasts: ForecastsService,
    private readonly experience: PatientExperienceService,
  ) {}

  async dashboard(role: DashboardRole, query: DashboardQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 30);
    const sinceStartOfDay = new Date();
    sinceStartOfDay.setUTCHours(0, 0, 0, 0);

    const days = await this.rollups.readDays({
      organizationId,
      from,
      to,
      branchId: query.branchId,
      departmentId: query.departmentId,
    });
    const sum = (pick: (d: (typeof days)[number]) => number): number =>
      days.reduce((a, d) => a + pick(d), 0);

    const widgets: Widget[] = [];

    switch (role) {
      case 'admin': {
        const metrics = await this.metrics.metrics({ from, to, branchId: query.branchId });
        const bottlenecks = await this.bottleneck.analyze({ from, to });
        const capacity = await this.capacity.capacity({ from, to });
        const forecastDemand = await this.forecasts.bySeries('appointment-demand', { from, to, horizon: 7 });
        const experience = await this.experience.score({ from, to });
        widgets.push(
          { key: 'patientVolume', label: 'Patient volume', value: metrics.summary.patientVolume },
          { key: 'appointmentVolume', label: 'Appointment volume', value: metrics.summary.appointmentVolume },
          { key: 'noShowRate', label: 'Appointment no-show rate', value: metrics.summary.noShowRate, unit: '%' },
          { key: 'revenue', label: 'Revenue collected', value: metrics.summary.revenue, unit: 'KES' },
          { key: 'outstandingInvoices', label: 'Outstanding invoices', value: metrics.snapshots.outstandingInvoices.balanceDue, unit: 'KES' },
          {
            key: 'bedOccupancy',
            label: 'Bed occupancy',
            value: metrics.snapshots.bedOccupancy.percent,
            unit: '%',
          },
          {
            key: 'emergencyTimeToTriage',
            label: 'Emergency time to triage (avg)',
            value: metrics.snapshots.emergencyIntake.avgTimeToTriageMinutes,
            unit: 'min',
          },
          {
            key: 'topBottleneck',
            label: 'Top bottleneck stage',
            value: bottlenecks.stages[0]?.key ?? null,
            delta: bottlenecks.stages[0]?.avgMinutes != null ? `${bottlenecks.stages[0].avgMinutes} min avg` : null,
          },
          {
            key: 'peakHour',
            label: 'Peak hour',
            value: capacity.peakHours[0] ? `${capacity.peakHours[0].hour} (${capacity.peakHours[0].count})` : null,
          },
          {
            key: 'forecastAppointmentDemand',
            label: `Appointment demand forecast (${forecastDemand.model.name} v${forecastDemand.model.version})`,
            value: forecastDemand.points[0]?.value ?? null,
            delta: 'labelled forecast/estimate',
          },
          { key: 'patientExperience', label: 'Patient experience', value: experience.composite, unit: '/100' },
        );
        break;
      }
      case 'doctor': {
        const [appointmentsToday, encountersOpened, openTasks, followUps] = await Promise.all([
          db.appointment.count({
            where: { organizationId, startsAt: { gte: sinceStartOfDay } },
          }),
          db.encounter.count({ where: { organizationId, status: 'OPEN', openedAt: { gte: sinceStartOfDay } } }),
          db.task.count({ where: { organizationId, status: { notIn: ['DONE', 'CANCELLED'] } } }),
          db.followUp.count({ where: { organizationId, status: 'SCHEDULED' } }),
        ]);
        const avgConsultation = averageDays(days, (d) => Number(d.consultationMinutes), (d) => d.consultationSamples);
        widgets.push(
          { key: 'appointmentsToday', label: 'Appointments today (starting today)', value: appointmentsToday },
          { key: 'openEncounters', label: 'Open encounters', value: encountersOpened },
          { key: 'avgConsultationMinutes', label: 'Average consultation duration', value: avgConsultation, unit: 'min' },
          { key: 'openTasks', label: 'Open tasks', value: openTasks },
          { key: 'scheduledFollowUps', label: 'Scheduled follow-ups', value: followUps },
        );
        break;
      }
      case 'nurse': {
        const [queueWaiting, triagePending, vitalsToday, openTasks] = await Promise.all([
          db.queueEntry.count({ where: { organizationId, status: 'WAITING' } }),
          db.visit.count({ where: { organizationId, status: 'TRIAGE' } }),
          db.vitalRecord.count({ where: { organizationId, observedAt: { gte: sinceStartOfDay } } }),
          db.task.count({ where: { organizationId, status: { notIn: ['DONE', 'CANCELLED'] } } }),
        ]);
        widgets.push(
          { key: 'queueWaiting', label: 'Patients waiting in queue', value: queueWaiting },
          { key: 'triagePending', label: 'Pending triage (visits in triage)', value: triagePending },
          { key: 'vitalsToday', label: 'Vital observations today', value: vitalsToday },
          { key: 'openTasks', label: 'Open tasks', value: openTasks },
        );
        break;
      }
      case 'pharmacy': {
        const expiryRiskLimit = new Date();
        expiryRiskLimit.setUTCDate(expiryRiskLimit.getUTCDate() + 30);
        const [dispensedToday, expiringBatches, emptyBatches, wastage, onHandTotals] = await Promise.all([
          db.prescription.count({ where: { organizationId, dispensedAt: { gte: sinceStartOfDay }, status: 'DISPENSED' } }),
          db.stockBatch.count({ where: { organizationId, expiryDate: { not: null, lte: expiryRiskLimit } } }),
          db.stockBatch.count({ where: { organizationId, onHand: 0 } }),
          db.inventoryLedgerEntry.aggregate({
            where: { organizationId, operation: 'WASTAGE', occurredAt: { gte: sinceStartOfDay } },
            _sum: { quantity: true },
          }),
          db.stockBatch.aggregate({ where: { organizationId }, _sum: { onHand: true } }),
        ]);
        widgets.push(
          { key: 'prescriptionsDispensedToday', label: 'Prescriptions dispensed today', value: dispensedToday },
          { key: 'expiryRiskBatches', label: 'Batches expiring within 30 days', value: expiringBatches },
          { key: 'outOfStockBatches', label: 'Batches with zero on hand', value: emptyBatches },
          { key: 'wastageTodayUnits', label: 'Units written off today', value: Math.abs(Number(wastage._sum?.quantity ?? 0)) },
          { key: 'onHandUnits', label: 'Stock on hand (units)', value: Number(onHandTotals._sum?.onHand ?? 0) },
        );
        break;
      }
      case 'laboratory': {
        const [ordersInWindow, releasedInWindow, pending, criticalPending] = await Promise.all([
          sum((d) => d.labOrdersCreated),
          sum((d) => d.labOrdersReleased),
          db.labOrder.count({
            where: {
              organizationId,
              status: { in: ['ORDERED', 'COLLECTED', 'RECEIVED', 'PROCESSING', 'RESULT_READY', 'VERIFIED'] },
            },
          }),
          db.criticalResult.count({ where: { organizationId, acknowledgedAt: null } }),
        ]);
        const avgTat = averageDays(days, (d) => Number(d.labTatMinutes), (d) => d.labTatSamples);
        widgets.push(
          { key: 'labOrders', label: 'Lab orders (window)', value: ordersInWindow },
          { key: 'labReleased', label: 'Lab orders released (window)', value: releasedInWindow },
          { key: 'labPending', label: 'Lab orders in progress', value: pending },
          { key: 'avgTatMinutes', label: 'Avg lab turnaround', value: avgTat, unit: 'min' },
          { key: 'criticalPending', label: 'Critical results pending acknowledgement', value: criticalPending },
        );
        break;
      }
      case 'accountant': {
        const metrics = await this.metrics.metrics({ from, to, branchId: query.branchId });
        const expenses = await db.expense.aggregate({
          where: {
            organizationId,
            status: { in: ['APPROVED'] },
            approvedAt: { gte: from, lte: to },
          },
          _sum: { amount: true },
          _count: true,
        });
        widgets.push(
          { key: 'revenue', label: 'Revenue collected', value: metrics.summary.revenue, unit: 'KES' },
          { key: 'outstandingInvoices', label: 'Outstanding invoices', value: metrics.snapshots.outstandingInvoices.balanceDue, unit: 'KES' },
          { key: 'refundsTotal', label: 'Refunds', value: metrics.summary.refundsTotal, unit: 'KES' },
          { key: 'expensesApproved', label: 'Approved expenses', value: expenses._sum?.amount?.toFixed(2) ?? '0.00', unit: 'KES' },
          {
            key: 'claimAging',
            label: 'Open claims (current/30/60/90/90+)',
            value: [
              metrics.snapshots.claimAging.buckets.current,
              metrics.snapshots.claimAging.buckets.d30,
              metrics.snapshots.claimAging.buckets.d60,
              metrics.snapshots.claimAging.buckets.d90,
            ].join('/'),
          },
        );
        break;
      }
    }

    return {
      role,
      interpretation:
        'Role-shaped dashboard. Time-series widgets read the daily rollup projection; point-in-time values are read live. Values are measurements or labelled estimates.',
      period: { from: from.toISOString(), to: to.toISOString() },
      widgets,
    };
  }
}

function averageDays(
  days: RollupCounters[],
  sumPick: (d: RollupCounters) => number,
  countPick: (d: RollupCounters) => number,
): number | null {
  let total = 0;
  let samples = 0;
  for (const d of days) {
    total += sumPick(d);
    samples += countPick(d);
  }
  return samples > 0 ? Math.round((total / samples) * 100) / 100 : null;
}