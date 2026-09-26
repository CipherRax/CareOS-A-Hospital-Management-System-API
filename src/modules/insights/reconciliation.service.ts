import { Injectable } from '@nestjs/common';
import type {
  ReconciliationExceptionSeverity,
  ReconciliationExceptionStatus,
  ReconciliationExceptionType,
} from '@prisma/client';
import { PrismaService } from '../../database/prisma.service';
import { TenantContext } from '../../database/tenant-context';
import { AppError } from '../../common/errors/app-error';
import { ErrorCodes } from '../../common/errors/codes';
import { pageOf } from '../../common/pagination/pagination';
import type { ReconcileRunDto, ExceptionsQueryDto } from './dto/insights.dto';
import { newId } from '../../common/lib/uuidv7';
import { exceptionSuggestionOf } from './domain/classification';
import { resolveWindow } from './domain/window';

const EPSILON = 0.005;
const isMoney = (a: number, b: number): boolean => Math.abs(a - b) > EPSILON;

interface Finding {
  type: ReconciliationExceptionType;
  severity: ReconciliationExceptionSeverity;
  message: string;
  visitId?: string;
  encounterId?: string;
  invoiceId?: string;
  claimId?: string;
  patientId?: string;
  referenceId?: string;
  amount?: number;
}

/**
 * Revenue-leakage/billing reconciliation (brief Phase 11 §7.16). A run is
 * organisation-scoped, timestamped, and always produces neutral exception
 * records — the data decides, never the feature. Runs are manually triggered
 * from the API; there is no background scheduler (documented in limitations).
 */
@Injectable()
export class ReconciliationService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContext,
  ) {}

  async run(dto: ReconcileRunDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const { from, to } = resolveWindow(dto.from, dto.to, 90);
    const startedAt = new Date();

    const findings: Finding[] = [];
    findings.push(...(await this.checkEncountersWithoutInvoice(db, from, to)));
    findings.push(...(await this.checkInvoiceTotals(db, from, to)));
    findings.push(...(await this.checkPaymentApplication(db, from, to)));
    findings.push(...(await this.checkRefunds(db)));
    findings.push(...(await this.checkClaims(db)));

    const byType = findings.reduce<Record<string, number>>((a, f) => {
      a[f.type] = (a[f.type] ?? 0) + 1;
      return a;
    }, {});

    const run = await db.reconciliationRun.create({
      data: {
        id: newId(),
        organizationId,
        from,
        to,
        method: 'MANUAL',
        exceptionsFound: findings.length,
        completedAt: startedAt,
      },
    });

    if (findings.length > 0) {
      await db.reconciliationException.createMany({
        data: findings.map((f) => ({
          id: newId(),
          organizationId,
          runId: run.id,
          type: f.type,
          severity: f.severity,
          status: 'OPEN',
          description: f.message,
          visitId: f.visitId ?? null,
          encounterId: f.encounterId ?? null,
          invoiceId: f.invoiceId ?? null,
          claimId: f.claimId ?? null,
          patientId: f.patientId ?? null,
          referenceId: f.referenceId ?? null,
          amount: f.amount == null ? null : f.amount,
        })),
      });
    }

    return {
      runId: run.id,
      period: { from: from.toISOString(), to: to.toISOString() },
      exceptionsFound: findings.length,
      byType,
      findings: findings.map((f) => ({
        type: f.type,
        severity: f.severity,
        message: f.message,
        suggestion: exceptionSuggestionOf(f.type),
      })),
    };
  }

  async exceptions(query: ExceptionsQueryDto) {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const page = query.page ?? 1;
    const limit = Math.min(query.pageSize ?? 25, 100);
    const where = {
      organizationId,
      ...(query.type ? { type: query.type as ReconciliationExceptionType } : {}),
      ...(query.severity ? { severity: query.severity as ReconciliationExceptionSeverity } : {}),
      ...(query.status ? { status: query.status as ReconciliationExceptionStatus } : {}),
    };
    const [total, items] = await Promise.all([
      db.reconciliationException.count({ where }),
      db.reconciliationException.findMany({
        where,
        orderBy: { createdAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
    ]);
    return pageOf(items, total, page, limit);
  }

  async updateStatus(id: string, status: 'ACKNOWLEDGED' | 'RESOLVED') {
    const organizationId = this.tenantContext.requireOrg();
    const db = this.prisma.tenantFor(organizationId);
    const existing = await db.reconciliationException.findFirst({
      where: { id, organizationId },
      select: { id: true, status: true },
    });
    if (!existing) {
      throw new AppError({
        code: ErrorCodes.RESOURCE_NOT_FOUND,
        message: 'Reconciliation exception not found',
        silent: true,
      });
    }
    if (existing.status === 'RESOLVED' && status === 'ACKNOWLEDGED') {
      throw new AppError({
        code: ErrorCodes.RECONCILIATION_ALREADY_RESOLVED,
        message: 'A resolved exception cannot be re-opened as acknowledged',
        silent: true,
      });
    }
    return db.reconciliationException.update({
      where: { id },
      data: { status },
    });
  }

  private async checkEncountersWithoutInvoice(
    db: ReturnType<PrismaService['tenantFor']>,
    from: Date,
    to: Date,
  ): Promise<Finding[]> {
    const [encounters, invoices] = await Promise.all([
      db.encounter.findMany({
        where: { status: 'COMPLETED', completedAt: { gte: from, lte: to } },
        select: { id: true, patientId: true, visitId: true },
      }),
      db.invoice.findMany({ select: { encounterId: true, patientId: true, visitId: true } }),
    ]);
    const linked = new Set(invoices.flatMap((i) => (i.encounterId ? [i.encounterId] : [])));
    return encounters
      .filter((e) => !linked.has(e.id))
      .map((e) => ({
        type: 'ENCOUNTER_WITHOUT_INVOICE' as const,
        severity: 'MEDIUM' as const,
        message: `Completed encounter ${e.id} has no linked invoice in the reconciliation window`,
        encounterId: e.id,
        patientId: e.patientId,
        visitId: e.visitId ?? undefined,
      }));
  }

  private async checkInvoiceTotals(
    db: ReturnType<PrismaService['tenantFor']>,
    from: Date,
    to: Date,
  ): Promise<Finding[]> {
    const invoices = await db.invoice.findMany({
      where: { issuedAt: { gte: from, lte: to } },
      select: { id: true, patientId: true, visitId: true, subtotal: true, discountAmount: true, taxAmount: true, total: true },
    });
    const findings: Finding[] = [];
    for (const invoice of invoices) {
      const expected = Number(invoice.subtotal) + Number(invoice.taxAmount) - Number(invoice.discountAmount);
      const actual = Number(invoice.total);
      if (isMoney(expected, actual)) {
        findings.push({
          type: 'INVOICE_TOTAL_MISMATCH',
          severity: 'HIGH',
          message: `Invoice ${invoice.id} total ${actual.toFixed(2)} differs from subtotal + tax - discount (${expected.toFixed(2)})`,
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          visitId: invoice.visitId ?? undefined,
          amount: Math.abs(expected - actual),
        });
      }
    }
    return findings;
  }

  private async checkPaymentApplication(
    db: ReturnType<PrismaService['tenantFor']>,
    from: Date,
    to: Date,
  ): Promise<Finding[]> {
    const [invoices, payments] = await Promise.all([
      db.invoice.findMany({
        where: { issuedAt: { gte: from, lte: to } },
        select: { id: true, patientId: true, total: true, balanceDue: true, status: true },
      }),
      db.payment.findMany({
        where: { recordedAt: { gte: from, lte: to } },
        select: { invoiceId: true, amount: true, status: true, refundedAt: true },
      }),
    ]);
    const applied = new Map<string, number>();
    for (const payment of payments) {
      if (payment.status !== 'COMPLETED' || payment.refundedAt) continue;
      applied.set(payment.invoiceId, (applied.get(payment.invoiceId) ?? 0) + Number(payment.amount));
    }
    const findings: Finding[] = [];
    for (const invoice of invoices) {
      const paid = applied.get(invoice.id) ?? 0;
      if (isMoney(paid, Number(invoice.total) - Number(invoice.balanceDue))) {
        findings.push({
          type: 'PAYMENT_APPLICATION_MISMATCH',
          severity: 'MEDIUM',
          message: `Invoice ${invoice.id} applied payments ${paid.toFixed(2)} do not match its outstanding balance (balance due ${invoice.balanceDue.toFixed(2)} of ${invoice.total.toFixed(2)})`,
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          amount: Math.abs(paid - (Number(invoice.total) - Number(invoice.balanceDue))),
        });
      }
      if (isMoney(paid, Number(invoice.total)) && paid > Number(invoice.total)) {
        findings.push({
          type: 'OVERPAID_INVOICE',
          severity: 'HIGH',
          message: `Invoice ${invoice.id} received ${paid.toFixed(2)} in payments against a total of ${invoice.total.toFixed(2)}`,
          invoiceId: invoice.id,
          patientId: invoice.patientId,
          amount: paid - Number(invoice.total),
        });
      }
    }
    return findings;
  }

  private async checkRefunds(
    db: ReturnType<PrismaService['tenantFor']>,
  ): Promise<Finding[]> {
    const refunded = await db.payment.findMany({
      where: { refundedAt: { not: null } },
      select: { id: true, receiptNumber: true, invoiceId: true, amount: true, refundReason: true, note: true, invoice: { select: { status: true, patientId: true } } },
    });
    const findings: Finding[] = [];
    for (const payment of refunded) {
      if (payment.invoice.status === 'PAID') {
        findings.push({
          type: 'REFUND_WITHOUT_PAYMENT',
          severity: 'HIGH',
          message: `Refund flagged on payment ${payment.receiptNumber} for invoice ${payment.invoiceId} while the invoice is still marked PAID`,
          invoiceId: payment.invoiceId,
          patientId: payment.invoice.patientId,
          referenceId: payment.id,
          amount: Number(payment.amount),
        });
        continue;
      }
      if (!payment.refundReason && !payment.note) {
        findings.push({
          type: 'REFUND_WITHOUT_PAYMENT',
          severity: 'MEDIUM',
          message: `Refund flagged on payment ${payment.receiptNumber} has no recorded reason`,
          invoiceId: payment.invoiceId,
          patientId: payment.invoice.patientId,
          referenceId: payment.id,
          amount: Number(payment.amount),
        });
      }
    }
    return findings;
  }

  private async checkClaims(
    db: ReturnType<PrismaService['tenantFor']>,
  ): Promise<Finding[]> {
    const [claims, invoices] = await Promise.all([
      db.insuranceClaim.findMany({
        where: { status: 'PAID' },
        select: { id: true, claimNumber: true, invoiceId: true, patientId: true, approvedAmount: true },
      }),
      db.invoice.findMany({
        where: { claims: { some: { status: 'PAID' } } },
        select: { id: true, balanceDue: true },
      }),
    ]);
    const invoiceBalance = new Map(invoices.map((i) => [i.id, Number(i.balanceDue)]));
    return claims
      .filter((claim) => (invoiceBalance.get(claim.invoiceId) ?? 0) > EPSILON)
      .map((claim) => ({
        type: 'CLAIM_PAYMENT_MISMATCH' as const,
        severity: 'MEDIUM' as const,
        message: `Claim ${claim.claimNumber} is PAID but its invoice still carries a balance of ${invoiceBalance.get(claim.invoiceId)?.toFixed(2)}`,
        claimId: claim.id,
        invoiceId: claim.invoiceId,
        patientId: claim.patientId ?? undefined,
        amount: claim.approvedAmount == null ? undefined : Number(claim.approvedAmount),
      }));
  }
}