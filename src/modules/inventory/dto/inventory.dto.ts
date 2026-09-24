import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const ReceiveStockLineSchema = z.object({
  medicationId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
  batchNumber: z.string().trim().min(1).max(200),
  expiryDate: z.coerce.date().optional(),
  unitCost: z.coerce.number().nonnegative().optional(),
});

export const ReceiveStockSchema = z.object({
  branchId: z.string().uuid(),
  lines: z.array(ReceiveStockLineSchema).min(1).max(100),
});
export class ReceiveStockDto extends createZodDto(ReceiveStockSchema) {}

export const DispenseSchema = z.object({
  prescriptionId: z.string().uuid(),
  branchId: z.string().uuid(),
  lines: z
    .array(
      z.object({
        medicationId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
});
export class DispenseDto extends createZodDto(DispenseSchema) {}

export const CreateStockTransferSchema = z.object({
  fromBranchId: z.string().uuid(),
  toBranchId: z.string().uuid(),
  reason: z.string().trim().max(2000).optional(),
  lines: z
    .array(
      z.object({
        medicationId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
      }),
    )
    .min(1)
    .max(100),
});
export class CreateStockTransferDto extends createZodDto(CreateStockTransferSchema) {}

export const TransferActionSchema = z.object({
  action: z.enum(['approve', 'ship', 'cancel']),
});
export class TransferActionDto extends createZodDto(TransferActionSchema) {}

export const CreateCountSchema = z.object({
  branchId: z.string().uuid(),
  notes: z.string().trim().max(2000).optional(),
});
export class CreateCountDto extends createZodDto(CreateCountSchema) {}

export const RecordCountItemSchema = z.object({
  countedQuantity: z.coerce.number().int().nonnegative(),
});
export class RecordCountItemDto extends createZodDto(RecordCountItemSchema) {}

export const StockAlertsQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
});
export class StockAlertsQueryDto extends createZodDto(StockAlertsQuerySchema) {}

export const OnHandQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
});
export class OnHandQueryDto extends createZodDto(OnHandQuerySchema) {}

export const InventoryResponseSchema = z.object({
  batchId: z.string(),
  batchNumber: z.string(),
  medicationId: z.string(),
  quantity: z.number(),
});
export class InventoryResponseDto extends createZodDto(InventoryResponseSchema) {}

export const TransferResponseSchema = z.object({
  transferId: z.string(),
  fromBranchId: z.string(),
  toBranchId: z.string(),
  status: z.string(),
});
export class TransferResponseDto extends createZodDto(TransferResponseSchema) {}

export const CountResponseSchema = z.object({
  countId: z.string(),
  branchId: z.string(),
  status: z.string(),
});
export class CountResponseDto extends createZodDto(CountResponseSchema) {}

export const AlertResponseSchema = z.object({
  medicationId: z.string(),
  name: z.string(),
  label: z.enum(['LOW_STOCK', 'REORDER_RISK', 'EXPIRY_RISK']),
  detail: z.string(),
});
export class AlertResponseDto extends createZodDto(AlertResponseSchema) {}