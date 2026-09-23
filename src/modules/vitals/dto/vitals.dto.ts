import { createZodDto } from 'nestjs-zod';
import { z } from 'zod';

export const PainScale = z.number().int().min(0).max(10);

const vitalFields = {
  temperatureC: z.number().min(28).max(47).nullish(),
  systolicMmHg: z.number().int().min(40).max(300).nullish(),
  diastolicMmHg: z.number().int().min(20).max(200).nullish(),
  pulseBpm: z.number().int().min(20).max(300).nullish(),
  respiratoryRate: z.number().int().min(4).max(100).nullish(),
  spo2: z.number().int().min(40).max(100).nullish(),
  weightKg: z.number().min(1).max(500).nullish(),
  heightCm: z.number().min(60).max(260).nullish(),
  painScore: PainScale.nullish(),
  notes: z.string().trim().max(1000).nullish(),
};

export const RecordVitalSchema = z
  .object({
    patientId: z.string().uuid(),
    visitId: z.string().uuid().optional(),
    observedAt: z.coerce.date().optional(),
    ...vitalFields,
  })
  .refine((v) => Object.keys(v).some((k) => vitalFields[k as keyof typeof vitalFields] !== undefined), {
    message: 'At least one vital measurement is required',
  });
export class RecordVitalDto extends createZodDto(RecordVitalSchema) {}

export const CorrectVitalSchema = z
  .object({
    correctionReason: z.string().trim().min(1).max(500),
    ...vitalFields,
  })
  .refine((v) => Object.keys(v).some((k) => vitalFields[k as keyof typeof vitalFields] !== undefined), {
    message: 'At least one corrected measurement is required',
  });
export class CorrectVitalDto extends createZodDto(CorrectVitalSchema) {}

export const ListVitalsQuerySchema = z.object({
  patientId: z.string().uuid().optional(),
  visitId: z.string().uuid().optional(),
  page: z.coerce.number().int().positive().optional(),
  limit: z.coerce.number().int().positive().optional(),
});
export class ListVitalsQueryDto extends createZodDto(ListVitalsQuerySchema) {}