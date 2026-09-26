import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { StaffAnalyticsQueryDto } from './dto/insights.dto';
import { averageOf } from './domain/rollup-cells';
import { resolveWindow } from './domain/window';

interface StaffAccumulator {
  appointmentsHandled: number;
  encountersOpened: number;
  consultationMinutes: number;
  consultationSamples: number;
  tasksCompleted: number;
  queueServed: number;
}

/**
 * Staff analytics (brief Phase 11 §7.13): raw measurements aggregated from
 * recorded activity. Deliberately presented as measurements with a caveat —
 * the brief forbids using them for automated individual employment decisions.
 */
@Injectable()
export class StaffAnalyticsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async staff(query: StaffAnalyticsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 30);
    const window = { gte: from, lte: to };
    const target = query.staffId;

    const staff = new Map<string, StaffAccumulator>();
    const touch = (id: string | null | undefined): StaffAccumulator | null => {
      if (!id) return null;
      let acc = staff.get(id);
      if (!acc) {
        acc = {
          appointmentsHandled: 0,
          encountersOpened: 0,
          consultationMinutes: 0,
          consultationSamples: 0,
          tasksCompleted: 0,
          queueServed: 0,
        };
        staff.set(id, acc);
      }
      return acc;
    };

    const appointments = await db.appointment.groupBy({
      by: ['providerId'],
      where: { organizationId, status: 'COMPLETED', startsAt: window, ...(target ? { providerId: target } : {}) },
      _count: { _all: true },
    });
    for (const row of appointments) {
      const acc = touch(row.providerId);
      if (acc) acc.appointmentsHandled += row._count._all;
    }

    const encounters = await db.encounter.findMany({
      where: {
        organizationId,
        openedAt: window,
        ...(target ? { providerId: target } : {}),
      },
      select: { providerId: true, inProgressAt: true, completedAt: true },
    });
    for (const row of encounters) {
      const acc = touch(row.providerId);
      if (!acc) continue;
      acc.encountersOpened += 1;
      if (row.inProgressAt && row.completedAt) {
        acc.consultationMinutes += (row.completedAt.getTime() - row.inProgressAt.getTime()) / 60000;
        acc.consultationSamples += 1;
      }
    }

    const tasks = await db.task.groupBy({
      by: ['assignedUserId'],
      where: {
        organizationId,
        status: 'DONE',
        completedAt: window,
        ...(target ? { assignedUserId: target } : {}),
      },
      _count: { _all: true },
    });
    for (const row of tasks) {
      const acc = touch(row.assignedUserId);
      if (acc) acc.tasksCompleted += row._count._all;
    }

    const queueServed = await db.queueEntry.groupBy({
      by: ['servedByUserId'],
      where: {
        organizationId,
        status: 'COMPLETED',
        completedAt: window,
        ...(target ? { servedByUserId: target } : {}),
      },
      _count: { _all: true },
    });
    for (const row of queueServed) {
      const acc = touch(row.servedByUserId);
      if (acc) acc.queueServed += row._count._all;
    }

    const items = [...staff.entries()]
      .map(([staffId, acc]) => ({
        staffId,
        appointmentsHandled: acc.appointmentsHandled,
        encountersOpened: acc.encountersOpened,
        avgConsultationMinutes: averageOf(acc.consultationMinutes, acc.consultationSamples),
        tasksCompleted: acc.tasksCompleted,
        queueServed: acc.queueServed,
      }))
      .sort((a, b) => b.appointmentsHandled - a.appointmentsHandled);

    return {
      interpretation:
        'Raw measurements aggregated from recorded activity. Not intended for individual performance evaluation or automated employment decisions.',
      period: { from: from.toISOString(), to: to.toISOString() },
      items,
    };
  }
}