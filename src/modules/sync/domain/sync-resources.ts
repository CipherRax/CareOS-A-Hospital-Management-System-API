import { PERMISSION_GROUPS } from '../../../common/auth/permissions.catalog';
import { EventTypes } from '../../../events/catalog';

/**
 * The syncable resource registry (brief §10).
 *
 * A client syncs by resource type (`GET /sync?resources=patient,appointment`).
 * Each entry declares:
 *  - the permission a caller must hold to receive rows of that type,
 *  - the domain events that produce a change row for it, and
 *  - the payload key that carries the changed aggregate's id, so the change-log
 *    consumer can project a row without a per-event switch.
 *
 * This is the single source that keeps the change-log projection and the read
 * filter from drifting: the consumer writes `requiredPermission` from here, and
 * the read path filters by the caller's effective permissions from the same
 * table.
 */
export interface SyncableResource {
  /** The value a client passes in `?resources=` and sees in each row. */
  readonly type: string;
  /** Permission required to receive these rows. */
  readonly permission: string;
  /** Payload key holding the resource id for events in `events`. */
  readonly idKey: string;
  /** Event names (catalog.ts) that touch this resource. */
  readonly events: readonly string[];
  /**
   * Payload keys that, when present, carry a branch id. Omitted when the event
   * does not scope to a branch.
   */
  readonly branchKey?: string;
}

export const SYNCABLE_RESOURCES: readonly SyncableResource[] = [
  {
    type: 'patient',
    permission: PERMISSION_GROUPS.patients.read,
    idKey: 'patientId',
    events: [
      EventTypes.PatientRegistered,
      EventTypes.PatientUpdated,
      EventTypes.PatientMerged,
      EventTypes.PatientAllergyRecorded,
      EventTypes.PatientMedicalHistoryAdded,
      EventTypes.PatientConsentChanged,
      EventTypes.PatientGuardianAdded,
      EventTypes.PatientGuardianRemoved,
    ],
  },
  {
    type: 'appointment',
    permission: PERMISSION_GROUPS.appointments.read,
    idKey: 'appointmentId',
    events: [
      EventTypes.AppointmentBooked,
      EventTypes.AppointmentRescheduled,
      EventTypes.WaitlistOfferCreated,
      EventTypes.WaitlistOfferAccepted,
      EventTypes.WaitlistOfferDeclined,
    ],
  },
  {
    type: 'waitlist_entry',
    permission: PERMISSION_GROUPS.waitlist.read,
    idKey: 'waitlistEntryId',
    events: [EventTypes.WaitlistJoined],
  },
  {
    type: 'visit',
    permission: PERMISSION_GROUPS.visits.read,
    idKey: 'visitId',
    events: [EventTypes.VisitStatusChanged],
  },
  {
    type: 'vital_record',
    permission: PERMISSION_GROUPS.vitals.read,
    idKey: 'vitalRecordId',
    events: [EventTypes.VitalRecorded],
  },
  {
    type: 'encounter',
    permission: PERMISSION_GROUPS.encounters.read,
    idKey: 'encounterId',
    events: [EventTypes.EncounterCreated],
  },
  {
    type: 'clinical_note',
    permission: PERMISSION_GROUPS.clinicalNotes.read,
    idKey: 'noteId',
    events: [
      EventTypes.ClinicalNoteCreated,
      EventTypes.ClinicalNoteFinalized,
      EventTypes.ClinicalNoteAmended,
    ],
  },
  {
    type: 'diagnosis',
    permission: PERMISSION_GROUPS.diagnoses.read,
    idKey: 'diagnosisId',
    events: [EventTypes.DiagnosisRecorded],
  },
  {
    type: 'prescription',
    permission: PERMISSION_GROUPS.prescriptions.read,
    idKey: 'prescriptionId',
    events: [EventTypes.PrescriptionDispensed],
  },
  {
    type: 'follow_up',
    permission: PERMISSION_GROUPS.followUps.read,
    idKey: 'followUpId',
    events: [EventTypes.FollowUpCreated, EventTypes.FollowUpStatusChanged],
  },
  {
    type: 'referral',
    permission: PERMISSION_GROUPS.referrals.read,
    idKey: 'referralId',
    events: [EventTypes.ReferralCreated],
  },
  {
    type: 'invoice',
    permission: PERMISSION_GROUPS.billing.read,
    idKey: 'invoiceId',
    events: [EventTypes.InvoiceRefunded],
  },
  {
    type: 'payment',
    permission: PERMISSION_GROUPS.billing.read,
    idKey: 'paymentId',
    events: [
      EventTypes.PaymentCompleted,
      EventTypes.PaymentRefunded,
      EventTypes.PaymentConfirmed,
      EventTypes.PaymentFailed,
    ],
  },
  {
    type: 'lab_order',
    permission: PERMISSION_GROUPS.lab.read,
    idKey: 'orderId',
    events: [
      EventTypes.LabOrderCreated,
      EventTypes.LabSampleCollected,
      EventTypes.LabSampleRejected,
      EventTypes.LabResultEntered,
      EventTypes.LabResultAmended,
      EventTypes.LabResultVerified,
      EventTypes.LabResultReleased,
      EventTypes.LabCriticalResultRaised,
      EventTypes.LabCriticalResultAcknowledged,
    ],
  },
  {
    type: 'radiology_order',
    permission: PERMISSION_GROUPS.radiology.read,
    idKey: 'orderId',
    events: [
      EventTypes.RadiologyOrderCreated,
      EventTypes.RadiologyPerformed,
      EventTypes.RadiologyReportSubmitted,
      EventTypes.RadiologyReportReleased,
    ],
  },
  {
    type: 'admission',
    permission: PERMISSION_GROUPS.inpatient.read,
    idKey: 'admissionId',
    events: [
      EventTypes.AdmissionCreated,
      EventTypes.AdmissionTransferred,
      EventTypes.AdmissionDischarged,
    ],
  },
];

const BY_TYPE = new Map(SYNCABLE_RESOURCES.map((r) => [r.type, r]));

/** All event names that produce a change row, deduplicated. */
export const SYNC_BACKED_EVENTS: readonly string[] = Array.from(
  new Set(SYNCABLE_RESOURCES.flatMap((r) => r.events)),
);

/** The reverse map a consumer uses: event name → resource definition. */
export const EVENT_TO_RESOURCE: ReadonlyMap<string, SyncableResource> = new Map(
  SYNCABLE_RESOURCES.flatMap((r) => r.events.map((e) => [e, r] as const)),
);

export function isSyncableResource(type: string): boolean {
  return BY_TYPE.has(type);
}

export function resourceFor(type: string): SyncableResource | undefined {
  return BY_TYPE.get(type);
}

/**
 * A client-supplied cursor is the `seq` of the last change row it saw. Absent
 * or empty means "from the beginning". Any other malformed value is rejected
 * so a typo cannot silently return an unfiltered or empty page.
 */
export function isCursorShaped(cursor: string): boolean {
  return /^\d{1,19}$/.test(cursor);
}

/**
 * Extracts the changed aggregate's id for a decoded event. `resourceId` is
 * deliberately not assumed from a single key: some events name the aggregate
 * differently (e.g. reschedules/merges carry `from…`/`to…`), so the caller may
 * pass an explicit override.
 */
export function resourceIdFromPayload(
  resource: SyncableResource,
  payload: Record<string, unknown>,
  aggregateId: string,
): string {
  const value = payload[resource.idKey];
  if (typeof value === 'string' && value.length > 0) return value;
  return aggregateId;
}
