/**
 * Typed, versioned event catalog. Every outbox consumer subscribes to these
 * exact names. Payloads carry IDs only (never PHI). Add events here before
 * emitting them; version bumps are explicit.
 */
export const EventTypes = {
  OrganizationProvisioned: 'OrganizationProvisioned',
  OutboxEventDead: 'OutboxEventDead',
  /** Identity & access (Phase 1). */
  StaffInvited: 'Identity.StaffInvited',
  UserActivated: 'Identity.UserActivated',
  UserSuspended: 'Identity.UserSuspended',
  UserDeactivated: 'Identity.UserDeactivated',
  BreakGlassRequested: 'Access.BreakGlassRequested',
  /** Object storage (Phase 2): a document finished uploading to S3/MinIO. */
  DocumentUploaded: 'Storage.DocumentUploaded',
  /** Patients (brief Phase 2). */
  PatientRegistered: 'Patient.PatientRegistered',
  PatientUpdated: 'Patient.PatientUpdated',
  PatientDuplicateConfirmed: 'Patient.PatientDuplicateConfirmed',
  PatientMerged: 'Patient.PatientMerged',
  PatientGuardianAdded: 'Patient.PatientGuardianAdded',
  PatientGuardianRemoved: 'Patient.PatientGuardianRemoved',
  PatientConsentChanged: 'Patient.PatientConsentChanged',
  PatientAllergyRecorded: 'Patient.PatientAllergyRecorded',
  PatientMedicalHistoryAdded: 'Patient.PatientMedicalHistoryAdded',
  /**
   * Test/demo signal used by the Phase 0 harness (see modules/demo and
   * docs/limitations.md). Removed from the catalog before production use.
   */
  Probe: 'CareOS.Probe',
} as const;

export type EventType = (typeof EventTypes)[keyof typeof EventTypes];

export const EVENT_VERSION: Record<EventType, number> = {
  [EventTypes.OrganizationProvisioned]: 1,
  [EventTypes.OutboxEventDead]: 1,
  [EventTypes.StaffInvited]: 1,
  [EventTypes.UserActivated]: 1,
  [EventTypes.UserSuspended]: 1,
  [EventTypes.UserDeactivated]: 1,
  [EventTypes.BreakGlassRequested]: 1,
  [EventTypes.DocumentUploaded]: 1,
  [EventTypes.PatientRegistered]: 1,
  [EventTypes.PatientUpdated]: 1,
  [EventTypes.PatientDuplicateConfirmed]: 1,
  [EventTypes.PatientMerged]: 1,
  [EventTypes.PatientGuardianAdded]: 1,
  [EventTypes.PatientGuardianRemoved]: 1,
  [EventTypes.PatientConsentChanged]: 1,
  [EventTypes.PatientAllergyRecorded]: 1,
  [EventTypes.PatientMedicalHistoryAdded]: 1,
  [EventTypes.Probe]: 1,
};
