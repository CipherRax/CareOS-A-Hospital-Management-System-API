import { Injectable } from '@nestjs/common';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import type { BottleneckQueryDto } from './dto/insights.dto';
import { resolveWindow, round2 } from './domain/window';

interface StageAggregate {
  key: string;
  label: string;
  minutes: number[];
}

/**
 * Journey bottleneck analysis (brief Phase 11 §7.9). Averages the recorded
 * timestamps for each journey stage and ranks them by mean duration. Stages
 * map on to the timestamps the modules actually record (registration →
 * triage → provider → results → completion); per-visit LAB/PHARMACY/BILLING
 * sub-phases are not recorded separately, so those use order-level timestamps
 * (lab TAT, prescription issue→dispense, invoice issue→first completed
 * payment). No causal claims are made.
 */
@Injectable()
export class BottleneckService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async analyze(query: BottleneckQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(query.from, query.to, 30);
    const window = { gte: from, lte: to };

    const stages = new Map<string, StageAggregate>();
    const add = (
      key: string,
      label: string,
      start: Date | null | undefined,
      end: Date | null | undefined,
    ): void => {
      if (!start || !end || end <= start) return;
      let stage = stages.get(key);
      if (!stage) {
        stage = { key, label, minutes: [] };
        stages.set(key, stage);
      }
      stage.minutes.push((end.getTime() - start.getTime()) / 60000);
    };

    const visits = await db.visit.findMany({
      where: { organizationId, OR: [{ createdAt: window }, { completedAt: window }] },
      select: {
        registeredAt: true,
        createdAt: true,
        triageAt: true,
        providerStartedAt: true,
        completedAt: true,
      },
    });
    for (const v of visits) {
      const registered = v.registeredAt ?? v.createdAt;
      add('REGISTRATION_TO_TRIAGE', 'Registration → triage', registered, v.triageAt);
      add('TRIAGE_TO_PROVIDER', 'Triage → provider', v.triageAt, v.providerStartedAt);
      add('CONSULTATION', 'Provider consultation', v.providerStartedAt, v.completedAt);
    }

    const labOrders = await db.labOrder.findMany({
      where: { organizationId, releasedAt: window },
      select: { orderedAt: true, createdAt: true, releasedAt: true },
    });
    for (const row of labOrders) {
      add('LABORATORY', 'Laboratory (order → release)', row.orderedAt ?? row.createdAt, row.releasedAt);
    }

    const prescriptions = await db.prescription.findMany({
      where: { organizationId, dispensedAt: window },
      select: { issuedAt: true, createdAt: true, dispensedAt: true },
    });
    for (const row of prescriptions) {
      add('PHARMACY', 'Pharmacy (prescription issued → dispensed)', row.issuedAt ?? row.createdAt, row.dispensedAt);
    }

    const invoices = await db.invoice.findMany({
      where: { organizationId, status: { in: ['PAID', 'PARTIALLY_PAID'] }, issuedAt: window },
      select: { id: true, issuedAt: true, createdAt: true, payments: {
        where: { status: 'COMPLETED' },
        select: { recordedAt: true, createdAt: true },
        orderBy: { createdAt: 'asc' },
      } },
    });
    for (const row of invoices) {
      const firstPayment = row.payments[0];
      if (firstPayment) {
        const paidAt = firstPayment.recordedAt ?? firstPayment.createdAt;
        add('BILLING', 'Billing (invoice issued → first completed payment)', row.issuedAt ?? row.createdAt, paidAt);
      }
    }

    const ranked = [...stages.values()]
      .map((stage) => {
        const sorted = [...stage.minutes].sort((a, b) => a - b);
        const mean = round2(sorted.reduce((a, b) => a + b, 0) / sorted.length);
        const medianIndex = Math.floor(sorted.length / 2);
        const median = sorted.length ? round2(sorted[medianIndex] ?? 0) : null;
        return {
          key: stage.key,
          label: stage.label,
          avgMinutes: mean,
          medianMinutes: median,
          samples: stage.minutes.length,
        };
      })
      .sort((a, b) => b.avgMinutes - a.avgMinutes);

    return {
      interpretation:
        'Descriptive averages from recorded timestamps. LABORATORY/PHARMACY/BILLING use order-level timestamps where per-visit phase timestamps are not recorded. No causal or clinical claims.',
      order: ['REGISTRATION_TO_TRIAGE', 'TRIAGE_TO_PROVIDER', 'CONSULTATION', 'LABORATORY', 'PHARMACY', 'BILLING'],
      stages: ranked,
      period: { from: from.toISOString(), to: to.toISOString() },
    };
  }
}