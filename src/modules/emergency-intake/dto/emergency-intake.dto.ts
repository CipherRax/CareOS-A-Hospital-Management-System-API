import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { EMERGENCY_CONSENT_VERSION } from '../domain/consent';

const callerPhone = z
  .string()
  .trim()
  .min(3)
  .max(40)
  .regex(/^[\d+\s-]+$/, 'Invalid phone number');

/**
 * Anonymous submit payload (brief §6.15). Only a phone number is structurally
 * required once a branch policy asks for one: careOS is not a triage form and
 * must not make a frightened caller fill in fields before we record the request.
 */
export const SubmitEmergencyRequestSchema = z.object({
  // Slug of the PUBLISHED directory listing being asked for help.
  slug: z.string().trim().min(1).max(200),
  callerName: z.string().trim().max(120).optional(),
  callerPhone: callerPhone.optional(),
  description: z.string().trim().max(4000).optional(),
  /**
   * Caller-stated category in plain language. NOT a clinical assessment: it is
   * recorded and shown to staff only, never used to rank, delay, or triage.
   */
  category: z
    .enum([
      'NOT_SURE',
      'BREATHING_DIFFICULTY',
      'SEVERE_INJURY',
      'UNCONSCIOUS',
      'CHEST_PAIN',
      'HEAVY_BLEEDING',
      'OTHER',
    ])
    .optional(),
  // Whether the caller is asking for themselves or on someone else's behalf.
  forSelf: z.boolean().optional(),
  // How many people are at the scene. Count only — never a weight or an age.
  peopleCount: z.coerce.number().int().min(1).max(100).optional(),
  preferredContact: z.enum(['PHONE', 'SMS']).optional(),
  locale: z.string().trim().max(20).optional(),
  location: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      landmark: z.string().trim().max(400).optional(),
      // Caller-reported accuracy in metres. Recorded for the staff view only.
      accuracyM: z.coerce.number().min(0).max(100000).optional(),
    })
    .optional(),
  /**
   * Caller-chosen idempotency key so a retry or double-tap returns the original
   * request instead of paging twice. Scoped per organization, optional.
   */
  clientRequestId: z.string().trim().min(8).max(128).optional(),
  /**
   * Explicit acceptance of the disclosure text shown by the frontend. The
   * version is stored with the request so a later copy change is auditable.
   */
  consentVersion: z.string().trim().min(1).max(40).optional(),
});
export class SubmitEmergencyRequestDto extends createZodDto(SubmitEmergencyRequestSchema) {}

export const TrackEmergencyRequestSchema = z.object({
  token: z.string().trim().min(16).max(512),
});
export class TrackEmergencyRequestDto extends createZodDto(TrackEmergencyRequestSchema) {}

export const CancelEmergencyRequestSchema = TrackEmergencyRequestSchema;
export class CancelEmergencyRequestDto extends createZodDto(CancelEmergencyRequestSchema) {}

/**
 * Caller corrections to a still-open request (brief §6.15). Scoped to the same
 * token as tracking, so a caller can fix a wrong number or move themselves
 * without asking a human — and without opening a second incident.
 */
export const UpdateCallerEmergencyRequestSchema = z.object({
  token: z.string().trim().min(16).max(512),
  callerPhone: callerPhone.optional(),
  callerName: z.string().trim().max(120).optional(),
  location: z
    .object({
      lat: z.coerce.number().min(-90).max(90),
      lng: z.coerce.number().min(-180).max(180),
      landmark: z.string().trim().max(400).optional(),
      accuracyM: z.coerce.number().min(0).max(100000).optional(),
    })
    .optional(),
  preferredContact: z.enum(['PHONE', 'SMS']).optional(),
  // Acknowledges the disclosure text at update time as well as at submit.
  consentVersion: z.string().trim().min(1).max(40).optional(),
});
export class UpdateCallerEmergencyRequestDto extends createZodDto(
  UpdateCallerEmergencyRequestSchema,
) {}

export const IntakePolicyUpdateSchema = z.object({
  enabled: z.boolean().optional(),
  autoEscalate: z.boolean().optional(),
  requireDescription: z.boolean().optional(),
  allowAnonymousCaller: z.boolean().optional(),
  // SLA seconds per escalation level. Sub-second values run as milliseconds.
  levelSeconds: z.array(z.number().positive().max(86400)).min(1).max(10).optional(),
  // Seconds a staff member has to acknowledge before level 1 escalates.
  ackSlaSeconds: z.coerce.number().int().positive().max(86400).nullable().optional(),
  // Whether the facility runs its own ambulances. Informational for caller copy.
  ambulanceAvailable: z.boolean().optional(),
  // Plain-language description of the area served.
  serviceArea: z.string().trim().max(200).nullable().optional(),
  // Extra caller-facing guidance (accessibility, languages, where to wait).
  autoReplyTemplate: z.string().trim().max(1000).nullable().optional(),
  emergencyPhone: z.string().trim().max(40).nullable().optional(),
});
export class IntakePolicyUpdateDto extends createZodDto(IntakePolicyUpdateSchema) {}

/**
 * One daily availability window, facility-local time. `day` matches
 * `Date#getDay` (0 = Sunday). A window whose `end` is not after its `start`
 * wraps past midnight, which is how a night shift is expressed.
 */
export const OnCallWindowSchema = z
  .object({
    day: z.coerce.number().int().min(0).max(6),
    start: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, 'Expected HH:MM'),
    end: z
      .string()
      .regex(/^([01]\d|2[0-3]):[0-5]\d$|^24:00$/, 'Expected HH:MM or 24:00'),
  })
  .refine((v) => v.end !== '24:00' || v.start !== '00:00', {
    message: 'A window starting at 00:00 already covers the full day.',
    path: ['end'],
  });

export const EmergencyContactUpsertSchema = z
  .object({
    name: z.string().trim().min(1).max(200),
    // A contact is a phone line, a staff user, or both; the service enforces
    // "at least one" (mirrored by a DB check constraint).
    phone: callerPhone.optional(),
    userId: z.string().trim().min(1).max(64).optional(),
    role: z.string().trim().max(120).optional(),
    order: z.coerce.number().int().positive().max(50),
    notes: z.string().trim().max(1000).optional(),
    // Whether the contact is reachable right now. Excluded from the intake
    // enable guard and from escalation paging when false.
    onCall: z.boolean().optional(),
    // Per-shift availability (brief §6.15). Empty means always on call.
    onCallWindows: z.array(OnCallWindowSchema).max(28).optional(),
  })
  .refine((v) => v.phone !== undefined || v.userId !== undefined, {
    message: 'Provide a phone number, a staff user, or both.',
    path: ['phone'],
  });
export class EmergencyContactUpsertDto extends createZodDto(EmergencyContactUpsertSchema) {}

export const EmergencyContactPatchSchema = z
  .object({
    name: z.string().trim().min(1).max(200).optional(),
    phone: callerPhone.nullable().optional(),
    userId: z.string().trim().min(1).max(64).nullable().optional(),
    role: z.string().trim().max(120).optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
    active: z.boolean().optional(),
    // Whether the contact is reachable right now. Excluded from the intake
    // enable guard and from escalation notification when false.
    onCall: z.boolean().optional(),
    onCallWindows: z.array(OnCallWindowSchema).max(28).nullable().optional(),
  })
  .refine((v) => v.phone !== undefined || v.userId !== undefined, {
    message: 'A contact must keep a phone number, a staff user, or both.',
    path: ['phone'],
  });
export class EmergencyContactPatchDto extends createZodDto(EmergencyContactPatchSchema) {}

export const ListEmergencyRequestsQuerySchema = z.object({
  status: z
    .enum([
      'RECEIVED',
      'ACKNOWLEDGED',
      'CONTACTED',
      'RESPONDING',
      'ESCALATED',
      'REDIRECTED',
      'UNREACHABLE',
      'DUPLICATE',
      'NOT_ACTIONABLE',
      'CLOSED',
      'CANCELLED',
    ])
    .optional(),
  branchId: z.string().trim().min(1).optional(),
  // Inbox triage helpers. `flagged` surfaces requests staff could not reach.
  flagged: z
    .enum(['true', 'false'])
    .transform((v) => v === 'true')
    .optional(),
  from: z.string().datetime().optional(),
  to: z.string().datetime().optional(),
  page: z.coerce.number().int().positive().max(100000).optional(),
  limit: z.coerce.number().int().positive().max(100).optional(),
});
export class ListEmergencyRequestsQueryDto extends createZodDto(ListEmergencyRequestsQuerySchema) {}

export const StaffNoteSchema = z.object({
  note: z.string().trim().min(1).max(2000),
});
export class StaffNoteDto extends createZodDto(StaffNoteSchema) {}

/**
 * Staff callback attempt (brief §6.15). Records that a human tried to reach the
 * caller and whether it worked; a failed first attempt flags the request and
 * stamps `firstCallbackAt` so the inbox can surface unreachable callers.
 */
export const RecordCallbackSchema = z.object({
  // Whether the attempt reached the caller.
  reachedCaller: z.boolean(),
  note: z.string().trim().max(1000).optional(),
});
export class RecordCallbackDto extends createZodDto(RecordCallbackSchema) {}

/**
 * Staff status change (brief §6.15) for the states that are not simple
 * lifecycle transitions: unreachable, redirected, or not actionable.
 */
export const SetRequestStatusSchema = z.object({
  status: z.enum(['UNREACHABLE', 'REDIRECTED', 'NOT_ACTIONABLE']),
  // Required for REDIRECTED / NOT_ACTIONABLE so the caller copy is never a
  // bare state change with no explanation.
  reason: z.string().trim().min(1).max(500).optional(),
});
export class SetRequestStatusDto extends createZodDto(SetRequestStatusSchema) {}

/** Links an anonymous request to the ED arrival it produced (brief §6.15). */
export const LinkArrivalVisitSchema = z.object({
  visitId: z.string().trim().min(1).max(64),
});
export class LinkArrivalVisitDto extends createZodDto(LinkArrivalVisitSchema) {}

/** Merges a duplicate request into the canonical one it was reported against. */
export const MergeRequestSchema = z.object({
  intoRequestId: z.string().trim().min(1).max(64),
  note: z.string().trim().max(500).optional(),
});
export class MergeRequestDto extends createZodDto(MergeRequestSchema) {}

export const EmergencyNumberUpsertSchema = z.object({
  country: z.string().trim().min(2).max(4).default('KE'),
  purpose: z.string().trim().min(1).max(40),
  label: z.string().trim().min(1).max(200),
  phone: callerPhone,
  hours: z.string().trim().max(60).optional(),
  public: z.boolean().optional(),
  // Operator confirmation against the official source. Until set, the caller
  // copy labels the number as unverified.
  verified: z.boolean().optional(),
  // Brief §6.15 fields. `channel` is the contact channel the number serves;
  // `active` retires a number without deleting its audit trail; `verifiedAt`
  // is set by an operator after checking the official source.
  channel: z.enum(['VOICE', 'SMS', 'WHATSAPP', 'MOBILE']).optional(),
  active: z.boolean().optional(),
  verifiedAt: z.string().datetime().nullable().optional(),
  note: z.string().trim().max(200).optional(),
});
export class EmergencyNumberUpsertDto extends createZodDto(EmergencyNumberUpsertSchema) {}

export const PublicNoticeUpsertSchema = z.object({
  title: z.string().trim().min(1).max(200),
  message: z.string().trim().min(1).max(2000),
  severity: z.enum(['INFO', 'WARNING', 'CRITICAL']).optional(),
  active: z.boolean().optional(),
  startsAt: z.string().datetime().optional(),
  endsAt: z.string().datetime().nullable().optional(),
  // Brief §6.14: a published notice must be attributable. `reviewedBy`/`reviewedAt`
  // are set automatically from the acting operator, so a notice cannot be
  // published without a reviewer behind it.
  reviewedBy: z.string().trim().max(64).optional(),
  reviewedAt: z.string().datetime().nullable().optional(),
});
export class PublicNoticeUpsertDto extends createZodDto(PublicNoticeUpsertSchema) {}

export { EMERGENCY_CONSENT_VERSION };