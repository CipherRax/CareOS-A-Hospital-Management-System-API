import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

const NestedId = z.string().min(1).max(100);

export const WastageReportQuerySchema = z.object({
  branchId: NestedId.optional(),
  medicationId: NestedId.optional(),
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export class WastageReportQueryDto extends createZodDto(WastageReportQuerySchema) {}

export const SupplierSpendQuerySchema = z.object({
  from: z.coerce.date().optional(),
  to: z.coerce.date().optional(),
});
export class SupplierSpendQueryDto extends createZodDto(SupplierSpendQuerySchema) {}