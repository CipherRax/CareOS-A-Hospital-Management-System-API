import { Injectable } from '@nestjs/common';
import { Prisma, type BedStatus } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { pageOf, paginate } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { formatInpatientNumber, nextInpatientSequence } from './domain/inpatient-number';
import { assertAdmissionAction, assertManualBedStatus, bedUnavailable } from './domain/inpatient-flow';
import {
  CreateAdmissionDto,
  CreateBedDto,
  CreateRoomDto,
  CreateWardDto,
  DischargeAdmissionDto,
  ListAdmissionsQueryDto,
  ListBedsQueryDto,
  ListWardsQueryDto,
  SetBedStatusDto,
  TransferAdmissionDto,
  UpdateWardDto,
  AdmissionSource,
} from './dto/inpatient.dto';
import { z } from 'zod';

/** Zod-inferred union of admission source values. */
export type AdmissionSourceValue = z.infer<typeof AdmissionSource>;

/** Shared deep include for admissions (latest assignment first + discharge). */
const ADMISSION_INCLUDE = {
  assignments: { orderBy: { assignedAt: 'desc' as const } },
  discharge: true,
} as const;

type AdmissionInclude = typeof ADMISSION_INCLUDE;
type DeepAdmission = Prisma.AdmissionGetPayload<{ include: AdmissionInclude }>;

/** Admission fields required to create one (emergency strips the DTO extras). */
export interface NewAdmissionInput {
  patientId: string;
  branchId: string;
  bedId: string;
  departmentId?: string;
  encounterId?: string;
  expectedDischargeAt?: Date;
  provisionalDiagnosis?: string;
}

/**
 * Inpatient (brief §6.9). Wards → rooms → beds; admission flow = doctor
 * authorizes (inpatient.create) → available bed row-locked → admission created
 * → bed assigned → patient inpatient. One-bed-one-patient is enforced by the
 * partial unique index on active BedAssignments (migration) PLUS a FOR UPDATE
 * row lock on the bed inside the assignment transaction; violations surface as
 * BED_UNAVAILABLE. Transfers close the old assignment (history preserved) and
 * open a new one. Discharge closes the admission + active assignment and flips
 * the bed to CLEANING.
 */
@Injectable()
export class InpatientService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  // ─── wards / rooms / beds ────────────────────────────────────────────────

  async createWard(input: CreateWardDto) {
    const organizationId = this.tenantContext.requireOrg();
    const ward = await this.txRunner.run(async (ctx: TxContext) => {
      const branch = await ctx.db.branch.findFirst({
        where: { id: input.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch not found');
      return ctx.db.ward.create({
        data: {
          id: newId(),
          organizationId,
          branchId: input.branchId,
          name: input.name,
          code: input.code ?? null,
          floor: input.floor ?? null,
          description: input.description ?? null,
        },
        include: { rooms: { include: { beds: true } } },
      });
    });
    return { ward: serializeWard(ward) };
  }

  async updateWard(id: string, input: UpdateWardDto) {
    const organizationId = this.tenantContext.requireOrg();
    const ward = await this.txRunner.run(async (ctx: TxContext) => {
      const existing = await ctx.db.ward.findFirst({ where: { id, organizationId }, select: { id: true } });
      if (!existing) throw notFound('Ward not found');
      await ctx.db.ward.updateMany({
        where: { id, organizationId },
        data: {
          ...(input.name !== undefined ? { name: input.name } : {}),
          ...(input.code !== undefined ? { code: input.code } : {}),
          ...(input.floor !== undefined ? { floor: input.floor } : {}),
          ...(input.description !== undefined ? { description: input.description } : {}),
          ...(input.isActive !== undefined ? { isActive: input.isActive } : {}),
        },
      });
      return this.loadWard(ctx, organizationId, id);
    });
    return { ward: serializeWard(ward) };
  }

  async listWards(query: ListWardsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.WardWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.active !== undefined ? { isActive: query.active } : {}),
    };
    const [rows, total] = await Promise.all([
      db.ward.findMany({
        where,
        include: { rooms: { include: { beds: true } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.ward.count({ where }),
    ]);
    return pageOf(rows.map(serializeWard), total, page, limit);
  }

  async getWard(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const ward = await db.ward.findFirst({
      where: { id, organizationId },
      include: { rooms: { include: { beds: true } } },
    });
    if (!ward) throw notFound('Ward not found');
    return { ward: serializeWard(ward) };
  }

  async createRoom(wardId: string, input: CreateRoomDto) {
    const organizationId = this.tenantContext.requireOrg();
    const room = await this.txRunner.run(async (ctx: TxContext) => {
      const ward = await ctx.db.ward.findFirst({ where: { id: wardId, organizationId }, select: { id: true } });
      if (!ward) throw notFound('Ward not found');
      return ctx.db.room.create({
        data: {
          id: newId(),
          organizationId,
          wardId,
          name: input.name,
          description: input.description ?? null,
        },
        include: { beds: true },
      });
    });
    return { room: serializeRoom(room) };
  }

  async createBed(roomId: string, input: CreateBedDto) {
    const organizationId = this.tenantContext.requireOrg();
    const bed = await this.txRunner.run(async (ctx: TxContext) => {
      const room = await ctx.db.room.findFirst({ where: { id: roomId, organizationId }, select: { id: true } });
      if (!room) throw notFound('Room not found');
      return ctx.db.bed.create({
        data: {
          id: newId(),
          organizationId,
          roomId,
          bedNumber: input.bedNumber,
        },
      });
    });
    return { bed: serializeBed(bed) };
  }

  async setBedStatus(id: string, input: SetBedStatusDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();
    const status = assertManualBedStatus(input.status);

    const bed = await this.txRunner.run(async (ctx: TxContext) => {
      const existing = await ctx.db.bed.findFirst({ where: { id, organizationId }, select: { version: true } });
      if (!existing) throw notFound('Bed not found');
      const guard = await ctx.db.bed.updateMany({
        where: { id, organizationId, version: input.version },
        data: { status, version: { increment: 1 } },
      });
      if (guard.count !== 1) throw lockConflict('Bed changed underneath this update.');

      ctx.emit({
        type: EventTypes.BedStatusChanged,
        aggregateType: 'bed',
        aggregateId: id,
        payload: { bedId: id, status, changedById: actorId },
      });
      const row = await ctx.db.bed.findFirst({ where: { id, organizationId } });
      if (!row) throw notFound('Bed not found');
      return row;
    });
    return { bed: serializeBed(bed) };
  }

  async listBeds(query: ListBedsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.BedWhereInput = {
      ...(query.wardId ? { room: { wardId: query.wardId } } : {}),
      ...(query.branchId ? { room: { ward: { branchId: query.branchId } } } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.bed.findMany({
        where,
        orderBy: { bedNumber: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.bed.count({ where }),
    ]);
    return pageOf(rows.map(serializeBed), total, page, limit);
  }

  // ─── admissions ──────────────────────────────────────────────────────────

  async createAdmission(
    input: CreateAdmissionDto,
    opts: { source?: AdmissionSourceValue } = {},
  ) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const id = await this.txRunner.run(async (ctx: TxContext) =>
      this.createAdmissionInTx(
        ctx,
        organizationId,
        actorId,
        input,
        opts.source ?? 'OUTPATIENT_CLINIC',
      ),
    );
    const admission = await this.prisma
      .tenantFor(organizationId)
      .admission.findFirst({
        where: { id, organizationId },
        include: ADMISSION_INCLUDE,
      });
    if (!admission) throw notFound('Admission not found');
    return { admission: serializeAdmission(admission) };
  }

  /**
   * Admission creation run inside the CALLER's transaction — used by the
   * emergency module so an ED disposition commit atomically with the admission.
   * Returns the new admission id; emits Inpatient.AdmissionCreated in-context.
   */
  async createAdmissionInTx(
    ctx: TxContext,
    organizationId: string,
    actorId: string,
    input: NewAdmissionInput,
    source: AdmissionSourceValue,
  ): Promise<string> {
    await this.requirePatient(ctx, organizationId, input.patientId);
    await this.requireBranch(ctx, organizationId, input.branchId);

    const active = await ctx.db.admission.findFirst({
      where: { organizationId, patientId: input.patientId, status: 'ADMITTED' },
      select: { id: true },
    });
    if (active) {
      throw new AppError({
        code: ErrorCodes.ADMISSION_ALREADY_ACTIVE,
        message: 'The patient already has an active admission.',
        silent: true,
      });
    }

    const bed = await this.lockBedForAssignment(ctx, organizationId, input.bedId);
    const id = newId();
    const seq = await nextInpatientSequence(ctx.db, organizationId, 'admission');

    try {
      await ctx.db.admission.create({
        data: {
          id,
          organizationId,
          admissionNumber: formatInpatientNumber('admission', seq),
          patientId: input.patientId,
          branchId: input.branchId,
          departmentId: input.departmentId ?? null,
          encounterId: input.encounterId ?? null,
          source,
          admittedById: actorId,
          expectedDischargeAt: input.expectedDischargeAt ?? null,
          provisionalDiagnosis: input.provisionalDiagnosis ?? null,
        },
      });
      await ctx.db.bedAssignment.create({
        data: {
          id: newId(),
          organizationId,
          bedId: bed.id,
          admissionId: id,
          assignedById: actorId,
        },
      });
      await ctx.db.bed.update({
        where: { id: bed.id },
        data: { status: 'OCCUPIED', version: { increment: 1 } },
      });
    } catch (err) {
      if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
        throw bedUnavailable('The selected bed became occupied during admission.');
      }
      throw err;
    }

    ctx.emit({
      type: EventTypes.AdmissionCreated,
      aggregateType: 'admission',
      aggregateId: id,
      payload: { admissionId: id, patientId: input.patientId, bedId: bed.id },
    });
    return id;
  }

  async transferAdmission(id: string, input: TransferAdmissionDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const admission = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.admission.findFirst({
        where: { id, organizationId },
        include: { assignments: true },
      });
      if (!current) throw notFound('Admission not found');
      if (current.status !== 'ADMITTED') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'A discharged admission cannot be transferred.',
          silent: true,
        });
      }

      const active = current.assignments.find((a) => a.releasedAt === null);
      if (!active) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'The admission has no active bed assignment.',
          silent: true,
        });
      }
      if (active.bedId === input.toBedId) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'The target bed is the admission’s current bed.',
          silent: true,
        });
      }

      const target = await this.lockBedForAssignment(ctx, organizationId, input.toBedId);

      await ctx.db.bedAssignment.updateMany({
        where: { id: active.id, organizationId, releasedAt: null },
        data: { releasedById: actorId, releasedAt: new Date(), reason: input.reason ?? null },
      });
      await ctx.db.bed.update({
        where: { id: active.bedId },
        data: { status: 'AVAILABLE', version: { increment: 1 } },
      });

      try {
        await ctx.db.bedAssignment.create({
          data: {
            id: newId(),
            organizationId,
            bedId: target.id,
            admissionId: id,
            assignedById: actorId,
          },
        });
        await ctx.db.bed.update({
          where: { id: target.id },
          data: { status: 'OCCUPIED', version: { increment: 1 } },
        });
      } catch (err) {
        if (err instanceof Prisma.PrismaClientKnownRequestError && err.code === 'P2002') {
          throw bedUnavailable('The target bed became occupied during the transfer.');
        }
        throw err;
      }

      ctx.emit({
        type: EventTypes.AdmissionTransferred,
        aggregateType: 'admission',
        aggregateId: id,
        payload: { admissionId: id, patientId: current.patientId, fromBedId: active.bedId, toBedId: target.id },
      });
      return this.loadAdmission(ctx, organizationId, id);
    });
    return { admission: serializeAdmission(admission) };
  }

  async dischargeAdmission(id: string, input: DischargeAdmissionDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const admission = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.admission.findFirst({
        where: { id, organizationId },
        include: { assignments: true },
      });
      if (!current) throw notFound('Admission not found');

      const target = assertAdmissionAction(current.status, 'discharge');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'admission', current.status, target);

      const dischargeId = newId();
      await ctx.db.discharge.create({
        data: {
          id: dischargeId,
          organizationId,
          admissionId: id,
          dischargedById: actorId,
          dischargedAt: input.dischargedAt ?? new Date(),
          summary: input.summary ?? null,
          instructions: input.instructions ?? null,
          medications: (input.medications ?? null) as Prisma.InputJsonValue,
          followUp: (input.followUp ?? null) as Prisma.InputJsonValue,
          hasOutstandingBilling: input.hasOutstandingBilling ?? false,
          documentIds: (input.documentIds ?? null) as Prisma.InputJsonValue,
        },
      });

      const guard = await ctx.db.admission.updateMany({
        where: { id, organizationId, status: 'ADMITTED' },
        data: { status: 'DISCHARGED' },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'The admission changed while it was being discharged.',
          silent: true,
        });
      }

      const active = current.assignments.find((a) => a.releasedAt === null);
      if (active) {
        await ctx.db.bedAssignment.updateMany({
          where: { id: active.id, organizationId, releasedAt: null },
          data: { releasedById: actorId, releasedAt: new Date() },
        });
        await ctx.db.bed.update({
          where: { id: active.bedId },
          data: { status: 'CLEANING', version: { increment: 1 } },
        });
      }

      ctx.emit({
        type: EventTypes.AdmissionDischarged,
        aggregateType: 'admission',
        aggregateId: id,
        payload: { admissionId: id, patientId: current.patientId },
      });
      return this.loadAdmission(ctx, organizationId, id);
    });
    return { admission: serializeAdmission(admission) };
  }

  async listAdmissions(query: ListAdmissionsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.AdmissionWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.admission.findMany({
        where,
        include: ADMISSION_INCLUDE,
        orderBy: { admittedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.admission.count({ where }),
    ]);
    return pageOf(rows.map(serializeAdmission), total, page, limit);
  }

  async getAdmission(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const admission = await db.admission.findFirst({
      where: { id, organizationId },
      include: ADMISSION_INCLUDE,
    });
    if (!admission) throw notFound('Admission not found');
    return { admission: serializeAdmission(admission) };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  /**
   * Row-locks the bed (FOR UPDATE) and verifies it is assignable. Runs inside
   * the interactive transaction; concurrent admissions/transfers for the same
   * bed block here and re-read the committed state. A MAINTENANCE/BLOCKED bed,
   * a RESERVED/CLEANING bed, or one with an active assignment → BED_UNAVAILABLE.
   */
  private async lockBedForAssignment(
    ctx: TxContext,
    organizationId: string,
    bedId: string,
  ): Promise<{ id: string; status: BedStatus }> {
    const rows = await ctx.db.$queryRaw<Array<{ id: string; status: BedStatus }>>`
      SELECT id, status
      FROM beds
      WHERE id = ${bedId} AND "organizationId" = ${organizationId}
      FOR UPDATE`;
    const row = rows[0];
    if (!row) throw notFound('Bed not found');
    if (row.status !== 'AVAILABLE') {
      throw bedUnavailable('The bed is not available for assignment.');
    }
    const active = await ctx.db.bedAssignment.findFirst({
      where: { organizationId, bedId, releasedAt: null },
      select: { id: true },
    });
    if (active) throw bedUnavailable('The bed is already occupied.');
    return row;
  }

  private async requirePatient(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.patient.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Patient not found');
  }

  private async requireBranch(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.branch.findFirst({ where: { id, organizationId }, select: { id: true } });
    if (!row) throw notFound('Branch not found');
  }

  private async loadAdmission(
    ctx: TxContext,
    organizationId: string,
    id: string,
  ): Promise<DeepAdmission> {
    const row = await ctx.db.admission.findFirst({
      where: { id, organizationId },
      include: ADMISSION_INCLUDE,
    });
    if (!row) throw notFound('Admission not found');
    return row;
  }

  private async loadWard(
    ctx: TxContext,
    organizationId: string,
    id: string,
  ) {
    const row = await ctx.db.ward.findFirst({
      where: { id, organizationId },
      include: { rooms: { include: { beds: true } } },
    });
    if (!row) throw notFound('Ward not found');
    return row;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function lockConflict(message: string): AppError {
  return new AppError({ code: ErrorCodes.OPTIMISTIC_LOCK_CONFLICT, message, silent: true });
}

export function serializeBed(p: {
  id: string;
  organizationId: string;
  roomId: string;
  bedNumber: string;
  status: string;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    roomId: p.roomId,
    bedNumber: p.bedNumber,
    status: p.status,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function serializeRoom(p: {
  id: string;
  organizationId: string;
  wardId: string;
  name: string;
  description: string | null;
  createdAt: Date;
  updatedAt: Date;
  beds?: ReturnType<typeof serializeBed>[];
}) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    wardId: p.wardId,
    name: p.name,
    description: p.description,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    beds: p.beds?.map(serializeBed) ?? [],
  };
}

export function serializeWard(p: {
  id: string;
  organizationId: string;
  branchId: string;
  name: string;
  code: string | null;
  floor: string | null;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
  rooms?: ReturnType<typeof serializeRoom>[];
}) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    branchId: p.branchId,
    name: p.name,
    code: p.code,
    floor: p.floor,
    description: p.description,
    isActive: p.isActive,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    rooms: p.rooms?.map(serializeRoom) ?? [],
  };
}

function serializeAssignment(p: {
  id: string;
  organizationId: string;
  bedId: string;
  admissionId: string;
  assignedById: string;
  assignedAt: Date;
  releasedById: string | null;
  releasedAt: Date | null;
  reason: string | null;
  createdAt: Date;
}) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    bedId: p.bedId,
    admissionId: p.admissionId,
    assignedById: p.assignedById,
    assignedAt: p.assignedAt,
    releasedById: p.releasedById,
    releasedAt: p.releasedAt,
    reason: p.reason,
    createdAt: p.createdAt,
  };
}

function serializeDischarge(p: {
  id: string;
  organizationId: string;
  admissionId: string;
  dischargedById: string | null;
  dischargedAt: Date;
  summary: string | null;
  instructions: string | null;
  medications: Prisma.JsonValue;
  followUp: Prisma.JsonValue;
  hasOutstandingBilling: boolean;
  documentIds: Prisma.JsonValue;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    admissionId: p.admissionId,
    dischargedById: p.dischargedById,
    dischargedAt: p.dischargedAt,
    summary: p.summary,
    instructions: p.instructions,
    medications: p.medications,
    followUp: p.followUp,
    hasOutstandingBilling: p.hasOutstandingBilling,
    documentIds: p.documentIds,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}

export function serializeAdmission(p: DeepAdmission) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    admissionNumber: p.admissionNumber,
    patientId: p.patientId,
    branchId: p.branchId,
    departmentId: p.departmentId,
    encounterId: p.encounterId,
    source: p.source,
    status: p.status,
    admittedById: p.admittedById,
    admittedAt: p.admittedAt,
    expectedDischargeAt: p.expectedDischargeAt,
    provisionalDiagnosis: p.provisionalDiagnosis,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    assignments: p.assignments.map(serializeAssignment),
    discharge: p.discharge ? serializeDischarge(p.discharge) : null,
  };
}