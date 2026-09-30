import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { Prisma } from '@prisma/client';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';
import { expectRenderedPdf } from '../support/pdf';

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
  let publisher: OutboxPublisherService;
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
    publisher = app.get(OutboxPublisherService);
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

  it('reports emergency intake-request acknowledgement, escalation and dispatch latency', async () => {
    // P9. Seeded directly because the point here is the metric's shape and
    // arithmetic over varied request states, not the public intake flow (which
    // emergency-intake.e2e-spec.ts already drives end to end).
    const sc = prisma.unscoped();
    const dt = (s: string): Date => new Date(s);
    // 2-minute first escalation level, so "past SLA" is measurable.
    await sc.emergencyIntakePolicy.create({
      data: { id: newId(), organizationId: org, branchId: branch, enabled: true, levelSeconds: [120, 300, 900] },
    });

    let seq = 0;
    const base = { organizationId: org, branchId: branch };
    // referenceNumber/trackingTokenHash are unique per request, so each row gets
    // its own; the values are synthetic and carry no caller PII.
    const row = (over: Record<string, Date | string | number>): Prisma.EmergencyRequestCreateManyInput => {
      seq += 1;
      return {
        id: newId(),
        ...base,
        referenceNumber: `EMR-2026-${String(seq).padStart(6, '0')}`,
        trackingTokenHash: `hash-${seq}`,
        status: 'RECEIVED',
        escalationLevel: 0,
        ...over,
      };
    };

    await sc.emergencyRequest.createMany({
      data: [
        // Two prompt acknowledgements (1 and 3 minutes) and one that took 40.
        row({ createdAt: dt('2026-09-10T10:00:00Z'), acknowledgedAt: dt('2026-09-10T10:01:00Z'), status: 'ACKNOWLEDGED' }),
        row({ createdAt: dt('2026-09-10T11:00:00Z'), acknowledgedAt: dt('2026-09-10T11:03:00Z'), status: 'ACKNOWLEDGED' }),
        row({ createdAt: dt('2026-09-10T12:00:00Z'), acknowledgedAt: dt('2026-09-10T12:40:00Z'), status: 'ACKNOWLEDGED' }),
        // Acknowledged then dispatched: 12 minutes end to end, 9 of them after the ack.
        row({
          createdAt: dt('2026-09-11T09:00:00Z'),
          acknowledgedAt: dt('2026-09-11T09:03:00Z'),
          respondedAt: dt('2026-09-11T09:12:00Z'),
          status: 'RESPONDING',
        }),
        // Escalated twice, never acknowledged.
        row({ createdAt: dt('2026-09-11T14:00:00Z'), escalationLevel: 2, status: 'ESCALATED' }),
        // Cancelled by the caller; help was not needed.
        row({ createdAt: dt('2026-09-12T08:00:00Z'), cancelledAt: dt('2026-09-12T08:00:20Z'), status: 'CANCELLED' }),
        // Closed after a response.
        row({
          createdAt: dt('2026-09-12T09:00:00Z'),
          acknowledgedAt: dt('2026-09-12T09:02:00Z'),
          respondedAt: dt('2026-09-12T09:05:00Z'),
          closedAt: dt('2026-09-12T11:00:00Z'),
          status: 'CLOSED',
        }),
        // Still open and unacknowledged, old enough to be past the 2-minute SLA.
        row({ createdAt: dt('2026-09-12T10:00:00Z'), status: 'RECEIVED' }),
      ],
    });

    const res = await get(`/analytics/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`, perms);
    expect(res.statusCode).toBe(200);
    const m = res.json().data.snapshots.emergencyRequests;

    // The window is keyed on createdAt, so all eight are in scope.
    expect(m.received).toBe(8);
    expect(m.acknowledged).toBe(5);
    expect(m.dispatched).toBe(2);
    expect(m.cancelled).toBe(1);
    expect(m.closed).toBe(1);
    expect(m.escalated).toBe(1);
    expect(m.acknowledgementRate).toBe(62.5);

    // Acknowledgement latencies are 1, 3, 40, 2, 3 minutes.
    expect(m.timeToAcknowledge.samples).toBe(5);
    expect(m.timeToAcknowledge.p50Minutes).toBe(3);
    // The 40-minute outlier is the reason max is published: a mean of 9.8
    // minutes would have hidden it entirely.
    expect(m.timeToAcknowledge.maxMinutes).toBe(40);

    // Dispatch latency is over dispatched requests only: 12 and 5 minutes.
    // Nearest-rank p50 on an even-sized sample is the lower middle value, so this
    // is 5 rather than the 8.5 an interpolating percentile would report. The
    // choice is deliberate: a percentile should only ever name a latency that
    // actually occurred.
    expect(m.timeToDispatch.samples).toBe(2);
    expect(m.timeToDispatch.p50Minutes).toBe(5);
    expect(m.timeToDispatch.maxMinutes).toBe(12);
    // The ack→respond leg excludes the wait for someone to pick up the phone:
    // 9 minutes (12 − 3) and 3 minutes (5 − 2), so p50 is the lower of the two.
    expect(m.ackToDispatch.samples).toBe(2);
    expect(m.ackToDispatch.p50Minutes).toBe(3);
    expect(m.ackToDispatch.maxMinutes).toBe(9);

    expect(m.byEscalationLevel).toEqual([{ level: 2, count: 1 }]);
    expect(m.byBranch).toEqual([{ branchId: branch, received: 8, escalated: 1 }]);

    // Point-in-time, and note that the ESCALATED-never-acknowledged row counts
    // as unacknowledged: a request that escalated past every level without
    // anyone picking it up is the single most urgent thing in this system, so it
    // must not be hidden inside the "escalated" bucket.
    expect(m.unacknowledgedNow).toBe(2);
    // Both unacknowledged rows are far past the 2-minute first escalation level.
    expect(m.unacknowledgedPastSlaNow).toBe(2);
    expect(m.awaitingDispatchNow).toBe(3);
    // Open = everything except the cancelled and closed rows.
    expect(m.openNow).toBe(6);
    // The walk-in population stays separate rather than sharing a denominator.
    expect(typeof m.walkInArrivalsInWindow).toBe('number');
    expect(typeof m.label).toBe('string');
  });

  it('reports empty emergency request metrics as nulls, not zeros', async () => {
    // A tenant with intake disabled must not look like it answered instantly.
    const freshOrg = newId();
    const freshBranch = newId();
    const sc = prisma.unscoped();
    await sc.organization.create({ data: { id: freshOrg, name: 'No Intake Org' } });
    await sc.branch.create({ data: { id: freshBranch, organizationId: freshOrg, name: 'Solo', code: 'NONE' } });

    const res = await app.inject({
      method: 'GET',
      headers: principalHeaders({ organizationId: freshOrg, userId: user, permissions: perms }),
      url: url(`/analytics/metrics?from=${encodeURIComponent(from)}&to=${encodeURIComponent(to)}`),
    });
    expect(res.statusCode).toBe(200);
    const m = res.json().data.snapshots.emergencyRequests;
    expect(m.received).toBe(0);
    expect(m.acknowledgementRate).toBeNull();
    expect(m.timeToDispatch.p50Minutes).toBeNull();
    expect(m.openNow).toBe(0);
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

  it('requests exports asynchronously, generates them off the request path, and streams the artifact', async () => {
    const payload = { reportType: 'OPERATIONS', from, to };

    // 202 + PENDING: the request records the work and returns. Nothing is
    // rendered here, which is the point — a wide report is no longer bounded by
    // the caller's HTTP timeout.
    const json = await post('/reports/export', perms, { ...payload, format: 'JSON' });
    expect(json.statusCode).toBe(202);
    const jsonExport = json.json().data;
    expect(jsonExport.status).toBe('PENDING');
    expect(jsonExport.contentType).toBe('application/json');
    expect(jsonExport.expiresAt).toBeDefined();
    expect(jsonExport.artifactKey).toBeUndefined();

    const pdf = await post('/reports/export', perms, { ...payload, format: 'PDF' });
    expect(pdf.statusCode).toBe(202);
    const pdfExport = pdf.json().data;
    expect(pdfExport.status).toBe('PENDING');

    // Downloading a pending export is a conflict that names the next action, not
    // a 404 and not an empty body.
    const premature = await get(`/reports/exports/${pdfExport.id}/download`, perms);
    expect(premature.statusCode).toBe(409);
    expect(premature.json().error.message).toMatch(/still being generated/i);

    let guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;

    const ready = await get(`/reports/exports/${pdfExport.id}`, perms);
    expect(ready.statusCode).toBe(200);
    expect(ready.json().data.status).toBe('READY');
    expect(ready.json().data.sizeBytes).toBeGreaterThan(0);
    expect(ready.json().data.completedAt).not.toBeNull();

    // Binary, streamed: not the JSON envelope the old endpoint returned.
    const pdfDownload = await get(`/reports/exports/${pdfExport.id}/download`, perms);
    expect(pdfDownload.statusCode).toBe(200);
    expect(pdfDownload.headers['content-type']).toBe('application/pdf');
    expect(pdfDownload.headers['content-disposition']).toMatch(/attachment; filename="operations-/);
    // Patient data must not be left in a shared cache or a proxy.
    expect(pdfDownload.headers['cache-control']).toBe('private, no-store');
    const pdfBytes = expectRenderedPdf(pdfDownload.rawPayload);
    // The recorded size is the real file length, and the body actually sent.
    expect(pdfBytes.length).toBe(ready.json().data.sizeBytes);
    expect(Number(pdfDownload.headers['content-length'])).toBe(pdfBytes.length);

    // JSON export end to end.
    const jsonReady = await get(`/reports/exports/${jsonExport.id}`, perms);
    expect(jsonReady.json().data.status).toBe('READY');
    const jsonDownload = await get(`/reports/exports/${jsonExport.id}/download`, perms);
    expect(jsonDownload.statusCode).toBe(200);
    expect(jsonDownload.headers['content-type']).toBe('application/json');
    expect(JSON.parse(jsonDownload.rawPayload.toString('utf8')).rows.length).toBeGreaterThan(0);

    const csv = await post('/reports/export', perms, { ...payload, format: 'CSV' });
    expect(csv.statusCode).toBe(202);
    guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;
    const csvDownload = await get(`/reports/exports/${csv.json().data.id}/download`, perms);
    expect(csvDownload.statusCode).toBe(200);
    expect(csvDownload.headers['content-type']).toBe('text/csv');

    // The row keeps only a key, never the bytes.
    const stored = await prisma.unscoped().reportExport.findUniqueOrThrow({
      where: { id: pdfExport.id },
    });
    expect(stored.artifactKey).toBe(`reports/${org}/${pdfExport.id}.pdf`);
    expect(stored.artifactKey).not.toBeNull();

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

  it('refuses a download from another organization', async () => {
    // The stream is served through the API precisely so the tenant check still
    // applies to the bytes; a presigned URL would have bypassed it.
    const requested = await post(
      '/reports/export',
      perms,
      { reportType: 'OPERATIONS', from, to, format: 'JSON' },
    );
    let guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;
    const id = requested.json().data.id;

    const otherOrg = newId();
    const otherUser = newId();
    await prisma.unscoped().organization.create({ data: { id: otherOrg, name: 'Other Org' } });
    await prisma.unscoped().user.create({
      data: {
        id: otherUser,
        organizationId: otherOrg,
        email: `other.${otherUser}@test.local`,
        firstName: 'Other',
        lastName: 'Org',
        status: 'ACTIVE',
      },
    });
    const res = await app.inject({
      method: 'GET',
      url: url(`/reports/exports/${id}/download`),
      headers: {
        'x-careos-test-org': otherOrg,
        'x-careos-test-user': otherUser,
        'x-careos-test-permissions': perms.join(','),
        'x-request-id': 'test-request',
      },
    });
    expect(res.statusCode).toBe(404);
  });

  it('records a failed export instead of retrying it forever', async () => {
    // Drive the failure path directly: a payload the renderer cannot draw is
    // awkward to produce through the public API, and the behaviour under test
    // is what the consumer records when generation throws.
    const { ReportsService } = await import('../../src/modules/insights/reports.service');
    const reports = app.get(ReportsService);
    const requested = await post(
      '/reports/export',
      perms,
      { reportType: 'OPERATIONS', from, to, format: 'JSON' },
    );
    const id = requested.json().data.id;

    await reports.failGeneration(id, org, 'font cannot render U+4E2D (a table cell)');

    const failed = await get(`/reports/exports/${id}`, perms);
    expect(failed.json().data.status).toBe('FAILED');
    expect(failed.json().data.error).toBe('font cannot render U+4E2D (a table cell)');
    // And it is not downloadable, with a state-specific message.
    const download = await get(`/reports/exports/${id}/download`, perms);
    expect(download.statusCode).toBe(409);
    expect(download.json().error.message).toMatch(/failed/i);

    // A FAILED row must not be picked up and re-rendered by a later tick.
    let guard = 0;
    while ((await publisher.publishReadyEvents(100)) > 0 && guard < 20) guard += 1;
    const still = await get(`/reports/exports/${id}`, perms);
    expect(still.json().data.status).toBe('FAILED');
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