import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 6 (laboratory & radiology). Acceptance coverage:
 *  1. Catalog: categories + tests with org-configured reference/critical
 *     ranges; string wire format (ADR-029); duplicates + optimistic locking.
 *  2. Full lab lifecycle ORDERED → … → RELEASED with a mirrored sample.
 *  3. Results cannot be released before verification (LAB_RESULT_NOT_VERIFIED).
 *  4. Critical results block release until acknowledged
 *     (LAB_RESULT_NOT_ACKNOWLEDGED); acknowledgement is idempotent.
 *  5. Post-release amendments create a new revision (trail preserved).
 *  6. Sample rejection + linked recollection; reject only from collected.
 *  7. Result entry completeness (every active field required).
 *  8. Turnaround-time aggregation.
 *  9. Radiology lifecycle + report verification gate + cancel window.
 * 10. Role separation and cross-tenant isolation.
 */
describe('phase7 laboratory & radiology', () => {
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

  const labTech = [
    'patients.read',
    'lab.read',
    'lab.order',
    'lab.collect',
    'lab.process',
    'lab.verify',
    'lab.release',
    'lab.acknowledge',
  ];
  const nurse = ['patients.read', 'lab.read', 'lab.collect'];
  const doctor = ['patients.read', 'lab.read', 'lab.order'];
  const radTech = [
    'patients.read',
    'radiology.read',
    'radiology.order',
    'radiology.process',
    'radiology.verify',
    'radiology.release',
  ];
  const auditor = ['patients.read', 'lab.read', 'radiology.read'];
  const noLab = ['patients.read'];

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post('/patients', ['patients.create'], {
      firstName,
      lastName: 'Phase7',
      phone,
      dateOfBirth: '1990-01-01',
      sex: 'FEMALE',
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const createTest = async (
    code: string,
    name: string,
    fields: Array<Record<string, unknown>>,
    opts: Record<string, unknown> = {},
  ): Promise<{ id: string; version: number; fields: Array<{ id: string; name: string }> }> => {
    const res = await post('/lab/tests', labTech, { code, name, fields, ...opts });
    expect(res.statusCode).toBe(201);
    return res.json().data.test;
  };

  const createOrder = async (
    patientId: string,
    testIds: string[],
    opts: Record<string, unknown> = {},
  ) => {
    const res = await post('/lab/orders', labTech, {
      patientId,
      branchId: branchA,
      testIds,
      ...opts,
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.order;
  };

  const advanceToProcessing = async (orderId: string) => {
    for (const step of ['collect', 'receive', 'process'] as const) {
      const res = await post(`/lab/orders/${orderId}/${step}`, labTech, {});
      expect(res.statusCode).toBe(201);
    }
  };

  const enterResults = async (orderId: string, results: Array<Record<string, unknown>>) => {
    const res = await post(`/lab/orders/${orderId}/results`, labTech, { results });
    expect(res.statusCode).toBe(201);
    return res.json().data.order;
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase7 Org A' } });
    await sc.user.create({
      data: {
        id: userA,
        organizationId: orgA,
        email: 'phase7.user@test.local',
        firstName: 'Phase',
        lastName: 'Seven',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH7A' } });

    orgB = newId();
    userB = newId();
    await sc.organization.create({ data: { id: orgB, name: 'Phase7 Org B' } });
    await sc.user.create({
      data: {
        id: userB,
        organizationId: orgB,
        email: 'phase7.userb@test.local',
        firstName: 'Phase',
        lastName: 'SevenB',
        status: 'ACTIVE',
      },
    });
    branchB = newId();
    await sc.branch.create({ data: { id: branchB, organizationId: orgB, name: 'Main', code: 'PH7B' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 1. catalog -------------------------------------------------------------

  it('manages the lab catalog with configured ranges and optimistic locking', async () => {
    const category = await post('/lab/categories', labTech, {
      name: 'Haematology',
      description: 'Blood counts',
    });
    expect(category.statusCode).toBe(201);
    const categoryId = category.json().data.category.id;

    const dupCat = await post('/lab/categories', labTech, { name: 'Haematology' });
    expect(dupCat.statusCode).toBe(409);
    expect(dupCat.json().error.code).toBe(ErrorCodes.CONFLICT);

    const test = await createTest(
      'FBC',
      'Full Blood Count',
      [
        { name: 'Haemoglobin', fieldType: 'NUMERIC', unit: 'g/dL', referenceMin: '12', referenceMax: '17', criticalMin: '7', criticalMax: '20' },
        { name: 'Comment', fieldType: 'TEXT' },
      ],
      { categoryId },
    );
    expect(test.fields).toHaveLength(2);

    const listed = await get('/lab/tests?active=true', labTech);
    expect(listed.statusCode).toBe(200);
    const rows = listed.json().data as Array<{ code: string; fields: Array<{ referenceMin: string | null }> }>;
    const found = rows.find((r) => r.code === 'FBC');
    expect(found).toBeDefined();
    // Decimal thresholds are strings on the wire (ADR-029).
    expect(typeof found?.fields[0]?.referenceMin).toBe('string');

    const dupTest = await post('/lab/tests', labTech, {
      code: 'FBC',
      name: 'Duplicate',
      fields: [{ name: 'X', fieldType: 'TEXT' }],
    });
    expect(dupTest.statusCode).toBe(409);

    const updated = await patch(`/lab/tests/${test.id}`, labTech, { name: 'FBC Panel', version: 1 });
    expect(updated.statusCode).toBe(200);
    expect(updated.json().data.test.version).toBe(2);

    const stale = await patch(`/lab/tests/${test.id}`, labTech, { name: 'Stale', version: 1 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.OPTIMISTIC_LOCK_CONFLICT);

    const field = await patch(
      `/lab/tests/${test.id}/fields/${test.fields[0]?.id}`,
      labTech,
      { criticalMax: '25' },
    );
    expect(field.statusCode).toBe(200);
    expect(field.json().data.field.criticalMax).toBe('25');
  });

  // --- 2. full lifecycle ------------------------------------------------------

  it('runs the full lab lifecycle and mirrors the sample', async () => {
    const test = await createTest('GLU', 'Glucose', [
      { name: 'Glucose', fieldType: 'NUMERIC', unit: 'mmol/L', referenceMin: '4', referenceMax: '6', criticalMin: '2', criticalMax: '10' },
    ]);
    const patientId = await registerPatient('LifeOne', '0766000001');

    const order = await createOrder(patientId, [test.id]);
    expect(order.status).toBe('ORDERED');
    expect(order.orderNumber).toMatch(/^LAB-ORD-\d{4}-\d{6}$/);
    expect(order.sample).not.toBeNull();
    expect(order.sample.sampleNumber).toMatch(/^LAB-SMP-\d{4}-\d{6}$/);
    expect(order.sample.status).toBe('ORDERED');

    const collected = await post(`/lab/orders/${order.id}/collect`, labTech, {});
    expect(collected.json().data.order.status).toBe('COLLECTED');
    expect(collected.json().data.order.sample.status).toBe('COLLECTED');
    expect(collected.json().data.order.sample.collectedById).toBe(userA);

    const received = await post(`/lab/orders/${order.id}/receive`, labTech, {});
    expect(received.json().data.order.status).toBe('RECEIVED');
    const processedRes = await post(`/lab/orders/${order.id}/process`, labTech, {});
    expect(processedRes.json().data.order.status).toBe('PROCESSING');
    const processed = await get(`/lab/orders/${order.id}`, labTech);
    expect(processed.json().data.order.status).toBe('PROCESSING');
    expect(processed.json().data.order.sample.status).toBe('PROCESSING');

    const resultField = (await get(`/lab/tests?active=true`, labTech))
      .json()
      .data.find((t: { code: string }) => t.code === 'GLU').fields[0].id;

    const ready = await enterResults(order.id, [{ testFieldId: resultField, value: '5.2' }]);
    expect(ready.status).toBe('RESULT_READY');
    expect(ready.sample.status).toBe('COMPLETED');
    expect(ready.items[0].results[0].value).toBe('5.2');
    expect(ready.items[0].results[0].isAbnormal).toBe(false);
    expect(ready.items[0].results[0].isCritical).toBe(false);

    const verified = await post(`/lab/orders/${order.id}/verify`, labTech, {});
    expect(verified.json().data.order.status).toBe('VERIFIED');

    const released = await post(`/lab/orders/${order.id}/release`, labTech, {});
    expect(released.statusCode).toBe(201);
    expect(released.json().data.order.status).toBe('RELEASED');
    expect(released.json().data.order.releasedById).toBe(userA);
  });

  // --- 3. release requires verification ---------------------------------------

  it('blocks release until results are verified', async () => {
    const test = await createTest('UNV', 'Unverified', [{ name: 'Value', fieldType: 'TEXT' }]);
    const patientId = await registerPatient('UnvOne', '0766000002');
    const order = await createOrder(patientId, [test.id]);
    await advanceToProcessing(order.id);
    const fieldId = (await get('/lab/tests?active=true', labTech))
      .json()
      .data.find((t: { code: string }) => t.code === 'UNV').fields[0].id;
    await enterResults(order.id, [{ testFieldId: fieldId, value: 'ok' }]);

    const released = await post(`/lab/orders/${order.id}/release`, labTech, {});
    expect(released.statusCode).toBe(409);
    expect(released.json().error.code).toBe(ErrorCodes.LAB_RESULT_NOT_VERIFIED);
  });

  // --- 4. critical gating + acknowledgement -----------------------------------

  it('gates release on critical acknowledgement (idempotent)', async () => {
    const test = await createTest('CRIT', 'Critical Marker', [
      { name: 'Marker', fieldType: 'NUMERIC', referenceMin: '4', referenceMax: '6', criticalMin: '2', criticalMax: '10' },
    ]);
    const patientId = await registerPatient('CritOne', '0766000003');
    const order = await createOrder(patientId, [test.id]);
    await advanceToProcessing(order.id);
    const fieldId = (await get('/lab/tests?active=true', labTech))
      .json()
      .data.find((t: { code: string }) => t.code === 'CRIT').fields[0].id;

    const ready = await enterResults(order.id, [{ testFieldId: fieldId, value: '11' }]);
    expect(ready.items[0].results[0].isCritical).toBe(true);
    expect(ready.criticalResults).toHaveLength(1);
    const criticalId = ready.criticalResults[0].id;

    await post(`/lab/orders/${order.id}/verify`, labTech, {});
    const blocked = await post(`/lab/orders/${order.id}/release`, labTech, {});
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe(ErrorCodes.LAB_RESULT_NOT_ACKNOWLEDGED);

    const ack = await post(`/lab/critical/${criticalId}/acknowledge`, labTech, {});
    expect(ack.statusCode).toBe(201);
    expect(ack.json().data.criticalResult.acknowledgedAt).not.toBeNull();

    const replay = await post(`/lab/critical/${criticalId}/acknowledge`, labTech, {});
    expect(replay.statusCode).toBe(201);
    expect(replay.json().data.criticalResult.acknowledgedById).toBe(userA);

    const released = await post(`/lab/orders/${order.id}/release`, labTech, {});
    expect(released.statusCode).toBe(201);
    expect(released.json().data.order.status).toBe('RELEASED');
  });

  // --- 5. amendments ----------------------------------------------------------

  it('creates a new revision when a released result is amended', async () => {
    const test = await createTest('AMD', 'Amendable', [
      { name: 'Value', fieldType: 'NUMERIC', referenceMin: '0', referenceMax: '100' },
    ]);
    const patientId = await registerPatient('AmdOne', '0766000004');
    const order = await createOrder(patientId, [test.id]);
    await advanceToProcessing(order.id);
    const fieldId = (await get('/lab/tests?active=true', labTech))
      .json()
      .data.find((t: { code: string }) => t.code === 'AMD').fields[0].id;
    const ready = await enterResults(order.id, [{ testFieldId: fieldId, value: '50' }]);
    const resultId = ready.items[0].results[0].id;
    await post(`/lab/orders/${order.id}/verify`, labTech, {});
    await post(`/lab/orders/${order.id}/release`, labTech, {});

    const amended = await patch(`/lab/results/${resultId}`, labTech, {
      value: '75',
      reason: 'Corrected transcription error',
    });
    expect(amended.statusCode).toBe(200);
    const result = amended.json().data.result;
    expect(result.currentVersion).toBe(2);
    expect(result.value).toBe('75');
    expect(result.amendments).toBe(1);
  });

  // --- 6. rejection + recollection --------------------------------------------

  it('rejects a sample and links the recollection', async () => {
    const test = await createTest('REC', 'Recollect', [{ name: 'Value', fieldType: 'TEXT' }]);
    const patientId = await registerPatient('RecOne', '0766000005');
    const order = await createOrder(patientId, [test.id]);
    await post(`/lab/orders/${order.id}/collect`, labTech, {});

    const rejected = await post(`/lab/orders/${order.id}/reject`, labTech, {
      reason: 'Haemolysed specimen',
    });
    expect(rejected.statusCode).toBe(201);
    const rejectedOrder = rejected.json().data.order;
    expect(rejectedOrder.status).toBe('REJECTED');
    expect(rejectedOrder.sample.status).toBe('REJECTED');
    const rejectedSampleId = rejectedOrder.sample.id;

    const redo = await post('/lab/orders', labTech, {
      patientId,
      branchId: branchA,
      testIds: [test.id],
      recollectFromSampleId: rejectedSampleId,
    });
    expect(redo.statusCode).toBe(201);
    expect(redo.json().data.order.sample.recollectsFromOrderId).toBe(rejectedOrder.id);

    // A non-rejected sample cannot be a recollection source.
    const fresh = await createOrder(patientId, [test.id]);
    const badRecollect = await post('/lab/orders', labTech, {
      patientId,
      branchId: branchA,
      testIds: [test.id],
      recollectFromSampleId: fresh.sample.id,
    });
    expect(badRecollect.statusCode).toBe(400);

    // Rejecting an ORDERED (uncollected) order is invalid.
    const noReject = await post(`/lab/orders/${fresh.id}/reject`, labTech, { reason: 'nope' });
    expect(noReject.statusCode).toBe(409);
  });

  // --- 7. completeness --------------------------------------------------------

  it('requires every active field before results are accepted', async () => {
    const test = await createTest('CMP', 'Completeness', [
      { name: 'A', fieldType: 'TEXT' },
      { name: 'B', fieldType: 'TEXT' },
    ]);
    const patientId = await registerPatient('CmpOne', '0766000006');
    const order = await createOrder(patientId, [test.id]);
    await advanceToProcessing(order.id);
    const fields = (await get('/lab/tests?active=true', labTech))
      .json()
      .data.find((t: { code: string }) => t.code === 'CMP').fields;

    const partial = await post(`/lab/orders/${order.id}/results`, labTech, {
      results: [{ testFieldId: fields[0].id, value: 'a' }],
    });
    expect(partial.statusCode).toBe(400);

    const full = await post(`/lab/orders/${order.id}/results`, labTech, {
      results: [
        { testFieldId: fields[0].id, value: 'a' },
        { testFieldId: fields[1].id, value: 'b' },
      ],
    });
    expect(full.statusCode).toBe(201);
    expect(full.json().data.order.status).toBe('RESULT_READY');
  });

  // --- 8. turnaround time -----------------------------------------------------

  it('reports turnaround-time aggregation for released orders', async () => {
    const res = await get('/lab/tat', labTech);
    expect(res.statusCode).toBe(200);
    const stats = res.json().data as {
      overall: { count: number; avgMinutes: number };
      byTest: Array<{ testId: string; count: number }>;
    };
    expect(stats.overall.count).toBeGreaterThan(0);
    expect(stats.overall.avgMinutes).toBeGreaterThanOrEqual(0);
    expect(stats.byTest.length).toBeGreaterThan(0);
  });

  // --- 9. radiology -----------------------------------------------------------

  it('runs the radiology lifecycle with a report verification gate', async () => {
    const patientId = await registerPatient('RadOne', '0766000007');

    const created = await post('/radiology/orders', radTech, {
      patientId,
      branchId: branchA,
      modality: 'XRAY',
      region: 'Chest',
    });
    expect(created.statusCode).toBe(201);
    const order = created.json().data.order;
    expect(order.status).toBe('ORDERED');
    expect(order.orderNumber).toMatch(/^RAD-\d{4}-\d{6}$/);

    const scheduled = await post(`/radiology/orders/${order.id}/schedule`, radTech, {});
    expect(scheduled.json().data.order.status).toBe('SCHEDULED');
    const performed = await post(`/radiology/orders/${order.id}/perform`, radTech, {});
    expect(performed.json().data.order.status).toBe('PERFORMED');
    expect(performed.json().data.order.performedById).toBe(userA);

    const reported = await post(`/radiology/orders/${order.id}/report`, radTech, {
      findings: 'No acute cardiopulmonary process.',
      impression: 'Normal chest radiograph.',
    });
    expect(reported.json().data.order.status).toBe('REPORTED');
    expect(reported.json().data.order.report.findings).toContain('No acute');

    // Cannot release before verification.
    const early = await post(`/radiology/orders/${order.id}/release`, radTech, {});
    expect(early.statusCode).toBe(409);

    const verified = await post(`/radiology/orders/${order.id}/verify`, radTech, {});
    expect(verified.json().data.order.status).toBe('VERIFIED');
    expect(verified.json().data.order.report.verifiedById).toBe(userA);

    const released = await post(`/radiology/orders/${order.id}/release`, radTech, {});
    expect(released.json().data.order.status).toBe('RELEASED');
  });

  it('cancels radiology orders only while ordered/scheduled', async () => {
    const patientId = await registerPatient('RadTwo', '0766000008');
    const created = await post('/radiology/orders', radTech, {
      patientId,
      branchId: branchA,
      modality: 'CT',
    });
    const orderId = created.json().data.order.id;
    const cancelled = await post(`/radiology/orders/${orderId}/cancel`, radTech, { reason: 'Duplicate' });
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.order.status).toBe('CANCELLED');

    const other = await post('/radiology/orders', radTech, { patientId, branchId: branchA, modality: 'MRI' });
    const otherId = other.json().data.order.id;
    await post(`/radiology/orders/${otherId}/schedule`, radTech, {});
    await post(`/radiology/orders/${otherId}/perform`, radTech, {});
    const late = await post(`/radiology/orders/${otherId}/cancel`, radTech, { reason: 'late' });
    expect(late.statusCode).toBe(409);
  });

  // --- 10. roles & tenancy ----------------------------------------------------

  it('enforces lab/radiology role separation', async () => {
    const test = await createTest('ROLE', 'Role Check', [{ name: 'Value', fieldType: 'TEXT' }]);
    const patientId = await registerPatient('RolOne', '0766000009');
    const order = await createOrder(patientId, [test.id]);

    // Nurse can collect but not verify/release or process.
    const nurseCollect = await post(`/lab/orders/${order.id}/collect`, nurse, {});
    expect(nurseCollect.statusCode).toBe(201);
    const nurseVerify = await post(`/lab/orders/${order.id}/verify`, nurse, {});
    expect(nurseVerify.statusCode).toBe(403);
    expect(nurseVerify.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);

    // Doctor can order but not collect/process.
    const doctorOrder = await post('/lab/orders', doctor, {
      patientId,
      branchId: branchA,
      testIds: [test.id],
    });
    expect(doctorOrder.statusCode).toBe(201);
    const doctorCollect = await post(`/lab/orders/${order.id}/receive`, doctor, {});
    expect(doctorCollect.statusCode).toBe(403);

    // Auditor: read-only.
    const read = await get(`/lab/orders/${order.id}`, auditor);
    expect(read.statusCode).toBe(200);
    const auditWrite = await post(`/lab/orders/${order.id}/process`, auditor, {});
    expect(auditWrite.statusCode).toBe(403);
    const radRead = await get('/radiology/orders', auditor);
    expect(radRead.statusCode).toBe(200);

    // No lab permission at all.
    expect((await get(`/lab/orders/${order.id}`, noLab)).statusCode).toBe(403);
    expect((await get('/lab/tat', noLab)).statusCode).toBe(403);
  });

  it('isolates tenants: another org lab order is invisible', async () => {
    const otherPatient = newId();
    await prisma.unscoped().patient.create({
      data: {
        id: otherPatient,
        organizationId: orgB,
        patientNumber: 'P7B-0001',
        firstName: 'B',
        lastName: 'B',
      },
    });
    const testB = await prisma.unscoped().labTest.create({
      data: {
        id: newId(),
        organizationId: orgB,
        code: 'B7',
        name: 'Org B test',
        sampleType: 'BLOOD',
        fields: {
          create: [{ id: newId(), organizationId: orgB, name: 'Value', fieldType: 'TEXT' }],
        },
      },
    });
    const createdB = await app.inject({
      method: 'POST',
      headers: principalHeaders({
        organizationId: orgB,
        userId: userB,
        permissions: ['lab.order', 'lab.read'],
      }),
      url: url('/lab/orders'),
      payload: { patientId: otherPatient, branchId: branchB, testIds: [testB.id] },
    });
    expect(createdB.statusCode).toBe(201);
    const orderId = createdB.json().data.order.id;

    const scoped = await get(`/lab/orders/${orderId}`, labTech);
    expect(scoped.statusCode).toBe(404);
    expect(scoped.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);

    const advance = await post(`/lab/orders/${orderId}/collect`, labTech, {});
    expect(advance.statusCode).toBe(404);
  });
});
