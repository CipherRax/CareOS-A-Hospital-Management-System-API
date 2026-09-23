import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const RegisterDisplayDeviceSchema = z.object({
  branchId: z.string().uuid(),
  name: z.string().trim().min(1).max(120),
  departmentIds: z.array(z.string().uuid()).min(1).max(50),
});
export class RegisterDisplayDeviceDto extends createZodDto(RegisterDisplayDeviceSchema) {}

export const UpdateDisplayDeviceSchema = z
  .object({
    name: z.string().trim().min(1).max(120).optional(),
    branchId: z.string().uuid().optional(),
    departmentIds: z.array(z.string().uuid()).min(1).max(50).optional(),
  })
  .refine((v) => Object.keys(v).length > 0, { message: 'Nothing to update' });
export class UpdateDisplayDeviceDto extends createZodDto(UpdateDisplayDeviceSchema) {}

export const PairDisplayDeviceSchema = z.object({
  name: z.string().trim().min(1).max(120).optional(),
  code: z.string().trim().min(1).max(32),
});
export class PairDisplayDeviceDto extends createZodDto(PairDisplayDeviceSchema) {}

export const ListDisplayDevicesQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  status: z.enum(['PENDING_PAIRING', 'ACTIVE', 'REVOKED']).optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListDisplayDevicesQueryDto extends createZodDto(ListDisplayDevicesQuerySchema) {}