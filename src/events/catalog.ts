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
  /** Scheduling & patient flow (brief Phase 3). Payloads carry IDs only. */
  AppointmentBooked: 'Scheduling.AppointmentBooked',
  AppointmentConfirmed: 'Scheduling.AppointmentConfirmed',
  AppointmentCheckedIn: 'Scheduling.AppointmentCheckedIn',
  AppointmentStarted: 'Scheduling.AppointmentStarted',
  AppointmentCompleted: 'Scheduling.AppointmentCompleted',
  AppointmentCancelled: 'Scheduling.AppointmentCancelled',
  AppointmentNoShow: 'Scheduling.AppointmentNoShow',
  AppointmentRescheduled: 'Scheduling.AppointmentRescheduled',
  WaitlistJoined: 'Scheduling.WaitlistJoined',
  WaitlistOfferCreated: 'Scheduling.WaitlistOfferCreated',
  WaitlistOfferAccepted: 'Scheduling.WaitlistOfferAccepted',
  WaitlistOfferDeclined: 'Scheduling.WaitlistOfferDeclined',
  QueueEntryCreated: 'Queue.EntryCreated',
  QueueEntryCalled: 'Queue.EntryCalled',
  QueueEntryStarted: 'Queue.EntryStarted',
  QueueEntryCompleted: 'Queue.EntryCompleted',
  QueueEntryNoShow: 'Queue.EntryNoShow',
  QueueEntryTransferred: 'Queue.EntryTransferred',
  QueueEntryPriorityChanged: 'Queue.EntryPriorityChanged',
  VisitStatusChanged: 'Queue.VisitStatusChanged',
  VitalRecorded: 'Triage.VitalRecorded',
  DisplayDevicePaired: 'Display.DevicePaired',
  DisplayDeviceRevoked: 'Display.DeviceRevoked',
  DisplayDeviceRotated: 'Display.DeviceRotated',
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
  [EventTypes.AppointmentBooked]: 1,
  [EventTypes.AppointmentConfirmed]: 1,
  [EventTypes.AppointmentCheckedIn]: 1,
  [EventTypes.AppointmentStarted]: 1,
  [EventTypes.AppointmentCompleted]: 1,
  [EventTypes.AppointmentCancelled]: 1,
  [EventTypes.AppointmentNoShow]: 1,
  [EventTypes.AppointmentRescheduled]: 1,
  [EventTypes.WaitlistJoined]: 1,
  [EventTypes.WaitlistOfferCreated]: 1,
  [EventTypes.WaitlistOfferAccepted]: 1,
  [EventTypes.WaitlistOfferDeclined]: 1,
  [EventTypes.QueueEntryCreated]: 1,
  [EventTypes.QueueEntryCalled]: 1,
  [EventTypes.QueueEntryStarted]: 1,
  [EventTypes.QueueEntryCompleted]: 1,
  [EventTypes.QueueEntryNoShow]: 1,
  [EventTypes.QueueEntryTransferred]: 1,
  [EventTypes.QueueEntryPriorityChanged]: 1,
  [EventTypes.VisitStatusChanged]: 1,
  [EventTypes.VitalRecorded]: 1,
  [EventTypes.DisplayDevicePaired]: 1,
  [EventTypes.DisplayDeviceRevoked]: 1,
  [EventTypes.DisplayDeviceRotated]: 1,
  [EventTypes.Probe]: 1,
};
