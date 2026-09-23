import { Injectable } from '@nestjs/common';
import type { VitalRecord } from '@prisma/client';
import { PrismaService, type TenantClient } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { RealtimeService } from '../../database/realtime.service';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { bmiCategory, computeBmi } from './domain/bmi';
import type { CorrectVitalDto, RecordVitalDto } from './dto/vitals.dto';

/**
 * Append-only triage vitals (brief Phase 3, §6.5). Measurements are immutable:
 * corrections create a NEW row pointing at the superseded one. BMI is computed
 * in code from height/weight and re-computed for every corrected measurement.
 */
@Injectable()
export class VitalsService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly realtime: RealtimeService,
  ) {}

  async record(input: RecordVitalDto) {
    const organizationId = this.tenantContext.requireOrg();

    const record = await this.txRunner.run(async (ctx: TxContext) => {
      await this.assertPatient(ctx.db, organizationId, input.patientId);
      if (input.visitId) {
        await this.assertVisit(ctx.db, organizationId, input.visitId);
      }

      const data = measurementsOf(input);
      const bmi = computeBmi(data.weightKg, data.heightCm);
      const created = await ctx.db.vitalRecord.create({
        data: {
          id: newId(),
          organizationId,
          patientId: input.patientId,
          visitId: input.visitId ?? null,
          branchId: null,
          departmentId: null,
          ...data,
          bmi,
          observedAt: input.observedAt ?? new Date(),
          recordedByUserId: this.tenantContext.scope.userId!,
        },
      });

      await this.appendTimeline(ctx, input.patientId, {
        type: 'triage.vitals_recorded',
        title: 'Vitals recorded',
        requiredPermission: 'vitals.read',
        payload: { vitalRecordId: created.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'triage.vitals_recorded',
          resource: 'vital_record',
          resourceId: created.id,
          newState: { patientId: input.patientId, bmi, observedAt: created.observedAt },
        },
        select: { id: true },
      });
      ctx.emit({
        type: EventTypes.VitalRecorded,
        aggregateType: 'vital_record',
        aggregateId: created.id,
        payload: { vitalRecordId: created.id, patientId: input.patientId },
      });
      return created;
    });

    this.publish(organizationId, {
      event: EventTypes.VitalRecorded,
      aggregateId: record.id,
      payload: { vitalRecordId: record.id },
    });
    return { vitalRecord: serializeVital(record) };
  }

  async correct(id: string, input: CorrectVitalDto) {
    const organizationId = this.tenantContext.requireOrg();

    const record = await this.txRunner.run(async (ctx: TxContext) => {
      const original = await ctx.db.vitalRecord.findFirst({ where: { id, organizationId } });
      if (!original) {
        throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Vital record not found.', silent: true });
      }

      const data = measurementsOf(input);
      const bmi = computeBmi(data.weightKg, data.heightCm);
      const created = await ctx.db.vitalRecord.create({
        data: {
          id: newId(),
          organizationId,
          patientId: original.patientId,
          visitId: original.visitId,
          branchId: original.branchId,
          departmentId: original.departmentId,
          ...data,
          bmi,
          observedAt: original.observedAt,
          correctionOfId: original.id,
          correctionReason: input.correctionReason,
          recordedByUserId: this.tenantContext.scope.userId!,
        },
      });

      await this.appendTimeline(ctx, original.patientId, {
        type: 'triage.vitals_corrected',
        title: 'Vitals corrected',
        requiredPermission: 'vitals.read',
        payload: { vitalRecordId: created.id, correctionOfId: original.id },
      });
      await ctx.db.auditLog.create({
        data: {
          id: newId(),
          organizationId,
          action: 'triage.vitals_corrected',
          resource: 'vital_record',
          resourceId: created.id,
          newState: { correctionOfId: original.id, reason: input.correctionReason },
        },
        select: { id: true },
      });
      ctx.emit({
        type: EventTypes.VitalRecorded,
        aggregateType: 'vital_record',
        aggregateId: created.id,
        payload: { vitalRecordId: created.id, patientId: original.patientId, correctionOfId: original.id },
      });
      return created;
    });

    this.publish(organizationId, {
      event: EventTypes.VitalRecorded,
      aggregateId: record.id,
      payload: { vitalRecordId: record.id, correctionOfId: id },
    });
    return { vitalRecord: serializeVital(record) };
  }

  async list(query: { patientId?: string; visitId?: string; page?: number; limit?: number }) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Record<string, unknown> = {};
    if (query.patientId) where.patientId = query.patientId;
    if (query.visitId) where.visitId = query.visitId;

    const [rows, total] = await Promise.all([
      db.vitalRecord.findMany({
        where,
        orderBy: [{ observedAt: 'desc' }, { createdAt: 'desc' }],
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.vitalRecord.count({ where }),
    ]);
    return pageOf(rows.map(serializeVital), total, page, limit);
  }

  async get(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const record = await db.vitalRecord.findFirst({ where: { id, organizationId } });
    if (!record) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Vital record not found.', silent: true });
    }
    return { vitalRecord: serializeVital(record) };
  }

  private async assertPatient(db: TenantClient | TxContext['db'], organizationId: string, patientId: string) {
    const patient = await db.patient.findFirst({ where: { id: patientId, organizationId }, select: { id: true } });
    if (!patient) {
      throw new AppError({ code: ErrorCodes.PATIENT_NOT_FOUND, message: 'Patient not found.', silent: true });
    }
  }

  private async assertVisit(db: TenantClient | TxContext['db'], organizationId: string, visitId: string) {
    const visit = await db.visit.findFirst({ where: { id: visitId, organizationId }, select: { id: true } });
    if (!visit) {
      throw new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message: 'Visit not found.', silent: true });
    }
  }

  private async appendTimeline(
    ctx: TxContext,
    patientId: string,
    input: { type: string; title: string; requiredPermission: string; payload: Record<string, unknown> },
  ): Promise<void> {
    await ctx.db.patientTimelineEntry.create({
      data: {
        id: newId(),
        organizationId: ctx.organizationId,
        patientId,
        type: input.type,
        title: input.title,
        requiredPermission: input.requiredPermission,
        actorId: this.tenantContext.scope.userId,
        occurredAt: new Date(),
        payload: input.payload as never,
      },
      select: { id: true },
    });
  }

  private publish(
    organizationId: string,
    event: { event: string; aggregateId: string; payload: Record<string, unknown> },
  ): void {
    this.realtime.publish(organizationId, 'vitals', { version: 1, ...event });
  }
}

/** Requests spread measurements over the DTO surface; this flattens them. */
function measurementsOf(input: RecordVitalDto | CorrectVitalDto): Pick<
  VitalRecord,
  | 'temperatureC'
  | 'systolicMmHg'
  | 'diastolicMmHg'
  | 'pulseBpm'
  | 'respiratoryRate'
  | 'spo2'
  | 'weightKg'
  | 'heightCm'
  | 'painScore'
  | 'notes'
> {
  const v = input as unknown as Record<string, unknown>;
  return {
    temperatureC: v.temperatureC as number | null | undefined ?? null,
    systolicMmHg: v.systolicMmHg as number | null | undefined ?? null,
    diastolicMmHg: v.diastolicMmHg as number | null | undefined ?? null,
    pulseBpm: v.pulseBpm as number | null | undefined ?? null,
    respiratoryRate: v.respiratoryRate as number | null | undefined ?? null,
    spo2: v.spo2 as number | null | undefined ?? null,
    weightKg: v.weightKg as number | null | undefined ?? null,
    heightCm: v.heightCm as number | null | undefined ?? null,
    painScore: v.painScore as number | null | undefined ?? null,
    notes: v.notes as string | null | undefined ?? null,
  };
}

function serializeVital(v: VitalRecord) {
  return {
    id: v.id,
    patientId: v.patientId,
    visitId: v.visitId,
    temperatureC: v.temperatureC,
    systolicMmHg: v.systolicMmHg,
    diastolicMmHg: v.diastolicMmHg,
    pulseBpm: v.pulseBpm,
    respiratoryRate: v.respiratoryRate,
    spo2: v.spo2,
    weightKg: v.weightKg,
    heightCm: v.heightCm,
    bmi: v.bmi,
    bmiCategory: v.bmi !== null ? bmiCategory(v.bmi) : null,
    painScore: v.painScore,
    notes: v.notes,
    observedAt: v.observedAt,
    correctionOfId: v.correctionOfId,
    correctionReason: v.correctionReason,
    recordedByUserId: v.recordedByUserId,
    createdAt: v.createdAt,
  };
}