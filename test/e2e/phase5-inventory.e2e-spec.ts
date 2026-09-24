import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 5 — inventory & pharmacy. Acceptance coverage:
 *  1. Catalog + suppliers: CRUD with optimistic locking on medication version.
 *  2. Receiving: batches + append-only ledger; top-ups increment the same batch.
 *  3. FEFO dispensing: soonest expiry first, partial → PARTIALLY_DISPENSED,
 *     full → DISPENSED; INSUFFICIENT_STOCK / MEDICATION_EXPIRED 409s.
 *  4. Concurrency: two parallel dispensers of the last unit — exactly one
 *     succeeds (batch rows are FOR UPDATE-locked in the interactive tx).
 *  5. Purchase orders: DRAFT → SUBMITTED → APPROVED → ORDERED → (PARTIALLY_
 *     RECEIVED →) RECEIVED → CLOSED, all through the workflow engine.
 *  6. Branch transfers: approve → ship → receive applies both ledger legs and
 *     lands stock in a TRF-<id> destination batch.
 *  7. Stock counts: OPEN → record variance → APPLY (ADJUSTMENT ledger + on-hand
 *     reset); a closed count cannot be re-applied.
 *  8. Alerts: LOW_STOCK and EXPIRY_RISK advisories from ledger-derived usage.
 *  9. Prescription issue projects a pharmacy task (idempotent under replay).
 * 10. Role separation: pharmacists dispense but don't issue; doctors issue but
 *     don't dispense; receptionists never touch pharmacy writes.
 */
describe('phase5 inventory & pharmacy', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let publisher: OutboxPublisherService;
  let orgA: string;
  let userA: string;
  let branchA: string;
  let branchB: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const headerFor = (
    permissions: string[],
    extra: Record<string, string> = {},
  ) => ({
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

  const pharmacist = [
    'patients.read',
    'prescription.read',
    'pharmacy.dispense',
    'medications.read',
    'suppliers.read',
    'purchase_orders.read',
    'inventory.read',
    'inventory.manage',
  ];
  const doctor = [
    'patients.read',
    'patients.create',
    'prescription.read',
    'prescription.create',
    'prescription.update',
    'prescription.cancel',
    'inventory.read',
  ];
  const admin = [
    'medications.read',
    'medications.manage',
    'suppliers.read',
    'suppliers.manage',
    'purchase_orders.read',
    'purchase_orders.create',
    'purchase_orders.approve',
    'purchase_orders.receive',
    'inventory.read',
    'inventory.manage',
    'prescription.read',
    'prescription.create',
    'prescription.update',
    'prescription.cancel',
    'pharmacy.dispense',
    'patients.read',
    'patients.create',
    'tasks.read',
  ];
  const receptionist = ['patients.read', 'tasks.read', 'inventory.read', 'workflows.read'];

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post(
      '/patients',
      ['patients.create'],
      { firstName, lastName: 'Phase5', phone, dateOfBirth: '1990-01-01', sex: 'FEMALE' },
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const createMedication = async (
    name: string,
    opts: Record<string, unknown> = {},
  ): Promise<string> => {
    const res = await post('/medications', admin, {
      category: 'MEDICATION',
      name,
      unit: 'tablet',
      ...opts,
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.medication.id;
  };

  const createSupplier = async (name: string): Promise<string> => {
    const res = await post('/suppliers', admin, { name });
    expect(res.statusCode).toBe(201);
    return res.json().data.supplier.id;
  };

  const receiveStock = async (
    branchId: string,
    lines: Array<Record<string, unknown>>,
  ) => {
    const res = await post('/pharmacy/stock/receive', admin, { branchId, lines });
    expect(res.statusCode).toBe(201);
    return res.json().data.batches as Array<{ id: string; batchNumber: string; medicationId: string; quantity: number }>;
  };

  const createPrescription = async (payload: Record<string, unknown>) => {
    const created = await post('/prescriptions', doctor, payload);
    expect(created.statusCode).toBe(201);
    const prescription = created.json().data.prescription;
    const issued = await post(`/prescriptions/${prescription.id}/action`, doctor, {
      action: 'issue',
    });
    expect(issued.statusCode).toBe(201);
    return issued.json().data.prescription;
  };

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

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    publisher = app.get(OutboxPublisherService);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase5 Org A' } });
    await sc.user.create({
      data: {
        id: userA,
        organizationId: orgA,
        email: 'phase5.user@test.local',
        firstName: 'Phase',
        lastName: 'Five',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    branchB = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH5A' } });
    await sc.branch.create({ data: { id: branchB, organizationId: orgA, name: 'Sub', code: 'PH5B' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 1. catalog + suppliers ------------------------------------------------

  it('CRUDs the catalog with optimistic locking and denies non-catalog roles', async () => {
    const created = await post('/medications', admin, {
      category: 'MEDICATION',
      name: 'Amoxicillin',
      genericName: 'amoxicillin',
      unit: 'capsule',
      sku: 'AMX-250',
    });
    expect(created.statusCode).toBe(201);
    const med = created.json().data.medication;
    expect(med.version).toBe(1);

    const updated = await patch(`/medications/${med.id}`, admin, {
      version: 1,
      strength: '250mg',
    });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.medication.version).toBe(2);

    const stale = await patch(`/medications/${med.id}`, admin, { version: 1, form: 'tablet' });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.VERSION_CONFLICT);

    const listed = await get(`/medications?search=amoxi`, admin);
    expect(listed.statusCode).toBe(200);
    expect((listed.json().data as Array<{ name: string }>).some((m) => m.name === 'Amoxicillin')).toBe(true);

    const denied = await post('/medications', receptionist, { name: 'Forbidden' });
    expect(denied.statusCode).toBe(403);
    expect(denied.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
  });

  it('CRUDs suppliers', async () => {
    const created = await post('/suppliers', admin, { name: 'MedSupply Co', contactName: 'Jan' });
    expect(created.statusCode).toBe(201);
    const supplier = created.json().data.supplier;
    expect(supplier.isActive).toBe(true);

    const updated = await patch(`/suppliers/${supplier.id}`, admin, { phone: '0700000001' });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.supplier.phone).toBe('0700000001');
  });

  // --- 2. receiving -----------------------------------------------------------

  it('receives stock into a new batch and top-ups the same batch', async () => {
    const medId = await createMedication('Paracetamol');
    const first = await receiveStock(branchA, [
      { medicationId: medId, quantity: 100, batchNumber: 'PCM-001', expiryDate: '2027-12-31', unitCost: 5 },
    ]);
    const [firstBatch] = first;
    expect(firstBatch).toBeDefined();
    expect(firstBatch).toMatchObject({ batchNumber: 'PCM-001', quantity: 100 });

    const topUp = await receiveStock(branchA, [
      { medicationId: medId, quantity: 50, batchNumber: 'PCM-001', expiryDate: '2027-12-31' },
    ]);
    const [topUpBatch] = topUp;
    expect(topUpBatch).toBeDefined();
    expect(topUpBatch!.id).toBe(firstBatch!.id);
    expect(topUpBatch!.quantity).toBe(50);

    const batch = await prisma
      .unscoped()
      .stockBatch.findFirstOrThrow({ where: { id: firstBatch!.id, organizationId: orgA } });
    expect(batch.onHand).toBe(150);

    const onHand = await get('/pharmacy/stock/on-hand', admin);
    expect(onHand.statusCode).toBe(200);
    const row = (onHand.json().data.onHand as Array<{ medicationId: string; quantity: number }>).find(
      (r) => r.medicationId === medId,
    );
    expect(row?.quantity).toBe(150);
  });

  // --- 3. FEFO dispensing -----------------------------------------------------

  it('dispenses FEFO (soonest expiry first), partial then full', async () => {
    const medId = await createMedication('Azithromycin');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 30, batchNumber: 'AZM-NEAR', expiryDate: '2027-06-01' },
      { medicationId: medId, quantity: 30, batchNumber: 'AZM-RECENT', expiryDate: '2028-06-01' },
    ]);
    const patientId = await registerPatient('Fefo1', '0745000001');
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 40, dosage: '1 x 500mg' }],
    });

    const dispense = await post(
      '/pharmacy/stock/dispense',
      pharmacist,
      { prescriptionId: prescription.id, branchId: branchA, lines: [{ medicationId: medId, quantity: 12 }] },
    );
    expect(dispense.statusCode).toBe(201);
    expect(dispense.json().data.prescriptionStatus).toBe('PARTIALLY_DISPENSED');

    const medRow = await prisma.unscoped().stockBatch.findMany({
      where: { organizationId: orgA, branchId: branchA, medicationId: medId },
      orderBy: { batchNumber: 'asc' },
    });
    const byNumber = new Map(medRow.map((b) => [b.batchNumber, b.onHand]));
    // FEFO always draws from the soonest-expiring available batch first.
    expect(byNumber.get('AZM-NEAR')).toBe(18); // 12 drawn from the earlier-expiry batch
    expect(byNumber.get('AZM-RECENT')).toBe(30);

    const finish = await post(
      '/pharmacy/stock/dispense',
      pharmacist,
      { prescriptionId: prescription.id, branchId: branchA, lines: [{ medicationId: medId, quantity: 28 }] },
    );
    expect(finish.statusCode).toBe(201);
    expect(finish.json().data.prescriptionStatus).toBe('DISPENSED');

    // Splits across batches: remaining 18 from the near batch + 10 from recent.
    const fresh = await prisma.unscoped().stockBatch.findMany({
      where: { organizationId: orgA, branchId: branchA, medicationId: medId },
      orderBy: { batchNumber: 'asc' },
    });
    const after = new Map(fresh.map((b) => [b.batchNumber, b.onHand]));
    expect(after.get('AZM-NEAR')).toBe(0); // near-expiry batch fully depleted first
    expect(after.get('AZM-RECENT')).toBe(20);

    const got = await get(`/prescriptions/${prescription.id}`, ['prescription.read']);
    expect(got.json().data.prescription.status).toBe('DISPENSED');
    expect(got.json().data.prescription.dispensedAt).not.toBeNull();
  });

  it('rejects over-dispensing and expired-only stock with 409s', async () => {
    const medId = await createMedication('Metformin');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 10, batchNumber: 'MET-001', expiryDate: '2028-01-01' },
    ]);
    const patientId = await registerPatient('Fefo2', '0745000002');
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 30 }],
    });

    const tooMuch = await post(
      '/pharmacy/stock/dispense',
      pharmacist,
      { prescriptionId: prescription.id, branchId: branchA, lines: [{ medicationId: medId, quantity: 11 }] },
    );
    expect(tooMuch.statusCode).toBe(409);
    expect(tooMuch.json().error.code).toBe(ErrorCodes.INSUFFICIENT_STOCK);

    // A different medication whose ONLY stock has already expired.
    const expiredMed = await createMedication('OldDrug');
    await receiveStock(branchA, [
      { medicationId: expiredMed, quantity: 5, batchNumber: 'OLD-001', expiryDate: '2020-01-01' },
    ]);
    const rx2 = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: expiredMed, quantity: 1 }],
    });
    const expiredTry = await post(
      '/pharmacy/stock/dispense',
      pharmacist,
      { prescriptionId: rx2.id, branchId: branchA, lines: [{ medicationId: expiredMed, quantity: 1 }] },
    );
    expect(expiredTry.statusCode).toBe(409);
    expect(expiredTry.json().error.code).toBe(ErrorCodes.MEDICATION_EXPIRED);
  });

  // --- 4. concurrency ---------------------------------------------------------

  it('lets exactly one of two concurrent dispensers take the last unit', async () => {
    const medId = await createMedication('LastUnit');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 1, batchNumber: 'LAST-001', expiryDate: '2028-01-01' },
    ]);
    const patientId = await registerPatient('Conc1', '0745000003');
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 2 }],
    });

    const payload = {
      prescriptionId: prescription.id,
      branchId: branchA,
      lines: [{ medicationId: medId, quantity: 1 }],
    };
    const [a, b] = await Promise.all([
      post('/pharmacy/stock/dispense', pharmacist, payload),
      post('/pharmacy/stock/dispense', pharmacist, payload),
    ]);

    const [winner, loser] = [a, b].sort((x, y) => x.statusCode - y.statusCode);
    expect(winner).toBeDefined();
    expect(loser).toBeDefined();
    expect(winner!.statusCode).toBe(201);
    expect(loser!.statusCode).toBe(409);
    expect([ErrorCodes.INSUFFICIENT_STOCK, ErrorCodes.MEDICATION_EXPIRED]).toContain(
      loser!.json().error.code,
    );

    const batch = await prisma
      .unscoped()
      .stockBatch.findFirstOrThrow({ where: { batchNumber: 'LAST-001', organizationId: orgA } });
    expect(batch.onHand).toBe(0);
  });

  // --- 5. purchase orders -----------------------------------------------------

  it('walks a PO lifecycle through the workflow engine incl. partial receiving', async () => {
    const medId = await createMedication('Ciprofloxacin');
    const supplierId = await createSupplier('Cipro Dist');
    const created = await post(
      '/purchase-orders',
      admin,
      {
        branchId: branchA,
        supplierId,
        items: [{ medicationId: medId, quantityOrdered: 40, unitCost: 12.5 }],
      },
    );
    expect(created.statusCode).toBe(201);
    const po = created.json().data.purchaseOrder;
    expect(po.status).toBe('DRAFT');
    expect(po.poNumber).toBe('PO-000001');

    const submitted = await post(`/purchase-orders/${po.id}/action`, admin, { action: 'submit' });
    expect(submitted.statusCode).toBe(201);
    expect(submitted.json().data.purchaseOrder.status).toBe('SUBMITTED');

    const approved = await post(`/purchase-orders/${po.id}/action`, admin, { action: 'approve' });
    expect(approved.json().data.purchaseOrder.status).toBe('APPROVED');
    expect(approved.json().data.purchaseOrder.approvedAt).not.toBeNull();

    const ordered = await post(`/purchase-orders/${po.id}/action`, admin, { action: 'order' });
    expect(ordered.json().data.purchaseOrder.status).toBe('ORDERED');

    const partial = await post(
      `/purchase-orders/${po.id}/receive`,
      admin,
      {
        lines: [{ medicationId: medId, quantity: 25, batchNumber: 'CIP-25', expiryDate: '2027-06-01' }],
      },
    );
    expect(partial.statusCode).toBe(201);
    expect(partial.json().data.purchaseOrder.status).toBe('PARTIALLY_RECEIVED');

    const full = await post(
      `/purchase-orders/${po.id}/receive`,
      admin,
      {
        lines: [{ medicationId: medId, quantity: 15, batchNumber: 'CIP-15', expiryDate: '2027-06-01' }],
      },
    );
    expect(full.statusCode).toBe(201);
    expect(full.json().data.purchaseOrder.status).toBe('RECEIVED');

    const closed = await post(`/purchase-orders/${po.id}/action`, admin, { action: 'close' });
    expect(closed.statusCode).toBe(201);
    expect(closed.json().data.purchaseOrder.status).toBe('CLOSED');

    // Ledger rows carry the PO reference and on-hand is correct.
    const ledgers = await prisma.unscoped().inventoryLedgerEntry.findMany({
      where: { organizationId: orgA, referenceType: 'purchase_order', referenceId: po.id },
    });
    expect(ledgers).toHaveLength(2);
    expect(ledgers.reduce((s, l) => s + l.quantity, 0)).toBe(40);

    const batch = await prisma.unscoped().stockBatch.findFirstOrThrow({
      where: { batchNumber: 'CIP-25', organizationId: orgA },
    });
    expect(batch.onHand).toBe(25);

    // Terminal state is locked.
    const reClosed = await post(`/purchase-orders/${po.id}/action`, admin, { action: 'close' });
    expect(reClosed.statusCode).toBe(409);
    expect(reClosed.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('rejects an illegal PO move and over-receiving', async () => {
    const medId = await createMedication('Valsartan');
    const supplierId = await createSupplier('Vals Dist');
    const created = await post('/purchase-orders', admin, {
      branchId: branchA,
      supplierId,
      items: [{ medicationId: medId, quantityOrdered: 10 }],
    });
    const po = created.json().data.purchaseOrder;

    const skipApprove = await post(`/purchase-orders/${po.id}/receive`, admin, {
      lines: [{ medicationId: medId, quantity: 5, batchNumber: 'VAL-05', expiryDate: '2027-01-01' }],
    });
    expect(skipApprove.statusCode).toBe(409);
    expect(skipApprove.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    await post(`/purchase-orders/${po.id}/action`, admin, { action: 'submit' });
    await post(`/purchase-orders/${po.id}/action`, admin, { action: 'approve' });
    await post(`/purchase-orders/${po.id}/action`, admin, { action: 'order' });

    const overReceive = await post(`/purchase-orders/${po.id}/receive`, admin, {
      lines: [{ medicationId: medId, quantity: 99, batchNumber: 'VAL-99', expiryDate: '2027-01-01' }],
    });
    expect(overReceive.statusCode).toBe(400);
    expect(overReceive.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // --- 6. branch transfers ----------------------------------------------------

  it('transfers stock between branches applying both ledger legs', async () => {
    const medId = await createMedication('Ibuprofen');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 60, batchNumber: 'IBU-001', expiryDate: '2028-01-01' },
    ]);

    const requestBody = {
      fromBranchId: branchA,
      toBranchId: branchB,
      reason: 'Replenish satellite pharmacy',
      lines: [{ medicationId: medId, quantity: 20 }],
    };
    const created = await post('/pharmacy/transfers', admin, requestBody);
    expect(created.statusCode).toBe(201);
    const transfer = created.json().data.transfer;
    expect(transfer.status).toBe('REQUESTED');

    const approved = await post(`/pharmacy/transfers/${transfer.id}/action`, admin, { action: 'approve' });
    expect(approved.json().data.transfer.status).toBe('APPROVED');
    const shipped = await post(`/pharmacy/transfers/${transfer.id}/action`, admin, { action: 'ship' });
    expect(shipped.json().data.transfer.status).toBe('IN_TRANSIT');

    const received = await post(`/pharmacy/transfers/${transfer.id}/receive`, admin, {});
    expect(received.statusCode).toBe(201);
    expect(received.json().data.transfer.status).toBe('RECEIVED');

    const sourceBatch = await prisma.unscoped().stockBatch.findFirstOrThrow({
      where: { batchNumber: 'IBU-001', organizationId: orgA },
    });
    expect(sourceBatch.onHand).toBe(40);

    const destBatch = await prisma.unscoped().stockBatch.findFirstOrThrow({
      where: { organizationId: orgA, branchId: branchB, medicationId: medId },
    });
    expect(destBatch.batchNumber).toBe(`TRF-${transfer.id}`);
    expect(destBatch.onHand).toBe(20);

    const legs = await prisma.unscoped().inventoryLedgerEntry.findMany({
      where: { organizationId: orgA, referenceType: 'stock_transfer', referenceId: transfer.id },
    });
    const outgoing = legs.filter((l) => l.operation === 'TRANSFER_OUT').reduce((s, l) => s + l.quantity, 0);
    const incoming = legs.filter((l) => l.operation === 'TRANSFER_IN').reduce((s, l) => s + l.quantity, 0);
    expect(outgoing).toBe(-20);
    expect(incoming).toBe(20);

    // A received transfer cannot be received again.
    const again = await post(`/pharmacy/transfers/${transfer.id}/receive`, admin, {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('cannot transfer to the same branch', async () => {
    const medId = await createMedication('SameBranch');
    const res = await post('/pharmacy/transfers', admin, {
      fromBranchId: branchA,
      toBranchId: branchA,
      lines: [{ medicationId: medId, quantity: 5 }],
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // --- 7. stock counts --------------------------------------------------------

  it('opens, records, applies a count and adjusts the ledger', async () => {
    const medId = await createMedication('Counted');
    const [cntBatch] = await receiveStock(branchA, [
      { medicationId: medId, quantity: 10, batchNumber: 'CNT-001', expiryDate: '2028-01-01' },
    ]);

    const opened = await post('/pharmacy/stock/counts', admin, { branchId: branchA });
    expect(opened.statusCode).toBe(201);
    const count = opened.json().data.count;
    expect(count.status).toBe('OPEN');
    const item = (count.items as Array<{ id: string; batchId: string | null; systemQuantity: number }>).find(
      (i) => i.batchId === cntBatch!.id,
    );
    expect(item).toBeDefined();
    expect(item!.systemQuantity).toBe(10);

    const recorded = await post(
      `/pharmacy/stock/counts/${count.id}/items/${item!.id}`,
      admin,
      { countedQuantity: 7 },
    );
    expect(recorded.statusCode).toBe(201);
    expect(recorded.json().data.item.countedQuantity).toBe(7);

    const applied = await post(`/pharmacy/stock/counts/${count.id}/apply`, admin, {});
    expect(applied.statusCode).toBe(201);
    expect(applied.json().data.count.status).toBe('APPLIED');

    const batch = await prisma.unscoped().stockBatch.findFirstOrThrow({
      where: { batchNumber: 'CNT-001', organizationId: orgA },
    });
    expect(batch.onHand).toBe(7);

    const adjustments = await prisma.unscoped().inventoryLedgerEntry.findMany({
      where: { organizationId: orgA, referenceType: 'stock_count', referenceId: count.id },
    });
    expect(adjustments).toHaveLength(1);
    expect(adjustments[0]?.operation).toBe('ADJUSTMENT');
    expect(adjustments[0]?.quantity).toBe(-3);

    const replp = await post(`/pharmacy/stock/counts/${count.id}/apply`, admin, {});
    expect(replp.statusCode).toBe(400);
    expect(replp.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // --- 8. alerts --------------------------------------------------------------

  it('reports LOW_STOCK and EXPIRY_RISK advisories', async () => {
    const lowMed = await createMedication('LowVitals');
    await receiveStock(branchA, [
      { medicationId: lowMed, quantity: 3, batchNumber: 'LOW-001', expiryDate: '2028-01-01' },
    ]);
    const expMed = await createMedication('NearExp');
    await receiveStock(branchA, [
      { medicationId: expMed, quantity: 50, batchNumber: 'NXP-001', expiryDate: '2026-12-01' },
    ]);

    const res = await get('/pharmacy/stock/alerts', admin);
    expect(res.statusCode).toBe(200);
    const alerts = res.json().data.alerts as Array<{ medicationId: string; label: string }>;

    const low = alerts.find((a) => a.medicationId === lowMed);
    expect(low?.label).toBe('LOW_STOCK');

    const expiry = alerts.find((a) => a.medicationId === expMed);
    expect(expiry?.label).toBe('EXPIRY_RISK');
  });

  // --- 9. prescription → pharmacy task projection -----------------------------

  it('projects a dispense task on issue, idempotent under replay', async () => {
    const medId = await createMedication('TaskMed');
    const patientId = await registerPatient('Task1', '0745000009');
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 5 }],
    });

    await drainOutbox();
    await drainOutbox(); // second drain must be a no-op (idempotency)

    const task = await prisma.unscoped().task.findUnique({
      where: { id: prescription.id, organizationId: orgA },
    });
    expect(task).not.toBeNull();
    expect(task!.title).toBe('Dispense prescription');
    expect(task!.status).toBe('OPEN');
    expect(task!.patientId).toBe(patientId);
    expect(task!.createdById).toBe(userA);

    const tasks = await prisma.unscoped().task.count({ where: { id: prescription.id } });
    expect(tasks).toBe(1);
  });

  it('cancels an issued prescription and projects no task', async () => {
    const medId = await createMedication('CancelMed');
    const patientId = await registerPatient('Cancel1', '0745000010');
    const created = await post('/prescriptions', doctor, {
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 5 }],
    });
    const prescription = created.json().data.prescription;

    const cancelled = await post(`/prescriptions/${prescription.id}/action`, doctor, {
      action: 'cancel',
      cancelReason: 'Allergy noted',
    });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.prescription.status).toBe('CANCELLED');
    expect(cancelled.json().data.prescription.cancelReason).toBe('Allergy noted');
  });

  // --- 10. role separation ----------------------------------------------------

  it('enforces pharmacist vs doctor vs receptionist separation', async () => {
    const medId = await createMedication('SepMed');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 20, batchNumber: 'SEP-001', expiryDate: '2028-01-01' },
    ]);
    const patientId = await registerPatient('Roles1', '0745000011');

    // Pharmacist may NOT author a prescription (separation of duty).
    const rxAttempt = await post('/prescriptions', pharmacist, {
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 5 }],
    });
    expect(rxAttempt.statusCode).toBe(403);
    expect(rxAttempt.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);

    // Doctor may NOT dispense (delegated to pharmacy).
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 5 }],
    });
    const dispenseAttempt = await post(
      '/pharmacy/stock/dispense',
      doctor,
      { prescriptionId: prescription.id, branchId: branchA, lines: [{ medicationId: medId, quantity: 5 }] },
    );
    expect(dispenseAttempt.statusCode).toBe(403);
    expect(dispenseAttempt.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);

    // Receptionist may read inventory advisories but never manage stock.
    const alerts = await get('/pharmacy/stock/alerts', receptionist);
    expect(alerts.statusCode).toBe(200);
    const receiveAttempt = await post('/pharmacy/stock/receive', receptionist, {
      branchId: branchA,
      lines: [{ medicationId: medId, quantity: 5, batchNumber: 'SEP-002' }],
    });
    expect(receiveAttempt.statusCode).toBe(403);
  });

  it('replays an Idempotency-Key dispense instead of double-dispensing', async () => {
    const medId = await createMedication('IdemMed');
    await receiveStock(branchA, [
      { medicationId: medId, quantity: 20, batchNumber: 'IDM-001', expiryDate: '2028-01-01' },
    ]);
    const patientId = await registerPatient('Idem1', '0745000012');
    const prescription = await createPrescription({
      patientId,
      branchId: branchA,
      items: [{ medicationId: medId, quantity: 3 }],
    });

    const key = newId();
    const payload = {
      prescriptionId: prescription.id,
      branchId: branchA,
      lines: [{ medicationId: medId, quantity: 1 }],
    };
    const first = await post('/pharmacy/stock/dispense', pharmacist, payload, {
      'idempotency-key': key,
    });
    expect(first.statusCode).toBe(201);

    const replayed = await post('/pharmacy/stock/dispense', pharmacist, payload, {
      'idempotency-key': key,
    });
    // The idempotency contract replays the stored response as a 200 envelope.
    expect(replayed.statusCode).toBe(200);
    expect(replayed.json().success).toBe(true);

    // Only one unit left the shelf despite the replay.
    const batch = await prisma
      .unscoped()
      .stockBatch.findFirstOrThrow({ where: { batchNumber: 'IDM-001', organizationId: orgA } });
    expect(batch.onHand).toBe(19);
  });
});