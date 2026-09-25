import { Injectable } from '@nestjs/common';
import type { EmergencyVisit } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { pageOf, paginate } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { InpatientService } from '../inpatient/inpatient.service';
import { formatEmergencyNumber, nextEmergencySequence } from './domain/emergency-number';
import { assertEmergencyAction, isEmergencyTerminal } from './domain/emergency-flow';
import {
  AdmitFromEmergencyDto,
  AssessEmergencyVisitDto,
  ListEmergencyVisitsQueryDto,
  ReferEmergencyVisitDto,
  RegisterEmergencyVisitDto,
  SetEmergencyPriorityDto,
  TreatEmergencyVisitDto,
  TriageEmergencyVisitDto,
} from './dto/emergency.dto';

type EmergencyVisitRow = EmergencyVisit;

/**
 * Emergency department (brief §6.9). Workflow:
 * ARRIVED → TRIAGED → ASSESSED → IN_TREATMENT/OBSERVATION → ADMITTED|REFERRED|DISCHARGED.
 * Each step stamps its timestamp and clinical detail for ED analytics;
 * dispositions are final — any further action → EMERGENCY_VISIT_CLOSED. An
 * ADMITTED disposition creates the inpatient admission in the SAME transaction
 * via InpatientService, inheriting the bed concurrency guarantees.
 */
@Injectable()
export class EmergencyService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
    private readonly inpatient: InpatientService,
  ) {}

  async registerVisit(input: RegisterEmergencyVisitDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const branch = await ctx.db.branch.findFirst({
        where: { id: input.branchId, organizationId },
        select: { id: true },
      });
      if (!branch) throw notFound('Branch not found');
      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) throw notFound('Patient not found');

      const id = newId();
      const seq = await nextEmergencySequence(ctx.db, organizationId, 'visit');
      const arrivedAt = input.arrivedAt ?? new Date();
      await ctx.db.emergencyVisit.create({
        data: {
          id,
          organizationId,
          visitNumber: formatEmergencyNumber('visit', seq),
          branchId: input.branchId,
          patientId: input.patientId,
          status: 'ARRIVED',
          registeredById: actorId,
          arrivedById: actorId,
          arrivedAt,
        },
      });
      ctx.emit({
        type: EventTypes.EmergencyVisitRegistered,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: input.patientId, arrivedAt },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  async triageVisit(id: string, input: TriageEmergencyVisitDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id);
      const target = assertEmergencyAction(current.status, 'triage');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'emergency_visit', current.status, target);

      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: {
          status: target,
          priority: input.priority,
          chiefComplaint: input.complaint ?? null,
          triagedById: actorId,
          triagedAt: new Date(),
        },
      });
      ctx.emit({
        type: EventTypes.EmergencyVisitTriaged,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId, priority: input.priority },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  /** Priority re-recorded later in the visit (initial priority is set at triage). */
  async setPriority(id: string, input: SetEmergencyPriorityDto) {
    const organizationId = this.tenantContext.requireOrg();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id);
      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: { priority: input.priority },
      });
      ctx.emit({
        type: EventTypes.EmergencyPriorityRecorded,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId, priority: input.priority },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  async assessVisit(id: string, input: AssessEmergencyVisitDto) {
    return this.advance(id, 'assess', { assessment: input.assessment },
      EventTypes.EmergencyVisitAssessed, 'assessedAt');
  }

  async treatVisit(id: string, input: TreatEmergencyVisitDto) {
    return this.advance(id, 'treat', { treatment: input.treatment },
      EventTypes.EmergencyVisitTreatmentStarted, 'treatmentStartedAt');
  }

  async observeVisit(id: string) {
    return this.advance(id, 'observe', {},
      EventTypes.EmergencyVisitObserved, 'observedAt');
  }

  async admitVisit(id: string, input: AdmitFromEmergencyDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id, { branchId: true });
      const target = assertEmergencyAction(current.status, 'admit');

      // Create the inpatient admission in THIS transaction (bed row-locked,
      // one-bed-one-patient enforced). On failure the whole visit transition
      // rolls back — the ED record is never left half-moved.
      const admissionId = await this.inpatient.createAdmissionInTx(
        ctx,
        organizationId,
        actorId,
        {
          branchId: current.branchId,
          patientId: current.patientId,
          bedId: input.bedId,
          departmentId: input.departmentId,
          provisionalDiagnosis: input.provisionalDiagnosis,
          expectedDischargeAt: input.expectedDischargeAt,
        },
        'EMERGENCY',
      );

      await this.workflows.assertAllowed(ctx.db, organizationId, 'emergency_visit', current.status, target);
      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: {
          status: target,
          disposition: 'ADMITTED',
          dispositionAt: new Date(),
          admittedAdmissionId: admissionId,
        },
      });
      ctx.emit({
        type: EventTypes.EmergencyVisitAdmitted,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId, admissionId },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  async referVisit(id: string, input: ReferEmergencyVisitDto) {
    const organizationId = this.tenantContext.requireOrg();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id);
      const target = assertEmergencyAction(current.status, 'refer');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'emergency_visit', current.status, target);

      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: {
          status: target,
          disposition: 'REFERRED',
          dispositionAt: new Date(),
          referredTo: input.referredTo,
          referralNotes: input.referralNotes ?? null,
        },
      });
      ctx.emit({
        type: EventTypes.EmergencyVisitReferred,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId, referredTo: input.referredTo },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  async dischargeVisit(id: string) {
    const organizationId = this.tenantContext.requireOrg();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id);
      const target = assertEmergencyAction(current.status, 'discharge');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'emergency_visit', current.status, target);

      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: {
          status: target,
          disposition: 'DISCHARGED',
          dispositionAt: new Date(),
        },
      });
      ctx.emit({
        type: EventTypes.EmergencyVisitDischarged,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  async listVisits(query: ListEmergencyVisitsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.priority ? { priority: query.priority } : {}),
    };
    const [rows, total] = await Promise.all([
      db.emergencyVisit.findMany({
        where,
        orderBy: { arrivedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.emergencyVisit.count({ where }),
    ]);
    return pageOf(rows.map(serializeVisit), total, page, limit);
  }

  async getVisit(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const visit = await db.emergencyVisit.findFirst({ where: { id, organizationId } });
    if (!visit) throw notFound('Emergency visit not found');
    return { visit: serializeVisit(visit) };
  }

  /** Query-time ED analytics (today) — see limitations; not rollup-backed. */
  async summary() {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);

    const start = new Date();
    start.setUTCHours(0, 0, 0, 0);

    const today = await db.emergencyVisit.findMany({
      where: { organizationId, arrivedAt: { gte: start } },
      select: {
        status: true,
        priority: true,
        disposition: true,
        arrivedAt: true,
        triagedAt: true,
        dispositionAt: true,
      },
    });

    const arrivals = today.length;
    const terminal = new Set(['DISCHARGED', 'ADMITTED', 'REFERRED']);
    const active = today.filter((v) => !terminal.has(v.status)).length;

    const triaged = today.filter((v) => v.triagedAt !== null);
    const avgMinutesToTriage =
      triaged.length === 0
        ? 0
        : round1(
            triaged.reduce((s, v) => s + minutesBetween(v.arrivedAt, v.triagedAt!), 0) / triaged.length,
          );

    const disposed = today.filter((v) => v.dispositionAt !== null);
    const avgMinutesToDisposition =
      disposed.length === 0
        ? 0
        : round1(
            disposed.reduce((s, v) => s + minutesBetween(v.arrivedAt, v.dispositionAt!), 0) / disposed.length,
          );

    const byPriority: Record<string, number> = {};
    for (const v of today) {
      if (v.priority) byPriority[v.priority] = (byPriority[v.priority] ?? 0) + 1;
    }
    const byDisposition: Record<string, number> = {};
    for (const v of today) {
      if (v.disposition) byDisposition[v.disposition] = (byDisposition[v.disposition] ?? 0) + 1;
    }

    return {
      period: 'TODAY' as const,
      arrivals,
      active,
      avgMinutesToTriage,
      avgMinutesToDisposition,
      byPriority,
      byDisposition,
    };
  }

  // ─── internals ───────────────────────────────────────────────────────────

  private async advance(
    id: string,
    action: 'assess' | 'treat' | 'observe',
    detail: Partial<Pick<EmergencyVisitRow, 'assessment' | 'treatment'>>,
    event: string,
    stampField: 'assessedAt' | 'treatmentStartedAt' | 'observedAt',
  ) {
    const organizationId = this.tenantContext.requireOrg();

    const visit = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.requireOpenVisit(ctx, organizationId, id);
      const target = assertEmergencyAction(current.status, action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'emergency_visit', current.status, target);

      await ctx.db.emergencyVisit.updateMany({
        where: { id, organizationId, status: current.status },
        data: {
          status: target,
          [stampField]: new Date(),
          ...(Object.keys(detail).length > 0 ? detail : {}),
        },
      });
      ctx.emit({
        type: event,
        aggregateType: 'emergency_visit',
        aggregateId: id,
        payload: { visitId: id, patientId: current.patientId },
      });
      return this.loadVisit(ctx, organizationId, id);
    });
    return { visit: serializeVisit(visit) };
  }

  /**
   * Loads a visit and rejects all actions on a closed (terminal) record — the
   * terminal actor endpoints are expressive about the failure (EMERGENCY_VISIT_CLOSED)
   * so callers don't have to guess from the transition error.
   */
  private async requireOpenVisit(
    ctx: TxContext,
    organizationId: string,
    id: string,
    extra: { branchId?: true } = {},
  ) {
    const row = await ctx.db.emergencyVisit.findFirst({
      where: { id, organizationId },
      select: {
        status: true,
        patientId: true,
        ...(extra.branchId ? { branchId: true } : {}),
      },
    });
    if (!row) throw notFound('Emergency visit not found');
    if (isEmergencyTerminal(row.status)) {
      throw closedVisit('The emergency visit is already closed.');
    }
    return row;
  }

  private async loadVisit(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.emergencyVisit.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Emergency visit not found');
    return row;
  }
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function closedVisit(message: string): AppError {
  return new AppError({ code: ErrorCodes.EMERGENCY_VISIT_CLOSED, message, silent: true });
}

function minutesBetween(a: Date, b: Date): number {
  return (b.getTime() - a.getTime()) / 60_000;
}

function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

function serializeVisit(p: EmergencyVisitRow) {
  return {
    id: p.id,
    organizationId: p.organizationId,
    visitNumber: p.visitNumber,
    branchId: p.branchId,
    patientId: p.patientId,
    status: p.status,
    priority: p.priority,
    registeredById: p.registeredById,
    arrivedById: p.arrivedById,
    arrivedAt: p.arrivedAt,
    chiefComplaint: p.chiefComplaint,
    triagedById: p.triagedById,
    triagedAt: p.triagedAt,
    assessedAt: p.assessedAt,
    assessment: p.assessment,
    treatmentStartedAt: p.treatmentStartedAt,
    treatment: p.treatment,
    observedAt: p.observedAt,
    dispositionAt: p.dispositionAt,
    disposition: p.disposition,
    admittedAdmissionId: p.admittedAdmissionId,
    referredTo: p.referredTo,
    referralNotes: p.referralNotes,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
  };
}