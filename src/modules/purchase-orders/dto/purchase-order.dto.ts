import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PurchaseOrderStatus = z.enum([
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'ORDERED',
  'PARTIALLY_RECEIVED',
  'RECEIVED',
  'CLOSED',
  'CANCELLED',
]);

export const PurchaseOrderItemSchema = z.object({
  medicationId: z.string().uuid(),
  quantityOrdered: z.coerce.number().int().positive(),
  unitCost: z.coerce.number().nonnegative().optional(),
});

export const CreatePurchaseOrderSchema = z.object({
  branchId: z.string().uuid(),
  supplierId: z.string().uuid(),
  expectedAt: z.coerce.date().optional(),
  notes: z.string().trim().max(2000).optional(),
  items: z.array(PurchaseOrderItemSchema).min(1).max(100),
});
export class CreatePurchaseOrderDto extends createZodDto(CreatePurchaseOrderSchema) {}

export const ActionPurchaseOrderSchema = z.object({
  action: z.enum(['submit', 'approve', 'order', 'close']),
});
export class ActionPurchaseOrderDto extends createZodDto(ActionPurchaseOrderSchema) {}

export const ReceivePurchaseOrderSchema = z.object({
  lines: z
    .array(
      z.object({
        medicationId: z.string().uuid(),
        quantity: z.coerce.number().int().positive(),
        batchNumber: z.string().trim().min(1).max(200),
        expiryDate: z.coerce.date().optional(),
      }),
    )
    .min(1)
    .max(100),
});
export class ReceivePurchaseOrderDto extends createZodDto(ReceivePurchaseOrderSchema) {}

export const ListPurchaseOrdersQuerySchema = z.object({
  branchId: z.string().uuid().optional(),
  supplierId: z.string().uuid().optional(),
  status: PurchaseOrderStatus.optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListPurchaseOrdersQueryDto extends createZodDto(ListPurchaseOrdersQuerySchema) {}

export const PurchaseOrderItemResponseSchema = z.object({
  id: z.string(),
  medicationId: z.string(),
  quantityOrdered: z.number(),
  quantityReceived: z.number(),
  unitCost: z.number().nullable(),
});
export class PurchaseOrderItemResponseDto extends createZodDto(PurchaseOrderItemResponseSchema) {}

export const PurchaseOrderResponseSchema = z.object({
  id: z.string(),
  organizationId: z.string(),
  branchId: z.string(),
  supplierId: z.string(),
  poNumber: z.string(),
  status: PurchaseOrderStatus,
  expectedAt: z.date().nullable(),
  notes: z.string().nullable(),
  createdById: z.string(),
  submittedById: z.string().nullable(),
  approvedById: z.string().nullable(),
  submittedAt: z.date().nullable(),
  approvedAt: z.date().nullable(),
  receivedAt: z.date().nullable(),
  closedAt: z.date().nullable(),
  version: z.number(),
  items: z.array(PurchaseOrderItemResponseSchema),
});
export class PurchaseOrderResponseDto extends createZodDto(PurchaseOrderResponseSchema) {}