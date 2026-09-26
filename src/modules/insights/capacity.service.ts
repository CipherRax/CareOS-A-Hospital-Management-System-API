import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { CapacityQueryDto } from './dto/insights.dto';
import { RollupsService } from './rollups.service';
import { ForecastsService } from './forecasts.service';
import { resolveWindow, round2 } from './domain/window';

const PEAK_HOURS_TOPK = 5;
const PEAK_DAYS_TOPK = 3;

/**
 * Capacity planning over historical analytics (brief Phase 11 §7.10): peak
 * hours/days, department load, provider booking fill and current bed
 * occupancy, plus an appointment-demand forecast (labelled estimate).
 */
@Injectable()
export class CapacityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly rollups: RollupsService,
    private readonly forecasts: ForecastsService,
  ) {}

  async capacity(query: CapacityQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 90);
    const window = { gte: from, lte: to };

    const queue = await db.queueEntry.findMany({
      where: { organizationId, enteredAt: window },
      select: { branchId: true, departmentId: true, enteredAt: true },
    });

    const hourCounts = new Map<number, number>();
    const weekdayCounts = new Map<number, number>();
    for (const row of queue) {
      hourCounts.set(row.enteredAt.getUTCHours(), (hourCounts.get(row.enteredAt.getUTCHours()) ?? 0) + 1);
      weekdayCounts.set(row.enteredAt.getUTCDay(), (weekdayCounts.get(row.enteredAt.getUTCDay()) ?? 0) + 1);
    }
    const peakHours = [...hourCounts.entries()]
      .map(([hour, count]) => ({ hour: `${String(hour).padStart(2, '0')}:00`, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, PEAK_HOURS_TOPK);
    const weekdays = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
    const peakDays = [...weekdayCounts.entries()]
      .map(([day, count]) => ({ day: weekdays[day] ?? String(day), count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, PEAK_DAYS_TOPK);

    const [prioritizedDepartments, providerCompleted, providerFill] = await Promise.all([
      db.queueEntry.groupBy({
        by: ['departmentId'],
        where: { organizationId, enteredAt: window },
        _count: { _all: true },
      }),
      db.appointment.groupBy({
        by: ['providerId'],
        where: { organizationId, status: 'COMPLETED', startsAt: window },
        _count: { _all: true },
      }),
      db.appointment.groupBy({
        by: ['providerId'],
        where: {
          organizationId,
          status: { notIn: ['CANCELLED', 'NO_SHOW'] },
          startsAt: window,
        },
        _count: { _all: true },
      }),
    ]);

    const fillByProvider = new Map(providerFill.map((p) => [p.providerId, p._count._all]));
    const providerUtilization = [...providerCompleted]
      .map((row) => {
        const scheduled = fillByProvider.get(row.providerId) ?? 0;
        return {
          providerId: row.providerId,
          completedAppointments: row._count._all,
          scheduledNonCancelled: scheduled,
          percent: scheduled > 0 ? round2((row._count._all / scheduled) * 100) : null,
        };
      })
      .sort((a, b) => (b.percent ?? 0) - (a.percent ?? 0));

    const [occupiedBeds, totalBeds] = await Promise.all([
      db.bedAssignment.count({ where: { organizationId, releasedAt: null } }),
      db.bed.count({ where: { organizationId } }),
    ]);

    const appointmentDemand = await this.forecasts.bySeries('appointment-demand', {
      from,
      to,
      horizon: 7,
      branchId: query.branchId,
      departmentId: query.departmentId,
    });

    const bedSeries = await this.rollups.readDays({
      organizationId,
      from,
      to,
      branchId: query.branchId,
      departmentId: query.departmentId,
    });

    return {
      interpretation:
        'Historical analytics over recorded queue/appointment/admission data. Forecasts are labelled estimates from a statistical baseline.',
      period: { from: from.toISOString(), to: to.toISOString() },
      peakHours,
      peakDays,
      departmentLoad: {
        total: queue.length,
        label: 'Queue tickets per department; departments with no recorded tickets are omitted.',
        items: [...prioritizedDepartments]
          .map((row) => ({
            departmentId: row.departmentId,
            tickets: row._count._all,
          }))
          .sort((a, b) => b.tickets - a.tickets),
      },
      providerUtilization: {
        label: 'Booking fill estimate per provider = completed / scheduled-and-not-cancelled appointments.',
        items: providerUtilization,
      },
      bedOccupancy: {
        occupied: occupiedBeds,
        total: totalBeds,
        percent: totalBeds > 0 ? round2((occupiedBeds / totalBeds) * 100) : null,
        label: 'Point-in-time bed occupancy.',
        admissionsPerDay: bedSeries.map((d) => ({ date: d.date, admissions: d.admissionsCreated })),
      },
      appointmentDemand: {
        forecast: appointmentDemand,
        label: `Labelled estimate of daily appointment demand (${appointmentDemand.model.name} v${appointmentDemand.model.version}).`,
      },
    };
  }
}