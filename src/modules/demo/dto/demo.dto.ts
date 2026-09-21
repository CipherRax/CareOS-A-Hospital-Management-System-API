import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const EmitProbeSchema = z.object({
  label: z.string().min(1).max(64).describe('Free text label for the probe (demo only)'),
});
export class EmitProbeDto extends createZodDto(EmitProbeSchema) {}

export const EmitProbeResponseSchema = z.object({
  ok: z.literal(true),
  auditId: z.string().uuid(),
  eventId: z.string().uuid(),
  eventType: z.literal('CareOS.Probe'),
});
export class EmitProbeResponseDto extends createZodDto(EmitProbeResponseSchema) {}
