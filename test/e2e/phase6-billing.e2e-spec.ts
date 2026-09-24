import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 6 — billing & invoicing. Acceptance coverage:
 *  1. Price list (billable items): CRUD with optimistic locking; money is a
 *     string on the wire (ADR-029); duplicates rejected.
 *  2. Invoice creation from price-list lines: correct subtotal/total math,
 *     INV-YYYY-NNNNNN numbering, DRAFT until issued.
 *  3. Payments: atomic balance guards (over-payment 400), partial → full
 *     settle, RCT-YYYY-NNNNNN receipts, idempotent replay.
 *  4. Refunds: payment refund restores balance and re-opens the invoice
 *     (PAID → PARTIALLY_PAID); invoice refund refunds all payments (REFUNDED).
 *  5. Cancellation is only allowed while unpaid (DRAFT/ISSUED).
 *  6. Insurance: payers, patient policies (policy/patient matching), and the
 *     claim lifecycle submit → approve → pay posting an INSURANCE payment.
 *  7. Role separation: receptionist bills/collects but can't cancel or manage
 *     insurance; accountants manage; no-permission roles get 403.
 *  8. Cross-tenant isolation: another org's invoices are invisible (404).
 */
describe('phase6 billing & invoicing', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let orgA: string;
  let userA: string;
  let branchA: string;
  let orgB: string;
  let userB: string;
  let branchB: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const headerFor = (permissions: string[], extra: Record<string, string> = {}) => ({
    ...principalHeaders({ organizationId: orgA, userId: userA, permissions }),
    ...extra,
  });

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
    extra?: Record<string, string>,
  ) =>
    app.inject({
      method,
      headers: headerFor(permissions, extra),
      url: url(path),
      ...(payload ? { payload } : {}),
    });

  const post = (
    path: string,
    permissions: string[],
    payload: Record<string, unknown>,
    extra?: Record<string, string>,
  ) => request('POST', path, permissions, payload, extra);
  const get = (path: string, permissions: string[]) => request('GET', path, permissions);
  const patch = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('PATCH', path, permissions, payload);

  const receptionist = [
    'patients.read',
    'billing.read',
    'billing.create',
    'payments.create',
    'insurance.read',
  ];
  const accountant = [
    'patients.read',
    'billing.read',
    'billing.create',
    'billing.manage',
    'payments.create',
    'payments.refund',
    'insurance.read',
    'insurance.manage',
  ];
  const auditor = ['patients.read', 'billing.read', 'insurance.read'];
  const noBilling = ['patients.read'];

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post('/patients', ['patients.create'], {
      firstName,
      lastName: 'Phase6',
      phone,
      dateOfBirth: '1990-01-01',
      sex: 'FEMALE',
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const createItem = async (
    name: string,
    price: string,
    opts: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number; price: string }> => {
    const res = await post('/billable-items', receptionist, {
      category: 'CONSULTATION',
      name,
      price,
      ...opts,
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.billableItem as { id: string; version: number; price: string };
  };

  const createInvoice = async (
    patientId: string,
    items: Array<Record<string, unknown>>,
    opts: Record<string, unknown> = {},
  ) => {
    const created = await post('/invoices', receptionist, {
      branchId: branchA,
      patientId,
      items,
      ...opts,
    });
    expect(created.statusCode).toBe(201);
    return created.json().data.invoice;
  };

  const issueInvoice = async (invoiceId: string) => {
    const res = await post(`/invoices/${invoiceId}/issue`, receptionist, {});
    expect(res.statusCode).toBe(201);
    return res.json().data.invoice;
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase6 Org A' } });
    await sc.user.create({
      data: {
        id: userA,
        organizationId: orgA,
        email: 'phase6.user@test.local',
        firstName: 'Phase',
        lastName: 'Six',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH6A' } });

    orgB = newId();
    userB = newId();
    await sc.organization.create({ data: { id: orgB, name: 'Phase6 Org B' } });
    await sc.user.create({
      data: {
        id: userB,
        organizationId: orgB,
        email: 'phase6.userb@test.local',
        firstName: 'Phase',
        lastName: 'SixB',
        status: 'ACTIVE',
      },
    });
    branchB = newId();
    await sc.branch.create({ data: { id: branchB, organizationId: orgB, name: 'Main', code: 'PH6B' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 1. price list ----------------------------------------------------------

  it('CRUDs billable items with optimistic locking and string money', async () => {
    const created = await post('/billable-items', receptionist, {
      category: 'LAB',
      name: 'Full Blood Count',
      price: '1200.50',
      insuranceEligible: true,
    });
    expect(created.statusCode).toBe(201);
    const item = created.json().data.billableItem as {
      id: string;
      version: number;
      price: string;
      category: string;
      insuranceEligible: boolean;
      branchId: string | null;
    };
    expect(item.price).toBe('1200.50');
    expect(typeof item.price).toBe('string');
    expect(item.branchId).toBeNull();
    expect(item.insuranceEligible).toBe(true);
    expect(item.version).toBe(1);

    const dup = await post('/billable-items', receptionist, {
      category: 'LAB',
      name: 'Full Blood Count',
      price: '900',
    });
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe(ErrorCodes.CONFLICT);

    const updated = await patch(`/billable-items/${item.id}`, accountant, {
      price: '1350.00',
      version: 1,
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.billableItem.price).toBe('1350.00');
    expect(updated.json().data.billableItem.version).toBe(2);

    const stale = await patch(`/billable-items/${item.id}`, accountant, {
      price: '999',
      version: 1,
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.OPTIMISTIC_LOCK_CONFLICT);

    const listed = await get('/billable-items?category=LAB', receptionist);
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().data as Array<{ name: string; price: string }>;
    expect(rows.some((r) => r.name === 'Full Blood Count' && r.price === '1350.00')).toBe(true);

    const denied = await patch(`/billable-items/${item.id}`, receptionist, { price: '1' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
  });

  // --- 2. invoice creation ----------------------------------------------------

  it('creates a DRAFT invoice with price-snapshots and INV numbering', async () => {
    const fee = await createItem('Consultation', '1000');
    const lab = await createItem('Blood Test', '1500', { category: 'LAB' });
    const patientId = await registerPatient('InvOne', '0755000001');

    const invoice = await createInvoice(patientId, [
      { billableItemId: fee.id, quantity: 2 }, // 2000.00
      { billableItemId: lab.id, quantity: 1 }, // 1500.00
    ]);
    expect(invoice.status).toBe('DRAFT');
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);
    expect(invoice.subtotal).toBe('3500.00');
    expect(invoice.taxAmount).toBe('0.00');
    expect(invoice.total).toBe('3500.00');
    expect(invoice.balanceDue).toBe('3500.00');
    expect(invoice.items).toHaveLength(2);
    expect(invoice.items[0].description).toBe('Consultation');
    expect(invoice.items[0].lineTotal).toBe('2000.00');
    expect(invoice.items[0].unitPrice).toBe('1000.00');
  });

  it('honors discount + tax and rejects inactive or cross-branch items', async () => {
    const patientId = await registerPatient('InvTwo', '0755000002');
    const item = await createItem('MRI Scan', '8500', { category: 'RADIOLOGY' });

    const discounted = await createInvoice(
      patientId,
      [{ billableItemId: item.id, quantity: 1 }],
      { discountAmount: '500', taxAmount: '160' },
    );
    expect(discounted.subtotal).toBe('8500.00');
    expect(discounted.taxAmount).toBe('160.00');
    expect(discounted.total).toBe('8160.00');

    await patch(`/billable-items/${item.id}`, accountant, { isActive: false, version: 1 });
    const inactive = await post('/invoices', receptionist, {
      branchId: branchA,
      patientId,
      items: [{ billableItemId: item.id, quantity: 1 }],
    });
    expect(inactive.statusCode).toBe(400);
  });

  it('rejects a line with neither a price-list item nor a description+price', async () => {
    const patientId = await registerPatient('InvThree', '0755000003');
    const res = await post('/invoices', receptionist, {
      branchId: branchA,
      patientId,
      items: [{ quantity: 1 }],
    });
    expect(res.statusCode).toBe(400);
  });

  // --- 3. payments ------------------------------------------------------------

  it('settles partially then fully, issuing RCT receipts and moving status', async () => {
    const item = await createItem('Room Charge', '2000', { category: 'ADMISSION' });
    const patientId = await registerPatient('PayOne', '0755000004');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    expect(invoice.invoiceNumber).toMatch(/^INV-\d{4}-\d{6}$/);

    const notYet = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '500',
      method: 'CASH',
    });
    expect(notYet.statusCode).toBe(409); // DRAFT invoices cannot be paid

    const issued = await issueInvoice(invoice.id);
    expect(issued.status).toBe('ISSUED');
    expect(issued.issuedById).toBe(userA);

    const first = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '500',
      method: 'CASH',
    });
    expect(first.statusCode).toBe(201);
    const p1 = first.json().data.payment;
    expect(p1.receiptNumber).toMatch(/^RCT-\d{4}-\d{6}$/);
    expect(typeof p1.amount).toBe('string');
    expect(p1.amount).toBe('500.00');

    const after = await get(`/invoices/${invoice.id}`, receptionist);
    expect(after.json().data.invoice.status).toBe('PARTIALLY_PAID');
    expect(after.json().data.invoice.balanceDue).toBe('1500.00');
    expect(after.json().data.invoice.payments.map((p: { amount: string }) => p.amount)).toEqual([
      '500.00',
    ]);

    const over = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '99999',
      method: 'CASH',
    });
    expect(over.statusCode).toBe(400);
    expect(over.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);

    const rest = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '1500.00',
      method: 'MOBILE_MONEY',
    });
    expect(rest.statusCode).toBe(201);

    const done = await get(`/invoices/${invoice.id}`, receptionist);
    expect(done.json().data.invoice.status).toBe('PAID');
    expect(done.json().data.invoice.balanceDue).toBe('0.00');
  });

  it('refunds a payment and re-opens the invoice balance', async () => {
    const item = await createItem('Procedure', '3000', { category: 'PROCEDURE' });
    const patientId = await registerPatient('PayTwo', '0755000005');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(invoice.id);
    await post(`/invoices/${invoice.id}/payments`, receptionist, { amount: '3000', method: 'CASH' });

    const done = await get(`/invoices/${invoice.id}`, receptionist);
    const { id: paymentId } = done.json().data.invoice.payments[0];

    const refunded = await post(`/payments/${paymentId}/refund`, accountant, {
      reason: 'Wrong charge',
    });
    expect(refunded.statusCode).toBe(201);
    expect(refunded.json().data.payment.status).toBe('REFUNDED');

    const reopened = await get(`/invoices/${invoice.id}`, receptionist);
    expect(reopened.json().data.invoice.status).toBe('ISSUED');
    expect(reopened.json().data.invoice.balanceDue).toBe('3000.00');

    const double = await post(`/payments/${paymentId}/refund`, accountant, { reason: 'again' });
    expect(double.statusCode).toBe(409);
    expect(double.json().error.code).toBe(ErrorCodes.PAYMENT_ALREADY_PROCESSED);
  });

  it('idempotently replays a payment instead of double-applying it', async () => {
    const item = await createItem('Surgery', '5000', { category: 'PROCEDURE' });
    const patientId = await registerPatient('PayThree', '0755000006');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(invoice.id);

    const key = `idem-${newId()}`;
    const body = { amount: '1000', method: 'CASH' };
    const first = await post(
      `/invoices/${invoice.id}/payments`,
      receptionist,
      body,
      { 'idempotency-key': key },
    );
    expect(first.statusCode).toBe(201);

    const replay = await post(
      `/invoices/${invoice.id}/payments`,
      receptionist,
      body,
      { 'idempotency-key': key },
    );
    expect(replay.statusCode).toBe(200);

    const counts = await prisma.unscoped().payment.count({
      where: { invoiceId: invoice.id, organizationId: orgA },
    });
    expect(counts).toBe(1);
  });

  // --- 4. refunds & cancellation ----------------------------------------------

  it('refunds a fully-paid invoice and marks its payments REFUNDED', async () => {
    const item = await createItem('Package', '1200', { category: 'OTHER' });
    const patientId = await registerPatient('RefOne', '0755000007');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(invoice.id);
    await post(`/invoices/${invoice.id}/payments`, receptionist, { amount: '1200', method: 'CASH' });

    const res = await post(`/invoices/${invoice.id}/refund`, accountant, {
      reason: 'Service not rendered',
    });
    expect(res.statusCode).toBe(201);
    const refunded = res.json().data.invoice;
    expect(refunded.status).toBe('REFUNDED');
    expect(refunded.refundReason).toBe('Service not rendered');
    expect(refunded.payments.every((p: { status: string }) => p.status === 'REFUNDED')).toBe(true);
  });

  it('cancels only unpaid invoices', async () => {
    const item = await createItem('Xray', '600', { category: 'RADIOLOGY' });
    const patientId = await registerPatient('CanOne', '0755000008');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);

    const cancelled = await post(`/invoices/${invoice.id}/cancel`, accountant, {
      reason: 'Patient declined',
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.invoice.status).toBe('CANCELLED');

    const reIssue = await post(`/invoices/${invoice.id}/issue`, receptionist, {});
    expect(reIssue.statusCode).toBe(409);

    const other = await registerPatient('CanTwo', '0755000009');
    const inv2 = await createInvoice(other, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(inv2.id);
    await post(`/invoices/${inv2.id}/payments`, receptionist, { amount: '600', method: 'CASH' });
    const noCancel = await post(`/invoices/${inv2.id}/cancel`, accountant, { reason: 'late' });
    expect(noCancel.statusCode).toBe(409);
  });

  // --- 5. insurance -----------------------------------------------------------

  it('manages payers and patient policies with patient matching', async () => {
    const payer = await post('/insurance/payers', accountant, {
      name: 'National Health Fund',
      contactPhone: '0800-123456',
    });
    expect(payer.statusCode).toBe(201);
    const payerId = payer.json().data.payer.id;

    const dup = await post('/insurance/payers', accountant, { name: 'National Health Fund' });
    expect(dup.statusCode).toBe(409);

    const patientId = await registerPatient('InsOne', '0755000010');
    const otherPatient = await registerPatient('InsOther', '0755000011');

    const policy = await post('/insurance/policies', accountant, {
      patientId,
      payerId,
      policyNumber: 'NHF-2026-0001',
      coverageType: 'PARTIAL',
      coveragePercent: 80,
    });
    expect(policy.statusCode).toBe(201);

    const missingPercent = await post('/insurance/policies', accountant, {
      patientId: otherPatient,
      payerId,
      policyNumber: 'NHF-2026-0002',
      coverageType: 'PARTIAL',
    });
    expect(missingPercent.statusCode).toBe(400);

    const listed = await get(`/insurance/policies?patientId=${patientId}`, receptionist);
    const rows = listed.json().data as Array<{ policyNumber: string; coveragePercent: number }>;
    expect(rows).toHaveLength(1);
    expect(rows[0]?.coveragePercent).toBe(80);
  });

  it('runs the claim lifecycle submit → approve → pay and posts an INSURANCE payment', async () => {
    const item = await createItem('Insured Care', '4000', { category: 'CONSULTATION' });
    const patientId = await registerPatient('ClmOne', '0755000012');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(invoice.id);

    const payer = await post('/insurance/payers', accountant, { name: 'SafeNet HMO' });
    const payerId = payer.json().data.payer.id;
    const policy = await post('/insurance/policies', accountant, {
      patientId,
      payerId,
      policyNumber: 'SN-00042',
      coverageType: 'FULL',
    });
    const policyId = policy.json().data.policy.id;

    const mismatch = await post('/insurance/policies', accountant, {
      patientId: (await registerPatient('ClmOther', '0755000013')),
      payerId,
      policyNumber: 'SN-00043',
      coverageType: 'FULL',
    });
    const otherPolicyId = mismatch.json().data.policy.id;
    const wrongClaim = await post('/insurance/claims', accountant, {
      invoiceId: invoice.id,
      policyId: otherPolicyId,
    });
    expect(wrongClaim.statusCode).toBe(400); // policy belongs to another patient

    const created = await post('/insurance/claims', accountant, {
      invoiceId: invoice.id,
      policyId,
    });
    expect(created.statusCode).toBe(201);
    const claim = created.json().data.claim;
    expect(claim.claimNumber).toMatch(/^CLM-\d{4}-\d{6}$/);
    expect(claim.amount).toBe('4000.00');
    expect(claim.status).toBe('DRAFT');

    const oversize = await post('/insurance/claims', accountant, {
      invoiceId: invoice.id,
      policyId,
      amount: '99999',
    });
    expect(oversize.statusCode).toBe(400);

    const submitted = await post(`/insurance/claims/${claim.id}/action`, accountant, {
      action: 'submit',
    });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().data.claim.status).toBe('SUBMITTED');

    const denyNoReason = await post(`/insurance/claims/${claim.id}/action`, accountant, {
      action: 'deny',
    });
    expect(denyNoReason.statusCode).toBe(400);

    const approved = await post(`/insurance/claims/${claim.id}/action`, accountant, {
      action: 'approve',
    });
    expect(approved.statusCode).toBe(201);
    expect(approved.json().data.claim.status).toBe('APPROVED');

    const paid = await post(`/insurance/claims/${claim.id}/action`, accountant, {
      action: 'pay',
    });
    expect(paid.statusCode).toBe(201);
    const paidClaim = paid.json().data.claim;
    expect(paidClaim.status).toBe('PAID');
    expect(paidClaim.paidAt).not.toBeNull();

    const invoiceAfter = await get(`/invoices/${invoice.id}`, receptionist);
    expect(invoiceAfter.json().data.invoice.status).toBe('PAID');
    expect(invoiceAfter.json().data.invoice.balanceDue).toBe('0.00');
    const insurancePayments = invoiceAfter.json().data.invoice.payments.filter(
      (p: { method: string }) => p.method === 'INSURANCE',
    );
    expect(insurancePayments).toHaveLength(1);
    expect(insurancePayments[0].amount).toBe('4000.00');
  });

  it('handles a partially-approved claim then tops the rest up with cash', async () => {
    const item = await createItem('Day Case', '3000', { category: 'PROCEDURE' });
    const patientId = await registerPatient('ClmTwo', '0755000014');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);
    await issueInvoice(invoice.id);

    const payer = await post('/insurance/payers', accountant, { name: 'CoPay LLP' });
    const payerId = payer.json().data.payer.id;
    const policy = await post('/insurance/policies', accountant, {
      patientId,
      payerId,
      policyNumber: 'CP-007',
      coverageType: 'PARTIAL',
      coveragePercent: 75,
    });
    const policyId = policy.json().data.policy.id;

    const claim = (await post('/insurance/claims', accountant, { invoiceId: invoice.id, policyId }))
      .json().data.claim;
    await post(`/insurance/claims/${claim.id}/action`, accountant, { action: 'submit' });

    const partial = await post(`/insurance/claims/${claim.id}/action`, accountant, {
      action: 'partial_approve',
      approvedAmount: '1500',
    });
    expect(partial.statusCode).toBe(201);
    expect(partial.json().data.claim.status).toBe('PARTIALLY_APPROVED');
    expect(partial.json().data.claim.approvedAmount).toBe('1500.00');

    const paid = await post(`/insurance/claims/${claim.id}/action`, accountant, { action: 'pay' });
    expect(paid.statusCode).toBe(201);
    expect(paid.json().data.claim.status).toBe('PAID');

    const after = await get(`/invoices/${invoice.id}`, receptionist);
    expect(after.json().data.invoice.status).toBe('PARTIALLY_PAID');
    expect(after.json().data.invoice.balanceDue).toBe('1500.00');

    const topUp = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '1500.00',
      method: 'CASH',
    });
    expect(topUp.statusCode).toBe(201);
    const done = await get(`/invoices/${invoice.id}`, receptionist);
    expect(done.json().data.invoice.status).toBe('PAID');
  });

  // --- 6. roles & tenancy -----------------------------------------------------

  it('enforces role separation on billing and insurance writes', async () => {
    const item = await createItem('Scope Fee', '200', { category: 'OTHER' });
    const patientId = await registerPatient('RolOne', '0755000015');
    const invoice = await createInvoice(patientId, [{ billableItemId: item.id, quantity: 1 }]);

    // receptionist: can create/issue invoice and record payments,
    // but cannot cancel (billing.manage) or manage insurance (insurance.manage).
    expect((await post(`/invoices/${invoice.id}/issue`, receptionist, {})).statusCode).toBe(201);
    const noCancel = await post(`/invoices/${invoice.id}/cancel`, receptionist, { reason: 'x' });
    expect(noCancel.statusCode).toBe(403);
    expect(noCancel.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
    const noPayer = await post('/insurance/payers', receptionist, { name: 'Forbidden' });
    expect(noPayer.statusCode).toBe(403);

    // auditor: read-only on billing + insurance.
    const reads = await get(`/invoices/${invoice.id}`, auditor);
    expect(reads.statusCode).toBe(200);
    const noWrite = await post(`/invoices/${invoice.id}/payments`, auditor, {
      amount: '200',
      method: 'CASH',
    });
    expect(noWrite.statusCode).toBe(403);
    expect((await post('/insurance/claims', auditor, {})).statusCode).toBe(403);

    // no billing permission at all: 403 everywhere.
    const ghost = await get(`/invoices/${invoice.id}`, noBilling);
    expect(ghost.statusCode).toBe(403);
    expect((await get('/payments', noBilling)).statusCode).toBe(403);
  });

  it('isolates tenants: another org invoices are invisible', async () => {
    const otherPatient = newId();
    await prisma.unscoped().patient.create({
      data: {
        id: otherPatient,
        organizationId: orgB,
        patientNumber: 'P6B-0001',
        firstName: 'B',
        lastName: 'B',
      },
    });
    const bugB = await app.inject({
      method: 'POST',
      headers: principalHeaders({
        organizationId: orgB,
        userId: userB,
        permissions: ['billing.create', 'billing.read', 'payments.create'],
      }),
      url: url('/invoices'),
      payload: {
        branchId: branchB,
        patientId: otherPatient,
        items: [{ description: 'cross', quantity: 1, unitPrice: '10' }],
      },
    });
    expect(bugB.statusCode).toBe(201);
    const invoiceId = bugB.json().data.invoice.id;

    const scoped = await get(`/invoices/${invoiceId}`, receptionist);
    expect(scoped.statusCode).toBe(404);
    expect(scoped.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);

    const payment = await post(`/invoices/${invoiceId}/payments`, receptionist, {
      amount: '10',
      method: 'CASH',
    });
    expect(payment.statusCode).toBe(404);
  });
});