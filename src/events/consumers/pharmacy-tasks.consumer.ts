import { Injectable } from '@nestjs/common';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { EventTypes } from '../../events/catalog';

/**
 * Pharmacy task projection, fed from the outbox (brief Phase 5). When a
 * prescription is issued, a dispensing task is created for the pharmacy queue.
 *
 * Idempotency: the task id is pinned to the prescription id (deterministic), so
 * replays upsert instead of duplicating. Payloads carry IDs only (never PHI).
 */
@Injectable()
export class PharmacyTaskConsumer implements OutboxConsumer {
  readonly name = 'pharmacy-tasks';

  readonly eventTypes: ReadonlyArray<string> = [EventTypes.PrescriptionIssued];

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = (ctx.row.payload ?? {}) as { prescriptionId?: unknown; patientId?: unknown };
    if (typeof payload.prescriptionId !== 'string' || payload.prescriptionId.length === 0) {
      return;
    }
    const patientId = typeof payload.patientId === 'string' ? payload.patientId : null;

    const prescription = await ctx.db.prescription.findFirst({
      where: { id: payload.prescriptionId, organizationId: ctx.organizationId },
      select: { id: true, providerId: true, branchId: true },
    });
    if (!prescription) return;

    await ctx.db.task.upsert({
      where: { id: payload.prescriptionId },
      create: {
        id: payload.prescriptionId,
        organizationId: ctx.organizationId,
        title: 'Dispense prescription',
        description: `Dispense the issued prescription (${payload.prescriptionId}).`,
        priority: 'NORMAL',
        status: 'OPEN',
        patientId,
        // createdById is a FK to a real user — fall back to the prescribing
        // provider who issued the prescription (never a synthetic id).
        createdById: ctx.row.actorId ?? prescription.providerId,
      },
      update: {},
    });
  }
}