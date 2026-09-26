import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 7 — financial ledger + M-PESA (repo Phase 11). Acceptance:
 *  1. Financial periods: open (unique code, no overlap), close, lock.
 *  2. Manual journals: balanced single-side lines, JRN-YYYY-NNNNNN, live
 *     period enforcement (PERIOD_LOCKED 409), unbalanced rejected (422),
 *     reversal, auto-posted journals cannot be reversed.
 *  3. Trial balance: DB-backstopped accounts (idempotent seeding) with
 *     debits === credits.
 *  4. Auto-posting via the outbox: InvoiceIssued → DR AR / CR Revenue,
 *     PaymentCompleted → DR Cash / CR AR; idempotent on re-drain; a journal
 *     whose date falls in a CLOSED period writes an LedgerPostingException
 *     and the outbox row is still acked (consumer NEVER throws).
 *  5. M-PESA STK push: initiation persists a PENDING request, the public
 *     callback (secret-gated, 401 without it) creates the payment exactly
 *     once on a SUCCEEDED webhook, marks the request MISMATCHED without a
 *     payment on an amount difference, and FAILED on a non-zero result code.
 *  6. Reconciliation: MATCHED for confirmed pushes, UNMATCHED for provider
 *     charges the books never saw, resolve match once (409 on second resolve).
 *  7. Permissions: ledger.read/post/manage + mpesa.read/initiate/reconcile.
 */
describe('phase11 financial & mpesa', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let env: Env;
  let orgA: string;
  let userA: string;
  let branchA: string;
  let orgB: string;
  let userB: string;
  let branchB: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
    extra?: Record<string, string>,
    org = orgA,
    userId = userA,
  ) =>
    app.inject({
      method,
      headers: {
        ...principalHeaders({ organizationId: org, userId, permissions }),
        ...(extra ?? {}),
      },
      url: url(path),
      ...(payload ? { payload } : {}),
    });

  const post = (
    path: string,
    permissions: string[],
    payload: Record<string, unknown>,
    extra?: Record<string, string>,
    org?: string,
    userId?: string,
  ) => request('POST', path, permissions, payload, extra, org, userId);
  const get = (
    path: string,
    permissions: string[],
    extra?: Record<string, string>,
    org?: string,
    userId?: string,
  ) => request('GET', path, permissions, undefined, extra, org, userId);
  const _patch = (
    path: string,
    permissions: string[],
    payload: Record<string, unknown>,
    extra?: Record<string, string>,
    org?: string,
    userId?: string,
  ) => request('PATCH', path, permissions, payload, extra, org, userId);

  const receptionist = [
    'patients.read',
    'patients.create',
    'billing.read',
    'billing.create',
    'payments.create',
    'mpesa.read',
    'mpesa.initiate',
  ];
  const accountant = [
    ...receptionist,
    'billing.manage',
    'payments.refund',
    'ledger.read',
    'ledger.post',
    'ledger.manage',
    'mpesa.reconcile',
  ];
  const auditor = ['patients.read', 'billing.read', 'ledger.read', 'mpesa.read'];

  const drainOutbox = async (maxEvents = 100): Promise<number> => {
    let published = 0;
    for (
      let n = await publisher.publishReadyEvents(maxEvents);
      n > 0;
      n = await publisher.publishReadyEvents(maxEvents)
    ) {
      published += n;
      expect(published).toBeLessThanOrEqual(1000);
    }
    return published;
  };

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post('/patients', receptionist, {
      firstName,
      lastName: 'Phase11',
      phone,
      dateOfBirth: '1990-01-01',
      sex: 'FEMALE',
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const createItem = async (name: string, price: string): Promise<{ id: string }> => {
    const res = await post('/billable-items', receptionist, {
      category: 'CONSULTATION',
      name,
      price,
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.billableItem as { id: string };
  };

  const createInvoice = async (
    patientId: string,
    itemId: string,
    quantity = 1,
    branch = branchA,
    org = orgA,
  ): Promise<{ id: string; status: string }> => {
    const res = await post(
      '/invoices',
      receptionist,
      { branchId: branch, patientId, items: [{ billableItemId: itemId, quantity }] },
      {},
      org,
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.invoice;
  };

  const issueInvoice = async (
    invoiceId: string,
    org = orgA,
    userId = userA,
  ): Promise<{ id: string; status: string }> => {
    const res = await post(`/invoices/${invoiceId}/issue`, receptionist, {}, {}, org, userId);
    expect(res.statusCode).toBe(201);
    return res.json().data.invoice;
  };

  const openPeriod = async (
    org: string,
    opts: { code: string; label: string; start: string; end: string; by?: string },
  ): Promise<{ id: string; status: string }> => {
    const res = await post(
      '/ledger/periods',
      accountant,
      { code: opts.code, label: opts.label, startDate: opts.start, endDate: opts.end },
      {},
      org,
      opts.by ?? userA,
    );
    expect(res.statusCode).toBe(201);
    return res.json().data as { id: string; status: string };
  };

  const stkCallbackBody = (merchantRequestId: string, checkoutRequestId: string, resultCode: number, amount: string) => ({
    Body: {
      stkCallback: {
        MerchantRequestID: merchantRequestId,
        CheckoutRequestID: checkoutRequestId,
        ResultCode: resultCode,
        ResultDesc: resultCode === 0 ? 'Success' : 'Request cancelled by user',
        CallbackMetadata: {
          Item: [
            { Name: 'Amount', Value: amount },
            { Name: 'MpesaReceiptNumber', Value: `PBC${Date.now()}` },
            { Name: 'TransactionDate', Value: '20260925120000' },
          ],
        },
      },
    },
  });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase11 Org A' } });
    await sc.user.create({
      data: {
        id: userA,
        organizationId: orgA,
        email: 'phase11.a@test.local',
        firstName: 'Phase',
        lastName: 'ElevenA',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH11A' } });

    orgB = newId();
    userB = newId();
    await sc.organization.create({ data: { id: orgB, name: 'Phase11 Org B' } });
    await sc.user.create({
      data: {
        id: userB,
        organizationId: orgB,
        email: 'phase11.b@test.local',
        firstName: 'Phase',
        lastName: 'ElevenB',
        status: 'ACTIVE',
      },
    });
    branchB = newId();
    await sc.branch.create({ data: { id: branchB, organizationId: orgB, name: 'Main', code: 'PH11B' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Financial periods (manual journal host, org B) ───────────────────────

  it('opens periods: unique codes, no overlaps, then closes and locks', async () => {
    const p1 = await openPeriod(orgB, {
      code: 'FY2026-08',
      label: 'August 2026',
      start: '2026-08-01T00:00:00.000Z',
      end: '2026-08-31T23:59:59.000Z',
    });
    expect(p1.status).toBe('OPEN');

    const dup = await post(
      '/ledger/periods',
      accountant,
      { code: 'FY2026-08', label: 'again', startDate: '2026-09-01T00:00:00.000Z', endDate: '2026-09-30T23:59:59.000Z' },
      {},
      orgB,
    );
    expect(dup.statusCode).toBe(409);
    expect(dup.json().error.code).toBe(ErrorCodes.CONFLICT);

    const overlap = await post(
      '/ledger/periods',
      accountant,
      { code: 'FY2026-08B', label: 'touching', startDate: '2026-08-15T00:00:00.000Z', endDate: '2026-09-15T00:00:00.000Z' },
      {},
      orgB,
    );
    expect(overlap.statusCode).toBe(409);
    expect(overlap.json().error.code).toBe(ErrorCodes.CONFLICT);

    const closed = await post(`/ledger/periods/${p1.id}/close`, accountant, {}, {}, orgB);
    expect(closed.statusCode).toBe(201);
    expect(closed.json().data.status).toBe('CLOSED');

    const locked = await post(`/ledger/periods/${p1.id}/lock`, accountant, {}, {}, orgB);
    expect(locked.statusCode).toBe(201);
    expect(locked.json().data.status).toBe('LOCKED');

    // only CLOSED can lock; an already LOCKED period is rejected on lock
    const relock = await post(`/ledger/periods/${p1.id}/lock`, accountant, {}, {}, orgB);
    expect(relock.statusCode).toBe(409);
  });

  it('posts a manual journal only inside an OPEN period; rejects unbalanced and locked', async () => {
    const open = await openPeriod(orgB, {
      code: 'FY2027-H1',
      label: 'H1 2027',
      start: '2027-01-01T00:00:00.000Z',
      end: '2027-06-30T23:59:59.000Z',
    });

    const res = await post(
      '/ledger/journal',
      accountant,
      {
        date: '2027-03-15T12:00:00.000Z',
        description: 'Owner contribution',
        lines: [
          { accountCode: '1000', debit: '10000.00', memo: 'cash in' },
          { accountCode: '3000', credit: '10000.00', memo: 'equity' },
        ],
      },
      {},
      orgB,
    );
    expect(res.statusCode).toBe(201);
    const journal = res.json().data;
    expect(journal.transactionNumber).toMatch(/^JRN-\d{4}-\d{6}$/);
    expect(journal.status).toBe('POSTED');
    expect(journal.periodId).toBe(open.id);
    expect(journal.referenceType).toBeNull();
    expect(journal.totals).toEqual({ debit: '10000.00', credit: '10000.00' });
    expect(journal.lines).toHaveLength(2);

    const unbalanced = await post(
      '/ledger/journal',
      accountant,
      {
        date: '2027-03-16T12:00:00.000Z',
        lines: [
          { accountCode: '1000', debit: '100.00' },
          { accountCode: '2100', credit: '90.00' },
        ],
      },
      {},
      orgB,
    );
    expect(unbalanced.statusCode).toBe(422);
    expect(unbalanced.json().error.code).toBe(ErrorCodes.UNBALANCED_JOURNAL);

    // single-side requirement is enforced by the DTO too
    const bothSides = await post(
      '/ledger/journal',
      accountant,
      {
        date: '2027-03-16T12:00:00.000Z',
        lines: [
          { accountCode: '1000', debit: '100.00', credit: '10.00' },
          { accountCode: '2100', credit: '100.00' },
        ],
      },
      {},
      orgB,
    );
    expect(bothSides.statusCode).toBe(400);

    // journal dated inside the LOCKED August period from the previous test
    const locked = await post(
      '/ledger/journal',
      accountant,
      {
        date: '2026-08-15T12:00:00.000Z',
        lines: [
          { accountCode: '1000', debit: '1.00' },
          { accountCode: '2100', credit: '1.00' },
        ],
      },
      {},
      orgB,
    );
    expect(locked.statusCode).toBe(409);
    expect(locked.json().error.code).toBe(ErrorCodes.PERIOD_LOCKED);
  });

  it('lists the journal; reverses only manual journals once', async () => {
    const list = await get('/ledger/journal?limit=50', accountant, {}, orgB);
    expect(list.statusCode).toBe(200);
    const manual = list
      .json()
      .data.items.find(
        (t: { description: string | null }) => t.description === 'Owner contribution',
      );
    expect(manual).toBeDefined();

    const byAccount = await get('/ledger/journal?accountCode=3000', accountant, {}, orgB);
    expect(byAccount.statusCode).toBe(200);
    expect(byAccount.json().data.items.some((t: { id: string }) => t.id === manual.id)).toBe(true);

    const reversed = await post(
      `/ledger/journal/${manual.id}/reverse`,
      accountant,
      { reason: 'Correction' },
      {},
      orgB,
    );
    expect(reversed.statusCode).toBe(201);
    const reversal = reversed.json().data;
    expect(reversal.status).toBe('POSTED');
    expect(reversal.reversalOfId).toBe(manual.id);
    // reversal swaps the legs: DR equity / CR cash
    expect(
      reversal.lines.some(
        (l: { accountCode: string; debit: string }) =>
          l.accountCode === '3000' && l.debit === '10000.00',
      ),
    ).toBe(true);

    const again = await post(`/ledger/journal/${manual.id}/reverse`, accountant, {}, {}, orgB);
    expect(again.statusCode).toBe(409);

    const nowStatus = await get(`/ledger/journal/${manual.id}`, accountant, {}, orgB);
    expect(nowStatus.json().data.status).toBe('REVERSED');
  });

  it('trial balance balances, with account lines scoped and sign-normalized', async () => {
    const res = await get('/ledger/balances', accountant, {}, orgB);
    expect(res.statusCode).toBe(200);
    const tb = res.json().data;
    expect(tb.totals.debit).toBe(tb.totals.credit);
    expect(parseFloat(tb.totals.debit)).toBeGreaterThan(0);
    // cash (1000) is DEBIT-normal: opening 10000 minus reversal credit 10000 = 0
    const cash = tb.items.find((l: { accountCode: string }) => l.accountCode === '1000');
    expect(cash).toBeDefined();
    expect(cash.balance).toBeNull();
    const smallJournal = await get('/ledger/journal?limit=50&status=POSTED', accountant, {}, orgB);
    expect(smallJournal.json().data.items.length).toBeGreaterThanOrEqual(1);
  });

  // ─── Auto-posting + period lock (org A) ───────────────────────────────────

  it('auto-posts InvoiceIssued and PaymentCompleted journals; never duplicates', async () => {
    const period = await openPeriod(orgA, {
      code: 'FY2026-H2',
      label: 'H2 2026',
      start: '2026-09-01T00:00:00.000Z',
      end: '2026-12-31T23:59:59.000Z',
    });

    const patientId = await registerPatient('Ledger', '0755001001');
    const item = await createItem('Ledger Consult', '1000.00');
    const invoice = await createInvoice(patientId, item.id);
    await issueInvoice(invoice.id);

    const pay = await post(`/invoices/${invoice.id}/payments`, receptionist, {
      amount: '400.00',
      method: 'CASH',
    });
    expect(pay.statusCode).toBe(201);

    await drainOutbox();

    const sc = prisma.unscoped();
    const issued = await sc.financeTransaction.findFirst({
      where: { organizationId: orgA, referenceType: 'Billing.InvoiceIssued' },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(issued).not.toBeNull();
    expect(issued!.periodId).toBe(period.id);
    expect(issued!.transactionNumber).toMatch(/^AUTO-/);
    expect(
      issued!.lines.find(
        (l) => l.account.code === '1200' && l.debit.toFixed(2) === '1000.00',
      ),
    ).toBeDefined();
    expect(
      issued!.lines.find(
        (l) => l.account.code === '4000' && l.credit.toFixed(2) === '1000.00',
      ),
    ).toBeDefined();

    const paid = await sc.financeTransaction.findFirst({
      where: { organizationId: orgA, referenceType: 'Billing.PaymentCompleted' },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(paid).not.toBeNull();
    expect(
      paid!.lines.find((l) => l.account.code === '1000' && l.debit.toFixed(2) === '400.00'),
    ).toBeDefined();
    expect(
      paid!.lines.find((l) => l.account.code === '1200' && l.credit.toFixed(2) === '400.00'),
    ).toBeDefined();

    // idempotency: re-draining posts nothing new
    const before = await sc.financeTransaction.count({ where: { organizationId: orgA } });
    await drainOutbox();
    const after = await sc.financeTransaction.count({ where: { organizationId: orgA } });
    expect(after).toBe(before);
  });

  it('writes LedgerPostingException rows when a period is locked, and acks the outbox', async () => {
    const patientId = await registerPatient('Locked', '0755001002');
    const item = await createItem('Locked Consult', '2000.00');
    const invoice = await createInvoice(patientId, item.id);
    await issueInvoice(invoice.id);
    const pay = await post(`/invoices/${invoice.id}/payments`, receptionist, { amount: '2000.00', method: 'CASH' });
    expect(pay.statusCode).toBe(201);

    const period = await prisma.unscoped().financialPeriod.findFirst({
      where: { organizationId: orgA, code: 'FY2026-H2' },
    });
    const closed = await post(`/ledger/periods/${period!.id}/close`, accountant, {}, {}, orgA);
    expect(closed.statusCode).toBe(201);

    // Drain must succeed — the ledger consumer must not throw on PERIOD_LOCKED.
    await drainOutbox();

    const sc = prisma.unscoped();
    const exceptions = await sc.ledgerPostingException.findMany({
      where: {
        organizationId: orgA,
        referenceId: { in: [invoice.id, pay.json().data.payment.id] },
      },
    });
    expect(exceptions.length).toBeGreaterThanOrEqual(1);
    expect(exceptions.every((e) => e.reason.includes('financial period'))).toBe(true);

    // no journal was posted for the locked events
    const postedAfterLock = await sc.financeTransaction.findMany({
      where: {
        organizationId: orgA,
        referenceId: { in: [invoice.id, pay.json().data.payment.id] },
      },
    });
    expect(postedAfterLock).toHaveLength(0);
  });

  // ─── M-PESA STK push + callback + reconciliation (org A) ──────────────────

  it('initiates an STK push; callbacks are secret-gated and settle the invoice', async () => {
    const patientId = await registerPatient('Mpesa', '0755001003');
    const item = await createItem('Mpesa Consult', '1500.00');
    const invoice = await createInvoice(patientId, item.id);
    await issueInvoice(invoice.id);

    const initiated = await post(
      '/mpesa/stk-push',
      receptionist,
      { invoiceId: invoice.id, phone: '254755001004', amount: '1500.00' },
      {},
      orgA,
    );
    expect(initiated.statusCode).toBe(201);
    const req = initiated.json().data;
    expect(req.status).toBe('PENDING');
    expect(req.checkoutRequestId).toMatch(/^mock-co-/);
    expect(req.amount).toBe('1500.00');

    // amount beyond the balance is rejected
    const over = await post(
      '/mpesa/stk-push',
      receptionist,
      { invoiceId: invoice.id, phone: '254755001004', amount: '9000.00' },
      {},
      orgA,
    );
    expect(over.statusCode).toBe(409);

    // no/no secret → 401
    const noSecret = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 0, '1500.00'),
    });
    expect(noSecret.statusCode).toBe(401);
    expect(noSecret.json().error.code).toBe(ErrorCodes.MPESA_CALLBACK_UNAUTHORIZED);

    const badSecret = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      headers: { 'x-careos-mpesa-callback-secret': 'wrong-secret' },
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 0, '1500.00'),
    });
    expect(badSecret.statusCode).toBe(401);

    // success callback
    const ack = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      headers: { 'x-careos-mpesa-callback-secret': env.MPESA_CALLBACK_SECRET },
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 0, '1500.00'),
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().data.ResultCode).toBe('0');

    const sc = prisma.unscoped();
    const settled = await sc.mpesaRequest.findUnique({ where: { id: req.id } });
    expect(settled!.status).toBe('SUCCEEDED');
    expect(settled!.confirmedAt).not.toBeNull();

    const payment = await sc.payment.findFirst({
      where: { organizationId: orgA, externalReference: req.checkoutRequestId },
    });
    expect(payment).not.toBeNull();
    expect(payment!.method).toBe('MPESA');
    expect(payment!.amount.toFixed(2)).toBe('1500.00');
    expect(payment!.receiptNumber).toMatch(/^RCT-/);

    const freshInvoice = await sc.invoice.findUnique({ where: { id: invoice.id } });
    expect(freshInvoice!.status).toBe('PAID');
    expect(freshInvoice!.balanceDue.toFixed(2)).toBe('0.00');

    // replaying the same callback is a no-op (exactly once)
    const replay = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      headers: { 'x-careos-mpesa-callback-secret': env.MPESA_CALLBACK_SECRET },
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 0, '1500.00'),
    });
    expect(replay.statusCode).toBe(200);
    const payments = await sc.payment.count({
      where: { organizationId: orgA, externalReference: req.checkoutRequestId },
    });
    expect(payments).toBe(1);

    // The payment landed while orgA's only financial period is CLOSED (the
    // exception test above locked the books), so the ledger consumer must write
    // a LedgerPostingException instead of a journal (ADR-035) — and never throw.
    await drainOutbox();
    const auto = await sc.financeTransaction.findFirst({
      where: { organizationId: orgA, referenceId: payment!.id },
    });
    expect(auto).toBeNull();
    const exc = await sc.ledgerPostingException.findFirst({
      where: { organizationId: orgA, eventType: 'Billing.PaymentCompleted', referenceId: payment!.id },
    });
    expect(exc).not.toBeNull();
    expect(exc!.reason).toContain('financial period');
  });

  it('flags amount mismatches without booking a payment; reconciliation finds them UNMATCHED', async () => {
    const patientId = await registerPatient('Mismatch', '0755001005');
    const item = await createItem('Mismatch Consult', '2000.00');
    const invoice = await createInvoice(patientId, item.id);
    await issueInvoice(invoice.id);

    const initiated = await post(
      '/mpesa/stk-push',
      receptionist,
      { invoiceId: invoice.id, phone: '254755001006', amount: '2000.00' },
      {},
      orgA,
    );
    const req = initiated.json().data;

    const ack = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      headers: { 'x-careos-mpesa-callback-secret': env.MPESA_CALLBACK_SECRET },
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 0, '500.00'),
    });
    expect(ack.statusCode).toBe(200);

    const sc = prisma.unscoped();
    const row = await sc.mpesaRequest.findUnique({ where: { id: req.id } });
    expect(row!.status).toBe('MISMATCHED');
    const payments = await sc.payment.count({
      where: { organizationId: orgA, externalReference: req.checkoutRequestId },
    });
    expect(payments).toBe(0);
    const freshInvoice = await sc.invoice.findUnique({ where: { id: invoice.id } });
    expect(freshInvoice!.status).toBe('ISSUED');

    const reconciled = await post('/mpesa/reconcile', accountant, {}, {}, orgA);
    expect(reconciled.statusCode).toBe(201);
    const run = reconciled.json().data;
    expect(run.run.providerCount).toBeGreaterThanOrEqual(1);
    const unmatched = run.matches.find(
      (m: { reference: string }) => m.reference === req.checkoutRequestId,
    );
    expect(unmatched).toBeDefined();
    expect(unmatched.status).toBe('UNMATCHED');
    expect(unmatched.providerAmount).toBe('500.00');
  });

  it('marks failed callbacks FAILED with no payment; reconciliation resolves matches once', async () => {
    const sc = prisma.unscoped();
    const patientId = await registerPatient('Recon', '0755001007');
    const item = await createItem('Recon Consult', '800.00');
    const invoice = await createInvoice(patientId, item.id);
    await issueInvoice(invoice.id);

    const initiated = await post(
      '/mpesa/stk-push',
      receptionist,
      { invoiceId: invoice.id, phone: '254755001008', amount: '800.00' },
      {},
      orgA,
    );
    const req = initiated.json().data;

    const failed = await app.inject({
      method: 'POST',
      url: url('/mpesa/callback'),
      headers: { 'x-careos-mpesa-callback-secret': env.MPESA_CALLBACK_SECRET },
      payload: stkCallbackBody(req.merchantRequestId, req.checkoutRequestId, 1032, '0'),
    });
    expect(failed.statusCode).toBe(200);
    const failedRow = await sc.mpesaRequest.findUnique({ where: { id: req.id } });
    expect(failedRow!.status).toBe('FAILED');
    expect(failedRow!.resultCode).toBe('1032');

    const reconciled = await post('/mpesa/reconcile', accountant, {}, {}, orgA);
    expect(reconciled.statusCode).toBe(201);
    // FAILED pushes never enter reconciliation (no money moved)
    expect(reconciled.json().data.matches.filter((m: { reference: string }) => m.reference === req.checkoutRequestId)).toHaveLength(0);

    // resolve an existing match exactly once
    const matched = reconciled.json().data.matches.find(
      (m: { status: string }) => m.status === 'MATCHED',
    );
    expect(matched).toBeDefined();
    const resolved = await post(
      `/mpesa/matches/${matched.id}/resolve`,
      accountant,
      { resolution: 'VERIFIED', reason: 'Checked against the bank statement.' },
      {},
      orgA,
    );
    expect(resolved.statusCode).toBe(201);
    expect(resolved.json().data.resolution).toBe('VERIFIED');

    const twice = await post(
      `/mpesa/matches/${matched.id}/resolve`,
      accountant,
      { resolution: 'CORRECTED', reason: 'again' },
      {},
      orgA,
    );
    expect(twice.statusCode).toBe(409);
    expect(twice.json().error.code).toBe(ErrorCodes.RECONCILIATION_ALREADY_RESOLVED);
  });

  it('separates permissions across the ledger and mpesa groups', async () => {
    const noLedger = await get('/ledger/journal', auditor, {}, orgB);
    expect(noLedger.statusCode).toBe(200);

    const blocked = await post(
      '/ledger/journal',
      receptionist,
      {
        date: '2027-04-01T12:00:00.000Z',
        lines: [
          { accountCode: '1000', debit: '1.00' },
          { accountCode: '2100', credit: '1.00' },
        ],
      },
      {},
      orgB,
    );
    expect(blocked.statusCode).toBe(403);

    const accounts = await get('/ledger/accounts', accountant, {}, orgA);
    expect(accounts.statusCode).toBe(200);
    // default chart was seeded by the auto-posting consumer in org A
    const codes = accounts.json().data.items.map((a: { code: string }) => a.code);
    for (const c of ['1000', '1200', '2100', '3000', '4000', '5000']) {
      expect(codes).toContain(c);
    }

    const noReconcile = await post('/mpesa/reconcile', receptionist, {}, {}, orgA);
    expect(noReconcile.statusCode).toBe(403);

    const list = await get('/mpesa/requests', receptionist, {}, orgA);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.items.length).toBeGreaterThanOrEqual(3);
  });
});