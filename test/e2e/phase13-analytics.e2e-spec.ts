import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 11 — analytics & reports (repo Phase 13). Acceptance:
 *  1. Daily rollups recompute per (org, day, branch, department) on outbox
 *     events or on demand via POST /analytics/rollups/rebuild.
 *  2. Metrics: time-series + snapshots over a window; labelled aggregation.
 *  3. Bottleneck (ranked stage averages), capacity (peaks, department load,
 *     provider fill, bed occupancy), labelled forecasts per series, weighted
 *     patient-experience composite, staff measurements.
 *  4. Role dashboards return widgets per role.
 *  5. Reports export synchronously as JSON/CSV/PDF with a 24h expiry; the
 *     download endpoint serves the inline artifact; exports list/get.
 *  6. Billing reconciliation surfaces revenue-leakage exceptions with
 *     severity + suggestions and a resolve/acknowledge workflow.
 */
describe('phase13 analytics & reports', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let org: string;
  let user: string;
  let providerId: string;
  let branch: string;
  let department: string;
  let patientA: string;
  let patientB: string;

  const from = '2026-09-01T00:00:00.000Z';
  const to = '2026-09-30T23:59:59.000Z';
  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const perms = ['analytics.read', 'reports.read'];
  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      headers: principalHeaders({ organizationId: org, userId: user, permissions }),
      url: url(path),
      ...(payload ? { payload } : {}),
    });
  const post = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('POST', path, permissions, payload);
  const get = (path: string, permissions: string[]) => request('GET', path, permissions);
  const patch = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('PATCH', path, permissions, payload);

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    org = newId();
    user = newId();
    providerId = newId();
    branch = newId();
    department = newId();
    patientA = newId();
    patientB = newId();

    await sc.organization.create({ data: { id: org, name: 'Phase13 Org' } });
    const userRow = { id: user, organizationId: org, email: 'phase13.user@test.local', firstName: 'Phase', lastName: 'Thirteen', status: 'ACTIVE' as const };
    const providerRow = { id: providerId, organizationId: org, email: 'phase13.provider@test.local', firstName: 'Nancy', lastName: 'Provider', status: 'ACTIVE' as const };
    await sc.user.createMany({ data: [userRow, providerRow] });
    await sc.branch.create({ data: { id: branch, organizationId: org, name: 'Main', code: 'P13' } });
    await sc.department.create({ data: { id: department, organizationId: org, name: 'Outpatient', code: 'OUTP' } });

    await sc.patient.createMany({
      data: [
        {
          id: patientA,
          organizationId: org,
          patientNumber: 'P13-0001',
          firstName: 'Ada',
          lastName: 'Patient',
          dateOfBirth: new Date('1990-01-01T00:00:00.000Z'),
          sex: 'FEMALE',
        },
        {
          id: patientB,
          organizationId: org,
          patientNumber: 'P13-0002',
          firstName: 'Bob',
          lastName: 'Patient',
          dateOfBirth: new Date('1985-05-05T00:00:00.000Z'),
          sex: 'MALE',
        },
      ],
    });

    const dt = (s: string): Date => new Date(s);

    // ── Patient flow ────────────────────────────────────────────────────────
    await sc.visit.createMany({
      data: [
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientA, createdAt: dt('2026-09-02T08:00:00Z'), registeredAt: dt('2026-09-02T08:00:00Z'), providerStartedAt: dt('2026-09-02T09:00:00Z'), status: 'COMPLETED', completedAt: dt('2026-09-02T09:45:00Z') },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientB, createdAt: dt('2026-09-05T09:00:00Z'), registeredAt: dt('2026-09-05T09:00:00Z'), status: 'REGISTERED' },
      ],
    });

    await sc.encounter.createMany({
      data: [
        {
          id: 'enc-hopital-unbilled',
          organizationId: org,
          branchId: branch,
          departmentId: department,
          patientId: patientA,
          providerId,
          openedById: user,
          openedAt: dt('2026-09-02T08:30:00Z'),
          inProgressAt: dt('2026-09-02T09:00:00Z'),
          completedAt: dt('2026-09-02T09:45:00Z'),
          status: 'COMPLETED',
        },
        {
          id: 'enc-open',
          organizationId: org,
          branchId: branch,
          departmentId: department,
          patientId: patientB,
          providerId,
          openedById: user,
          openedAt: dt('2026-09-05T09:15:00Z'),
          status: 'OPEN',
        },
      ],
    });

    await sc.queueEntry.createMany({
      data: [
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientA, queueDate: dt('2026-09-03T00:00:00Z'), prefix: 'A', ticketNumber: 'A-1001', status: 'COMPLETED', enteredAt: dt('2026-09-03T08:00:00Z'), serviceStartedAt: dt('2026-09-03T08:12:00Z'), completedAt: dt('2026-09-03T08:40:00Z'), servedByUserId: user },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientB, queueDate: dt('2026-09-03T00:00:00Z'), prefix: 'A', ticketNumber: 'A-1002', status: 'WAITING', enteredAt: dt('2026-09-03T08:05:00Z') },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientA, queueDate: dt('2026-09-04T00:00:00Z'), prefix: 'A', ticketNumber: 'A-1003', status: 'NO_SHOW', enteredAt: dt('2026-09-04T08:00:00Z'), noShowAt: dt('2026-09-04T09:00:00Z') },
      ],
    });

    await sc.appointment.createMany({
      data: [
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientA, providerId, createdById: user, createdAt: dt('2026-09-01T07:00:00Z'), startsAt: dt('2026-09-03T09:00:00Z'), endsAt: dt('2026-09-03T09:30:00Z'), status: 'BOOKED' },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientA, providerId, createdById: user, createdAt: dt('2026-09-01T07:10:00Z'), startsAt: dt('2026-09-03T09:30:00Z'), endsAt: dt('2026-09-03T10:00:00Z'), status: 'COMPLETED', completedAt: dt('2026-09-03T10:00:00Z') },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientB, providerId, createdById: user, createdAt: dt('2026-09-01T07:20:00Z'), startsAt: dt('2026-09-03T10:00:00Z'), endsAt: dt('2026-09-03T10:30:00Z'), status: 'CANCELLED', cancelledAt: dt('2026-09-02T07:00:00Z'), cancelledById: user },
        { id: newId(), organizationId: org, branchId: branch, departmentId: department, patientId: patientB, providerId, createdById: user, createdAt: dt('2026-09-01T07:30:00Z'), startsAt: dt('2026-09-04T09:00:00Z'), endsAt: dt('2026-09-04T09:30:00Z'), status: 'NO_SHOW', noShowAt: dt('2026-09-04T09:00:00Z') },
      ],
    });

    // ── Clinical ────────────────────────────────────────────────────────────
    await sc.diagnosis.create({
      data: { id: newId(), organizationId: org, patientId: patientA, encounterId: 'enc-hopital-unbilled', providerId, description: 'Malaria', createdAt: dt('2026-09-02T09:30:00Z') },
    });
    await sc.task.create({
      data: { id: newId(), organizationId: org, title: 'Send referral', createdById: user, assignedUserId: user, status: 'DONE', completedAt: dt('2026-09-02T10:30:00Z'), createdAt: dt('2026-09-02T09:00:00Z') },
    });

    // ── Pharmacy / inventory ────────────────────────────────────────────────
    const medId = newId();
    await sc.medication.create({ data: { id: medId, organizationId: org, name: 'Phase13 Amoxicillin', unit: 'tablet', category: 'MEDICATION' } });
    await sc.prescription.create({
      data: {
        id: newId(),
        organizationId: org,
        branchId: branch,
        patientId: patientA,
        providerId,
        status: 'DISPENSED',
        issuedById: user,
        issuedAt: dt('2026-09-02T09:00:00Z'),
        dispensedAt: dt('2026-09-02T11:00:00Z'),
        version: 1,
        items: {
          create: { id: newId(), organizationId: org, medicationId: medId, quantity: 10, dispensedQuantity: 8 },
        },
      },
    });
    await sc.stockBatch.create({
      data: { id: newId(), organizationId: org, branchId: branch, medicationId: medId, batchNumber: 'B-P13-01', onHand: 20, receivedAt: dt('2026-09-02T06:00:00Z') },
    });
    await sc.inventoryLedgerEntry.createMany({
      data: [
        { id: newId(), organizationId: org, branchId: branch, medicationId: medId, batchId: null, operation: 'DISPENSED', quantity: 8, occurredAt: dt('2026-09-02T11:00:00Z') },
        { id: newId(), organizationId: org, branchId: branch, medicationId: medId, batchId: null, operation: 'WASTAGE', quantity: 2, occurredAt: dt('2026-09-02T12:00:00Z') },
      ],
    });

    // ── Laboratory + radiology ──────────────────────────────────────────────
    const labId = newId();
    await sc.labOrder.create({
      data: { id: labId, orderNumber: 'LAB-P13-001', organizationId: org, branchId: branch, patientId: patientA, orderedAt: dt('2026-09-02T09:00:00Z'), orderedById: user, releasedAt: dt('2026-09-02T11:30:00Z'), releasedById: user, version: 1 },
    });
    await sc.labSample.create({
      data: { id: newId(), sampleNumber: 'S-P13-001', organizationId: org, orderId: labId, branchId: branch, patientId: patientA, rejectedAt: null },
    });
    await sc.radiologyOrder.create({
      data: { id: newId(), orderNumber: 'RAD-P13-001', organizationId: org, branchId: branch, patientId: patientB, encounterId: 'enc-open', releasedAt: dt('2026-09-05T14:00:00Z'), releasedById: user, version: 1 },
    });

    // ── Inpatient + emergency ───────────────────────────────────────────────
    const admissionId = 'adm-p13-001';
    await sc.admission.create({
      data: { id: admissionId, admissionNumber: 'ADM-P13-001', organizationId: org, branchId: branch, departmentId: department, patientId: patientB, admittedById: user, admittedAt: dt('2026-09-06T08:00:00Z'), version: 1 },
    });
    await sc.discharge.create({
      data: { id: newId(), organizationId: org, admissionId, dischargedById: user, dischargedAt: dt('2026-09-07T09:00:00Z'), version: 1 },
    });
    await sc.emergencyVisit.createMany({
      data: [
        { id: newId(), visitNumber: 'EV-P13-001', organizationId: org, branchId: branch, patientId: patientA, status: 'ARRIVED', arrivedAt: dt('2026-09-08T07:00:00Z'), version: 1 },
        { id: newId(), visitNumber: 'EV-P13-002', organizationId: org, branchId: branch, patientId: patientB, status: 'TRIAGED', arrivedAt: dt('2026-09-09T07:00:00Z'), triagedAt: dt('2026-09-09T07:20:00Z'), triagedById: user, version: 1 },
      ],
    });

    // Feedback drives the experience composite's feedback component.
    await sc.feedback.create({
      data: { id: newId(), organizationId: org, branchId: branch, patientId: patientA, category: 'SERVICE', rating: 4, createdAt: dt('2026-09-02T12:00:00Z') },
    });

    // ── Billing + reconciliation fixtures ───────────────────────────────────
    // INV-partial: issued 100, paid 60, balanceDue 40 (consistent).
    const invPartial = newId();
    await sc.invoice.create({
      data: { id: invPartial, organizationId: org, branchId: branch, patientId: patientA, invoiceNumber: 'INV-P13-001', status: 'PARTIALLY_PAID', visitId: null, encounterId: null, subtotal: new Prisma.Decimal('100.00'), taxAmount: new Prisma.Decimal('0.00'), discountAmount: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('100.00'), balanceDue: new Prisma.Decimal('40.00'), issuedById: user, issuedAt: dt('2026-09-02T09:00:00Z'), version: 1 },
    });
    await sc.payment.create({
      data: { id: newId(), organizationId: org, invoiceId: invPartial, patientId: patientA, receiptNumber: 'RCP-P13-001', amount: '60.00', method: 'CASH', status: 'COMPLETED', recordedById: user, recordedAt: dt('2026-09-02T09:05:00Z') },
    });

    // INV-overpay: total 20, two 12 payments → overpaid.
    const invOver = newId();
    await sc.invoice.create({
      data: { id: invOver, organizationId: org, branchId: branch, patientId: patientB, invoiceNumber: 'INV-P13-002', status: 'ISSUED', visitId: null, encounterId: null, subtotal: new Prisma.Decimal('20.00'), taxAmount: new Prisma.Decimal('0.00'), discountAmount: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('20.00'), balanceDue: new Prisma.Decimal('0.00'), issuedById: user, issuedAt: dt('2026-09-03T09:00:00Z'), version: 1 },
    });
    await sc.payment.createMany({
      data: [
        { id: newId(), organizationId: org, invoiceId: invOver, patientId: patientB, receiptNumber: 'RCP-P13-002', amount: '12.00', method: 'CASH', status: 'COMPLETED', recordedById: user, recordedAt: dt('2026-09-03T09:10:00Z') },
        { id: newId(), organizationId: org, invoiceId: invOver, patientId: patientB, receiptNumber: 'RCP-P13-003', amount: '12.00', method: 'CASH', status: 'COMPLETED', recordedById: user, recordedAt: dt('2026-09-03T09:15:00Z') },
      ],
    });

    // INV-claim: total/balance 200 with a PAID claim → claim-payment mismatch.
    const invClaim = newId();
    await sc.invoice.create({
      data: { id: invClaim, organizationId: org, branchId: branch, patientId: patientB, invoiceNumber: 'INV-P13-003', status: 'ISSUED', visitId: null, encounterId: null, subtotal: new Prisma.Decimal('200.00'), taxAmount: new Prisma.Decimal('0.00'), discountAmount: new Prisma.Decimal('0.00'), total: new Prisma.Decimal('200.00'), balanceDue: new Prisma.Decimal('200.00'), issuedById: user, issuedAt: dt('2026-09-03T09:00:00Z'), version: 1 },
    });
    const payerId = newId();
    await sc.insurancePayer.create({ data: { id: payerId, organizationId: org, name: 'Phase13 Payer' } });
    const policyId = newId();
    await sc.patientInsurancePolicy.create({
      data: { id: policyId, organizationId: org, patientId: patientB, payerId, policyNumber: 'POL-P13-001', coverageType: 'FULL', coveragePercent: 100, version: 1 },
    });
    await sc.insuranceClaim.create({
      data: { id: newId(), organizationId: org, claimNumber: 'CLM-P13-001', invoiceId: invClaim, policyId, patientId: patientB, amount: '200.00', status: 'PAID', submittedById: user, submittedAt: dt('2026-09-03T09:30:00Z'), approvedById: user, approvedAt: dt('2026-09-04T09:00:00Z'), approvedAmount: '200.00', paidById: user, paidAt: dt('2026-09-05T09:00:00Z'), version: 1 },
    });

    await sc.organizationSetting.create({
      data: {
        id: newId(),
        organizationId: org,
        data: { patientExperience: { weights: { waitingTime: 0.4, feedback: 0.2, appointmentReliability: 0.2, serviceCompletion: 0.2 } } },
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  // ─── Rollups ──────────────────────────────────────────────────────────────

  it('rebuilds the daily rollup across the window', async () => {
    const res = await post('/analytics/rollups/rebuild', perms, { from, to });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.days).toBe(30);
  });

  // ─── Metrics ──────────────────────────────────────────────────────────────

  it('returns windowed metrics from the rollup projection plus snapshots', async () => {
    const res = await get(`/analytics/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.period.from).toBe(from);
    expect(data.series.length).toBeGreaterThanOrEqual(30);
    expect(data.summary.patientVolume).toBeGreaterThanOrEqual(2);
    expect(data.summary.appointmentVolume).toBeGreaterThanOrEqual(4);
    expect(data.summary.revenue).toBe('84.00');
    expect(typeof data.snapshots.outstandingInvoices.balanceDue).toBe('string');
    expect(data.snapshots.medicationWastage).toBeDefined();
  });

  it('forbids analytics without analytics.read', async () => {
    const res = await get('/analytics/metrics', []);
    expect(res.statusCode).toBe(403);
  });

  // ─── Bottleneck + capacity + forecasts + experience + staff ──────────────

  it('ranks bottleneck stages with descriptive averages', async () => {
    const res = await get(`/analytics/bottleneck?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.order).toContain('CONSULTATION');
    const consultation = data.stages.find((s: { key: string }) => s.key === 'CONSULTATION');
    expect(consultation).toBeDefined();
    expect(consultation.samples).toBeGreaterThanOrEqual(1);
    expect(consultation.avgMinutes).toBeCloseTo(45, 1);
  });

  it('exposes capacity peaks, department load, bed occupancy and forecast', async () => {
    const res = await get(`/analytics/capacity?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.peakHours.length).toBeGreaterThan(0);
    expect(data.peakDays.length).toBeGreaterThan(0);
    expect(data.departmentLoad.items).toEqual(
      expect.arrayContaining([expect.objectContaining({ departmentId: department })]),
    );
    expect(data.bedOccupancy).toMatchObject({ occupied: 0, total: 0 });
    expect(data.appointmentDemand.forecast.model.name).toMatch(/seasonal-naive|moving-average/);
    expect(data.appointmentDemand.forecast.points.length).toBe(7);
    expect(data.interpretation.toLowerCase()).toContain('estimate');
  });

  it('serves labelled forecasts for a known series and an unknown-series response', async () => {
    const known = await get(
      `/analytics/forecasts/appointment-demand?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&horizon=7`,
      perms,
    );
    expect(known.statusCode).toBe(200);
    const k = known.json().data;
    expect(k.kind).toBe('forecast');
    expect(k.model.version).toBeDefined();
    expect(k.points).toHaveLength(7);
    expect(k.notes.some((n: string) => n.toLowerCase().includes('estimate'))).toBe(true);

    const unknown = await get(
      `/analytics/forecasts/waitlist-speculative?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}&horizon=3`,
      perms,
    );
    expect(unknown.statusCode).toBe(200);
    expect(unknown.json().data.kind).toBe('forecast');
    expect(unknown.json().data.notes.some((n: string) => n.includes('Unknown forecast series "waitlist-speculative"'))).toBe(true);
  });

  it('computes a weighted patient-experience composite from recorded data', async () => {
    const res = await get(`/analytics/patient-experience?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.weights).toMatchObject({ waitingTime: 0.4, feedback: 0.2 });
    expect(data.components.waitingTime).toBeDefined();
    expect(data.components.feedback.score).toBe(80);
    expect(typeof data.composite).toBe('number');
    expect(data.composite).toBeGreaterThan(0);
  });

  it('returns staff measurements with the employment caveat', async () => {
    const res = await get(`/analytics/staff?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.interpretation.toLowerCase()).toContain('not intended for individual performance');
    const provider = data.items.find((i: { staffId: string }) => i.staffId === providerId);
    expect(provider).toBeDefined();
    expect(provider.encountersOpened).toBeGreaterThanOrEqual(1);
  });

  // ─── Dashboards ───────────────────────────────────────────────────────────

  it('serves role-fitted dashboard widgets', async () => {
    const admin = await get(`/dashboards/admin?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(admin.statusCode).toBe(200);
    const keys = admin.json().data.widgets.map((w: { key: string }) => w.key);
    expect(keys).toContain('patientVolume');
    expect(new Set(keys).size).toBe(keys.length);

    const pharmacy = await get(`/dashboards/pharmacy?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(pharmacy.statusCode).toBe(200);
    expect(pharmacy.json().data.widgets.map((w: { key: string }) => w.key)).toContain('prescriptionsDispensedToday');

    const unsupported = await get('/dashboards/ceo', perms);
    expect(unsupported.statusCode).toBe(400);
  });

  // ─── Reports ──────────────────────────────────────────────────────────────

  it('exports JSON, CSV and PDF reports with a 24h expiry; downloads the artifact', async () => {
    const payload = { reportType: 'OPERATIONS', from, to };
    const json = await post('/reports/export', perms, { ...payload, format: 'JSON' });
    expect(json.statusCode).toBe(201);
    const jsonExport = json.json().data;
    expect(jsonExport.status).toBe('READY');
    expect(jsonExport.contentType).toBe('application/json');
    expect(jsonExport.expiresAt).toBeDefined();

    const csv = await post('/reports/export', perms, { ...payload, format: 'CSV' });
    expect(csv.statusCode).toBe(201);
    expect(csv.json().data.contentType).toBe('text/csv');

    const pdf = await post('/reports/export', perms, { ...payload, format: 'PDF' });
    expect(pdf.statusCode).toBe(201);
    const pdfExport = pdf.json().data;
    expect(pdfExport.contentType).toBe('application/pdf');
    expect(pdfExport.sizeBytes).toBeGreaterThan(0);

    const download = await get(`/reports/exports/${jsonExport.id}/download`, perms);
    expect(download.statusCode).toBe(200);
    expect(download.json().data.artifact.length).toBeGreaterThan(0);
    expect(download.json().data.contentType).toBe('application/json');

    const missing = await get('/reports/exports/00000000-0000-7000-8000-000000000001/download', perms);
    expect(missing.statusCode).toBe(404);
    expect(missing.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);

    const list = await get('/reports/exports?pageSize=50', perms);
    expect(list.statusCode).toBe(200);
    expect(list.json().data.some((r: { id: string }) => r.id === jsonExport.id)).toBe(true);
    expect(list.json().meta.totalPages).toBeGreaterThanOrEqual(1);

    const one = await get(`/reports/exports/${jsonExport.id}`, perms);
    expect(one.statusCode).toBe(200);
    expect(one.json().data.id).toBe(jsonExport.id);
  });

  it('enforces reports.read on report endpoints', async () => {
    const res = await post('/reports/export', ['analytics.read'], { reportType: 'OPERATIONS', format: 'JSON', from, to });
    expect(res.statusCode).toBe(403);
  });

  // ─── Reconciliation ───────────────────────────────────────────────────────

  it('flags revenue-leakage exceptions with severity + suggestions', async () => {
    const res = await post('/reconciliation/run', perms, { from, to });
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.period.from).toBe(from);
    const byType = data.byType as Record<string, number>;
    expect(byType.ENCOUNTER_WITHOUT_INVOICE).toBeGreaterThanOrEqual(1);
    expect(byType.CLAIM_PAYMENT_MISMATCH).toBeGreaterThanOrEqual(1);

    const unbilled = data.findings.find((f: { type: string }) => f.type === 'ENCOUNTER_WITHOUT_INVOICE');
    expect(unbilled.severity).toBe('MEDIUM');
    expect(unbilled.suggestion.length).toBeGreaterThan(0);

    const overpaid = data.findings.find((f: { type: string }) => f.type === 'OVERPAID_INVOICE');
    expect(overpaid).toBeDefined();
    expect(overpaid.severity).toBe('HIGH');
  });

  it('lists exceptions by type/severity and applies the acknowledge/resolve workflow', async () => {
    const list = await get('/reconciliation/exceptions?severity=HIGH&pageSize=50', perms);
    expect(list.statusCode).toBe(200);
    const high = list.json().data as Array<{ severity: 'HIGH' | 'MEDIUM' | 'LOW' }>;
    expect(high.length).toBeGreaterThanOrEqual(1);
    expect(high.every((e) => e.severity === 'HIGH')).toBe(true);

    const open = await get('/reconciliation/exceptions?status=OPEN&pageSize=1', perms);
    expect(open.statusCode).toBe(200);
    const [exception] = open.json().data as [{ id: string; status: 'OPEN' }];
    expect(exception).toBeDefined();

    const ack = await patch(`/reconciliation/exceptions/${exception.id}`, perms, { status: 'ACKNOWLEDGED' });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().data.status).toBe('ACKNOWLEDGED');

    const resolve = await patch(`/reconciliation/exceptions/${exception.id}`, perms, { status: 'RESOLVED' });
    expect(resolve.statusCode).toBe(200);

    // a resolved exception cannot be re-opened as acknowledged
    const reack = await patch(`/reconciliation/exceptions/${exception.id}`, perms, { status: 'ACKNOWLEDGED' });
    expect(reack.statusCode).toBe(409);
    expect(reack.json().error.code).toBe(ErrorCodes.RECONCILIATION_ALREADY_RESOLVED);
  });
});