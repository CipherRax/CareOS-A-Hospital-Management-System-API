import { http, HttpResponse } from 'msw';

import {
  BILLING_INVOICES,
  type RegistryInvoice,
  type RegistryPayment,
} from '@/mocks/fixtures/billing-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F7 billing handlers (invoices desk).
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: issuing, cancelling, refunding and taking payments all move the
 * same records the worklist reads back. Money is handled in **integer cents**
 * here (never `Number(amount)` arithmetic) so a mock total cannot drift by a
 * cent — the same discipline ADR-029 asks of production code.
 *
 * Every write answers the `{ invoice }` / `{ payment }` envelope the service
 * uses while the export types the bare entity (GAP-020), and the lifecycle
 * guards mirror the service: DRAFT→ISSUED, DRAFT|ISSUED→CANCELLED, PAID→REFUNDED,
 * payments only on ISSUED|PARTIALLY_PAID, refunds only on COMPLETED payments.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface MutablePayment extends Mutable<RegistryPayment> {
  invoiceId: string;
  patientId: string;
}

interface MutableInvoice extends Mutable<Omit<RegistryInvoice, 'payments'>> {
  payments: MutablePayment[];
}

function clone(): MutableInvoice[] {
  return BILLING_INVOICES.map((invoice) => ({
    ...invoice,
    payments: invoice.payments.map((payment) => ({
      ...payment,
      invoiceId: invoice.id,
      patientId: invoice.patientId,
    })),
  }));
}

const invoices = clone();
let receiptSeq = 104;
let paymentSeq = 9004;

/** Integer cents: split on the decimal point, never route money through a float. */
function toCents(value: string): number {
  const negative = value.startsWith('-');
  const [whole, frac = ''] = (negative ? value.slice(1) : value).split('.');
  const cents = Number(whole) * 100 + Number((frac + '00').slice(0, 2));
  return negative ? -cents : cents;
}

function fromCents(cents: number): string {
  const negative = cents < 0;
  const abs = Math.abs(cents);
  const text = `${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
  return negative ? `-${text}` : text;
}

function findInvoice(id: string): MutableInvoice | undefined {
  return invoices.find((invoice) => invoice.id === id);
}

/** Thin projection: list rows omit payments, matching the desk's list read. */
function serializeForList(invoice: MutableInvoice) {
  return { ...invoice, payments: [] };
}

function serializePayment(payment: MutablePayment) {
  return { ...payment };
}

function notFound() {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Invoice not found'), { status: 404 });
}

function workflowConflict(message: string) {
  return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', message), { status: 409 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

export function billingHandlers() {
  return [
    http.get('*/api/v1/invoices', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const branchId = url.searchParams.get('branchId');
      const patientId = url.searchParams.get('patientId');
      const status = url.searchParams.get('status');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = invoices.filter((invoice) => {
        if (branchId && invoice.branchId !== branchId) return false;
        if (patientId && invoice.patientId !== patientId) return false;
        if (status && invoice.status !== status) return false;
        return true;
      });
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit).map(serializeForList);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/invoices/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      return HttpResponse.json(apiOk({ invoice }, 'req_mock_invoice'));
    }),

    http.post('*/api/v1/invoices/:id/issue', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      if (invoice.status !== 'DRAFT') {
        return workflowConflict('Only a draft invoice can be issued.');
      }
      invoice.status = 'ISSUED';
      invoice.issuedAt = new Date().toISOString();
      invoice.version += 1;
      return HttpResponse.json(apiOk({ invoice }, 'req_mock_invoice_issue'));
    }),

    http.post('*/api/v1/invoices/:id/cancel', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      if (invoice.status !== 'DRAFT' && invoice.status !== 'ISSUED') {
        return workflowConflict('Only a draft or issued invoice can be cancelled.');
      }
      const body = await readJson(request);
      invoice.status = 'CANCELLED';
      invoice.cancelledAt = new Date().toISOString();
      invoice.cancelReason = stringField(body?.reason);
      invoice.version += 1;
      return HttpResponse.json(apiOk({ invoice }, 'req_mock_invoice_cancel'));
    }),

    http.post('*/api/v1/invoices/:id/refund', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      if (invoice.status !== 'PAID') {
        return workflowConflict('The invoice was not fully paid; it cannot be refunded.');
      }
      const body = await readJson(request);
      const reason = stringField(body?.reason);
      const now = new Date().toISOString();
      for (const payment of invoice.payments) {
        if (payment.status !== 'COMPLETED') continue;
        payment.status = 'REFUNDED';
        payment.refundedAt = now;
        payment.refundReason = reason ?? 'Invoice refunded';
      }
      invoice.status = 'REFUNDED';
      invoice.balanceDue = invoice.total;
      invoice.refundedAt = now;
      invoice.refundReason = reason;
      invoice.version += 1;
      return HttpResponse.json(apiOk({ invoice }, 'req_mock_invoice_refund'));
    }),

    http.get('*/api/v1/invoices/:id/payments', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      return HttpResponse.json(apiPage(invoice.payments.map(serializePayment)));
    }),

    http.post('*/api/v1/invoices/:id/payments', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const invoice = findInvoice(String(params.id));
      if (!invoice) return notFound();
      if (invoice.status !== 'ISSUED' && invoice.status !== 'PARTIALLY_PAID') {
        return workflowConflict(`A ${invoice.status} invoice cannot receive payments.`);
      }
      const body = await readJson(request);
      const amount = stringField(body?.amount);
      const method = stringField(body?.method);
      if (!amount || !/^\d+(\.\d{1,2})?$/.test(amount) || toCents(amount) <= 0) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'A positive amount is required.'), {
          status: 400,
        });
      }
      if (toCents(amount) > toCents(invoice.balanceDue)) {
        return workflowConflict('A payment cannot exceed the invoice balance.');
      }
      if (!method) {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'A payment method is required.'), {
          status: 400,
        });
      }

      const payment: MutablePayment = {
        id: `pay_example_${paymentSeq++}`,
        receiptNumber: `RCP-2026-${String(receiptSeq++).padStart(6, '0')}`,
        amount,
        method: method as MutablePayment['method'],
        status: 'COMPLETED',
        externalReference: stringField(body?.externalReference),
        note: stringField(body?.note),
        recordedAt: new Date().toISOString(),
        refundedAt: null,
        refundReason: null,
        invoiceId: invoice.id,
        patientId: invoice.patientId,
      };
      invoice.payments.push(payment);
      invoice.balanceDue = fromCents(toCents(invoice.balanceDue) - toCents(amount));
      invoice.status = toCents(invoice.balanceDue) === 0 ? 'PAID' : 'PARTIALLY_PAID';
      invoice.version += 1;
      return HttpResponse.json(apiOk({ payment: serializePayment(payment) }, 'req_mock_payment'), {
        status: 201,
      });
    }),

    http.post('*/api/v1/payments/:id/refund', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const id = String(params.id);
      let found: MutablePayment | undefined;
      let invoice: MutableInvoice | undefined;
      for (const candidate of invoices) {
        const payment = candidate.payments.find((row) => row.id === id);
        if (payment) {
          found = payment;
          invoice = candidate;
          break;
        }
      }
      if (!found || !invoice) return notFound();
      if (found.status !== 'COMPLETED') {
        return HttpResponse.json(
          apiError('PAYMENT_ALREADY_PROCESSED', 'Only a completed payment can be refunded.'),
          { status: 409 },
        );
      }
      const body = await readJson(request);
      found.status = 'REFUNDED';
      found.refundedAt = new Date().toISOString();
      found.refundReason = stringField(body?.reason);
      invoice.balanceDue = fromCents(toCents(invoice.balanceDue) + toCents(found.amount));
      invoice.status = toCents(invoice.balanceDue) === 0 ? 'PAID' : 'PARTIALLY_PAID';
      invoice.version += 1;
      return HttpResponse.json(apiOk({ payment: serializePayment(found) }, 'req_mock_refund'));
    }),
  ];
}
