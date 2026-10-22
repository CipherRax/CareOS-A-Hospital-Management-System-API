import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';
import { RETENTION_ACTIONS, RETENTION_CATEGORIES } from '../domain/retention';

const CategorySchema = z.enum(RETENTION_CATEGORIES);
const ActionSchema = z.enum(RETENTION_ACTIONS);

export const UpsertRetentionPolicySchema = z.object({
  category: CategorySchema,
  retentionDays: z.number().int().min(1).max(3650),
  action: ActionSchema.default('REVIEW'),
  enabled: z.boolean().default(true),
});
export class UpsertRetentionPolicyDto extends createZodDto(UpsertRetentionPolicySchema) {}

export const UpdateRetentionPolicySchema = z.object({
  retentionDays: z.number().int().min(1).max(3650).optional(),
  action: ActionSchema.optional(),
  enabled: z.boolean().optional(),
});
export class UpdateRetentionPolicyDto extends createZodDto(UpdateRetentionPolicySchema) {}

export const PlaceLegalHoldSchema = z.object({
  patientId: z.string().trim().min(1).max(64),
  reason: z.string().trim().min(3).max(500),
});
export class PlaceLegalHoldDto extends createZodDto(PlaceLegalHoldSchema) {}

export const ReleaseLegalHoldSchema = z.object({
  releaseReason: z.string().trim().min(3).max(500),
});
export class ReleaseLegalHoldDto extends createZodDto(ReleaseLegalHoldSchema) {}

export const RequestDataExportSchema = z.object({
  /** A single patient, or the whole org when omitted. */
  patientId: z.string().trim().min(1).max(64).optional(),
  format: z.enum(['JSON']).default('JSON'),
});
export class RequestDataExportDto extends createZodDto(RequestDataExportSchema) {}

export class RetentionPolicyResponseDto {
  id!: string;
  category!: string;
  retentionDays!: number;
  action!: string;
  enabled!: boolean;
  createdAt!: string;
  updatedAt!: string;
}

export class LegalHoldResponseDto {
  id!: string;
  patientId!: string;
  reason!: string;
  placedById!: string | null;
  placedAt!: string;
  releasedAt!: string | null;
  releasedById!: string | null;
  releaseReason!: string | null;
  active!: boolean;
}

export class DataExportResponseDto {
  id!: string;
  patientId!: string | null;
  requestedById!: string | null;
  status!: string;
  format!: string;
  sizeBytes?: number | null;
  failureReason?: string | null;
  expiresAt?: string | null;
  completedAt?: string | null;
  createdAt!: string;
}

export class DataExportDownloadDto {
  url!: string;
  expiresIn!: number;
}
