import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const AssetCategory = z.enum([
  'EQUIPMENT',
  'COMPUTER',
  'VEHICLE',
  'BED',
  'MACHINE',
  'INSTRUMENT',
  'FURNITURE',
  'OTHER',
]);

export const AssetStatus = z.enum(['ACTIVE', 'MAINTENANCE', 'RETIRED', 'DISPOSED']);

const NestedId = z.string().min(1).max(100);

export const CreateAssetSchema = z.object({
  branchId: NestedId.optional(),
  departmentId: NestedId.optional(),
  assetTag: z.string().trim().min(1).max(40),
  category: AssetCategory,
  name: z.string().trim().min(1).max(200),
  serialNumber: z.string().trim().min(1).max(200).optional(),
  location: z.string().trim().min(1).max(200).optional(),
  purchaseDate: z.coerce.date().optional(),
  purchaseCost: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
      message: 'Money must be a decimal amount with up to 2 fraction digits',
    })
    .optional(),
  notes: z.string().trim().max(2000).optional(),
});
export class CreateAssetDto extends createZodDto(CreateAssetSchema) {}

export const UpdateAssetSchema = z.object({
  branchId: NestedId.nullable().optional(),
  departmentId: NestedId.nullable().optional(),
  category: AssetCategory.optional(),
  name: z.string().trim().min(1).max(200).optional(),
  serialNumber: z.string().trim().min(1).max(200).nullable().optional(),
  location: z.string().trim().min(1).max(200).nullable().optional(),
  purchaseDate: z.coerce.date().nullable().optional(),
  purchaseCost: z
    .union([z.string(), z.number()])
    .transform(String)
    .refine((v) => /^\d+(\.\d{1,2})?$/.test(v), {
      message: 'Money must be a decimal amount with up to 2 fraction digits',
    })
    .nullable()
    .optional(),
  notes: z.string().trim().max(2000).nullable().optional(),
  status: AssetStatus.optional(),
  version: z.coerce.number().int().nonnegative().optional(),
});
export class UpdateAssetDto extends createZodDto(UpdateAssetSchema) {}

export const ListAssetsQuerySchema = z.object({
  status: AssetStatus.optional(),
  category: AssetCategory.optional(),
  branchId: NestedId.optional(),
  search: z.string().trim().min(1).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListAssetsQueryDto extends createZodDto(ListAssetsQuerySchema) {}

export const AssetResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string().nullable(),
  departmentId: z.string().nullable(),
  assetTag: z.string(),
  category: AssetCategory,
  name: z.string(),
  serialNumber: z.string().nullable(),
  location: z.string().nullable(),
  status: AssetStatus,
  purchaseDate: z.date().nullable(),
  purchaseCost: z.string().nullable(),
  notes: z.string().nullable(),
  version: z.number(),
  retiredById: z.string().nullable(),
  retiredAt: z.date().nullable(),
  createdById: z.string().nullable(),
  createdAt: z.date(),
  updatedAt: z.date(),
});
export class AssetResponseDto extends createZodDto(AssetResponseSchema) {}