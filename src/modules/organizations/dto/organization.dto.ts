import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const OrgStatus = z.enum(['ACTIVE', 'SUSPENDED', 'CLOSED']);

export const OrganizationSchema = z.object({
  id: z.string().uuid().describe('UUIDv7 organization id'),
  name: z.string().describe('Organization name'),
  status: OrgStatus,
  legalName: z.string().nullable(),
  tradingName: z.string().nullable(),
  registrationNumber: z.string().nullable(),
  kraPin: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  website: z.string().nullable(),
  logoUrl: z.string().nullable(),
  address: z.string().nullable(),
  county: z.string().nullable(),
  town: z.string().nullable(),
  currency: z.string(),
  timezone: z.string(),
  country: z.string(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});

export const UpdateOrganizationSchema = z
  .object({
    legalName: z.string().max(200).optional(),
    tradingName: z.string().max(200).nullable().optional(),
    registrationNumber: z.string().max(64).optional(),
    kraPin: z.string().max(16).optional(),
    phone: z.string().max(32).nullable().optional(),
    email: z.string().email().nullable().optional(),
    website: z.string().url().nullable().optional(),
    logoUrl: z.string().url().nullable().optional(),
    address: z.string().max(300).nullable().optional(),
    county: z.string().max(100).nullable().optional(),
    town: z.string().max(100).nullable().optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateOrganizationDto extends createZodDto(UpdateOrganizationSchema) {}

export class OrganizationDto extends createZodDto(OrganizationSchema) {}
export class OrganizationResponseDto extends createZodDto(
  z.object({
    organization: OrganizationSchema,
  }),
) {}
