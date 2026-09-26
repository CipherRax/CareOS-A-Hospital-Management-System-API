import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

/**
 * Brief Phase 11 — analytics & reports (repo Phase 13). Shared DTOs.
 * Windows are optional: services default to a rolling lookback (30 days for
 * metrics/dashboards series, 90 for trends) so callers can open a URL with no
 * query string and get a labelled result.
 */
const NestedId = z.string().min(1).max(100);
const DateOpt = z.coerce.date().optional();

export const WindowQuerySchema = z.object({
  from: DateOpt,
  to: DateOpt,
  branchId: NestedId.optional(),
  departmentId: NestedId.optional(),
});
export class WindowQueryDto extends createZodDto(WindowQuerySchema) {}

export const MetricsQuerySchema = WindowQuerySchema.extend({
  granularity: z.enum(['day', 'week']).optional(),
});
export class MetricsQueryDto extends createZodDto(MetricsQuerySchema) {}

export const BottleneckQuerySchema = WindowQuerySchema;
export class BottleneckQueryDto extends createZodDto(BottleneckQuerySchema) {}

export const CapacityQuerySchema = WindowQuerySchema;
export class CapacityQueryDto extends createZodDto(CapacityQuerySchema) {}

export const ForecastSeriesSchema = z.enum([
  'appointment-demand',
  'inventory-demand',
  'bed-occupancy',
  'lab-workload',
]);

export const ForecastQuerySchema = z.object({
  from: DateOpt,
  to: DateOpt,
  horizon: z.coerce.number().int().min(1).max(90).default(7),
  medicationId: NestedId.optional(),
  branchId: NestedId.optional(),
  departmentId: NestedId.optional(),
});
export class ForecastQueryDto extends createZodDto(ForecastQuerySchema) {}

export const StaffAnalyticsQuerySchema = z.object({
  from: DateOpt,
  to: DateOpt,
  staffId: NestedId.optional(),
  branchId: NestedId.optional(),
});
export class StaffAnalyticsQueryDto extends createZodDto(StaffAnalyticsQuerySchema) {}

export const DashboardRoleSchema = z.enum([
  'admin',
  'doctor',
  'nurse',
  'pharmacy',
  'laboratory',
  'accountant',
]);
export class DashboardParamsDto extends createZodDto(z.object({ role: DashboardRoleSchema })) {}
export class DashboardQueryDto extends createZodDto(WindowQuerySchema) {}
export type DashboardRole = z.infer<typeof DashboardRoleSchema>;

export const ReportTypeSchema = z.enum([
  'PATIENT',
  'APPOINTMENT',
  'CLINICAL_OPERATIONS',
  'LABORATORY',
  'PHARMACY',
  'FINANCIAL',
  'INSURANCE',
  'OPERATIONS',
]);
export const ReportFormatSchema = z.enum(['JSON', 'CSV', 'PDF']);

export type ReportType = z.infer<typeof ReportTypeSchema>;
export type ReportFormat = z.infer<typeof ReportFormatSchema>;

export const ExportReportSchema = z.object({
  reportType: ReportTypeSchema,
  format: ReportFormatSchema,
  from: DateOpt,
  to: DateOpt,
  branchId: NestedId.optional(),
  departmentId: NestedId.optional(),
});
export class ExportReportDto extends createZodDto(ExportReportSchema) {}

export const ReportExportsListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
  reportType: ReportTypeSchema.optional(),
});
export class ReportExportsListQueryDto extends createZodDto(ReportExportsListQuerySchema) {}

export const ReconcileRunSchema = z.object({
  from: DateOpt,
  to: DateOpt,
  method: z.enum(['MANUAL', 'SCHEDULED']).optional(),
});
export class ReconcileRunDto extends createZodDto(ReconcileRunSchema) {}

export const ExceptionsQuerySchema = z.object({
  runId: NestedId.optional(),
  status: z.enum(['OPEN', 'ACKNOWLEDGED', 'RESOLVED']).optional(),
  severity: z.enum(['LOW', 'MEDIUM', 'HIGH']).optional(),
  type: z.enum([
    'ENCOUNTER_WITHOUT_INVOICE',
    'INVOICE_TOTAL_MISMATCH',
    'PAYMENT_APPLICATION_MISMATCH',
    'OVERPAID_INVOICE',
    'REFUND_WITHOUT_PAYMENT',
    'CLAIM_PAYMENT_MISMATCH',
  ]).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(25),
});
export class ExceptionsQueryDto extends createZodDto(ExceptionsQuerySchema) {}

export const ExceptionUpdateSchema = z.object({
  status: z.enum(['ACKNOWLEDGED', 'RESOLVED']),
  version: z.coerce.number().int().optional(),
});
export class ExceptionUpdateDto extends createZodDto(ExceptionUpdateSchema) {}

export const RebuildRollupsSchema = z.object({
  from: DateOpt,
  to: DateOpt,
  branchId: NestedId.optional(),
  departmentId: NestedId.optional(),
});
export class RebuildRollupsDto extends createZodDto(RebuildRollupsSchema) {}