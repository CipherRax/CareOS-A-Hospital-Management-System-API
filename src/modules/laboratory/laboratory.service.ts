import { Injectable } from '@nestjs/common';
import { Prisma, type LabSampleType } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { pageOf, paginate, parseDateRange } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { formatLabNumber, nextLabSequence } from './domain/lab-number';
import {
  assertFieldValue,
  assertLabAction,
  assertOrderVerifiedForRelease,
  classifyFieldValue,
  computeTurnaroundMinutes,
  type LabAction,
} from './domain/lab-flow';
import { parseLabOrgSettings } from './domain/lab-settings';
import type {
  AcknowledgeCriticalDto,
  AmendResultDto,
  CancelLabOrderDto,
  CreateLabCategoryDto,
  CreateLabOrderDto,
  CreateLabTestDto,
  EnterResultsDto,
  ListLabOrdersQueryDto,
  ListLabTestsQueryDto,
  RejectLabOrderDto,
  TatQueryDto,
  UpdateLabFieldDto,
  UpdateLabTestDto,
} from './dto/laboratory.dto';

/** Shared include for lab orders that carry their full deep view. */
const ORDER_INCLUDE = {
  items: {
    include: {
      test: { select: { id: true, code: true, name: true } },
      results: { include: { criticality: true } },
    },
  },
  samples: true,
} as const;

type LabOrderInclude = typeof ORDER_INCLUDE;
type DeepLabOrder = Prisma.LabOrderGetPayload<{ include: LabOrderInclude }>;

/**
 * Laboratory & radiology (brief Phase 6): org test catalog (with configured
 * reference/critical ranges), orders (workflow aggregate 'lab_order'), the
 * physical sample (mirrors the order), versioned results (amendments after
 * release), the critical-result acknowledgement trail and turnaround-time
 * aggregation.
 *
 * Every explicit status move funnels through the workflow engine (custom edges
 * only widen) and is guarded by an atomic `updateMany` on the previous status.
 * Result flags come ONLY from the configured ranges on LabTestField (pure
 * functions — see domain/lab-flow.ts).
 */
@Injectable()
export class LaboratoryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  // ─── Catalog: categories ───────────────────────────────────────────────────

  async createCategory(input: CreateLabCategoryDto) {
    const organizationId = this.tenantContext.requireOrg();

    const category = await this.txRunner.run(async (ctx: TxContext) => {
      const duplicate = await ctx.db.labTestCategory.findFirst({
        where: { organizationId, name: input.name },
        select: { id: true },
      });
      if (duplicate) throw conflict('A category with this name already exists.');

      const id = newId();
      await ctx.db.labTestCategory.create({
        data: { id, organizationId, name: input.name, description: input.description ?? null },
      });
      return this.loadCategory(ctx, organizationId, id);
    });
    return { category: serializeCategory(category) };
  }

  async listCategories() {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.labTestCategory.findMany({
      where: { organizationId },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
    });
    return pageOf(rows.map(serializeCategory), rows.length, 1, rows.length);
  }

  // ─── Catalog: tests & fields ───────────────────────────────────────────────

  async createTest(input: CreateLabTestDto) {
    const organizationId = this.tenantContext.requireOrg();

    const test = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.categoryId) {
        const category = await ctx.db.labTestCategory.findFirst({
          where: { id: input.categoryId, organizationId },
          select: { id: true },
        });
        if (!category) throw notFound('Category not found');
      }
      const duplicate = await ctx.db.labTest.findFirst({
        where: { organizationId, code: input.code },
        select: { id: true },
      });
      if (duplicate) throw conflict('A test with this code already exists.');

      const id = newId();
      await ctx.db.labTest.create({
        data: {
          id,
          organizationId,
          code: input.code,
          name: input.name,
          categoryId: input.categoryId ?? null,
          sampleType: input.sampleType ?? 'OTHER',
          specimenInstructions: input.specimenInstructions ?? null,
          isActive: input.isActive ?? true,
          version: 1,
          fields: {
            create: input.fields.map((f, i) => ({
              id: newId(),
              organizationId,
              name: f.name,
              fieldType: f.fieldType,
              unit: f.unit ?? null,
              referenceMin: f.referenceMin !== undefined ? new Prisma.Decimal(f.referenceMin) : null,
              referenceMax: f.referenceMax !== undefined ? new Prisma.Decimal(f.referenceMax) : null,
              criticalMin: f.criticalMin !== undefined ? new Prisma.Decimal(f.criticalMin) : null,
              criticalMax: f.criticalMax !== undefined ? new Prisma.Decimal(f.criticalMax) : null,
              allowsValues: f.allowsValues ?? null,
              displayOrder: f.displayOrder ?? i,
            })),
          },
        },
      });
      return this.loadTest(ctx, organizationId, id);
    });
    return { test: serializeTest(test) };
  }

  async listTests(query: ListLabTestsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.LabTestWhereInput = {
      ...(query.categoryId ? { categoryId: query.categoryId } : {}),
      ...(query.active ? { isActive: query.active === 'true' } : {}),
    };
    const [rows, total] = await Promise.all([
      db.labTest.findMany({
        where,
        include: { fields: { orderBy: { displayOrder: 'asc' } } },
        orderBy: { name: 'asc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.labTest.count({ where }),
    ]);
    return pageOf(rows.map(serializeTest), total, page, limit);
  }

  async updateTest(id: string, input: UpdateLabTestDto) {
    const organizationId = this.tenantContext.requireOrg();

    const test = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadTest(ctx, organizationId, id);
      if (input.version !== undefined && current.version !== input.version) {
        throw optimisticLock('Test');
      }
      if (input.categoryId !== undefined && input.categoryId !== null) {
        const category = await ctx.db.labTestCategory.findFirst({
          where: { id: input.categoryId, organizationId },
          select: { id: true },
        });
        if (!category) throw notFound('Category not found');
      }
      const data: Prisma.LabTestUncheckedUpdateInput = { version: { increment: 1 } };
      if (input.name !== undefined) data.name = input.name;
      if (input.categoryId !== undefined) data.categoryId = input.categoryId;
      if (input.sampleType !== undefined) data.sampleType = input.sampleType;
      if (input.specimenInstructions !== undefined) data.specimenInstructions = input.specimenInstructions;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      await ctx.db.labTest.update({ where: { id }, data });
      return this.loadTest(ctx, organizationId, id);
    });
    return { test: serializeTest(test) };
  }

  async updateField(testId: string, fieldId: string, input: UpdateLabFieldDto) {
    const organizationId = this.tenantContext.requireOrg();

    const field = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labTestField.findFirst({ where: { id: fieldId, organizationId, testId } });
      if (!current) throw notFound('Field not found');

      const data: Prisma.LabTestFieldUpdateInput = {};
      if (input.name !== undefined) data.name = input.name;
      if (input.unit !== undefined) data.unit = input.unit;
      if (input.referenceMin !== undefined) data.referenceMin = input.referenceMin === null ? null : new Prisma.Decimal(input.referenceMin);
      if (input.referenceMax !== undefined) data.referenceMax = input.referenceMax === null ? null : new Prisma.Decimal(input.referenceMax);
      if (input.criticalMin !== undefined) data.criticalMin = input.criticalMin === null ? null : new Prisma.Decimal(input.criticalMin);
      if (input.criticalMax !== undefined) data.criticalMax = input.criticalMax === null ? null : new Prisma.Decimal(input.criticalMax);
      if (input.allowsValues !== undefined) data.allowsValues = input.allowsValues;
      if (input.displayOrder !== undefined) data.displayOrder = input.displayOrder;
      if (input.isActive !== undefined) data.isActive = input.isActive;

      await ctx.db.labTestField.update({ where: { id: fieldId }, data });
      return this.loadField(ctx, organizationId, fieldId);
    });
    return { field: serializeField(field) };
  }

  // ─── Orders ────────────────────────────────────────────────────────────────

  async createOrder(input: CreateLabOrderDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
      const branch = await ctx.db.branch.findFirst({ where: { id: input.branchId, organizationId }, select: { id: true } });
      if (!branch) throw notFound('Branch not found');
      const patient = await ctx.db.patient.findFirst({ where: { id: input.patientId, organizationId }, select: { id: true } });
      if (!patient) throw notFound('Patient not found');

      let recollection = null;
      if (input.recollectFromSampleId) {
        const source = await ctx.db.labSample.findFirst({
          where: { id: input.recollectFromSampleId, organizationId },
          select: { id: true, patientId: true, status: true, orderId: true },
        });
        if (!source) throw notFound('Source sample not found');
        if (source.patientId !== input.patientId) {
          throw validation('The recollection sample belongs to a different patient.');
        }
        if (source.status !== 'REJECTED') {
          throw validation('A recollection must reference a rejected sample.');
        }
        recollection = source;
      }

      const tests: Array<{ id: string; sampleType: LabSampleType }> = [];
      const seen = new Set<string>();
      for (const testId of input.testIds) {
        if (seen.has(testId)) throw validation('A test can only be ordered once per order.');
        seen.add(testId);
        const test = await ctx.db.labTest.findFirst({
          where: { id: testId, organizationId, isActive: true },
          select: { id: true, sampleType: true },
        });
        if (!test) throw notFound('Test not found or inactive');
        tests.push(test);
      }

      const orderId = newId();
      const sampleId = newId();
      const orderSeq = await nextLabSequence(ctx.db, organizationId, 'order');
      const sampleSeq = await nextLabSequence(ctx.db, organizationId, 'sample');

      await ctx.db.labOrder.create({
        data: {
          id: orderId,
          organizationId,
          orderNumber: formatLabNumber('order', orderSeq),
          patientId: input.patientId,
          branchId: input.branchId,
          encounterId: input.encounterId ?? null,
          status: 'ORDERED',
          priority: input.priority ?? 'ROUTINE',
          clinicalNotes: input.clinicalNotes ?? null,
          orderedById: actorId,
          items: {
            create: tests.map((t) => ({ id: newId(), organizationId, testId: t.id })),
          },
          samples: {
            create: {
              id: sampleId,
              organizationId,
              sampleNumber: formatLabNumber('sample', sampleSeq),
              patientId: input.patientId,
              branchId: input.branchId,
              sampleType: tests[0]?.sampleType ?? 'OTHER',
              status: 'ORDERED',
              recollectsFromOrderId: recollection ? recollection.orderId : null,
            },
          },
        },
      });

      ctx.emit({
        type: EventTypes.LabOrderCreated,
        aggregateType: 'lab_order',
        aggregateId: orderId,
        payload: { orderId, patientId: input.patientId, sampleId },
      });
      return this.loadOrder(ctx, organizationId, orderId);
    });
    return { order: serializeLabOrder(order) };
  }

  async listOrders(query: ListLabOrdersQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.LabOrderWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.labOrder.findMany({
        where,
        include: { items: { select: { id: true, testId: true } }, samples: { select: { id: true, sampleNumber: true, status: true } } },
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.labOrder.count({ where }),
    ]);
    const out = rows.map((r) => ({
      ...r,
      sample: r.samples[0] ?? null,
      items: r.items.map((i) => ({ id: i.id, testId: i.testId })),
    }));
    return pageOf(out, total, page, limit);
  }

  async getOrder(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const order = await db.labOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!order) throw notFound('Lab order not found');
    return { order: serializeLabOrder(order as DeepLabOrder) };
  }

  async collectOrder(id: string) {
    return this.sampleAction(id, 'collect');
  }
  async receiveOrder(id: string) {
    return this.sampleAction(id, 'receive');
  }
  async processOrder(id: string) {
    return this.sampleAction(id, 'process');
  }

  async rejectOrder(id: string, input: RejectLabOrderDto) {
    const order = await this.transition(id, 'reject', async (ctx, orderId) => {
      await ctx.db.labOrder.update({
        where: { id: orderId },
        data: { rejectionReason: input.reason },
      });
      const patientId = await orderPatientId(ctx, orderId);
      const sample = await ctx.db.labSample.updateMany({
        where: { orderId, organizationId: ctx.organizationId, status: { in: ['COLLECTED', 'RECEIVED'] } },
        data: { status: 'REJECTED', rejectedAt: new Date(), rejectedReason: input.reason },
      });
      if (sample.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'Only a collected/received sample can be rejected.', silent: true });
      }
      ctx.emit({
        type: EventTypes.LabSampleRejected,
        aggregateType: 'lab_order',
        aggregateId: orderId,
        payload: { orderId, patientId: patientId ?? '' },
      });
    });
    return { order: serializeLabOrder(order) };
  }

  async cancelOrder(id: string, input: CancelLabOrderDto) {
    const order = await this.transition(id, 'cancel', async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      await ctx.db.labOrder.update({
        where: { id: orderId },
        data: { cancelledById: actorId, cancelledAt: new Date(), cancelledReason: input.reason },
      });
      await ctx.db.labSample.updateMany({
        where: { orderId, organizationId: ctx.organizationId },
        data: { status: 'ORDERED' },
      });
    });
    return { order: serializeLabOrder(order) };
  }

  // ─── Results ───────────────────────────────────────────────────────────────

  async enterResults(id: string, input: EnterResultsDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labOrder.findFirst({
        where: { id, organizationId },
        include: {
          items: { include: { test: { include: { fields: { where: { isActive: true } } } } } },
        },
      });
      if (!current) throw notFound('Lab order not found');
      const target = assertLabAction(current, 'enter_results');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'lab_order', current.status, target);

      // Completeness + ownership: every active field of every ordered test must
      // appear exactly once; unknown/foreign fields are rejected.
      const fieldMap = new Map<
        string,
        { itemId: string; name: string; fieldType: string; allowsValues: string | null }
      >();
      for (const item of current.items) {
        for (const field of item.test.fields) {
          fieldMap.set(field.id, { itemId: item.id, name: field.name, fieldType: field.fieldType, allowsValues: field.allowsValues });
        }
      }
      const submitted = new Map<string, string>();
      for (const r of input.results) {
        if (submitted.has(r.testFieldId)) throw validation('Duplicate result for the same field.');
        submitted.set(r.testFieldId, r.value);
      }
      for (const [fieldId] of fieldMap) {
        if (!submitted.has(fieldId)) {
          throw validation(`Missing result for field "${fieldMap.get(fieldId)?.name ?? fieldId}".`);
        }
      }
      for (const fieldId of submitted.keys()) {
        if (!fieldMap.has(fieldId)) throw validation('A result was submitted for a field that is not on this order.');
      }

      const criticalIds: string[] = [];
      for (const [fieldId, value] of submitted) {
        const meta = fieldMap.get(fieldId);
        if (!meta) continue;
        const field = current.items
          .map((i) => i.test.fields)
          .flat()
          .find((f) => f.id === fieldId);
        if (!field) continue;
        assertFieldValue(field, value);
        const flags = classifyFieldValue(field, value);
        const resultId = newId();
        await ctx.db.labResult.create({
          data: {
            id: resultId,
            organizationId,
            orderItemId: meta.itemId,
            testFieldId: fieldId,
            currentVersion: 1,
            value,
            isAbnormal: flags.isAbnormal,
            isCritical: flags.isCritical,
            versions: {
              create: {
                id: newId(),
                organizationId,
                revisionNumber: 1,
                value,
                isAbnormal: flags.isAbnormal,
                isCritical: flags.isCritical,
                enteredById: actorId,
              },
            },
          },
        });
        if (flags.isCritical) {
          criticalIds.push(resultId);
          await ctx.db.criticalResult.create({
            data: { id: newId(), organizationId, resultId, notifiedToId: current.orderedById ?? actorId },
          });
          ctx.emit({
            type: EventTypes.LabCriticalResultRaised,
            aggregateType: 'lab_result',
            aggregateId: resultId,
            payload: { resultId, orderId: id, patientId: current.patientId },
          });
        }
      }

      const guard = await ctx.db.labOrder.updateMany({
        where: { id, organizationId, status: 'PROCESSING' },
        data: { status: 'RESULT_READY' },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed while results were entered.', silent: true });
      }
      await ctx.db.labSample.updateMany({
        where: { orderId: id, organizationId, status: 'PROCESSING' },
        data: { status: 'COMPLETED', completedById: actorId, completedAt: new Date() },
      });

      ctx.emit({
        type: EventTypes.LabResultEntered,
        aggregateType: 'lab_order',
        aggregateId: id,
        payload: { orderId: id, patientId: current.patientId, critical: criticalIds.length },
      });
      return this.loadOrder(ctx, organizationId, id);
    });
    return { order: serializeLabOrder(order) };
  }

  async verifyOrder(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labOrder.findFirst({
        where: { id, organizationId },
        include: { items: { include: { results: true } } },
      });
      if (!current) throw notFound('Lab order not found');
      const target = assertLabAction(current, 'verify');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'lab_order', current.status, target);

      const settings = await this.orgSettings(ctx.db, organizationId);
      if (settings.laboratory.requireDifferentVerifier) {
        for (const item of current.items) {
          for (const r of item.results) {
            const version = await ctx.db.labResultVersion.findFirst({
              where: { organizationId, resultId: r.id, revisionNumber: r.currentVersion },
              select: { enteredById: true },
            });
            if (version?.enteredById === actorId) {
              throw validation('This order requires verification by a different user than the one who entered the results.');
            }
          }
        }
      }

      const guard = await ctx.db.labOrder.updateMany({
        where: { id, organizationId, status: 'RESULT_READY' },
        data: { status: 'VERIFIED' },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed while it was verified.', silent: true });
      }
      for (const item of current.items) {
        for (const r of item.results) {
          await ctx.db.labResultVersion.updateMany({
            where: { organizationId, resultId: r.id, revisionNumber: r.currentVersion, verifiedById: null },
            data: { verifiedById: actorId, verifiedAt: new Date() },
          });
        }
      }

      ctx.emit({
        type: EventTypes.LabResultVerified,
        aggregateType: 'lab_order',
        aggregateId: id,
        payload: { orderId: id, patientId: current.patientId },
      });
      return this.loadOrder(ctx, organizationId, id);
    });
    return { order: serializeLabOrder(order) };
  }

  async releaseOrder(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const order = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labOrder.findFirst({
        where: { id, organizationId },
        include: { items: { include: { results: true } } },
      });
      if (!current) throw notFound('Lab order not found');
      assertOrderVerifiedForRelease(current);
      const target = assertLabAction(current, 'release');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'lab_order', current.status, target);

      const outstanding = await ctx.db.criticalResult.count({
        where: { organizationId, acknowledgedAt: null, result: { orderItem: { orderId: id } } },
      });
      if (outstanding > 0) {
        throw new AppError({
          code: ErrorCodes.LAB_RESULT_NOT_ACKNOWLEDGED,
          message: 'Critical results on this order have not been acknowledged yet.',
          silent: true,
        });
      }

      const guard = await ctx.db.labOrder.updateMany({
        where: { id, organizationId, status: 'VERIFIED' },
        data: { status: 'RELEASED', releasedById: actorId, releasedAt: new Date() },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed while it was released.', silent: true });
      }

      ctx.emit({
        type: EventTypes.LabResultReleased,
        aggregateType: 'lab_order',
        aggregateId: id,
        payload: { orderId: id, patientId: current.patientId },
      });
      return this.loadOrder(ctx, organizationId, id);
    });
    return { order: serializeLabOrder(order) };
  }

  /** Amend a result (pre-release: correct v1 in place; post-release: new revision). */
  async amendResult(resultId: string, input: AmendResultDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const result = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labResult.findFirst({
        where: { id: resultId, organizationId },
        include: {
          testField: true,
          orderItem: {
            include: { order: { select: { id: true, patientId: true, status: true, orderedById: true } } },
          },
        },
      });
      if (!current) throw notFound('Result not found');

      assertFieldValue(current.testField, input.value);
      const flags = classifyFieldValue(current.testField, input.value);
      const released = current.orderItem.order.status === 'RELEASED';

      if (released) {
        const next = current.currentVersion + 1;
        await ctx.db.labResultVersion.create({
          data: {
            id: newId(),
            organizationId,
            resultId,
            revisionNumber: next,
            value: input.value,
            isAbnormal: flags.isAbnormal,
            isCritical: flags.isCritical,
            enteredById: actorId,
            amended: true,
            reason: input.reason,
          },
        });
        await ctx.db.labResult.update({
          where: { id: resultId },
          data: { currentVersion: next, value: input.value, isAbnormal: flags.isAbnormal, isCritical: flags.isCritical },
        });
      } else {
        await ctx.db.labResultVersion.update({
          where: { organizationId_resultId_revisionNumber: { organizationId, resultId, revisionNumber: 1 } },
          data: { value: input.value, isAbnormal: flags.isAbnormal, isCritical: flags.isCritical },
        });
        await ctx.db.labResult.update({
          where: { id: resultId },
          data: { value: input.value, isAbnormal: flags.isAbnormal, isCritical: flags.isCritical },
        });
      }

      if (flags.isCritical) {
        const existing = await ctx.db.criticalResult.findFirst({ where: { organizationId, resultId } });
        if (!existing) {
          await ctx.db.criticalResult.create({
            data: {
              id: newId(),
              organizationId,
              resultId,
              notifiedToId: current.orderItem.order.orderedById ?? actorId,
            },
          });
          ctx.emit({
            type: EventTypes.LabCriticalResultRaised,
            aggregateType: 'lab_result',
            aggregateId: resultId,
            payload: { resultId, orderId: current.orderItem.order.id, patientId: current.orderItem.order.patientId },
          });
        }
      }

      ctx.emit({
        type: EventTypes.LabResultAmended,
        aggregateType: 'lab_result',
        aggregateId: resultId,
        payload: { resultId, orderId: current.orderItem.order.id, patientId: current.orderItem.order.patientId, amended: released },
      });
      return this.loadResult(ctx, organizationId, resultId);
    });
    return { result: serializeResult(result) };
  }

  async getResult(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const row = await db.labResult.findFirst({
      where: { id, organizationId },
      include: { versions: { orderBy: { revisionNumber: 'desc' } } },
    });
    if (!row) throw notFound('Result not found');
    return { result: serializeResult(row) };
  }

  /** Acknowledge a critical result. Replays are idempotent. */
  async acknowledgeCritical(criticalId: string, input: AcknowledgeCriticalDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const critical = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.criticalResult.findFirst({ where: { id: criticalId, organizationId } });
      if (!current) throw notFound('Critical result not found');
      if (current.acknowledgedAt) return current;

      const updated = await ctx.db.criticalResult.update({
        where: { id: criticalId },
        data: { acknowledgedById: actorId, acknowledgedAt: new Date(), escalationAt: input.note ? null : undefined },
      });
      ctx.emit({
        type: EventTypes.LabCriticalResultAcknowledged,
        aggregateType: 'lab_result',
        aggregateId: current.resultId,
        payload: { resultId: current.resultId, criticalResultId: criticalId },
      });
      return updated;
    });
    return { criticalResult: serializeCritical(critical) };
  }

  // ─── Turnaround time ───────────────────────────────────────────────────────

  async tat(query: TatQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = parseDateRange(query.dateFrom, query.dateTo);

    const orders = await db.labOrder.findMany({
      where: {
        organizationId,
        status: 'RELEASED',
        ...(query.branchId ? { branchId: query.branchId } : {}),
        ...(query.testId ? { items: { some: { testId: query.testId } } } : {}),
        ...(from || to ? { releasedAt: { gte: from ?? undefined, lte: to ?? undefined } } : {}),
      },
      include: {
        samples: { select: { collectedAt: true } },
        items: { select: { testId: true, test: { select: { id: true, code: true, name: true } } } },
      },
      orderBy: { releasedAt: 'desc' },
    });

    interface Row {
      branchId: string;
      testId: string;
      minutes: number;
    }
    const rows: Row[] = [];
    for (const order of orders) {
      const collectedAt = order.samples[0]?.collectedAt;
      if (!collectedAt || !order.releasedAt) continue;
      const minutes = computeTurnaroundMinutes(collectedAt, order.releasedAt);
      for (const item of order.items) rows.push({ branchId: order.branchId, testId: item.testId, minutes });
    }

    const aggr = (list: Row[]) => {
      if (list.length === 0) return { count: 0, avgMinutes: 0, minMinutes: 0, maxMinutes: 0 };
      const mins = list.map((r) => r.minutes);
      return {
        count: mins.length,
        avgMinutes: Math.round(mins.reduce((a, b) => a + b, 0) / mins.length),
        minMinutes: Math.min(...mins),
        maxMinutes: Math.max(...mins),
      };
    };

    const byBranch = new Map<string, Row[]>();
    const byTest = new Map<string, Row[]>();
    for (const row of rows) {
      pushTo(byBranch, row.branchId, row);
      pushTo(byTest, row.testId, row);
    }
    const testMeta = new Map<string, { code: string | null; name: string | null }>();
    for (const order of orders) {
      for (const item of order.items) {
        if (!testMeta.has(item.testId)) testMeta.set(item.testId, { code: item.test.code, name: item.test.name });
      }
    }

    return {
      overall: aggr(rows),
      byBranch: [...byBranch.entries()].map(([branchId, list]) => ({ branchId, ...aggr(list) })),
      byTest: [...byTest.entries()].map(([testId, list]) => ({
        testId,
        code: testMeta.get(testId)?.code ?? null,
        name: testMeta.get(testId)?.name ?? null,
        ...aggr(list),
      })),
    };
  }

  // ─── Internals ─────────────────────────────────────────────────────────────

  private async sampleAction(id: string, action: 'collect' | 'receive' | 'process') {
    const order = await this.transition(id, action, async (ctx, orderId) => {
      const actorId = this.tenantContext.requireUserId();
      const stamp =
        action === 'collect'
          ? { status: 'COLLECTED' as const, collectedById: actorId, collectedAt: new Date() }
          : action === 'receive'
            ? { status: 'RECEIVED' as const, receivedById: actorId, receivedAt: new Date() }
            : { status: 'PROCESSING' as const, processingById: actorId, processingAt: new Date() };
      const sample = await ctx.db.labSample.updateMany({
        where: { orderId, organizationId: ctx.organizationId },
        data: stamp,
      });
      if (sample.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order has no sample to advance.', silent: true });
      }
      if (action === 'collect') {
        const patientId = await orderPatientId(ctx, orderId);
        ctx.emit({
          type: EventTypes.LabSampleCollected,
          aggregateType: 'lab_order',
          aggregateId: orderId,
          payload: { orderId, patientId: patientId ?? '' },
        });
      }
    });
    return { order: serializeLabOrder(order) };
  }

  /**
   * Shared transition path: pure action map → workflow engine (custom edges)
   * → atomic updateMany guard on the previous status → side effects → reload.
   */
  private async transition(
    id: string,
    action: LabAction,
    sideEffect?: (ctx: TxContext, orderId: string) => Promise<void>,
  ): Promise<DeepLabOrder> {
    const organizationId = this.tenantContext.requireOrg();

    return this.txRunner.run(async (ctx: TxContext) => {
      const current = await ctx.db.labOrder.findFirst({ where: { id, organizationId } });
      if (!current) throw notFound('Lab order not found');

      const target = assertLabAction(current, action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'lab_order', current.status, target);

      const guard = await ctx.db.labOrder.updateMany({
        where: { id, organizationId, status: current.status },
        data: { status: target },
      });
      if (guard.count !== 1) {
        throw new AppError({ code: ErrorCodes.INVALID_WORKFLOW_TRANSITION, message: 'The order changed underneath this action.', silent: true });
      }
      await sideEffect?.(ctx, id);
      return this.loadOrder(ctx, organizationId, id);
    });
  }

  private async orgSettings(db: TxContext['db'], organizationId: string) {
    const row = await db.organizationSetting.findUnique({
      where: { organizationId },
      select: { data: true },
    });
    return parseLabOrgSettings(row?.data ?? null);
  }

  private async loadCategory(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.labTestCategory.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Category not found');
    return row;
  }

  private async loadTest(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.labTest.findFirst({
      where: { id, organizationId },
      include: { fields: { orderBy: { displayOrder: 'asc' } } },
    });
    if (!row) throw notFound('Lab test not found');
    return row;
  }

  private async loadField(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.labTestField.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Field not found');
    return row;
  }

  private async loadOrder(ctx: TxContext, organizationId: string, id: string): Promise<DeepLabOrder> {
    const row = await ctx.db.labOrder.findFirst({
      where: { id, organizationId },
      include: ORDER_INCLUDE,
    });
    if (!row) throw notFound('Lab order not found');
    return row;
  }

  private async loadResult(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.labResult.findFirst({
      where: { id, organizationId },
      include: { versions: { orderBy: { revisionNumber: 'desc' } } },
    });
    if (!row) throw notFound('Result not found');
    return row;
  }
}

async function orderPatientId(ctx: TxContext, orderId: string): Promise<string | null> {
  const row = await ctx.db.labOrder.findFirst({
    where: { id: orderId, organizationId: ctx.organizationId },
    select: { patientId: true },
  });
  return row?.patientId ?? null;
}

function pushTo<T>(map: Map<string, T[]>, key: string, row: T): void {
  const bucket = map.get(key) ?? [];
  bucket.push(row);
  map.set(key, bucket);
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function conflict(message: string): AppError {
  return new AppError({ code: ErrorCodes.CONFLICT, message, silent: true });
}

function validation(message: string): AppError {
  return new AppError({ code: ErrorCodes.VALIDATION_ERROR, message, silent: true });
}

function optimisticLock(entity: string): AppError {
  return new AppError({
    code: ErrorCodes.OPTIMISTIC_LOCK_CONFLICT,
    message: `${entity} was modified by another user.`,
    silent: true,
  });
}

export function serializeCategory(p: {
  id: string;
  organizationId: string;
  name: string;
  description: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p };
}

export function serializeField(p: {
  id: string;
  organizationId: string;
  testId: string;
  name: string;
  fieldType: string;
  unit: string | null;
  referenceMin: unknown;
  referenceMax: unknown;
  criticalMin: unknown;
  criticalMax: unknown;
  allowsValues: string | null;
  displayOrder: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return {
    ...p,
    referenceMin: p.referenceMin === null ? null : String(p.referenceMin),
    referenceMax: p.referenceMax === null ? null : String(p.referenceMax),
    criticalMin: p.criticalMin === null ? null : String(p.criticalMin),
    criticalMax: p.criticalMax === null ? null : String(p.criticalMax),
  };
}

export function serializeTest(p: {
  id: string;
  organizationId: string;
  code: string;
  name: string;
  categoryId: string | null;
  sampleType: string;
  specimenInstructions: string | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  fields: Array<Parameters<typeof serializeField>[0]>;
}) {
  return { ...p, fields: (p.fields ?? []).map(serializeField) };
}

export function serializeResult(p: {
  id: string;
  organizationId: string;
  orderItemId: string;
  testFieldId: string;
  currentVersion: number;
  value: string;
  isAbnormal: boolean;
  isCritical: boolean;
  createdAt: Date;
  updatedAt: Date;
  versions?: Array<{
    id: string;
    revisionNumber: number;
    value: string;
    isAbnormal: boolean;
    isCritical: boolean;
    enteredById: string | null;
    verifiedById: string | null;
    verifiedAt: Date | null;
    amended: boolean;
    reason: string | null;
    createdAt: Date;
  }>;
}) {
  const versions = p.versions ?? [];
  return {
    ...p,
    versions: versions.map((v) => ({
      id: v.id,
      revisionNumber: v.revisionNumber,
      value: v.value,
      isAbnormal: v.isAbnormal,
      isCritical: v.isCritical,
      enteredById: v.enteredById,
      verifiedById: v.verifiedById,
      verifiedAt: v.verifiedAt,
      amended: v.amended,
      reason: v.reason,
      createdAt: v.createdAt,
    })),
    amendments: versions.filter((v) => v.amended).length,
  };
}

export function serializeCritical(p: {
  id: string;
  organizationId: string;
  resultId: string;
  notifiedToId: string;
  notifiedAt: Date;
  acknowledgedById: string | null;
  acknowledgedAt: Date | null;
  escalationAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p };
}

export function serializeLabOrder(p: DeepLabOrder) {
  const sample: Parameters<typeof serializeSample>[0] | null = p.samples[0] ?? null;
  return {
    id: p.id,
    organizationId: p.organizationId,
    orderNumber: p.orderNumber,
    patientId: p.patientId,
    branchId: p.branchId,
    encounterId: p.encounterId,
    status: p.status,
    priority: p.priority,
    clinicalNotes: p.clinicalNotes,
    orderedById: p.orderedById,
    orderedAt: p.orderedAt,
    rejectionReason: p.rejectionReason,
    cancelledById: p.cancelledById,
    cancelledAt: p.cancelledAt,
    cancelledReason: p.cancelledReason,
    releasedById: p.releasedById,
    releasedAt: p.releasedAt,
    version: p.version,
    createdAt: p.createdAt,
    updatedAt: p.updatedAt,
    sample: sample ? serializeSample(sample) : null,
    items: p.items.map((item) => ({
      id: item.id,
      testId: item.test.id,
      testCode: item.test.code,
      testName: item.test.name,
      notes: item.notes,
      results: item.results.map(serializeResult),
    })),
    criticalResults: p.items
      .flatMap((item) => item.results)
      .map((r) => r.criticality)
      .filter((c): c is NonNullable<typeof c> => c !== null)
      .map(serializeCritical),
  };
}

export function serializeSample(p: {
  id: string;
  organizationId: string;
  sampleNumber: string;
  orderId: string;
  patientId: string;
  branchId: string;
  sampleType: string;
  status: string;
  collectedById: string | null;
  collectedAt: Date | null;
  receivedById: string | null;
  receivedAt: Date | null;
  processingById: string | null;
  processingAt: Date | null;
  completedById: string | null;
  completedAt: Date | null;
  rejectedAt: Date | null;
  rejectedReason: string | null;
  recollectsFromOrderId: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p };
}