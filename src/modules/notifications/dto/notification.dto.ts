import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const NotificationChannelSchema = z.enum(['IN_APP', 'SMS', 'EMAIL', 'PUSH']);
export const NotificationStatusSchema = z.enum(['PENDING', 'SENT', 'FAILED']);

const TemplateKeySchema = z
  .string()
  .trim()
  .min(1)
  .max(100)
  .regex(/^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/);
const TemplateVariableSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Za-z][A-Za-z0-9_]*$/);

export const ListNotificationTemplatesQuerySchema = z.object({
  key: TemplateKeySchema.optional(),
  isActive: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListNotificationTemplatesQueryDto extends createZodDto(
  ListNotificationTemplatesQuerySchema,
) {}

export const UpsertNotificationTemplateSchema = z.object({
  key: TemplateKeySchema,
  name: z.string().trim().min(1).max(200),
  description: z.string().trim().max(1000).optional(),
  subjectTemplate: z.string().trim().min(1).max(500),
  bodyTemplate: z.string().trim().min(1).max(5000),
  allowlistedVariables: z
    .array(TemplateVariableSchema)
    .max(50)
    .refine((values) => new Set(values).size === values.length, {
      message: 'Allowlisted variables must be unique',
    }),
  isDefault: z.boolean().default(false),
  isActive: z.boolean().default(true),
});
export class UpsertNotificationTemplateDto extends createZodDto(
  UpsertNotificationTemplateSchema,
) {}

export const ListNotificationsQuerySchema = z.object({
  channel: NotificationChannelSchema.optional(),
  status: NotificationStatusSchema.optional(),
  unreadOnly: z
    .enum(['true', 'false'])
    .transform((value) => value === 'true')
    .optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListNotificationsQueryDto extends createZodDto(
  ListNotificationsQuerySchema,
) {}

export const UpdateNotificationPreferenceSchema = z.object({
  category: z.string().trim().min(1).max(100),
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
});
export class UpdateNotificationPreferenceDto extends createZodDto(
  UpdateNotificationPreferenceSchema,
) {}

export const ListNotificationPreferencesQuerySchema = z.object({
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListNotificationPreferencesQueryDto extends createZodDto(
  ListNotificationPreferencesQuerySchema,
) {}

export const NotificationResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  recipientUserId: z.string().nullable(),
  recipientPatientId: z.string().nullable(),
  channel: NotificationChannelSchema,
  templateKey: z.string(),
  subject: z.string(),
  body: z.string(),
  variables: z.record(z.string(), z.unknown()).nullable(),
  status: NotificationStatusSchema,
  attemptCount: z.number().int().nonnegative(),
  errorCode: z.string().nullable(),
  readAt: z.date().nullable(),
  sentAt: z.date().nullable(),
  createdAt: z.date(),
});
export class NotificationResponseDto extends createZodDto(
  z.object({ notification: NotificationResponseSchema }),
) {}

export const NotificationTemplateResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  key: z.string(),
  name: z.string(),
  description: z.string().nullable(),
  subjectTemplate: z.string(),
  bodyTemplate: z.string(),
  allowlistedVariables: z.array(z.string()),
  isDefault: z.boolean(),
  isActive: z.boolean(),
  updatedById: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class NotificationTemplateResponseDto extends createZodDto(
  z.object({ template: NotificationTemplateResponseSchema }),
) {}

export const NotificationPreferenceResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  recipientUserId: z.string().nullable(),
  recipientPatientId: z.string().nullable(),
  category: z.string(),
  channel: NotificationChannelSchema,
  enabled: z.boolean(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class NotificationPreferenceResponseDto extends createZodDto(
  z.object({ preference: NotificationPreferenceResponseSchema }),
) {}
