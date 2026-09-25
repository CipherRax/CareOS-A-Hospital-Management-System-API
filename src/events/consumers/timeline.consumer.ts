import { Injectable } from '@nestjs/common';
import type { Prisma } from '@prisma/client';
import {
  type OutboxConsumer,
  type OutboxConsumerContext,
} from '../../events/outbox-consumer/outbox-consumer.types';
import { newId } from '../../common/lib/uuidv7';
import { EventTypes } from '../../events/catalog';

/**
 * Patient timeline projection, fed from the outbox. This is the "timeline built
 * from events" path (brief §5.7): Phase 4 clinical modules emit events; the
 * worker/consumer writes the PatientTimelineEntry projection idempotently.
 *
 * Idempotency: each entry is pinned to its source event via
 * `sourceEventId` (+ unique index) so replays upsert instead of duplicating.
 * Payloads carry IDs only (never PHI).
 */
@Injectable()
export class TimelineProjectionConsumer implements OutboxConsumer {
  readonly name = 'timeline-projection';

  readonly eventTypes: ReadonlyArray<string> = [
    EventTypes.EncounterCreated,
    EventTypes.EncounterStarted,
    EventTypes.EncounterCompleted,
    EventTypes.ClinicalNoteCreated,
    EventTypes.ClinicalNoteFinalized,
    EventTypes.ClinicalNoteAmended,
    EventTypes.DiagnosisRecorded,
    EventTypes.DiagnosisResolved,
    EventTypes.FollowUpCreated,
    EventTypes.ReferralCreated,
    EventTypes.ReferralCompleted,
    EventTypes.TaskCreated,
    EventTypes.InvoiceIssued,
    EventTypes.InvoiceCancelled,
    EventTypes.InvoiceRefunded,
    EventTypes.PaymentCompleted,
    EventTypes.PaymentRefunded,
    EventTypes.ClaimSubmitted,
    EventTypes.ClaimDecided,
    EventTypes.ClaimPaid,
    EventTypes.LabOrderCreated,
    EventTypes.LabResultReleased,
    EventTypes.LabCriticalResultRaised,
    EventTypes.LabCriticalResultAcknowledged,
    EventTypes.RadiologyOrderCreated,
    EventTypes.RadiologyReportReleased,
    EventTypes.AdmissionCreated,
    EventTypes.AdmissionTransferred,
    EventTypes.AdmissionDischarged,
    EventTypes.EmergencyVisitRegistered,
    EventTypes.EmergencyVisitTriaged,
    EventTypes.EmergencyVisitAdmitted,
    EventTypes.EmergencyVisitDischarged,
  ];

  async handle(ctx: OutboxConsumerContext): Promise<void> {
    const mapping = TIMELINE_MAP[ctx.row.type];
    if (!mapping) return;

    const payload = (ctx.row.payload ?? {}) as { patientId?: unknown };
    if (typeof payload.patientId !== 'string' || payload.patientId.length === 0) {
      // Nothing to project against without a patient — skip silently.
      return;
    }

    await ctx.db.patientTimelineEntry.upsert({
      where: {
        organizationId_sourceEventId: {
          organizationId: ctx.organizationId,
          sourceEventId: ctx.row.id,
        },
      },
      create: {
        id: newId(),
        organizationId: ctx.organizationId,
        patientId: payload.patientId,
        type: mapping.type,
        title: mapping.title,
        requiredPermission: mapping.requiredPermission,
        actorId: ctx.row.actorId,
        occurredAt: ctx.row.occurredAt,
        sourceEventId: ctx.row.id,
        payload: (ctx.row.payload ?? {}) as Prisma.InputJsonObject,
      },
      update: {},
    });
  }
}

interface TimelineSpec {
  type: string;
  title: string;
  requiredPermission: string;
}

const TIMELINE_MAP: Record<string, TimelineSpec> = {
  [EventTypes.EncounterCreated]: { type: 'encounter.created', title: 'Encounter opened', requiredPermission: 'encounters.read' },
  [EventTypes.EncounterStarted]: { type: 'encounter.in_progress', title: 'Encounter in progress', requiredPermission: 'encounters.read' },
  [EventTypes.EncounterCompleted]: { type: 'encounter.completed', title: 'Encounter completed', requiredPermission: 'encounters.read' },
  [EventTypes.ClinicalNoteCreated]: { type: 'clinical_note.created', title: 'Clinical note draft created', requiredPermission: 'clinical_notes.read' },
  [EventTypes.ClinicalNoteFinalized]: { type: 'clinical_note.finalized', title: 'Clinical note finalized', requiredPermission: 'clinical_notes.read' },
  [EventTypes.ClinicalNoteAmended]: { type: 'clinical_note.amended', title: 'Clinical note amended', requiredPermission: 'clinical_notes.read' },
  [EventTypes.DiagnosisRecorded]: { type: 'diagnosis.recorded', title: 'Diagnosis recorded', requiredPermission: 'diagnosis.read' },
  [EventTypes.DiagnosisResolved]: { type: 'diagnosis.resolved', title: 'Diagnosis resolved', requiredPermission: 'diagnosis.read' },
  [EventTypes.FollowUpCreated]: { type: 'followup.created', title: 'Follow-up scheduled', requiredPermission: 'follow_ups.read' },
  [EventTypes.ReferralCreated]: { type: 'referral.created', title: 'Referral created', requiredPermission: 'referrals.read' },
  [EventTypes.ReferralCompleted]: { type: 'referral.completed', title: 'Referral completed', requiredPermission: 'referrals.read' },
  [EventTypes.TaskCreated]: { type: 'task.created', title: 'Task created', requiredPermission: 'tasks.read' },
  [EventTypes.InvoiceIssued]: { type: 'billing.invoice.issued', title: 'Invoice issued', requiredPermission: 'billing.read' },
  [EventTypes.InvoiceCancelled]: { type: 'billing.invoice.cancelled', title: 'Invoice cancelled', requiredPermission: 'billing.read' },
  [EventTypes.InvoiceRefunded]: { type: 'billing.invoice.refunded', title: 'Invoice refunded', requiredPermission: 'billing.read' },
  [EventTypes.PaymentCompleted]: { type: 'billing.payment.completed', title: 'Payment received', requiredPermission: 'billing.read' },
  [EventTypes.PaymentRefunded]: { type: 'billing.payment.refunded', title: 'Payment refunded', requiredPermission: 'billing.read' },
  [EventTypes.ClaimSubmitted]: { type: 'billing.claim.submitted', title: 'Insurance claim submitted', requiredPermission: 'insurance.read' },
  [EventTypes.ClaimDecided]: { type: 'billing.claim.decided', title: 'Insurance claim decided', requiredPermission: 'insurance.read' },
  [EventTypes.ClaimPaid]: { type: 'billing.claim.paid', title: 'Insurance claim paid', requiredPermission: 'insurance.read' },
  [EventTypes.LabOrderCreated]: { type: 'lab.order.created', title: 'Lab order placed', requiredPermission: 'lab.read' },
  [EventTypes.LabResultReleased]: { type: 'lab.result.released', title: 'Lab result released', requiredPermission: 'lab.read' },
  [EventTypes.LabCriticalResultRaised]: { type: 'lab.critical.raised', title: 'Critical lab result flagged', requiredPermission: 'lab.read' },
  [EventTypes.LabCriticalResultAcknowledged]: { type: 'lab.critical.acknowledged', title: 'Critical lab result acknowledged', requiredPermission: 'lab.read' },
  [EventTypes.RadiologyOrderCreated]: { type: 'radiology.order.created', title: 'Radiology order placed', requiredPermission: 'radiology.read' },
  [EventTypes.RadiologyReportReleased]: { type: 'radiology.report.released', title: 'Radiology report released', requiredPermission: 'radiology.read' },
  [EventTypes.AdmissionCreated]: { type: 'inpatient.admission.created', title: 'Admitted to ward', requiredPermission: 'inpatient.read' },
  [EventTypes.AdmissionTransferred]: { type: 'inpatient.admission.transferred', title: 'Bed transfer completed', requiredPermission: 'inpatient.read' },
  [EventTypes.AdmissionDischarged]: { type: 'inpatient.admission.discharged', title: 'Discharged', requiredPermission: 'inpatient.read' },
  [EventTypes.EmergencyVisitRegistered]: { type: 'emergency.visit.registered', title: 'Emergency visit registered', requiredPermission: 'emergency.read' },
  [EventTypes.EmergencyVisitTriaged]: { type: 'emergency.visit.triaged', title: 'Emergency triage completed', requiredPermission: 'emergency.read' },
  [EventTypes.EmergencyVisitAdmitted]: { type: 'emergency.visit.admitted', title: 'Admitted from emergency', requiredPermission: 'emergency.read' },
  [EventTypes.EmergencyVisitDischarged]: { type: 'emergency.visit.discharged', title: 'Emergency visit discharged', requiredPermission: 'emergency.read' },
};