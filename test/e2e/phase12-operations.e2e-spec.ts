import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 10 — operations (repo Phase 12). Acceptance:
 *  1. Expenses: DRAFT → SUBMITTED → APPROVED/REJECTED → PAID with a supplier/
 *     category/amount/branch/department + approval workflow; segregation of
 *     duties (creator may not approve/reject own expense); DRAFT-only editing;
 *     REJECTED is terminal.
 *  2. Ledger posting: ExpenseApproved → DR 5000 / CR 2100, ExpensePaid →
 *     DR 2100 / CR 1000, idempotent on re-drain; a CLOSED period writes a
 *     LedgerPostingException and still acks the outbox row.
 *  3. Assets: org-unique normalized tag (duplicates 409), CRUD, maintenance
 *     flag edits, one-way retire.
 *  4. Maintenance: schedule/reschedule/start/complete/cancel, asset status
 *     flips (ACTIVE → MAINTENANCE → ACTIVE), history with downtime/cost.
 *     Reminders are queued idempotently (exactly one per maintenance record).
 *  5. Waste management: stock write-off creates WASTAGE ledger entries and the
 *     wastage report aggregates them.
 *  6. Procurement analytics: supplier spend + outstanding balances.
 */
describe('phase12 operations', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let env: Env;
  let org: string;
  let userCreator: string;
  let userApprover: string;
  let branch: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const ops = [
    'expenses.read',
    'expenses.create',
    'expenses.approve',
    'expenses.pay',
    'expenses.manage',
    'assets.read',
    'assets.create',
    'assets.update',
    'assets.manage',
    'maintenance.read',
    'maintenance.create',
    'maintenance.manage',
    'analytics.read',
    'inventory.manage',
    'inventory.wastage',
    'medications.manage',
    'suppliers.manage',
  ];

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
    userId = userCreator,
  ) =>
    app.inject({
      method,
      headers: principalHeaders({ organizationId: org, userId, permissions }),
      url: url(path),
      ...(payload ? { payload } : {}),
    });

  const post = (path: string, permissions: string[], payload: Record<string, unknown>, userId?: string) =>
    request('POST', path, permissions, payload, userId);
  const get = (path: string, permissions: string[], userId?: string) =>
    request('GET', path, permissions, undefined, userId);
  const patch = (path: string, permissions: string[], payload: Record<string, unknown>, userId?: string) =>
    request('PATCH', path, permissions, payload, userId);

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

  const createSupplier = async (name: string): Promise<string> => {
    const res = await post('/suppliers', ops, { name });
    expect(res.statusCode).toBe(201);
    return res.json().data.supplier.id;
  };

  const createExpense = async (
    amount: string,
    opts: Record<string, unknown> = {},
    userId?: string,
  ): Promise<{ id: string; expenseNumber: string; status: string; amount: string; paymentStatus: string; version: number }> => {
    const res = await post('/expenses', ops, { branchId: branch, amount, category: 'EQUIPMENT', ...opts }, userId);
    expect(res.statusCode).toBe(201);
    return res.json().data.expense;
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    org = newId();
    userCreator = newId();
    userApprover = newId();
    await sc.organization.create({ data: { id: org, name: 'Phase12 Org C' } });
    await sc.user.create({
      data: {
        id: userCreator,
        organizationId: org,
        email: 'phase12.creator@test.local',
        firstName: 'Phase',
        lastName: 'Twelve',
        status: 'ACTIVE',
      },
    });
    await sc.user.create({
      data: {
        id: userApprover,
        organizationId: org,
        email: 'phase12.approver@test.local',
        firstName: 'Phase',
        lastName: 'TwelveA',
        status: 'ACTIVE',
      },
    });
    branch = newId();
    await sc.branch.create({ data: { id: branch, organizationId: org, name: 'Main', code: 'PH12C' } });

    await sc.financialPeriod.create({
      data: {
        id: newId(),
        organizationId: org,
        code: 'FY2026-P12',
        label: 'Phase 12 window',
        status: 'OPEN',
        startDate: new Date('2026-01-01T00:00:00.000Z'),
        endDate: new Date('2026-12-31T23:59:59.000Z'),
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Expenses: lifecycle, numbers, segregation ────────────────────────────

  it('creates a DRAFT expense with an EXP number; edits only while DRAFT', async () => {
    const created = await createExpense('1500.50', { category: 'EQUIPMENT', reference: 'INV-001' });
    expect(created.status).toBe('DRAFT');
    expect(created.expenseNumber).toMatch(/^EXP-\d{4}-\d{6}$/);
    expect(created.amount).toBe('1500.50');
    expect(created.paymentStatus).toBe('UNPAID');

    // DRAFT-only content edits are allowed
    const patched = await patch(`/expenses/${created.id}`, ops, {
      version: created.version,
      amount: '1800.00',
    });
    expect(patched.statusCode).toBe(200);
    expect(patched.json().data.expense.amount).toBe('1800.00');

    // stale version → conflict
    const stale = await patch(`/expenses/${created.id}`, ops, { version: 9999, amount: '1.00' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.VERSION_CONFLICT);

    // nothing outside the org is reachable
    const list = await get('/expenses?status=DRAFT', ops);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.length).toBeGreaterThanOrEqual(1);
  });

  it('enforces the approval workflow and segregation of duties', async () => {
    const expense = await createExpense('600.00');

    // only the creator submits
    const otherSubmit = await post(`/expenses/${expense.id}/submit`, ops, {}, userApprover);
    expect(otherSubmit.statusCode).toBe(403);
    expect(otherSubmit.json().error.code).toBe(ErrorCodes.SEGREGATION_VIOLATION);

    const submitted = await post(`/expenses/${expense.id}/submit`, ops, {}, userCreator);
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().data.expense.status).toBe('SUBMITTED');

    // creator cannot approve/reject own expense
    const selfApprove = await post(`/expenses/${expense.id}/approve`, ops, {}, userCreator);
    expect(selfApprove.statusCode).toBe(403);
    expect(selfApprove.json().error.code).toBe(ErrorCodes.SEGREGATION_VIOLATION);

    // reject without a reason → 400
    const noReason = await post(`/expenses/${expense.id}/reject`, ops, {}, userApprover);
    expect(noReason.statusCode).toBe(400);

    // an approver different from the creator approves
    const approved = await post(`/expenses/${expense.id}/approve`, ops, {}, userApprover);
    expect(approved.statusCode).toBe(201);
    expect(approved.json().data.expense.status).toBe('APPROVED');
    expect(approved.json().data.expense.approvedById).toBe(userApprover);

    // post-approval edits are blocked
    const afterApprove = await patch(`/expenses/${expense.id}`, ops, { amount: '999.00' });
    expect(afterApprove.statusCode).toBe(409);
    expect(afterApprove.json().error.code).toBe(ErrorCodes.EXPENSE_STATE_CONFLICT);

    // an approved expense (ledger obligation) cannot be cancelled
    const cancelApproved = await post(`/expenses/${expense.id}/cancel`, ops, {}, userCreator);
    expect(cancelApproved.statusCode).toBe(409);
    expect(cancelApproved.json().error.code).toBe(ErrorCodes.EXPENSE_STATE_CONFLICT);

    // pay once
    const paid = await post(`/expenses/${expense.id}/pay`, ops, {}, userApprover);
    expect(paid.statusCode).toBe(201);
    expect(paid.json().data.expense.paymentStatus).toBe('PAID');
    expect(paid.json().data.expense.paidAt).not.toBeNull();

    const paidAgain = await post(`/expenses/${expense.id}/pay`, ops, {}, userApprover);
    expect(paidAgain.statusCode).toBe(409);
    expect(paidAgain.json().error.code).toBe(ErrorCodes.EXPENSE_ALREADY_PAID);
  });

  it('rejection is terminal; cancelled expenses cannot be revived', async () => {
    const expense = await createExpense('200.00');
    await post(`/expenses/${expense.id}/submit`, ops, {}, userCreator);

    const rejected = await post(`/expenses/${expense.id}/reject`, ops, { reason: 'Duplicate invoice' }, userApprover);
    expect(rejected.statusCode).toBe(201);
    expect(rejected.json().data.expense.status).toBe('REJECTED');
    expect(rejected.json().data.expense.rejectReason).toBe('Duplicate invoice');

    // REJECTED is terminal: no approve, no pay, no cancel, no submit
    for (const action of ['approve', 'pay', 'cancel', 'submit']) {
      const attempt = await post(`/expenses/${expense.id}/${action}`, ops, {}, userCreator);
      expect(attempt.statusCode).toBe(409);
      expect(attempt.json().error.code).toBe(ErrorCodes.EXPENSE_STATE_CONFLICT);
    }

    const cancellable = await createExpense('50.00');
    await post(`/expenses/${cancellable.id}/submit`, ops, {}, userCreator);
    const cancelled = await post(`/expenses/${cancellable.id}/cancel`, ops, {}, userCreator);
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.expense.status).toBe('CANCELLED');

    const revive = await post(`/expenses/${cancellable.id}/submit`, ops, {}, userCreator);
    expect(revive.statusCode).toBe(409);
    expect(revive.json().error.code).toBe(ErrorCodes.EXPENSE_STATE_CONFLICT);
  });

  // ─── Ledger posting for expenses (ADR-035) ────────────────────────────────

  it('auto-posts the expense accrual and its payment, never duplicating', async () => {
    const supplier = await createSupplier('Ledger Supply Co');
    const expense = await createExpense('2400.00', {
      category: 'SUPPLIES',
      supplierId: supplier,
      reference: 'PO-42',
    });
    await post(`/expenses/${expense.id}/submit`, ops, {}, userCreator);
    await post(`/expenses/${expense.id}/approve`, ops, {}, userApprover);
    await post(`/expenses/${expense.id}/pay`, ops, {}, userApprover);

    await drainOutbox();

    const sc = prisma.unscoped();
    const accrual = await sc.financeTransaction.findFirst({
      where: { organizationId: org, referenceType: 'Operations.ExpenseApproved', referenceId: expense.id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(accrual).not.toBeNull();
    expect(accrual!.transactionNumber).toMatch(/^AUTO-/);
    expect(accrual!.lines.find((l) => l.account.code === '5000' && l.debit.toFixed(2) === '2400.00')).toBeDefined();
    expect(accrual!.lines.find((l) => l.account.code === '2100' && l.credit.toFixed(2) === '2400.00')).toBeDefined();

    const payment = await sc.financeTransaction.findFirst({
      where: { organizationId: org, referenceType: 'Operations.ExpensePaid', referenceId: expense.id },
      include: { lines: { include: { account: { select: { code: true } } } } },
    });
    expect(payment).not.toBeNull();
    expect(payment!.lines.find((l) => l.account.code === '2100' && l.debit.toFixed(2) === '2400.00')).toBeDefined();
    expect(payment!.lines.find((l) => l.account.code === '1000' && l.credit.toFixed(2) === '2400.00')).toBeDefined();

    // idempotency: re-drain posts nothing new
    const before = await sc.financeTransaction.count({ where: { organizationId: org } });
    await drainOutbox();
    const after = await sc.financeTransaction.count({ where: { organizationId: org } });
    expect(after).toBe(before);

    // supplier spend + balances reflect the approved+paid expense (no outstanding)
    const spend = await get('/analytics/procurement/supplier-spend', ops);
    expect(spend.statusCode).toBe(200);
    const supplierRow = spend.json().data.items.find((r: { supplierId: string }) => r.supplierId === supplier);
    expect(supplierRow).toBeDefined();
    expect(supplierRow.total).toBe('2400.00');

    const balances = await get('/analytics/procurement/supplier-balances', ops);
    expect(balances.statusCode).toBe(200);
    const balanceRow = balances.json().data.items.find((r: { supplierId: string }) => r.supplierId === supplier);
    expect(balanceRow).toBeDefined();
    expect(balanceRow.outstanding).toBe('0.00');
    expect(balanceRow.paid).toBe('2400.00');
  });

  it('writes LedgerPostingExceptions for expenses approved into a CLOSED period', async () => {
    const sc = prisma.unscoped();
    const period = await sc.financialPeriod.findFirst({
      where: { organizationId: org, code: 'FY2026-P12' },
    });
    expect(period).not.toBeNull();
    const closed = await post(`/ledger/periods/${period!.id}/close`, ['ledger.manage'], {}, userApprover);
    expect(closed.statusCode).toBe(201);

    const expense = await createExpense('700.00');
    await post(`/expenses/${expense.id}/submit`, ops, {}, userCreator);
    await post(`/expenses/${expense.id}/approve`, ops, {}, userApprover);
    await post(`/expenses/${expense.id}/pay`, ops, {}, userApprover);

    // consumer must not throw on PERIOD_LOCKED (ADR-035)
    await drainOutbox();

    const exceptions = await sc.ledgerPostingException.findMany({
      where: { organizationId: org, referenceId: expense.id },
    });
    expect(exceptions.length).toBeGreaterThanOrEqual(2);
    expect(exceptions.every((e) => e.reason.includes('financial period'))).toBe(true);

    const journals = await sc.financeTransaction.findMany({
      where: { organizationId: org, referenceId: expense.id },
    });
    expect(journals).toHaveLength(0);
  });

  // ─── Assets ───────────────────────────────────────────────────────────────

  it('registers assets, enforces tag uniqueness, and retires only once', async () => {
    const created = await post('/assets', ops, {
      assetTag: '  mri-scanner-01 ',
      category: 'EQUIPMENT',
      name: 'MRI Scanner',
      location: 'Radiology',
    });
    expect(created.statusCode).toBe(201);
    const asset = created.json().data.asset;
    expect(asset.assetTag).toBe('MRI-SCANNER-01');
    expect(asset.status).toBe('ACTIVE');

    const dup = await post('/assets', ops, {
      assetTag: 'mri-scanner-01',
      category: 'EQUIPMENT',
      name: 'Duplicate',
    });
    expect(dup.statusCode).toBe(409);

    const other = await post('/assets', ops, {
      assetTag: 'BED-001',
      category: 'BED',
      name: 'Ward Bed',
    });
    expect(other.statusCode).toBe(201);

    const search = await get('/assets?search=MRI', ops);
    expect(search.statusCode).toBe(200);
    expect(search.json().data.map((a: { assetTag: string }) => a.assetTag)).toContain('MRI-SCANNER-01');

    // retirement via PATCH is rejected (lifecycle endpoint only)
    const patchRetire = await patch(`/assets/${asset.id}`, ops, { status: 'RETIRED' });
    expect(patchRetire.statusCode).toBe(409);
    expect(patchRetire.json().error.code).toBe(ErrorCodes.ASSET_STATE_CONFLICT);

    const retired = await post(`/assets/${asset.id}/retire`, ops, {});
    expect(retired.statusCode).toBe(201);
    expect(retired.json().data.asset.status).toBe('RETIRED');
    expect(retired.json().data.asset.retiredAt).not.toBeNull();

    const retiredAgain = await post(`/assets/${asset.id}/retire`, ops, {});
    expect(retiredAgain.statusCode).toBe(409);
    expect(retiredAgain.json().error.code).toBe(ErrorCodes.ASSET_STATE_CONFLICT);
  });

  // ─── Maintenance + reminders ──────────────────────────────────────────────

  it('runs a maintenance job: schedule → start → complete with downtime/cost', async () => {
    const assetRes = await post('/assets', ops, {
      assetTag: 'VEH-AMB-01',
      category: 'VEHICLE',
      name: 'Ambulance',
    });
    const assetId = assetRes.json().data.asset.id;

    const scheduled = await post('/maintenance', ops, {
      assetId,
      scheduledFor: new Date(Date.now() + 2 * 3600 * 1000).toISOString(),
      serviceProvider: 'Kilifi Garage',
    });
    expect(scheduled.statusCode).toBe(201);
    const record = scheduled.json().data.record;
    expect(record.status).toBe('PLANNED');

    // cannot reschedule once started
    const started = await post(`/maintenance/${record.id}/start`, ops, {});
    expect(started.statusCode).toBe(201);
    expect(started.json().data.record.status).toBe('IN_PROGRESS');

    const resched = await patch(`/maintenance/${record.id}`, ops, {
      scheduledFor: new Date(Date.now() + 72 * 3600 * 1000).toISOString(),
    });
    expect(resched.statusCode).toBe(409);
    expect(resched.json().error.code).toBe(ErrorCodes.MAINTENANCE_STATE_CONFLICT);

    // the asset went MAINTENANCE while work was underway
    const sc = prisma.unscoped();
    const midAsset = await sc.asset.findUnique({ where: { id: assetId } });
    expect(midAsset!.status).toBe('MAINTENANCE');

    const completed = await post(`/maintenance/${record.id}/complete`, ops, {
      downtimeHours: 3,
      cost: '4500.00',
    });
    expect(completed.statusCode).toBe(201);
    const done = completed.json().data.record;
    expect(done.status).toBe('COMPLETED');
    expect(done.downtimeHours).toBe(3);
    expect(done.cost).toBe('4500.00');
    expect(done.completedAt).not.toBeNull();

    const postAsset = await sc.asset.findUnique({ where: { id: assetId } });
    expect(postAsset!.status).toBe('ACTIVE');

    // a completed job cannot be restarted
    const restart = await post(`/maintenance/${record.id}/start`, ops, {});
    expect(restart.statusCode).toBe(409);
    expect(restart.json().error.code).toBe(ErrorCodes.MAINTENANCE_STATE_CONFLICT);
  });

  it('queues maintenance reminders idempotently (exactly one per record)', async () => {
    const assetRes = await post('/assets', ops, {
      assetTag: 'BED-002',
      category: 'BED',
      name: 'Ward Bed B',
    });
    const assetId = assetRes.json().data.asset.id;

    const soon = await post('/maintenance', ops, {
      assetId,
      scheduledFor: new Date(Date.now() + 6 * 3600 * 1000).toISOString(),
    });
    const soonId = soon.json().data.record.id;

    const far = await post('/maintenance', ops, {
      assetId,
      scheduledFor: new Date(Date.now() + 90 * 24 * 3600 * 1000).toISOString(),
    });
    const farId = far.json().data.record.id;

    const first = await post('/maintenance/reminders/queue', ops, {});
    expect(first.statusCode).toBe(201);
    expect(first.json().data.queued).toBe(1);
    expect(first.json().data.skipped).toBe(0);

    // same record inside the horizon → no duplicates on a second run
    const second = await post('/maintenance/reminders/queue', ops, {});
    expect(second.statusCode).toBe(201);
    expect(second.json().data.queued).toBe(0);
    expect(second.json().data.skipped).toBe(1);

    const sc = prisma.unscoped();
    const reminders = await sc.maintenanceReminder.count({
      where: { organizationId: org, maintenanceId: soonId },
    });
    expect(reminders).toBe(1);
    const farReminders = await sc.maintenanceReminder.count({
      where: { organizationId: org, maintenanceId: farId },
    });
    expect(farReminders).toBe(0);

    const list = await get('/maintenance/reminders', ops);
    expect(list.statusCode).toBe(200);
    const reminder = list.json().data.find((r: { maintenanceId: string }) => r.maintenanceId === soonId);
    expect(reminder).toBeDefined();
    expect(reminder.status).toBe('QUEUED');

    const sent = await post(`/maintenance/reminders/${reminder.id}/sent`, ops, {});
    expect(sent.statusCode).toBe(201);
    expect(sent.json().data.reminder.status).toBe('SENT');
  });

  // ─── Waste management + wastage report ────────────────────────────────────

  it('write-offs damaged stock into WASTAGE ledger rows the report aggregates', async () => {
    const medRes = await post('/medications', ops, {
      category: 'MEDICATION',
      name: 'Phase12 Amoxicillin',
      unit: 'tablet',
    });
    const medId = medRes.json().data.medication.id;

    await post('/pharmacy/stock/receive', ops, {
      branchId: branch,
      lines: [{ medicationId: medId, quantity: 50, batchNumber: 'B-P12-01', unitCost: 10 }],
    });

    const off = await post('/pharmacy/stock/write-off', ops, {
      branchId: branch,
      reason: 'Damaged in transit',
      lines: [{ medicationId: medId, quantity: 12 }],
    });
    expect(off.statusCode).toBe(201);
    expect(off.json().data.quantity).toBe(12);

    const sc = prisma.unscoped();
    const batches = await sc.stockBatch.findMany({
      where: { organizationId: org, medicationId: medId },
    });
    expect(batches.map((b) => b.onHand).reduce((a, b) => a + b, 0)).toBe(38);

    const report = await get(`/analytics/procurement/wastage?medicationId=${medId}`, ops);
    expect(report.statusCode).toBe(200);
    const data = report.json().data;
    expect(data.summary.totalQuantity).toBe(12);
    expect(data.summary.totalValue).toBe('120.00');
    expect(data.items[0].quantityWasted).toBe(12);

    // too much → insufficient stock
    const over = await post('/pharmacy/stock/write-off', ops, {
      branchId: branch,
      reason: 'All of it',
      lines: [{ medicationId: medId, quantity: 999 }],
    });
    expect(over.statusCode).toBe(409);
    expect(over.json().error.code).toBe(ErrorCodes.INSUFFICIENT_STOCK);
  });

  it('segregates permissions across the operations groups', async () => {
    // expenses.read only → lifecycle actions denied
    const viewOnly = ['expenses.read', 'analytics.read'];
    const expense = await createExpense('50.00');
    const submit = await post(`/expenses/${expense.id}/submit`, viewOnly, {}, userCreator);
    expect(submit.statusCode).toBe(403);

    const approve = await post(`/expenses/${expense.id}/approve`, viewOnly, {}, userApprover);
    expect(approve.statusCode).toBe(403);

    const noAssets = await get('/assets', viewOnly);
    expect(noAssets.statusCode).toBe(403);

    // write-off needs inventory.wastage
    const noWastage = await post('/pharmacy/stock/write-off', ['inventory.manage'], {
      branchId: branch,
      reason: 'nope',
      lines: [{ medicationId: '00000000-0000-7000-8000-000000000001', quantity: 1 }],
    });
    expect(noWastage.statusCode).toBe(403);

    // maintenance stays hidden without maintenance.read
    const noMaintenance = await get('/maintenance', viewOnly);
    expect(noMaintenance.statusCode).toBe(403);
  });
});