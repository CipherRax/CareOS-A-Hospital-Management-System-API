import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { ForecastQueryDto } from './dto/insights.dto';
import {
  DEFAULT_FORECASTER,
  toForecastResult,
} from './domain/forecaster';
import { addUTCDays, businessDay } from './domain/rollup-cells';
import { resolveWindow } from './domain/window';

type SeriesKind = 'appointment-demand' | 'inventory-demand' | 'bed-occupancy' | 'lab-workload';

const NOTES: Record<SeriesKind, string> = {
  'appointment-demand': 'Based on daily appointment bookings.',
  'inventory-demand': 'Based on daily dispensed quantities.',
  'bed-occupancy': 'Based on occupied beds at the end of each day.',
  'lab-workload': 'Based on daily lab orders created.',
};

/**
 * Forecasting (brief Phase 11 §7.11). Every response is a labelled estimate:
 * it carries kind=forecast, the statistical model name+version, the fit
 * period, a horizon, and an uncertainty band. The baseline model is a weekly
 * seasonal naive that degrades to a moving average on short histories (domain/
 * forecaster.ts). No clinical or business promises are made.
 */
@Injectable()
export class ForecastsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async bySeries(kind: SeriesKind, query: ForecastQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 28);
    const start = businessDay(from);
    const history = await this.buildHistory(kind, organizationId, db, start, to, query);
    if (history.length === 0) {
      return toForecastResult({
        forecaster: DEFAULT_FORECASTER,
        start,
        history: [0],
        horizon: query.horizon,
        notes: [NOTES[kind], 'No historical data in window; series treated as a flat baseline of zero.'],
      });
    }
    return toForecastResult({
      forecaster: DEFAULT_FORECASTER,
      start,
      history,
      horizon: query.horizon,
      notes: [NOTES[kind]],
    });
  }

  unknownSeries(series: string, query: ForecastQueryDto) {
    const { from } = resolveWindow(query.from, query.to, 28);
    return toForecastResult({
      forecaster: DEFAULT_FORECASTER,
      start: businessDay(from),
      history: [0],
      horizon: query.horizon,
      notes: [
        `Unknown forecast series "${series}". Known series: appointment-demand, inventory-demand, bed-occupancy, lab-workload.`,
      ],
    });
  }

  private async buildHistory(
    kind: SeriesKind,
    organizationId: string,
    db: ReturnType<PrismaService['tenantFor']>,
    start: Date,
    to: Date,
    query: ForecastQueryDto,
  ): Promise<number[]> {
    const end = businessDay(to);
    const dayCount = Math.round((end.getTime() - start.getTime()) / 86_400_000) + 1;
    const buffer = new Array<number>(Math.max(1, dayCount)).fill(0);
    const keyOf = (d: Date): number =>
      Math.round((businessDay(d).getTime() - start.getTime()) / 86_400_000);

    switch (kind) {
      case 'appointment-demand': {
        const rows = await db.appointment.findMany({
          where: { organizationId, createdAt: { gte: start, lte: end }, ...branchDept(query) },
          select: { createdAt: true },
        });
        for (const r of rows) {
          const idx = keyOf(r.createdAt);
          if (idx >= 0 && idx < buffer.length) buffer[idx] = (buffer[idx] ?? 0) + 1;
        }
        return buffer;
      }
      case 'inventory-demand': {
        const rows = await db.inventoryLedgerEntry.findMany({
          where: {
            organizationId,
            operation: 'DISPENSED',
            occurredAt: { gte: start, lte: end },
            ...(query.medicationId ? { medicationId: query.medicationId } : {}),
            ...(query.branchId ? { branchId: query.branchId } : {}),
          },
          select: { occurredAt: true, quantity: true },
        });
        for (const r of rows) {
          const idx = keyOf(r.occurredAt);
          if (idx >= 0 && idx < buffer.length) buffer[idx] = (buffer[idx] ?? 0) + Math.abs(r.quantity);
        }
        return buffer;
      }
      case 'bed-occupancy': {
        const assignments = await db.bedAssignment.findMany({
          where: {
            organizationId,
            assignedAt: { lte: end },
            OR: [{ releasedAt: null }, { releasedAt: { gte: start } }],
          },
          select: { assignedAt: true, releasedAt: true },
        });
        for (let i = 0; i < buffer.length; i += 1) {
          const day = addUTCDays(start, i);
          const dayEnd = addUTCDays(day, 1);
          buffer[i] = assignments.filter(
            (a) => a.assignedAt < dayEnd && (a.releasedAt === null || a.releasedAt >= day),
          ).length;
        }
        return buffer;
      }
      case 'lab-workload': {
        const rows = await db.labOrder.findMany({
          where: { organizationId, createdAt: { gte: start, lte: end }, ...branchDept(query) },
          select: { createdAt: true },
        });
        for (const r of rows) {
          const idx = keyOf(r.createdAt);
          if (idx >= 0 && idx < buffer.length) buffer[idx] = (buffer[idx] ?? 0) + 1;
        }
        return buffer;
      }
    }
  }
}

function branchDept(query: ForecastQueryDto): {
  branchId?: string;
  departmentId?: string;
} {
  const out: { branchId?: string; departmentId?: string } = {};
  if (query.branchId) out.branchId = query.branchId;
  if (query.departmentId) out.departmentId = query.departmentId;
  return out;
}