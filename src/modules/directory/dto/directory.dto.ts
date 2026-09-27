import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const coords = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
});

export const NearbyFacilitiesQuerySchema = z.object({
  lat: z.coerce.number().min(-90).max(90),
  lng: z.coerce.number().min(-180).max(180),
  radiusKm: z.coerce.number().positive().max(100).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export class NearbyFacilitiesQueryDto extends createZodDto(NearbyFacilitiesQuerySchema) {}

export const SearchFacilitiesQuerySchema = z.object({
  q: z.string().trim().min(1).max(120).optional(),
  county: z.string().trim().min(1).max(120).optional(),
  town: z.string().trim().min(1).max(120).optional(),
  lat: z.coerce.number().min(-90).max(90).optional(),
  lng: z.coerce.number().min(-180).max(180).optional(),
  limit: z.coerce.number().int().positive().max(50).optional(),
});
export class SearchFacilitiesQueryDto extends createZodDto(SearchFacilitiesQuerySchema) {}

const GeocodeQuerySchema = z.object({
  query: z.string().trim().min(1).max(200),
});
export class GeocodeQueryDto extends createZodDto(GeocodeQuerySchema) {}

const SuggestFacilitySchema = z.object({
  facilityName: z.string().trim().min(1).max(200),
  address: z.string().trim().max(400).optional(),
  county: z.string().trim().max(120).optional(),
  town: z.string().trim().max(120).optional(),
  contactName: z.string().trim().max(120).optional(),
  contactEmail: z.string().trim().email().max(254).optional(),
  contactPhone: z.string().trim().max(40).optional(),
  notes: z.string().trim().max(1000).optional(),
});
export class SuggestFacilityDto extends createZodDto(SuggestFacilitySchema) {}

export const GeoBounds = coords;
export type GeoBoundsInput = z.infer<typeof coords>;

export const UpdateListingSettingsSchema = z.object({
  summary: z.string().trim().max(400).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  county: z.string().trim().max(120).nullable().optional(),
  town: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  website: z.string().trim().url().max(400).nullable().optional(),
  hours: z
    .record(z.string().max(10), z.array(z.string().max(24)).max(12))
    .nullable()
    .optional(),
  departments: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        services: z.array(z.string().trim().max(120)).max(80).optional(),
      }),
    )
    .max(200)
    .nullable()
    .optional(),
  insurance: z.array(z.string().trim().max(80)).max(40).optional(),
  accessibility: z.array(z.string().trim().max(80)).max(20).optional(),
  services: z.array(z.string().trim().max(80)).max(80).optional(),
  open24h: z.boolean().optional(),
  emergency24h: z.boolean().optional(),
  ambulanceAvailable: z.boolean().optional(),
  emergencyIntakeEnabled: z.boolean().optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  feeNote: z.string().trim().max(500).nullable().optional(),
  locationLat: z.coerce.number().min(-90).max(90).nullable().optional(),
  locationLng: z.coerce.number().min(-180).max(180).nullable().optional(),
});
export class UpdateListingSettingsDto extends createZodDto(UpdateListingSettingsSchema) {}

export const ListListingsQuerySchema = z.object({
  status: z.enum(['DRAFT', 'PUBLISHED', 'SUSPENDED']).optional(),
  partner: z.enum(['true', 'false']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListListingsQueryDto extends createZodDto(ListListingsQuerySchema) {}

export const UpdateListingBodySchema = z.object({
  summary: z.string().trim().max(400).nullable().optional(),
  description: z.string().trim().max(4000).nullable().optional(),
  address: z.string().trim().max(400).nullable().optional(),
  county: z.string().trim().max(120).nullable().optional(),
  town: z.string().trim().max(120).nullable().optional(),
  phone: z.string().trim().max(40).nullable().optional(),
  email: z.string().trim().email().max(254).nullable().optional(),
  website: z.string().trim().url().max(400).nullable().optional(),
  hours: z
    .record(z.string().max(10), z.array(z.string().max(24)).max(12))
    .nullable()
    .optional(),
  departments: z
    .array(
      z.object({
        name: z.string().trim().min(1).max(120),
        services: z.array(z.string().trim().max(120)).max(80).optional(),
      }),
    )
    .max(200)
    .nullable()
    .optional(),
  insurance: z.array(z.string().trim().max(80)).max(40).optional(),
  accessibility: z.array(z.string().trim().max(80)).max(20).optional(),
  services: z.array(z.string().trim().max(80)).max(80).optional(),
  open24h: z.boolean().optional(),
  emergency24h: z.boolean().optional(),
  ambulanceAvailable: z.boolean().optional(),
  emergencyIntakeEnabled: z.boolean().optional(),
  acceptsOnlineBooking: z.boolean().optional(),
  feeNote: z.string().trim().max(500).nullable().optional(),
  locationLat: z.coerce.number().min(-90).max(90).nullable().optional(),
  locationLng: z.coerce.number().min(-180).max(180).nullable().optional(),
  emergencyIntakeIndex: z.coerce.number().int().min(0).max(100).nullable().optional(),
});
export class UpdateListingBodyDto extends createZodDto(UpdateListingBodySchema) {}