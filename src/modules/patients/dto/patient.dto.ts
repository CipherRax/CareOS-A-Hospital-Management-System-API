import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

// --- identity / status enums (mirror Prisma) ---
export const Sex = z.enum(['MALE', 'FEMALE', 'OTHER']);
export const PatientStatus = z.enum(['ACTIVE', 'MERGED', 'ARCHIVED']);
export const GuardianRelationship = z.enum([
  'PARENT',
  'SPOUSE',
  'SIBLING',
  'RELATIVE',
  'LEGAL_GUARDIAN',
  'OTHER',
]);
export const ConsentType = z.enum([
  'DATA_PROCESSING',
  'COMMUNICATIONS',
  'TELEMEDICINE',
  'DATA_SHARING',
]);
export const ConsentStatus = z.enum(['GRANTED', 'WITHDRAWN']);
export const AllergySeverity = z.enum(['MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING']);
export const AllergyStatus = z.enum(['ACTIVE', 'RESOLVED', 'AMENDED']);
export const MedicalHistoryCategory = z.enum([
  'PAST_MEDICAL',
  'SURGICAL',
  'FAMILY',
  'SOCIAL',
  'PREVIOUS_CONDITIONS',
]);

const demographicsFields = {
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  otherNames: z.string().trim().max(120).nullable().optional(),
  dateOfBirth: z.coerce.date().optional(),
  sex: Sex.optional(),
  county: z.string().trim().max(120).nullable().optional(),
  town: z.string().trim().max(120).nullable().optional(),
  photoUrl: z.string().url().max(2048).nullable().optional(),
};

const contactFields = {
  phone: z
    .string()
    .trim()
    .regex(/^[0-9+()\-.\s]{6,32}$/)
    .nullable()
    .optional(),
  email: z.string().email().max(254).nullable().optional(),
  address: z.string().trim().max(300).nullable().optional(),
};

export const CreatePatientSchema = z
  .object({
    ...demographicsFields,
    ...contactFields,
    /** Declare the registration is knowingly a duplicate despite the flag. */
    confirmDuplicate: z.boolean().optional(),
    duplicateConfirmReason: z.string().trim().max(500).optional(),
  })
  .refine(
    (v) => (v.confirmDuplicate === true ? !!v.duplicateConfirmReason : true),
    { message: 'duplicateConfirmReason is required when confirmDuplicate is true' },
  );
export class CreatePatientDto extends createZodDto(CreatePatientSchema) {}

export const UpdatePatientSchema = z
  .object({
    ...demographicsFields,
    ...contactFields,
    /** Required to guard against lost updates; 409 VERSION_CONFLICT on mismatch. */
    version: z.number().int().nonnegative().optional(),
  })
  .partial()
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdatePatientDto extends createZodDto(UpdatePatientSchema) {}

export const ConfirmNotDuplicateSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});
export class ConfirmNotDuplicateDto extends createZodDto(ConfirmNotDuplicateSchema) {}

export const MergePatientsSchema = z.object({
  sourcePatientId: z.string().uuid(),
  reason: z.string().trim().min(1).max(500),
});
export class MergePatientsDto extends createZodDto(MergePatientsSchema) {}

export const ListPatientsQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
  q: z.string().trim().max(120).optional(),
  status: PatientStatus.optional(),
});
export class ListPatientsQueryDto extends createZodDto(ListPatientsQuerySchema) {}

// --- guardians ---
export const AddGuardianSchema = z.object({
  firstName: z.string().trim().min(1).max(120),
  lastName: z.string().trim().min(1).max(120),
  phone: z.string().trim().regex(/^[0-9+()\-.\s]{6,32}$/).nullable().optional(),
  email: z.string().email().max(254).nullable().optional(),
  relationship: GuardianRelationship,
  isPrimary: z.boolean().optional(),
  isEmergencyContact: z.boolean().optional(),
});
export class AddGuardianDto extends createZodDto(AddGuardianSchema) {}

// --- consents ---
export const GrantConsentSchema = z.object({
  type: ConsentType,
  notes: z.string().trim().max(500).nullable().optional(),
});
export class GrantConsentDto extends createZodDto(GrantConsentSchema) {}

export const WithdrawConsentSchema = z.object({
  notes: z.string().trim().max(500).nullable().optional(),
});
export class WithdrawConsentDto extends createZodDto(WithdrawConsentSchema) {}

// --- allergies ---
export const AddAllergySchema = z.object({
  substance: z.string().trim().min(1).max(200),
  reaction: z.string().trim().max(500).nullable().optional(),
  severity: AllergySeverity,
  notes: z.string().trim().max(1000).nullable().optional(),
});
export class AddAllergyDto extends createZodDto(AddAllergySchema) {}

export const UpdateAllergyStatusSchema = z.object({
  status: AllergyStatus,
});
export class UpdateAllergyStatusDto extends createZodDto(UpdateAllergyStatusSchema) {}

export const AmendAllergySchema = z.object({
  reaction: z.string().trim().max(500).nullable().optional(),
  severity: AllergySeverity.optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export class AmendAllergyDto extends createZodDto(AmendAllergySchema) {}

// --- medical history ---
export const AddMedicalHistorySchema = z.object({
  category: MedicalHistoryCategory,
  description: z.string().trim().min(1).max(2000),
  onsetDate: z.coerce.date().optional(),
  notes: z.string().trim().max(1000).nullable().optional(),
});
export class AddMedicalHistoryDto extends createZodDto(AddMedicalHistorySchema) {}

// ---------------------------------------------------------------------------
// Response schemas (documentation only; runtime envelope comes from the
// interceptor).
// ---------------------------------------------------------------------------
export const PatientResponseSchema = z.object({
  id: z.string().uuid(),
  patientNumber: z.string(),
  firstName: z.string(),
  lastName: z.string(),
  otherNames: z.string().nullable(),
  dateOfBirth: z.string().nullable(),
  sex: Sex.nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  address: z.string().nullable(),
  county: z.string().nullable(),
  town: z.string().nullable(),
  photoUrl: z.string().nullable(),
  status: PatientStatus,
  duplicateConfirmedAt: z.string().nullable(),
  duplicateConfirmReason: z.string().nullable(),
  mergedIntoPatientId: z.string().uuid().nullable(),
  version: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});

export const PatientListResponseSchema = z.object({
  items: z.array(PatientResponseSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});

export class PatientResponseDto extends createZodDto(PatientResponseSchema) {}
export class PatientListResponseDto extends createZodDto(PatientListResponseSchema) {}

export const PatientAccessLogSchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  userId: z.string().nullable(),
  action: z.string(),
  section: z.string(),
  reason: z.string().nullable(),
  ip: z.string().nullable(),
  userAgent: z.string().nullable(),
  requestId: z.string().nullable(),
  createdAt: z.string(),
});

export const PatientAccessLogResponseSchema = z.object({
  items: z.array(PatientAccessLogSchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export class PatientAccessLogResponseDto extends createZodDto(
  PatientAccessLogResponseSchema,
) {}

export const PatientTimelineEntrySchema = z.object({
  id: z.string().uuid(),
  patientId: z.string().uuid(),
  type: z.string(),
  title: z.string(),
  requiredPermission: z.string(),
  actorId: z.string().nullable(),
  occurredAt: z.string(),
});

export const PatientTimelineResponseSchema = z.object({
  items: z.array(PatientTimelineEntrySchema),
  meta: z.object({
    page: z.number().int(),
    limit: z.number().int(),
    total: z.number().int(),
    totalPages: z.number().int(),
  }),
});
export class PatientTimelineResponseDto extends createZodDto(PatientTimelineResponseSchema) {}