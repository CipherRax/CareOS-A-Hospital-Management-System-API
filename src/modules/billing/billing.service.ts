import { Injectable } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { TxRunner, type TxContext } from '../../database/tx';
import { newId } from '../../common/lib/uuidv7';
import { paginate, pageOf } from '../../common/pagination/pagination';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { EventTypes } from '../../events/catalog';
import { WorkflowsService } from '../workflows/workflows.service';
import { nextBillingSequence, formatBillingNumber } from './domain/billing-number';
import {
  assertInvoiceAction,
  assertClaimAction,
  computeLineTotal,
  computeInvoiceTotals,
  settleInvoiceStatus,
  assertPaymentWithinBalance,
} from './domain/billing-flow';
import type {
  ActionClaimDto,
  ActionInvoiceDto,
  CreateBillableItemDto,
  CreateClaimDto,
  CreateInsurancePayerDto,
  CreateInvoiceDto,
  CreatePatientInsurancePolicyDto,
  CreatePaymentDto,
  ListBillableItemsQueryDto,
  ListClaimsQueryDto,
  ListInvoicesQueryDto,
  ListPaymentsQueryDto,
  ListPoliciesQueryDto,
  RefundPaymentDto,
  UpdateBillableItemDto,
} from './dto/billing.dto';

/**
 * Billing & invoicing (brief Phase 6): org price-list (billable items),
 * invoices (DRAFT → ISSUED → … → PAID), payments (desk settlement with
 * atomic balance guards), and insurance (payers → patient policies → claims).
 *
 * Money is Decimal everywhere (ADR-029). Concurrency relies on conditional
 * `updateMany` guards (no raw SQL): settling a payment decrements the invoice
 * balance only while the remaining balance covers the amount, and refunding
 * flips a payment COMPLETED → REFUNDED only once. Every status move routes
 * through the workflow engine so org customizations apply consistently.
 */
@Injectable()
export class BillingService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
    private readonly txRunner: TxRunner,
    private readonly workflows: WorkflowsService,
  ) {}

  // ─── Price-list / billable items ────────────────────────────────────────────

  async createBillableItem(input: CreateBillableItemDto) {
    const organizationId = this.tenantContext.requireOrg();

    const billableItem = await this.txRunner.run(async (ctx: TxContext) => {
      if (input.branchId) {
        const branch = await ctx.db.branch.findFirst({
          where: { id: input.branchId, organizationId },
          select: { id: true },
        });
        if (!branch) throw notFound('Branch not found');
      }
      const duplicate = await ctx.db.billableItem.findFirst({
        where: {
          organizationId,
          name: input.name,
          category: input.category,
        },
        select: { id: true },
      });
      if (duplicate) throw duplicateItemError();

      const id = newId();
      await ctx.db.billableItem.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId ?? null,
          category: input.category,
          name: input.name,
          description: input.description ?? null,
          price: toDecimal(input.price),
          insuranceEligible: input.insuranceEligible ?? false,
          isActive: input.isActive ?? true,
          version: 1,
        },
      });
      return this.loadBillableItem(ctx, organizationId, id);
    });

    return { billableItem: serializeBillableItem(billableItem) };
  }

  async listBillableItems(query: ListBillableItemsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.BillableItemWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.category ? { category: query.category } : {}),
      ...(query.active ? { isActive: query.active === 'true' } : {}),
    };
    const [rows, total] = await Promise.all([
      db.billableItem.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.billableItem.count({ where }),
    ]);
    return pageOf(rows.map(serializeBillableItem), total, page, limit);
  }

  async updateBillableItem(id: string, input: UpdateBillableItemDto) {
    const organizationId = this.tenantContext.requireOrg();

    const billableItem = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadBillableItem(ctx, organizationId, id);
      if (
        input.version !== undefined &&
        current.version !== input.version
      ) {
        throw new AppError({
          code: ErrorCodes.OPTIMISTIC_LOCK_CONFLICT,
          message: 'Billable item was modified by another user.',
          silent: true,
        });
      }
      const data: Prisma.BillableItemUpdateInput = {
        version: { increment: 1 },
      };
      if (input.price !== undefined) data.price = toDecimal(input.price);
      if (input.description !== undefined) data.description = input.description;
      if (input.insuranceEligible !== undefined) {
        data.insuranceEligible = input.insuranceEligible;
      }
      if (input.isActive !== undefined) data.isActive = input.isActive;

      await ctx.db.billableItem.update({ where: { id }, data });
      return this.loadBillableItem(ctx, organizationId, id);
    });

    return { billableItem: serializeBillableItem(billableItem) };
  }

  // ─── Invoices ───────────────────────────────────────────────────────────────

  async createInvoice(input: CreateInvoiceDto) {
    const organizationId = this.tenantContext.requireOrg();
    const createdById = this.tenantContext.requireUserId();

    const invoice = await this.txRunner.run(async (ctx: TxContext) => {
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

      const lines = [];
      for (const line of input.items) {
        lines.push(await this.resolveLine(ctx, organizationId, input.branchId, line));
      }
      const { subtotal, total } = computeInvoiceTotals({
        lines,
        discountAmount: input.discountAmount !== undefined ? toDecimal(input.discountAmount) : undefined,
        taxAmount: input.taxAmount !== undefined ? toDecimal(input.taxAmount) : undefined,
      });

      const id = newId();
      const seq = await nextBillingSequence(ctx.db, organizationId, 'invoice');
      const invoiceNumber = formatBillingNumber('invoice', seq);

      await ctx.db.invoice.create({
        data: {
          id,
          organizationId,
          branchId: input.branchId,
          patientId: input.patientId,
          invoiceNumber,
          status: 'DRAFT',
          visitId: input.visitId ?? null,
          encounterId: input.encounterId ?? null,
          subtotal,
          discountAmount: input.discountAmount !== undefined ? toDecimal(input.discountAmount) : toDecimal('0'),
          taxAmount: input.taxAmount !== undefined ? toDecimal(input.taxAmount) : toDecimal('0'),
          total,
          balanceDue: total,
          dueAt: input.dueAt ?? null,
          notes: input.notes ?? null,
          items: {
            create: lines.map((l) => ({
              id: newId(),
              organizationId,
              billableItemId: l.billableItemId,
              medicationId: l.medicationId,
              description: l.description,
              quantity: l.quantity,
              unitPrice: l.unitPrice,
              lineTotal: computeLineTotal(l.quantity, l.unitPrice),
              referenceType: l.referenceType,
              referenceId: l.referenceId,
              createdById,
            })),
          },
        },
      });
      return this.loadInvoice(ctx, organizationId, id);
    });

    return { invoice: serializeInvoice(invoice) };
  }

  async listInvoices(query: ListInvoicesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.InvoiceWhereInput = {
      ...(query.branchId ? { branchId: query.branchId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.invoice.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
        include: { items: { orderBy: { createdAt: 'asc' } } },
      }),
      db.invoice.count({ where }),
    ]);
    return pageOf(rows.map(serializeInvoice), total, page, limit);
  }

  async getInvoice(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const invoice = await db.invoice.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!invoice) throw notFound('Invoice not found');
    return { invoice: serializeInvoice(invoice) };
  }

  async issueInvoice(id: string, input: ActionInvoiceDto) {
    return this.workflowAction(id, 'issue', 'DRAFT', input.reason);
  }

  async cancelInvoice(id: string, input: ActionInvoiceDto) {
    return this.workflowAction(id, 'cancel', ['DRAFT', 'ISSUED'], input.reason);
  }

  /** An invoice is refundable only once fully paid (PAID → REFUNDED). */
  async refundInvoice(id: string, input: ActionInvoiceDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const invoice = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadInvoice(ctx, organizationId, id);
      const target = assertInvoiceAction(current, 'refund');
      await this.workflows.assertAllowed(ctx.db, organizationId, 'invoice', current.status, target);

      const payments = await ctx.db.payment.findMany({
        where: { invoiceId: current.id, organizationId, status: 'COMPLETED' },
        select: { id: true, amount: true },
      });
      for (const p of payments) {
        const guard = await ctx.db.payment.updateMany({
          where: { id: p.id, organizationId, status: 'COMPLETED' },
          data: {
            status: 'REFUNDED',
            refundedById: actorId,
            refundedAt: new Date(),
            refundReason: input.reason ?? 'Invoice refunded',
          },
        });
        if (guard.count !== 1) {
          throw new AppError({
            code: ErrorCodes.PAYMENT_ALREADY_PROCESSED,
            message: 'Payment changed while the invoice refunded.',
            silent: true,
          });
        }
        ctx.emit({
          type: EventTypes.PaymentRefunded,
          aggregateType: 'payment',
          aggregateId: p.id,
          payload: { paymentId: p.id, invoiceId: current.id, patientId: current.patientId },
        });
      }

      const guard = await ctx.db.invoice.updateMany({
        where: { id: current.id, organizationId, status: 'PAID' },
        data: {
          status: 'REFUNDED',
          balanceDue: current.total,
          refundedById: actorId,
          refundedAt: new Date(),
          refundReason: input.reason ?? null,
          version: { increment: 1 },
        },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: 'The invoice was not fully paid; it cannot be refunded.',
          silent: true,
        });
      }

      ctx.emit({
        type: EventTypes.InvoiceRefunded,
        aggregateType: 'invoice',
        aggregateId: current.id,
        payload: { invoiceId: current.id, patientId: current.patientId },
      });
      return this.loadInvoice(ctx, organizationId, current.id);
    });

    return { invoice: serializeInvoice(invoice) };
  }

  // ─── Payments ───────────────────────────────────────────────────────────────

  /** Record a desk payment against an issued invoice (settles immediately). */
  async createPayment(invoiceId: string, input: CreatePaymentDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const payment = await this.txRunner.run(async (ctx: TxContext) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: invoiceId, organizationId },
      });
      if (!invoice) throw notFound('Invoice not found');
      if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `A ${invoice.status} invoice cannot receive payments.`,
          silent: true,
        });
      }
      const amount = toDecimal(input.amount);
      assertPaymentWithinBalance(amount, invoice.balanceDue);

      // Atomically consume the balance; fails when a concurrent payment took
      // the last of it or the invoice state changed under us.
      const guard = await ctx.db.invoice.updateMany({
        where: {
          id: invoiceId,
          organizationId,
          status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
          balanceDue: { gte: amount },
        },
        data: { balanceDue: { decrement: amount } },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'Payment exceeds the current outstanding balance.',
          silent: true,
        });
      }

      const id = newId();
      const seq = await nextBillingSequence(ctx.db, organizationId, 'receipt');
      await ctx.db.payment.create({
        data: {
          id,
          organizationId,
          invoiceId,
          patientId: invoice.patientId,
          receiptNumber: formatBillingNumber('receipt', seq),
          amount,
          method: input.method,
          status: 'COMPLETED',
          externalReference: input.externalReference ?? null,
          note: input.note ?? null,
          recordedById: actorId,
          recordedAt: new Date(),
        },
      });

      const fresh = await ctx.db.invoice.findUnique({ where: { id: invoiceId } });
      if (!fresh) throw notFound('Invoice not found');
      const target = settleInvoiceStatus(fresh.total, fresh.balanceDue);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'invoice', fresh.status, target);
      const settle = await ctx.db.invoice.updateMany({
        where: { id: invoiceId, organizationId },
        data: { status: target, version: { increment: 1 } },
      });
      if (settle.count !== 1) {
        throw new AppError({
          code: ErrorCodes.CONCURRENT_MODIFICATION,
          message: 'Invoice changed while its payment was settled.',
          silent: true,
        });
      }

      ctx.emit({
        type: EventTypes.PaymentCompleted,
        aggregateType: 'payment',
        aggregateId: id,
        payload: { paymentId: id, invoiceId, patientId: invoice.patientId },
      });
      return this.loadPayment(ctx, organizationId, id);
    });

    return { payment: serializePayment(payment) };
  }

  /** Refund a single completed payment, restoring the invoice's balance. */
  async refundPayment(paymentId: string, input: RefundPaymentDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const payment = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadPayment(ctx, organizationId, paymentId);
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: current.invoiceId, organizationId },
      });
      if (!invoice) throw notFound('Invoice not found');

      const guard = await ctx.db.payment.updateMany({
        where: { id: paymentId, organizationId, status: 'COMPLETED' },
        data: {
          status: 'REFUNDED',
          refundedById: actorId,
          refundedAt: new Date(),
          refundReason: input.reason ?? null,
        },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.PAYMENT_ALREADY_PROCESSED,
          message: 'Only a completed payment can be refunded.',
          silent: true,
        });
      }

      const nextBalance = invoice.balanceDue.plus(current.amount).toDecimalPlaces(2);
      await ctx.db.invoice.updateMany({
        where: { id: current.invoiceId, organizationId },
        data: { balanceDue: { increment: current.amount } },
      });
      const target = settleInvoiceStatus(invoice.total, nextBalance);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'invoice', invoice.status, target);
      await ctx.db.invoice.updateMany({
        where: { id: current.invoiceId, organizationId },
        data: { status: target, version: { increment: 1 } },
      });

      ctx.emit({
        type: EventTypes.PaymentRefunded,
        aggregateType: 'payment',
        aggregateId: paymentId,
        payload: { paymentId, invoiceId: current.invoiceId, patientId: current.patientId },
      });
      return this.loadPayment(ctx, organizationId, paymentId);
    });

    return { payment: serializePayment(payment) };
  }

  async listPayments(query: ListPaymentsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.PaymentWhereInput = {
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
      ...(query.method ? { method: query.method } : {}),
    };
    const [rows, total] = await Promise.all([
      db.payment.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.payment.count({ where }),
    ]);
    return pageOf(rows.map(serializePayment), total, page, limit);
  }

  async getPayment(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const payment = await db.payment.findFirst({ where: { id, organizationId } });
    if (!payment) throw notFound('Payment not found');
    return { payment: serializePayment(payment) };
  }

  // ─── Insurance: payers ──────────────────────────────────────────────────────

  async createPayer(input: CreateInsurancePayerDto) {
    const organizationId = this.tenantContext.requireOrg();

    const payer = await this.txRunner.run(async (ctx: TxContext) => {
      const duplicate = await ctx.db.insurancePayer.findFirst({
        where: { organizationId, name: input.name },
        select: { id: true },
      });
      if (duplicate) {
        throw new AppError({
          code: ErrorCodes.CONFLICT,
          message: 'A payer with this name already exists.',
          silent: true,
        });
      }
      const id = newId();
      await ctx.db.insurancePayer.create({
        data: {
          id,
          organizationId,
          name: input.name,
          contactPhone: input.contactPhone ?? null,
          email: input.email ?? null,
          isActive: input.isActive ?? true,
        },
      });
      return this.loadPayer(ctx, organizationId, id);
    });

    return { payer: serializePayer(payer) };
  }

  async listPayers() {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const rows = await db.insurancePayer.findMany({
      where: { organizationId },
      orderBy: { name: 'asc' },
    });
    return pageOf(rows.map(serializePayer), rows.length, 1, rows.length);
  }

  // ─── Insurance: patient policies ────────────────────────────────────────────

  async createPolicy(input: CreatePatientInsurancePolicyDto) {
    const organizationId = this.tenantContext.requireOrg();

    const policy = await this.txRunner.run(async (ctx: TxContext) => {
      const patient = await ctx.db.patient.findFirst({
        where: { id: input.patientId, organizationId },
        select: { id: true },
      });
      if (!patient) throw notFound('Patient not found');
      const payer = await ctx.db.insurancePayer.findFirst({
        where: { id: input.payerId, organizationId, isActive: true },
        select: { id: true },
      });
      if (!payer) throw notFound('Payer not found');

      const coverageType = input.coverageType ?? 'PARTIAL';
      if (coverageType === 'PARTIAL' && input.coveragePercent === undefined) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'coveragePercent is required for a PARTIAL coverage policy.',
          silent: true,
        });
      }

      const id = newId();
      await ctx.db.patientInsurancePolicy.create({
        data: {
          id,
          organizationId,
          patientId: input.patientId,
          payerId: input.payerId,
          policyNumber: input.policyNumber,
          coverageType,
          coveragePercent: input.coveragePercent ?? 100,
          validityStart: input.validityStart ?? null,
          validityEnd: input.validityEnd ?? null,
          isActive: input.isActive ?? true,
          version: 1,
        },
      });
      return this.loadPolicy(ctx, organizationId, id);
    });

    return { policy: serializePolicy(policy) };
  }

  async listPolicies(query: ListPoliciesQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.PatientInsurancePolicyWhereInput = {
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.payerId ? { payerId: query.payerId } : {}),
    };
    const [rows, total] = await Promise.all([
      db.patientInsurancePolicy.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.patientInsurancePolicy.count({ where }),
    ]);
    return pageOf(rows.map(serializePolicy), total, page, limit);
  }

  // ─── Insurance: claims ──────────────────────────────────────────────────────

  async createClaim(input: CreateClaimDto) {
    const organizationId = this.tenantContext.requireOrg();

    const claim = await this.txRunner.run(async (ctx: TxContext) => {
      const invoice = await ctx.db.invoice.findFirst({
        where: { id: input.invoiceId, organizationId },
      });
      if (!invoice) throw notFound('Invoice not found');
      const policy = await ctx.db.patientInsurancePolicy.findFirst({
        where: { id: input.policyId, organizationId, isActive: true },
      });
      if (!policy) throw notFound('Insurance policy not found');
      if (policy.patientId !== invoice.patientId) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'The insurance policy belongs to a different patient than the invoice.',
          silent: true,
        });
      }

      const amount = input.amount !== undefined ? toDecimal(input.amount) : invoice.total;
      if (amount.greaterThan(invoice.total)) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'A claim cannot exceed the invoice total.',
          silent: true,
        });
      }

      const id = newId();
      const seq = await nextBillingSequence(ctx.db, organizationId, 'claim');
      await ctx.db.insuranceClaim.create({
        data: {
          id,
          organizationId,
          claimNumber: formatBillingNumber('claim', seq),
          invoiceId: input.invoiceId,
          policyId: input.policyId,
          patientId: invoice.patientId,
          amount,
          status: 'DRAFT',
          notes: input.notes ?? null,
          version: 1,
        },
      });
      return this.loadClaim(ctx, organizationId, id);
    });

    return { claim: serializeClaim(claim) };
  }

  async listClaims(query: ListClaimsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { page, limit } = paginate(query);

    const where: Prisma.InsuranceClaimWhereInput = {
      ...(query.invoiceId ? { invoiceId: query.invoiceId } : {}),
      ...(query.patientId ? { patientId: query.patientId } : {}),
      ...(query.status ? { status: query.status } : {}),
    };
    const [rows, total] = await Promise.all([
      db.insuranceClaim.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      db.insuranceClaim.count({ where }),
    ]);
    return pageOf(rows.map(serializeClaim), total, page, limit);
  }

  async getClaim(id: string) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const claim = await db.insuranceClaim.findFirst({ where: { id, organizationId } });
    if (!claim) throw notFound('Insurance claim not found');
    return { claim: serializeClaim(claim) };
  }

  /** submit | approve | partial_approve | deny | pay — all through the engine. */
  async claimAction(claimId: string, input: ActionClaimDto) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const claim = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadClaim(ctx, organizationId, claimId);
      const target = assertClaimAction(current, input.action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'insurance_claim', current.status, target);

      const data: Prisma.InsuranceClaimUpdateInput = { status: target, version: { increment: 1 } };

      if (input.action === 'submit') {
        data.submittedById = actorId;
        data.submittedAt = new Date();
      } else if (input.action === 'approve') {
        const approved = input.approvedAmount !== undefined ? toDecimal(input.approvedAmount) : current.amount;
        if (approved.greaterThan(current.amount)) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'An approved amount cannot exceed the claim amount.',
            silent: true,
          });
        }
        if (approved.lessThan(current.amount)) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'For a partial approval use the partial_approve action.',
            silent: true,
          });
        }
        data.approvedAmount = approved;
        data.approvedById = actorId;
        data.approvedAt = new Date();
      } else if (input.action === 'partial_approve') {
        if (input.approvedAmount === undefined) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'partial_approve requires an approvedAmount below the claim amount.',
            silent: true,
          });
        }
        const approved = toDecimal(input.approvedAmount);
        if (approved.greaterThanOrEqualTo(current.amount) || approved.lessThanOrEqualTo(0)) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'approvedAmount must be between 0 and the claim amount.',
            silent: true,
          });
        }
        data.approvedAmount = approved;
        data.approvedById = actorId;
        data.approvedAt = new Date();
      } else if (input.action === 'deny') {
        if (!input.reason) {
          throw new AppError({
            code: ErrorCodes.VALIDATION_ERROR,
            message: 'A deny reason is required.',
            silent: true,
          });
        }
        data.deniedById = actorId;
        data.deniedAt = new Date();
        data.denyReason = input.reason;
      } else if (input.action === 'pay') {
        const approved = current.approvedAmount ?? current.amount;
        data.paidById = actorId;
        data.paidAt = new Date();
        await this.settleClaimPayment(ctx, organizationId, current, approved, actorId);
      }

      await ctx.db.insuranceClaim.update({ where: { id: claimId }, data });

      if (input.action === 'submit') {
        ctx.emit({
          type: EventTypes.ClaimSubmitted,
          aggregateType: 'insurance_claim',
          aggregateId: current.id,
          payload: { claimId: current.id, patientId: current.patientId },
        });
      } else if (input.action === 'approve' || input.action === 'partial_approve' || input.action === 'deny') {
        ctx.emit({
          type: EventTypes.ClaimDecided,
          aggregateType: 'insurance_claim',
          aggregateId: current.id,
          payload: { claimId: current.id, patientId: current.patientId, status: target },
        });
      } else if (input.action === 'pay') {
        ctx.emit({
          type: EventTypes.ClaimPaid,
          aggregateType: 'insurance_claim',
          aggregateId: current.id,
          payload: { claimId: current.id, patientId: current.patientId },
        });
      }

      return this.loadClaim(ctx, organizationId, claimId);
    });

    return { claim: serializeClaim(claim) };
  }

  // ─── Internals ──────────────────────────────────────────────────────────────

  /** issue|cancel share the engine + atomic guard path. */
  private async workflowAction(
    id: string,
    action: 'issue' | 'cancel',
    fromStatuses: 'DRAFT' | Array<'DRAFT' | 'ISSUED'>,
    reason?: string,
  ) {
    const organizationId = this.tenantContext.requireOrg();
    const actorId = this.tenantContext.requireUserId();

    const invoice = await this.txRunner.run(async (ctx: TxContext) => {
      const current = await this.loadInvoice(ctx, organizationId, id);
      const target = assertInvoiceAction(current, action);
      await this.workflows.assertAllowed(ctx.db, organizationId, 'invoice', current.status, target);

      const states = Array.isArray(fromStatuses) ? fromStatuses : [fromStatuses];
      const guard = await ctx.db.invoice.updateMany({
        where: { id, organizationId, status: { in: states } },
        data:
          action === 'issue'
            ? {
                status: 'ISSUED',
                issuedById: actorId,
                issuedAt: new Date(),
                version: { increment: 1 },
              }
            : {
                status: 'CANCELLED',
                cancelledById: actorId,
                cancelledAt: new Date(),
                cancelReason: reason ?? null,
                version: { increment: 1 },
              },
      });
      if (guard.count !== 1) {
        throw new AppError({
          code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
          message: `The invoice could not be ${action}d.`,
          silent: true,
        });
      }

      ctx.emit({
        type: action === 'issue' ? EventTypes.InvoiceIssued : EventTypes.InvoiceCancelled,
        aggregateType: 'invoice',
        aggregateId: current.id,
        payload: { invoiceId: current.id, patientId: current.patientId },
      });
      return this.loadInvoice(ctx, organizationId, id);
    });

    return { invoice: serializeInvoice(invoice) };
  }

  /** Posts an INSURANCE-method payment (claim payout) against the invoice. */
  private async settleClaimPayment(
    ctx: TxContext,
    organizationId: string,
    claim: { id: string; invoiceId: string; patientId: string; approvedAmount?: Prisma.Decimal | null },
    approved: Prisma.Decimal,
    actorId: string,
  ): Promise<void> {
    const invoice = await ctx.db.invoice.findFirst({
      where: { id: claim.invoiceId, organizationId },
    });
    if (!invoice) throw notFound('Invoice not found');
    if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
      throw new AppError({
        code: ErrorCodes.INVALID_WORKFLOW_TRANSITION,
        message: `A ${invoice.status} invoice cannot receive the claim payout.`,
        silent: true,
      });
    }
    assertPaymentWithinBalance(approved, invoice.balanceDue);

    const guard = await ctx.db.invoice.updateMany({
      where: {
        id: claim.invoiceId,
        organizationId,
        status: { in: ['ISSUED', 'PARTIALLY_PAID'] },
        balanceDue: { gte: approved },
      },
      data: { balanceDue: { decrement: approved } },
    });
    if (guard.count !== 1) {
      throw new AppError({
        code: ErrorCodes.CONFLICT,
        message: 'The claim payout exceeds the current outstanding balance.',
        silent: true,
      });
    }

    const paymentId = newId();
    const seq = await nextBillingSequence(ctx.db, organizationId, 'receipt');
    await ctx.db.payment.create({
      data: {
        id: paymentId,
        organizationId,
        invoiceId: claim.invoiceId,
        patientId: claim.patientId,
        receiptNumber: formatBillingNumber('receipt', seq),
        amount: approved,
        method: 'INSURANCE',
        status: 'COMPLETED',
        note: `Claim ${claim.id} payout`,
        recordedById: actorId,
        recordedAt: new Date(),
      },
    });

    const fresh = await ctx.db.invoice.findUnique({ where: { id: claim.invoiceId } });
    if (!fresh) throw notFound('Invoice not found');
    const target = settleInvoiceStatus(fresh.total, fresh.balanceDue);
    await this.workflows.assertAllowed(ctx.db, organizationId, 'invoice', fresh.status, target);
    await ctx.db.invoice.updateMany({
      where: { id: claim.invoiceId, organizationId },
      data: { status: target, version: { increment: 1 } },
    });

    ctx.emit({
      type: EventTypes.PaymentCompleted,
      aggregateType: 'payment',
      aggregateId: paymentId,
      payload: { paymentId, invoiceId: claim.invoiceId, patientId: claim.patientId },
    });
  }

  /** Resolves a raw line into a priced snapshot (price-list/menu override). */
  private async resolveLine(
    ctx: TxContext,
    organizationId: string,
    branchId: string,
    line: {
      billableItemId?: string;
      medicationId?: string;
      description?: string;
      quantity: number;
      unitPrice?: string;
      referenceType?: string;
      referenceId?: string;
    },
  ) {
    if (line.billableItemId) {
      const item = await ctx.db.billableItem.findFirst({
        where: { id: line.billableItemId, organizationId },
      });
      if (!item) throw notFound('Billable item not found');
      if (item.branchId && item.branchId !== branchId) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'The billable item belongs to a different branch.',
          silent: true,
        });
      }
      if (!item.isActive) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: `The billable item "${item.name}" is inactive.`,
          silent: true,
        });
      }
      const unitPrice = line.unitPrice !== undefined ? toDecimal(line.unitPrice) : item.price;
      return {
        billableItemId: item.id,
        medicationId: null,
        description: line.description ?? item.name,
        quantity: line.quantity,
        unitPrice,
        referenceType: line.referenceType ?? null,
        referenceId: line.referenceId ?? null,
      };
    }
    if (line.medicationId) {
      const med = await ctx.db.medication.findFirst({
        where: { id: line.medicationId, organizationId },
        select: { id: true, name: true },
      });
      if (!med) throw notFound('Medication not found');
      if (line.unitPrice === undefined) {
        throw new AppError({
          code: ErrorCodes.VALIDATION_ERROR,
          message: 'A unitPrice is required when billing a medication directly.',
          silent: true,
        });
      }
      return {
        billableItemId: null,
        medicationId: med.id,
        description: line.description ?? med.name,
        quantity: line.quantity,
        unitPrice: toDecimal(line.unitPrice),
        referenceType: line.referenceType ?? null,
        referenceId: line.referenceId ?? null,
      };
    }
    if (line.description === undefined || line.unitPrice === undefined) {
      throw new AppError({
        code: ErrorCodes.VALIDATION_ERROR,
        message: 'Each line needs a billableItemId, or a medicationId, or a description plus unitPrice.',
        silent: true,
      });
    }
    return {
      billableItemId: null,
      medicationId: null,
      description: line.description,
      quantity: line.quantity,
      unitPrice: toDecimal(line.unitPrice),
      referenceType: line.referenceType ?? null,
      referenceId: line.referenceId ?? null,
    };
  }

  private async loadBillableItem(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.billableItem.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Billable item not found');
    return row;
  }

  private async loadInvoice(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.invoice.findFirst({
      where: { id, organizationId },
      include: { items: { orderBy: { createdAt: 'asc' } }, payments: { orderBy: { createdAt: 'asc' } } },
    });
    if (!row) throw notFound('Invoice not found');
    return row;
  }

  private async loadPayment(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.payment.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Payment not found');
    return row;
  }

  private async loadPayer(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.insurancePayer.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Insurance payer not found');
    return row;
  }

  private async loadPolicy(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.patientInsurancePolicy.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Insurance policy not found');
    return row;
  }

  private async loadClaim(ctx: TxContext, organizationId: string, id: string) {
    const row = await ctx.db.insuranceClaim.findFirst({ where: { id, organizationId } });
    if (!row) throw notFound('Insurance claim not found');
    return row;
  }
}

function toDecimal(value: string): Prisma.Decimal {
  return new Prisma.Decimal(value);
}

function money(value: unknown): string {
  return value instanceof Prisma.Decimal ? value.toFixed(2) : String(value);
}

function notFound(message: string): AppError {
  return new AppError({ code: ErrorCodes.RESOURCE_NOT_FOUND, message, silent: true });
}

function duplicateItemError(): AppError {
  return new AppError({
    code: ErrorCodes.CONFLICT,
    message: 'A billable item with this name and category already exists.',
    silent: true,
  });
}

export function serializeBillableItem(p: {
  id: string;
  organizationId: string;
  branchId: string | null;
  category: string;
  name: string;
  description: string | null;
  price: unknown;
  insuranceEligible: boolean;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p, price: money(p.price) };
}

export function serializePayment(p: {
  id: string;
  organizationId: string;
  invoiceId: string;
  patientId: string;
  receiptNumber: string;
  amount: unknown;
  method: string;
  status: string;
  externalReference: string | null;
  note: string | null;
  recordedById: string | null;
  recordedAt: Date | null;
  refundedById: string | null;
  refundedAt: Date | null;
  refundReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p, amount: money(p.amount) };
}

export function serializePayer(p: {
  id: string;
  organizationId: string;
  name: string;
  contactPhone: string | null;
  email: string | null;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p };
}

export function serializePolicy(p: {
  id: string;
  organizationId: string;
  patientId: string;
  payerId: string;
  policyNumber: string;
  coverageType: string;
  coveragePercent: number;
  validityStart: Date | null;
  validityEnd: Date | null;
  isActive: boolean;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p };
}

export function serializeClaim(p: {
  id: string;
  organizationId: string;
  claimNumber: string;
  invoiceId: string;
  policyId: string;
  patientId: string;
  amount: unknown;
  status: string;
  notes: string | null;
  submittedById: string | null;
  submittedAt: Date | null;
  approvedById: string | null;
  approvedAt: Date | null;
  approvedAmount: unknown;
  deniedById: string | null;
  deniedAt: Date | null;
  denyReason: string | null;
  paidById: string | null;
  paidAt: Date | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}) {
  return { ...p, amount: money(p.amount), approvedAmount: p.approvedAmount === null ? null : money(p.approvedAmount) };
}

export function serializeInvoice(p: {
  id: string;
  organizationId: string;
  branchId: string;
  patientId: string;
  invoiceNumber: string;
  status: string;
  visitId: string | null;
  encounterId: string | null;
  subtotal: unknown;
  discountAmount: unknown;
  taxAmount: unknown;
  total: unknown;
  balanceDue: unknown;
  dueAt: Date | null;
  notes: string | null;
  issuedById: string | null;
  issuedAt: Date | null;
  cancelledById: string | null;
  cancelledAt: Date | null;
  cancelReason: string | null;
  refundedById: string | null;
  refundedAt: Date | null;
  refundReason: string | null;
  version: number;
  createdAt: Date;
  updatedAt: Date;
  items?: Array<{
    id: string;
    organizationId: string;
    invoiceId: string;
    billableItemId: string | null;
    medicationId: string | null;
    description: string;
    quantity: number;
    unitPrice: unknown;
    lineTotal: unknown;
    referenceType: string | null;
    referenceId: string | null;
    createdById: string | null;
    createdAt: Date;
  }>;
  payments?: Array<{
    id: string;
    amount: unknown;
    method: string;
    status: string;
    receiptNumber: string;
    recordedAt: Date | null;
  }>;
}) {
  return {
    ...p,
    subtotal: money(p.subtotal),
    discountAmount: money(p.discountAmount),
    taxAmount: money(p.taxAmount),
    total: money(p.total),
    balanceDue: money(p.balanceDue),
    items: p.items?.map((it) => ({
      id: it.id,
      organizationId: it.organizationId,
      invoiceId: it.invoiceId,
      billableItemId: it.billableItemId,
      medicationId: it.medicationId,
      description: it.description,
      quantity: it.quantity,
      unitPrice: money(it.unitPrice),
      lineTotal: money(it.lineTotal),
      referenceType: it.referenceType,
      referenceId: it.referenceId,
      createdById: it.createdById,
      createdAt: it.createdAt,
    })) ?? [],
    payments: p.payments?.map((pa) => ({
      id: pa.id,
      receiptNumber: pa.receiptNumber,
      amount: money(pa.amount),
      method: pa.method,
      status: pa.status,
      recordedAt: pa.recordedAt,
    })) ?? [],
  };
}