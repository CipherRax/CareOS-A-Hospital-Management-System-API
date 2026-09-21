import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const OrgStatus = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']);

export const OrganizationSchema = z.object({
  id: z.string().uuid().describe('UUIDv7 organization id'),
  name: z.string().describe('Organization name'),
  status: OrgStatus,
  currency: z.string(),
  timezone: z.string(),
  country: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export class OrganizationDto extends createZodDto(OrganizationSchema) {}
export class OrganizationResponseDto extends createZodDto(
  z.object({
    organization: OrganizationSchema,
  }),
) {}
