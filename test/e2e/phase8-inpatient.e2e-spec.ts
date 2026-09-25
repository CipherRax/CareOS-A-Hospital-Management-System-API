import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 8 (inpatient & emergency). Acceptance coverage:
 *  1. Ward → room → bed hierarchy; duplicate wards; bed manual statuses.
 *  2. Admission: AVAILABLE bed gate, OCCUPIED transition, ADM- number.
 *  3. One-bed-one-patient: partial unique index as backstop + duplicate admits
 *     (sequential and via Promise.all) → BED_UNAVAILABLE.
 *  4. Patient with an active admission cannot be admitted again.
 *  5. Transfer closes the old assignment (history preserved) and moves the bed.
 *  6. Discharge writes the discharge record, flips the bed to CLEANING and is
 *     single-fire.
 *  7. Emergency workflow ARRIVED → TRIAGED → ASSESSED → IN_TREATMENT/OBSERVATION
 *     → ADMITTED|REFERRED|DISCHARGED with timestamps and ER- number; ED
 *     admission links the inpatient admission (source EMERGENCY).
 *  8. Terminal visits reject all actions (EMERGENCY_VISIT_CLOSED).
 *  9. Role separation (clerk cannot triage) + cross-tenant isolation.
 */
describe('phase8 inpatient & emergency', () => {
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

  const full = [
    'wards.read',
    'wards.manage',
    'beds.read',
    'beds.manage',
    'inpatient.read',
    'inpatient.create',
    'inpatient.transfer',
    'inpatient.discharge',
    'emergency.read',
    'emergency.register',
    'emergency.triage',
    'emergency.manage',
    'patients.read',
    'patients.create',
  ];
  const clerk = ['emergency.read', 'emergency.register', 'patients.read', 'patients.create'];
  const auditor = ['wards.read', 'beds.read', 'inpatient.read', 'emergency.read', 'patients.read'];

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post('/patients', ['patients.create'], {
      firstName,
      lastName: 'Phase8',
      phone,
      dateOfBirth: '1990-01-01',
      sex: 'FEMALE',
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const createHierarchy = async (name = 'Ward A') => {
    const ward = await post('/wards', full, { branchId: branchA, name, code: 'WA', floor: '1' });
    expect(ward.statusCode).toBe(201);
    const wardId = ward.json().data.ward.id;

    const room = await post(`/wards/${wardId}/rooms`, full, { name: 'Room 1' });
    expect(room.statusCode).toBe(201);
    const roomId = room.json().data.room.id;

    const beds: Array<{ id: string; version: number }> = [];
    for (const n of ['101', '102', '103']) {
      const bed = await post(`/rooms/${roomId}/beds`, full, { bedNumber: n });
      expect(bed.statusCode).toBe(201);
      beds.push({ id: bed.json().data.bed.id, version: bed.json().data.bed.version });
    }
    return { wardId, roomId, beds };
  };

  const admit = async (
    patientId: string,
    bedId: string,
    opts: Record<string, unknown> = {},
  ) =>
    post('/admissions', ['inpatient.create'], {
      patientId,
      branchId: branchA,
      bedId,
      ...opts,
    });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase8 Org A' } });
    await sc.user.create({
      data: {
        id: userA,
        organizationId: orgA,
        email: 'phase8.user@test.local',
        firstName: 'Phase',
        lastName: 'Eight',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH8A' } });

    orgB = newId();
    userB = newId();
    await sc.organization.create({ data: { id: orgB, name: 'Phase8 Org B' } });
    await sc.user.create({
      data: {
        id: userB,
        organizationId: orgB,
        email: 'phase8.userb@test.local',
        firstName: 'Phase',
        lastName: 'EightB',
        status: 'ACTIVE',
      },
    });
    branchB = newId();
    await sc.branch.create({ data: { id: branchB, organizationId: orgB, name: 'Main', code: 'PH8B' } });
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 1. hierarchy ---------------------------------------------------------

  it('builds the ward → room → bed hierarchy and enforces bed status rules', async () => {
    const { wardId, roomId, beds } = await createHierarchy();

    const dup = await post('/wards', full, { branchId: branchA, name: 'Ward A', code: 'WA2' });
    expect(dup.statusCode).toBe(409);

    const listed = await get('/wards?branchId=' + branchA, full);
    expect(listed.statusCode).toBe(200);
    const items = listed.json().data as Array<{ id: string; rooms: Array<{ name: string; beds: Array<{ bedNumber: string }> }> }>;
    const found = items.find((w) => w.id === wardId);
    expect(found?.rooms[0]?.name).toBe('Room 1');
    expect(found?.rooms[0]?.beds.map((b) => b.bedNumber)).toContain('101');

    const updateWard = await patch(`/wards/${wardId}`, full, { name: 'Ward Alpha' });
    expect(updateWard.statusCode).toBe(200);
    expect(updateWard.json().data.ward.name).toBe('Ward Alpha');

    // OCCUPIED is assignment-driven and cannot be set manually.
    const occupied = await patch(`/beds/${beds[0]?.id}/status`, full, { status: 'OCCUPIED', version: 0 });
    expect(occupied.statusCode).toBe(400);
    expect(occupied.json().error.code).toBe(ErrorCodes.BAD_REQUEST);

    const maintenance = await patch(`/beds/${beds[0]?.id}/status`, full, { status: 'MAINTENANCE', version: 0 });
    expect(maintenance.statusCode).toBe(200);
    expect(maintenance.json().data.bed.status).toBe('MAINTENANCE');

    const stale = await patch(`/beds/${beds[0]?.id}/status`, full, { status: 'AVAILABLE', version: 0 });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.OPTIMISTIC_LOCK_CONFLICT);

    const back = await patch(`/beds/${beds[0]?.id}/status`, full, {
      status: 'AVAILABLE',
      version: maintenance.json().data.bed.version,
    });
    expect(back.statusCode).toBe(200);

    expect(roomId).toBeTruthy();
  });

  // --- 2 + 3 + 4. admissions & one-bed-one-patient ----------------------------

  it('admits onto an AVAILABLE bed and enforces one-bed-one-patient', async () => {
    const { wardId, beds } = await createHierarchy('Ward B');
    const patientA = await registerPatient('InA', '0767000001');

    const created = await admit(patientA, beds[0]!.id);
    expect(created.statusCode).toBe(201);
    const admission = created.json().data.admission;
    expect(admission.admissionNumber).toMatch(/^ADM-\d{4}-\d{6}$/);
    expect(admission.status).toBe('ADMITTED');
    expect(admission.source).toBe('OUTPATIENT_CLINIC');
    expect(admission.assignments).toHaveLength(1);
    expect(admission.assignments[0].bedId).toBe(beds[0]!.id);
    expect(admission.assignments[0].releasedAt).toBeNull();

    const bed = await get(`/beds?wardId=${wardId}`, full);
    expect(bed.json().data[0]?.status).toBe('OCCUPIED');

    // The same patient cannot be admitted twice.
    const again = await admit(patientA, beds[1]!.id);
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe(ErrorCodes.ADMISSION_ALREADY_ACTIVE);

    // A second patient cannot take an occupied bed.
    const patientB = await registerPatient('InB', '0767000002');
    const taken = await admit(patientB, beds[0]!.id);
    expect(taken.statusCode).toBe(409);
    expect(taken.json().error.code).toBe(ErrorCodes.BED_UNAVAILABLE);

    // A bed in MAINTENANCE/BLOCKED cannot be admitted onto either.
    await patch(`/beds/${beds[2]!.id}/status`, full, { status: 'BLOCKED', version: 0 });
    const blocked = await admit(patientB, beds[2]!.id);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe(ErrorCodes.BED_UNAVAILABLE);
  });

  it('is safe under concurrent admissions for the same bed', async () => {
    const { beds } = await createHierarchy('Ward C');
    const p1 = await registerPatient('ConA', '0767000003');
    const p2 = await registerPatient('ConB', '0767000004');

    const [r1, r2] = await Promise.all([
      app.inject({
        method: 'POST',
        headers: headerFor(['patients.read', 'inpatient.create']),
        url: url('/admissions'),
        payload: { patientId: p1, branchId: branchA, bedId: beds[0]!.id },
      }),
      app.inject({
        method: 'POST',
        headers: headerFor(['patients.read', 'inpatient.create']),
        url: url('/admissions'),
        payload: { patientId: p2, branchId: branchA, bedId: beds[0]!.id },
      }),
    ]);

    const statuses = [r1.statusCode, r2.statusCode].sort();
    expect(statuses).toEqual([201, 409]);
    const winner = r1.statusCode === 201 ? r1 : r2;
    const loser = r1.statusCode === 201 ? r2 : r1;
    expect(winner.json().data.admission.assignments[0].bedId).toBe(beds[0]!.id);
    expect(loser.json().error.code).toBe(ErrorCodes.BED_UNAVAILABLE);
  });

  // --- 5. transfer ----------------------------------------------------------

  it('transfers preserve assignment history and move the bed states', async () => {
    const { wardId, beds } = await createHierarchy('Ward D');
    const patient = await registerPatient('TrfA', '0767000005');
    const created = await admit(patient, beds[0]!.id);
    const admissionId = created.json().data.admission.id;

    const moved = await post(`/admissions/${admissionId}/transfer`, ['inpatient.transfer'], {
      toBedId: beds[1]!.id,
      reason: 'Bed rotation',
    });
    expect(moved.statusCode).toBe(201);
    const admission = moved.json().data.admission;
    expect(admission.status).toBe('ADMITTED');
    expect(admission.assignments).toHaveLength(2);
    expect(admission.assignments[0].bedId).toBe(beds[1]!.id);
    expect(admission.assignments[0].releasedAt).toBeNull();
    expect(admission.assignments[1].bedId).toBe(beds[0]!.id);
    expect(admission.assignments[1].releasedAt).not.toBeNull();
    expect(admission.assignments[1].reason).toBe('Bed rotation');

    const bedsNow = await get(`/beds?wardId=${wardId}`, full);
    const byNumber = Object.fromEntries(
      (bedsNow.json().data as Array<{ bedNumber: string; status: string }>).map((b) => [b.bedNumber, b.status]),
    );
    expect(byNumber['101']).toBe('AVAILABLE');
    expect(byNumber['102']).toBe('OCCUPIED');

    // Same bed transfer is a validation error.
    const same = await post(`/admissions/${admissionId}/transfer`, ['inpatient.transfer'], { toBedId: beds[1]!.id });
    expect(same.statusCode).toBe(400);

    // Transfer onto the occupied bed 101 (already taken by the block test above? No — fresh ward).
    const other = await registerPatient('TrfB', '0767000006');
    await admit(other, beds[2]!.id);
    const busy = await post(`/admissions/${admissionId}/transfer`, ['inpatient.transfer'], { toBedId: beds[2]!.id });
    expect(busy.statusCode).toBe(409);
    expect(busy.json().error.code).toBe(ErrorCodes.BED_UNAVAILABLE);
  });

  // --- 6. discharge ---------------------------------------------------------

  it('discharges once: writes the record, frees the bed to CLEANING', async () => {
    const { wardId, beds } = await createHierarchy('Ward E');
    const patient = await registerPatient('DsgA', '0767000007');
    const created = await admit(patient, beds[0]!.id);
    const admissionId = created.json().data.admission.id;

    const res = await post(`/admissions/${admissionId}/discharge`, ['inpatient.discharge'], {
      summary: 'Resolved and stable.',
      instructions: 'Return if fever recurs.',
      medications: [{ name: 'Paracetamol', dose: '500mg', instructions: 'Every 8 hours' }],
      followUp: { type: 'clinic', date: '2026-10-05', notes: 'Review in 7 days' },
      hasOutstandingBilling: true,
      documentIds: ['doc-dis-1'],
    });
    expect(res.statusCode).toBe(201);
    const admission = res.json().data.admission;
    expect(admission.status).toBe('DISCHARGED');
    expect(admission.discharge.summary).toContain('Resolved');
    expect(admission.discharge.medications).toHaveLength(1);
    expect(admission.discharge.followUp.type).toBe('clinic');
    expect(admission.discharge.hasOutstandingBilling).toBe(true);

    const bed = await get(`/beds?wardId=${wardId}`, full);
    expect(bed.json().data[0]?.status).toBe('CLEANING');

    const again = await post(`/admissions/${admissionId}/discharge`, ['inpatient.discharge'], {});
    expect(again.statusCode).toBe(409);
    expect(again.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    // Reuse the bed after cleaning.
    const clean = await patch(
      `/beds/${beds[0]!.id}/status`,
      full,
      { status: 'AVAILABLE', version: bed.json().data[0]?.version },
    );
    expect(clean.statusCode).toBe(200);
  });

  it('exposes admissions to read-only roles', async () => {
    const listed = await get('/admissions', auditor);
    expect(listed.statusCode).toBe(200);
    expect(listed.json().data.length).toBeGreaterThan(0);
  });

  // --- 7 + 8. emergency -------------------------------------------------------

  it('runs the emergency department workflow to an inpatient admission', async () => {
    const { wardId, beds } = await createHierarchy('Ward F');
    const patient = await registerPatient('ErA', '0767000008');

    const registered = await post('/emergency/visits', ['emergency.register'], {
      branchId: branchA,
      patientId: patient,
    });
    expect(registered.statusCode).toBe(201);
    const visit = registered.json().data.visit;
    expect(visit.visitNumber).toMatch(/^ER-\d{4}-\d{6}$/);
    expect(visit.status).toBe('ARRIVED');
    expect(visit.arrivedAt).not.toBeNull();
    const visitId = visit.id;

    const clerkTriage = await post(`/emergency/visits/${visitId}/triage`, clerk, {
      priority: 'URGENT',
    });
    expect(clerkTriage.statusCode).toBe(403);
    expect(clerkTriage.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);

    const triaged = await post(`/emergency/visits/${visitId}/triage`, ['emergency.triage'], {
      priority: 'URGENT',
      complaint: 'Chest pain radiating to the left arm.',
    });
    expect(triaged.statusCode).toBe(201);
    expect(triaged.json().data.visit.status).toBe('TRIAGED');
    expect(triaged.json().data.visit.priority).toBe('URGENT');
    expect(triaged.json().data.visit.chiefComplaint).toContain('Chest pain');
    expect(triaged.json().data.visit.triagedAt).not.toBeNull();

    const reprioritised = await patch(`/emergency/visits/${visitId}/priority`, ['emergency.triage'], {
      priority: 'EMERGENT',
    });
    expect(reprioritised.statusCode).toBe(200);
    expect(reprioritised.json().data.visit.priority).toBe('EMERGENT');

    const assessed = await post(`/emergency/visits/${visitId}/assess`, ['emergency.manage'], {
      assessment: 'Acute coronary syndrome suspected.',
    });
    expect(assessed.json().data.visit.status).toBe('ASSESSED');
    expect(assessed.json().data.visit.assessedAt).not.toBeNull();
    expect(assessed.json().data.visit.assessment).toContain('coronary');

    const treated = await post(`/emergency/visits/${visitId}/treat`, ['emergency.manage'], {
      treatment: 'Aspirin 300mg, cardiac monitoring started.',
    });
    expect(treated.json().data.visit.status).toBe('IN_TREATMENT');
    expect(treated.json().data.visit.treatmentStartedAt).not.toBeNull();
    expect(treated.json().data.visit.treatment).toContain('Aspirin');

    const observed = await post(`/emergency/visits/${visitId}/observe`, ['emergency.manage'], {});
    expect(observed.json().data.visit.status).toBe('OBSERVATION');
    expect(observed.json().data.visit.observedAt).not.toBeNull();

    const admitted = await post(`/emergency/visits/${visitId}/admit`, ['emergency.manage'], {
      bedId: beds[0]!.id,
      provisionalDiagnosis: 'Acute coronary syndrome',
    });
    expect(admitted.statusCode).toBe(201);
    const closed = admitted.json().data.visit;
    expect(closed.status).toBe('ADMITTED');
    expect(closed.disposition).toBe('ADMITTED');
    expect(closed.dispositionAt).not.toBeNull();
    expect(closed.admittedAdmissionId).not.toBeNull();

    const linked = await get(`/admissions/${closed.admittedAdmissionId}`, ['inpatient.read']);
    expect(linked.statusCode).toBe(200);
    expect(linked.json().data.admission.source).toBe('EMERGENCY');

    // A closed visit rejects further actions.
    const late = await patch(`/emergency/visits/${visitId}/priority`, ['emergency.triage'], {
      priority: 'NON_URGENT',
    });
    expect(late.statusCode).toBe(409);
    expect(late.json().error.code).toBe(ErrorCodes.EMERGENCY_VISIT_CLOSED);

    const lateObserve = await post(`/emergency/visits/${visitId}/observe`, ['emergency.manage'], {});
    expect(lateObserve.statusCode).toBe(409);
    expect(lateObserve.json().error.code).toBe(ErrorCodes.EMERGENCY_VISIT_CLOSED);

    const bed = await get(`/beds?wardId=${wardId}`, full);
    expect(bed.json().data[0]?.status).toBe('OCCUPIED');
  });

  it('handles refer and discharge dispositions and reports analytics', async () => {
    const patientA = await registerPatient('ErB', '0767000009');
    const patientB = await registerPatient('ErC', '0767000010');

    const doVisit = async (firstName: string) => {
      const res = await post('/emergency/visits', ['emergency.register'], {
        branchId: branchA,
        patientId: firstName === patientA ? patientA : patientB,
      });
      expect(res.statusCode).toBe(201);
      return res.json().data.visit;
    };

    // Referral.
    const v1 = await doVisit('a');
    await post(`/emergency/visits/${v1.id}/triage`, ['emergency.triage'], { priority: 'SEMI_URGENT' });
    await post(`/emergency/visits/${v1.id}/assess`, ['emergency.manage'], { assessment: 'Needs specialist care.' });
    const referred = await post(`/emergency/visits/${v1.id}/refer`, ['emergency.manage'], {
      referredTo: 'Regional Cardiology Centre',
      referralNotes: 'Urgent echo required.',
    });
    expect(referred.statusCode).toBe(201);
    expect(referred.json().data.visit.status).toBe('REFERRED');
    expect(referred.json().data.visit.disposition).toBe('REFERRED');
    expect(referred.json().data.visit.referredTo).toContain('Cardiology');

    // Straight discharge from assessment.
    const v2 = await doVisit('b');
    await post(`/emergency/visits/${v2.id}/triage`, ['emergency.triage'], { priority: 'NON_URGENT' });
    await post(`/emergency/visits/${v2.id}/assess`, ['emergency.manage'], { assessment: 'Minor laceration.' });
    const discharged = await post(`/emergency/visits/${v2.id}/discharge`, ['emergency.manage'], {});
    expect(discharged.json().data.visit.status).toBe('DISCHARGED');
    expect(discharged.json().data.visit.disposition).toBe('DISCHARGED');

    const summary = await get('/emergency/summary', ['emergency.read']);
    expect(summary.statusCode).toBe(200);
    const s = summary.json().data;
    expect(s.period).toBe('TODAY');
    expect(s.arrivals).toBeGreaterThanOrEqual(3);
    expect(s.active).toBeGreaterThanOrEqual(0);
    expect(s.avgMinutesToTriage).toBeGreaterThanOrEqual(0);
    expect(s.avgMinutesToDisposition).toBeGreaterThanOrEqual(0);
    expect(s.byDisposition['ADMITTED']).toBeGreaterThanOrEqual(1);
    expect(s.byDisposition['REFERRED']).toBeGreaterThanOrEqual(1);
    expect(s.byDisposition['DISCHARGED']).toBeGreaterThanOrEqual(1);
    expect(s.byPriority['EMERGENT']).toBeGreaterThanOrEqual(1);
  });

  // --- 9. tenancy ------------------------------------------------------------

  it('isolates tenants: another org asset is invisible', async () => {
    const sc = prisma.unscoped();

    const otherPatient = newId();
    await sc.patient.create({
      data: {
        id: otherPatient,
        organizationId: orgB,
        patientNumber: 'P8B-0001',
        firstName: 'B',
        lastName: 'B',
      },
    });

    const wardB = newId();
    const roomB = newId();
    const bedB = newId();
    await sc.ward.create({
      data: { id: wardB, organizationId: orgB, branchId: branchB, name: 'Ward B' },
    });
    await sc.room.create({ data: { id: roomB, organizationId: orgB, wardId: wardB, name: 'R1' } });
    await sc.bed.create({ data: { id: bedB, organizationId: orgB, roomId: roomB, bedNumber: 'B1' } });

    const headersB = principalHeaders({
      organizationId: orgB,
      userId: userB,
      permissions: ['wards.read', 'beds.read', 'inpatient.read', 'inpatient.create', 'patients.read', 'emergency.register'],
    });

    // Org A cannot see Org B's ward even with read permissions.
    const hiddenWard = await get(`/wards/${wardB}`, full);
    expect(hiddenWard.statusCode).toBe(404);
    expect(hiddenWard.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);

    // Org A cannot admit onto Org B's bed.
    const hiddenAdmit = await app.inject({
      method: 'POST',
      headers: headerFor(['inpatient.create']),
      url: url('/admissions'),
      payload: { patientId: otherPatient, branchId: branchA, bedId: bedB },
    });
    expect(hiddenAdmit.statusCode).toBe(404);

    // Org A admissions list only shows its own rows (bed B not visible via list).
    const beds = await get(`/beds?wardId=${wardB}`, full);
    expect(beds.json().data).toHaveLength(0);

    // Org B's emergency visit is invisible to Org A.
    const visitB = await app.inject({
      method: 'POST',
      headers: headersB,
      url: url('/emergency/visits'),
      payload: { branchId: branchB, patientId: otherPatient },
    });
    expect(visitB.statusCode).toBe(201);
    const visitId = visitB.json().data.visit.id;
    const hiddenVisit = await get(`/emergency/visits/${visitId}`, ['emergency.read']);
    expect(hiddenVisit.statusCode).toBe(404);
  });
});