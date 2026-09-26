import { Injectable } from '@nestjs/common';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { EventTypes } from '../../events/catalog';
import { RollupsService } from './rollups.service';
import { businessDay } from './domain/rollup-cells';

/**
 * Rollup touch consumer (brief Phase 11 §7.1). The outbox is deduplicated
 * exactly-once per (consumer, event) via ProcessedEvent, so touching a day on
 * every relevant event is idempotent: recomputeDay is a full recompute of that
 * org-day across all scopes and upserts by unique key. Payloads carry IDs only
 * (never PHI); the source row is looked up under RLS for its timestamps.
 */
@Injectable()
export class RollupTouchConsumer implements OutboxConsumer {
  readonly name = 'rollup-touch';

  readonly eventTypes: ReadonlyArray<string> = [
    EventTypes.AppointmentBooked,
    EventTypes.AppointmentConfirmed,
    EventTypes.AppointmentCheckedIn,
    EventTypes.AppointmentStarted,
    EventTypes.AppointmentCompleted,
    EventTypes.AppointmentCancelled,
    EventTypes.AppointmentNoShow,
    EventTypes.AppointmentRescheduled,
    EventTypes.QueueEntryCreated,
    EventTypes.QueueEntryCalled,
    EventTypes.QueueEntryStarted,
    EventTypes.QueueEntryCompleted,
    EventTypes.QueueEntryNoShow,
    EventTypes.QueueEntryTransferred,
    EventTypes.QueueEntryPriorityChanged,
    EventTypes.VisitStatusChanged,
    EventTypes.VitalRecorded,
    EventTypes.EncounterCreated,
    EventTypes.EncounterStarted,
    EventTypes.EncounterCompleted,
    EventTypes.DiagnosisRecorded,
    EventTypes.TaskCreated,
    EventTypes.TaskStatusChanged,
    EventTypes.PrescriptionIssued,
    EventTypes.PrescriptionDispensed,
    EventTypes.PrescriptionCancelled,
    EventTypes.StockReceived,
    EventTypes.LabOrderCreated,
    EventTypes.LabSampleRejected,
    EventTypes.LabResultReleased,
    EventTypes.RadiologyOrderCreated,
    EventTypes.RadiologyReportReleased,
    EventTypes.AdmissionCreated,
    EventTypes.AdmissionDischarged,
    EventTypes.EmergencyVisitRegistered,
    EventTypes.EmergencyVisitTriaged,
    EventTypes.EmergencyVisitAdmitted,
    EventTypes.EmergencyVisitDischarged,
    EventTypes.FeedbackSubmitted,
    EventTypes.InvoiceIssued,
    EventTypes.InvoiceCancelled,
    EventTypes.InvoiceRefunded,
    EventTypes.PaymentCompleted,
    EventTypes.PaymentRefunded,
    EventTypes.ClaimSubmitted,
    EventTypes.ClaimDecided,
    EventTypes.ClaimPaid,
  ];

  constructor(private readonly rollups: RollupsService) {}

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const payload = (ctx.row.payload ?? {}) as Record<string, unknown>;
    const stringOf = (v: unknown): string | undefined =>
      typeof v === 'string' && v.length > 0 ? v : undefined;

    const day = (t: Date | null | undefined): Date | undefined =>
      t ? businessDay(t) : undefined;

    const touchDays = async (days: Array<Date | undefined>): Promise<void> => {
      const seen = new Set<string>();
      for (const d of days) {
        if (!d) continue;
        const key = d.toISOString();
        if (seen.has(key)) continue;
        seen.add(key);
        await this.rollups.recomputeDay(ctx.organizationId, d);
      }
    };

    switch (ctx.row.type) {
      case EventTypes.AppointmentBooked:
      case EventTypes.AppointmentConfirmed:
      case EventTypes.AppointmentCheckedIn:
      case EventTypes.AppointmentStarted:
      case EventTypes.AppointmentCompleted:
      case EventTypes.AppointmentCancelled:
      case EventTypes.AppointmentNoShow: {
        const id = stringOf(payload.appointmentId) ?? ctx.row.aggregateId;
        if (!id) return;
        const row = await ctx.db.appointment.findUnique({
          where: { id },
          select: {
            createdAt: true,
            startsAt: true,
            completedAt: true,
            cancelledAt: true,
            noShowAt: true,
            rescheduledAt: true,
          },
        });
        if (!row) return;
        await touchDays([
          day(row.createdAt),
          day(row.startsAt),
          day(row.completedAt),
          day(row.cancelledAt),
          day(row.noShowAt),
          day(row.rescheduledAt),
        ]);
        return;
      }
      case EventTypes.AppointmentRescheduled: {
        const id = stringOf(payload.toAppointmentId);
        if (!id) return;
        const row = await ctx.db.appointment.findUnique({
          where: { id },
          select: { createdAt: true, startsAt: true, rescheduledAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt), day(row.startsAt), day(row.rescheduledAt)]);
        return;
      }
      case EventTypes.QueueEntryCreated:
      case EventTypes.QueueEntryCalled:
      case EventTypes.QueueEntryStarted:
      case EventTypes.QueueEntryCompleted:
      case EventTypes.QueueEntryNoShow:
      case EventTypes.QueueEntryTransferred:
      case EventTypes.QueueEntryPriorityChanged: {
        const ticket = stringOf(payload.ticketNumber);
        if (!ticket) return;
        const row = await ctx.db.queueEntry.findFirst({
          where: { organizationId: ctx.organizationId, ticketNumber: ticket },
          orderBy: { createdAt: 'desc' },
          select: { queueDate: true, enteredAt: true, serviceStartedAt: true, completedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.queueDate), day(row.enteredAt), day(row.serviceStartedAt), day(row.completedAt)]);
        return;
      }
      case EventTypes.VisitStatusChanged: {
        const id = stringOf(payload.visitId);
        if (!id) return;
        const row = await ctx.db.visit.findUnique({
          where: { id },
          select: { createdAt: true, completedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt), day(row.completedAt)]);
        return;
      }
      case EventTypes.VitalRecorded: {
        const row = await ctx.db.vitalRecord.findFirst({
          where: { organizationId: ctx.organizationId },
          orderBy: { createdAt: 'desc' },
          select: { observedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.observedAt)]);
        return;
      }
      case EventTypes.EncounterCreated:
      case EventTypes.EncounterStarted:
      case EventTypes.EncounterCompleted: {
        const id = stringOf(payload.encounterId);
        if (!id) return;
        const row = await ctx.db.encounter.findUnique({
          where: { id },
          select: { openedAt: true, inProgressAt: true, completedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.openedAt), day(row.inProgressAt), day(row.completedAt)]);
        return;
      }
      case EventTypes.DiagnosisRecorded: {
        const id = stringOf(payload.diagnosisId);
        if (!id) return;
        const row = await ctx.db.diagnosis.findUnique({
          where: { id },
          select: { createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt)]);
        return;
      }
      case EventTypes.TaskCreated:
      case EventTypes.TaskStatusChanged: {
        const id = stringOf(payload.taskId);
        if (!id) return;
        const row = await ctx.db.task.findUnique({
          where: { id },
          select: { createdAt: true, completedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt), day(row.completedAt)]);
        return;
      }
      case EventTypes.PrescriptionIssued:
      case EventTypes.PrescriptionDispensed:
      case EventTypes.PrescriptionCancelled: {
        const id = stringOf(payload.prescriptionId);
        if (!id) return;
        const row = await ctx.db.prescription.findUnique({
          where: { id },
          select: { issuedAt: true, dispensedAt: true, cancelledAt: true },
        });
        if (!row) return;
        await touchDays([day(row.issuedAt), day(row.dispensedAt), day(row.cancelledAt)]);
        return;
      }
      case EventTypes.StockReceived: {
        const batchId = Array.isArray(payload.batches) ? stringOf(payload.batches[0]?.id) : undefined;
        if (!batchId) return;
        const row = await ctx.db.stockBatch.findUnique({
          where: { id: batchId },
          select: { receivedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.receivedAt)]);
        return;
      }
      case EventTypes.LabOrderCreated:
      case EventTypes.LabResultReleased: {
        const id = stringOf(payload.orderId);
        if (!id) return;
        const row = await ctx.db.labOrder.findUnique({
          where: { id },
          select: { createdAt: true, releasedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt), day(row.releasedAt)]);
        return;
      }
      case EventTypes.LabSampleRejected: {
        const orderId = stringOf(payload.orderId);
        if (!orderId) return;
        const row = await ctx.db.labSample.findFirst({
          where: { orderId },
          orderBy: { rejectedAt: 'desc' },
          select: { rejectedAt: true, createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.rejectedAt), day(row.createdAt)]);
        return;
      }
      case EventTypes.RadiologyOrderCreated:
      case EventTypes.RadiologyReportReleased: {
        const id = stringOf(payload.orderId);
        if (!id) return;
        const row = await ctx.db.radiologyOrder.findUnique({
          where: { id },
          select: { createdAt: true, releasedAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt), day(row.releasedAt)]);
        return;
      }
      case EventTypes.AdmissionCreated:
      case EventTypes.AdmissionDischarged: {
        const id = stringOf(payload.admissionId);
        if (!id) return;
        if (ctx.row.type === EventTypes.AdmissionDischarged) {
          const discharge = await ctx.db.discharge.findFirst({
            where: { admissionId: id },
            orderBy: { dischargedAt: 'desc' },
            select: { dischargedAt: true, createdAt: true },
          });
          if (!discharge) return;
          await touchDays([day(discharge.dischargedAt), day(discharge.createdAt)]);
          return;
        }
        const row = await ctx.db.admission.findUnique({
          where: { id },
          select: { admittedAt: true, createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.admittedAt), day(row.createdAt)]);
        return;
      }
      case EventTypes.EmergencyVisitRegistered:
      case EventTypes.EmergencyVisitTriaged:
      case EventTypes.EmergencyVisitAdmitted:
      case EventTypes.EmergencyVisitDischarged: {
        const id = stringOf(payload.visitId);
        if (!id) return;
        const row = await ctx.db.emergencyVisit.findUnique({
          where: { id },
          select: { arrivedAt: true, triagedAt: true, dispositionAt: true },
        });
        if (!row) return;
        await touchDays([day(row.arrivedAt), day(row.triagedAt), day(row.dispositionAt)]);
        return;
      }
      case EventTypes.FeedbackSubmitted: {
        const id = stringOf(payload.feedbackId);
        if (!id) return;
        const row = await ctx.db.feedback.findUnique({
          where: { id },
          select: { createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.createdAt)]);
        return;
      }
      case EventTypes.InvoiceIssued:
      case EventTypes.InvoiceCancelled:
      case EventTypes.InvoiceRefunded: {
        const id = stringOf(payload.invoiceId);
        if (!id) return;
        const row = await ctx.db.invoice.findUnique({
          where: { id },
          select: { issuedAt: true, cancelledAt: true, refundedAt: true, createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.issuedAt), day(row.cancelledAt), day(row.refundedAt), day(row.createdAt)]);
        return;
      }
      case EventTypes.PaymentCompleted:
      case EventTypes.PaymentRefunded: {
        const id = stringOf(payload.paymentId);
        if (!id) return;
        const row = await ctx.db.payment.findUnique({
          where: { id },
          select: { recordedAt: true, refundedAt: true, createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.recordedAt), day(row.refundedAt), day(row.createdAt)]);
        return;
      }
      case EventTypes.ClaimSubmitted:
      case EventTypes.ClaimDecided:
      case EventTypes.ClaimPaid: {
        const id = stringOf(payload.claimId);
        if (!id) return;
        const row = await ctx.db.insuranceClaim.findUnique({
          where: { id },
          select: { submittedAt: true, approvedAt: true, paidAt: true, createdAt: true },
        });
        if (!row) return;
        await touchDays([day(row.submittedAt), day(row.approvedAt), day(row.paidAt), day(row.createdAt)]);
        return;
      }
      default: {
        // Event types the map above does not need are ignored by design
        // (e.g. snapshot-only metrics read raw tables on demand).
        return;
      }
    }
  }
}