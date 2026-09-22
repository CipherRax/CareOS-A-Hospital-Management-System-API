import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const BREAK_GLASS_MAX_MINUTES = 60;

export const RESOURCE_TYPES = [
  'organization',
  'user',
  'branch',
  'department',
  'staff',
] as const;

export const CreateBreakGlassRequestSchema = z
  .object({
    resourceType: z.enum(RESOURCE_TYPES),
    /** The exact id of the resource emergency access is needed for. */
    resourceId: z.string().uuid(),
    permission: z.string().min(1),
    reason: z.string().min(10).max(500),
    expiresInMinutes: z.coerce
      .number()
      .int()
      .min(1)
      .max(BREAK_GLASS_MAX_MINUTES)
      .default(30),
  })
  .describe(
    'Requests temporary elevated access to a resource. Grants are created ' +
      'PENDING and nothing is ever self-activated (Phase 1 skeleton).',
  );
export class CreateBreakGlassRequestDto extends createZodDto(
  CreateBreakGlassRequestSchema,
) {}

export const BreakGlassGrantSchema = z.object({
  id: z.string().uuid(),
  resourceType: z.string(),
  resourceId: z.string(),
  permission: z.string(),
  reason: z.string(),
  status: z.enum(['PENDING', 'ACTIVE', 'EXPIRED', 'REVOKED']),
  createdAt: z.string().datetime(),
  expiresAt: z.string().datetime(),
});
export const BreakGlassGrantListSchema = z.object({
  grants: z.array(BreakGlassGrantSchema),
  meta: z.object({
    page: z.number(),
    limit: z.number(),
    total: z.number(),
    totalPages: z.number(),
  }),
});

export class BreakGlassGrantDto extends createZodDto(BreakGlassGrantSchema) {}
export class BreakGlassGrantListResponseDto extends createZodDto(
  BreakGlassGrantListSchema,
) {}
