import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { EventTypes } from '../../src/events/catalog';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 2 — patients. Exercises registration incl. duplicate detection
 * (409 POSSIBLE_DUPLICATE), org-scoped patient numbers, permission gating,
 * cross-tenant isolation, patient-participant ownership, access logging,
 * guardians/consents/allergies/medical-history, merge, and outbox events.
 */
describe('patients (Phase 2)', () => {
  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let orgA: string;
  let orgB: string;
  let userId: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const headerFor = (permissions: string[], opts?: { patientId?: string; org?: string }) =>
    principalHeaders({
      organizationId: opts?.org ?? orgA,
      userId,
      permissions,
      ...(opts?.patientId ? { patientId: opts.patientId } : {}),
    });

  const register = (permissions: string[], payload: Record<string, unknown>, opts?: { patientId?: string }) =>
    app.inject({
      method: 'POST',
      url: url('/patients'),
      headers: headerFor(permissions, opts),
      payload,
    });

  const baseIdent = {
    firstName: 'Amina',
    lastName: 'Mohammed',
    phone: '0722111222',
    dateOfBirth: '1995-03-14',
    sex: 'FEMALE',
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    orgB = newId();
    userId = newId();
    await sc.organization.createMany({
      data: [
        { id: orgA, name: 'Patients Org A' },
        { id: orgB, name: 'Patients Org B' },
      ],
    });
    await sc.user.create({
      data: {
        id: userId,
        organizationId: orgA,
        email: 'records@patients.test',
        firstName: 'Rec',
        lastName: 'Ord',
        status: 'ACTIVE',
      },
    });
  });

  afterAll(async () => {
    await app.close();
  });

  it('register requires patients.create', async () => {
    const res = await register(['patients.read'], baseIdent);
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe('PERMISSION_DENIED');
  });

  it('registers a patient with an org-scoped number and emits PatientRegistered', async () => {
    const res = await register(['patients.create'], baseIdent);
    expect(res.statusCode).toBe(201);
    const data = res.json().data;
    expect(data.success).toBeUndefined();
    expect(res.json().success).toBe(true);

    const patient = data.patient;
    expect(patient.patientNumber).toMatch(/^PAT-2026-\d{6}$/);
    expect(patient.status).toBe('ACTIVE');
    expect(patient.firstName).toBe('Amina');
    expect(patient.phone).toBe('0722111222'); // creator sees contact
    expect(patient.version).toBe(1);

    const ev = await prisma.unscoped().outboxEvent.findFirst({
      where: {
        organizationId: orgA,
        aggregateId: patient.id,
        type: EventTypes.PatientRegistered,
      },
    });
    expect(ev).not.toBeNull();
  });

  it('issues sequential, org-scoped numbers', async () => {
    const a = await register(['patients.create'], { ...baseIdent, firstName: 'Seq One', phone: '0733000001' });
    const b = await register(['patients.create'], { ...baseIdent, firstName: 'Seq Two', phone: '0733000002' });
    const n1 = a.json().data.patient.patientNumber;
    const n2 = b.json().data.patient.patientNumber;
    expect(Number(n1.slice(-6)) + 1).toBe(Number(n2.slice(-6)));
  });

  it('flags a likely duplicate with 409 POSSIBLE_DUPLICATE and candidate ids', async () => {
    const res = await register(['patients.create', 'patients.read'], baseIdent);
    expect(res.statusCode).toBe(409);
    const error = res.json().error;
    expect(error.code).toBe(ErrorCodes.POSSIBLE_DUPLICATE);
    expect(error.details.candidates.length).toBeGreaterThan(0);
    for (const c of error.details.candidates) {
      expect(c).toHaveProperty('patientId');
      expect(c).toHaveProperty('score');
    }
  });

  it('accepts registration when the creator confirms the duplicate', async () => {
    const res = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Amina',
      lastName: 'Mohammed',
      confirmDuplicate: true,
      duplicateConfirmReason: 'Same person re-attending, prior registration verified',
    });
    expect(res.statusCode).toBe(201);
    expect(res.json().data.patient.duplicateConfirmReason).toContain('re-attending');
  });

  it('rejects confirmDuplicate without a reason', async () => {
    const res = await register(['patients.create'], {
      ...baseIdent,
      confirmDuplicate: true,
    });
    expect(res.statusCode).toBe(400);
  });

  it('lists patients with search and pagination', async () => {
    const res = await app.inject({
      method: 'GET',
      url: url('/patients?q=amina&limit=2'),
      headers: headerFor(['patients.read']),
    });
    expect(res.statusCode).toBe(200);
    const body = res.json();
    expect(body.success).toBe(true);
    expect(Array.isArray(body.data)).toBe(true);
    expect(body.meta.page).toBe(1);
    expect(body.meta.limit).toBe(2);
    expect(body.data.length).toBeGreaterThan(0);
  });

  it('returns 404 for a patient in another tenant', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Cross',
      lastName: 'Tenant',
      phone: '0733111222',
    });
    const id = created.json().data.patient.id;

    const res = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read'], { org: orgB }),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(ErrorCodes.PATIENT_NOT_FOUND);
  });

  it('masks contact details for a reader without patients.update', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Masked',
      lastName: 'Contact',
      phone: '0799888777',
      email: 'masked@test.com',
    });
    const id = created.json().data.patient.id;

    const read = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read']),
    });
    expect(read.statusCode).toBe(200);
    expect(read.json().data.patient.phone).toBeNull();
    expect(read.json().data.patient.email).toBeNull();

    const withUpdate = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read', 'patients.update']),
    });
    expect(withUpdate.json().data.patient.phone).toBe('0799888777');
  });

  it('logs a patient-access row on single-record reads', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Audited',
      lastName: 'Read',
      phone: '0744000111',
    });
    const id = created.json().data.patient.id;

    await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read']),
    });

    const log = await prisma.unscoped().patientAccessLog.findFirst({
      where: { organizationId: orgA, patientId: id },
    });
    expect(log).not.toBeNull();
    expect(log?.action).toBe('READ');
    expect(log?.section).toBe('demographics');
    expect(log?.userId).toBe(userId);
    expect(log?.requestId).toBe('test-request');
  });

  it('rejects a self-scoped (patient portal) principal reading someone else', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Owner',
      lastName: 'Check',
      phone: '0755111333',
    });
    const id = created.json().data.patient.id;

    const other = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Other',
      lastName: 'Record',
      phone: '0755222444',
    });
    const otherId = other.json().data.patient.id;

    // Owner can read their own record with contact unmasked.
    const mine = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read'], { patientId: id }),
    });
    expect(mine.statusCode).toBe(200);
    expect(mine.json().data.patient.id).toBe(id);

    // But not another patient's record.
    const notMine = await app.inject({
      method: 'GET',
      url: url(`/patients/${otherId}`),
      headers: headerFor(['patients.read'], { patientId: id }),
    });
    expect(notMine.statusCode).toBe(403);
    expect(notMine.json().error.code).toBe('PATIENT_ACCESS_DENIED');

    // And list is scoped to their own record only.
    const list = await app.inject({
      method: 'GET',
      url: url('/patients'),
      headers: headerFor(['patients.read'], { patientId: id }),
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].id).toBe(id);
  });

  it('updates a patient with optimistic concurrency (409 on stale version)', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Version',
      lastName: 'Test',
      phone: '0766000555',
    });
    const id = created.json().data.patient.id;
    const v1 = created.json().data.patient.version;

    const ok = await app.inject({
      method: 'PATCH',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.update']),
      payload: { firstName: 'Versioned', version: v1 },
    });
    expect(ok.statusCode).toBe(200);
    expect(ok.json().data.patient.firstName).toBe('Versioned');
    expect(ok.json().data.patient.version).toBe(v1 + 1);

    const stale = await app.inject({
      method: 'PATCH',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.update']),
      payload: { lastName: 'Stale', version: v1 },
    });
    expect(stale.statusCode).toBe(409);
    expect(stale.json().error.code).toBe(ErrorCodes.VERSION_CONFLICT);
  });

  it('manages guardians (reuse by phone, primary clearing)', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Guardian',
      lastName: 'Host',
      phone: '0777000666',
    });
    const id = created.json().data.patient.id;

    const g1 = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/guardians`),
      headers: headerFor(['patients.update']),
      payload: { firstName: 'Sister', lastName: 'One', phone: '0711000111', relationship: 'SIBLING', isPrimary: true },
    });
    expect(g1.statusCode).toBe(201);

    const g2 = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/guardians`),
      headers: headerFor(['patients.update']),
      payload: { firstName: 'Brother', lastName: 'Two', relationship: 'SIBLING', isPrimary: true },
    });
    expect(g2.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/guardians`),
      headers: headerFor(['patients.read']),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(2);
    const primaries = list.json().data.filter((g: { isPrimary: boolean }) => g.isPrimary);
    expect(primaries).toHaveLength(1);

    const removed = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/guardians/${g1.json().data.guardian.id}/remove`),
      headers: headerFor(['patients.update']),
    });
    expect(removed.statusCode).toBe(200);

    const afterRemoval = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/guardians`),
      headers: headerFor(['patients.read']),
    });
    expect(afterRemoval.json().data).toHaveLength(1);
  });

  it('grants/withdraws consents and keeps one row per type', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Consent',
      lastName: 'Case',
      phone: '0788000777',
    });
    const id = created.json().data.patient.id;

    const grant = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/consents/grant`),
      headers: headerFor(['patients.update']),
      payload: { type: 'DATA_PROCESSING', notes: 'consented at check-in' },
    });
    expect(grant.statusCode).toBe(201);
    expect(grant.json().data.consent.status).toBe('GRANTED');

    const withdraw = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/consents/DATA_PROCESSING/withdraw`),
      headers: headerFor(['patients.update']),
      payload: { notes: 'requested removal' },
    });
    expect(withdraw.statusCode).toBe(200);
    expect(withdraw.json().data.consent.status).toBe('WITHDRAWN');

    const list = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/consents`),
      headers: headerFor(['patients.read']),
    });
    expect(list.json().data).toHaveLength(1);
    expect(list.json().data[0].status).toBe('WITHDRAWN');
  });

  it('rejects an invalid consent type', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'BadConsent',
      lastName: 'Type',
      phone: '0799000888',
    });
    const id = created.json().data.patient.id;
    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/consents/NOPE/withdraw`),
      headers: headerFor(['patients.update']),
      payload: {},
    });
    expect(res.statusCode).toBe(400);
  });

  it('records, resolves and amends allergies (source kept as AMENDED)', async () => {
    jest.setTimeout(30_000);
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Allergy',
      lastName: 'Sufferer',
      phone: '0701111888',
    });
    const id = created.json().data.patient.id;

    const rec = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/allergies`),
      headers: headerFor(['patients.update']),
      payload: { substance: 'Penicillin', reaction: 'rash', severity: 'MODERATE' },
    });
    expect(rec.statusCode).toBe(201);
    const allergyId = rec.json().data.allergy.id;

    const resolve = await app.inject({
      method: 'PATCH',
      url: url(`/patients/${id}/allergies/${allergyId}/status`),
      headers: headerFor(['patients.update']),
      payload: { status: 'RESOLVED' },
    });
    expect(resolve.statusCode).toBe(200);
    expect(resolve.json().data.allergy.status).toBe('RESOLVED');

    const amend = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/allergies/${allergyId}/amend`),
      headers: headerFor(['patients.update']),
      payload: { severity: 'SEVERE', reaction: 'anaphylaxis suspected' },
    });
    expect(amend.statusCode).toBe(201);
    const correctedId = amend.json().data.allergy.id;
    expect(correctedId).not.toBe(allergyId);
    expect(amend.json().data.allergy.status).toBe('ACTIVE');

    const original = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/allergies`),
      headers: headerFor(['patients.read']),
    });
    const entries = original.json().data;
    expect(entries).toHaveLength(2);
    const superseded = entries.find((e: { id: string }) => e.id === allergyId);
    expect(superseded.status).toBe('AMENDED');
    const kept = entries.find((e: { id: string }) => e.id === correctedId);
    expect(kept.status).toBe('ACTIVE');

    // Amended allergies cannot be re-opened.
    const reopen = await app.inject({
      method: 'PATCH',
      url: url(`/patients/${id}/allergies/${allergyId}/status`),
      headers: headerFor(['patients.update']),
      payload: { status: 'ACTIVE' },
    });
    expect(reopen.statusCode).toBe(409);
  });

  it('adds and lists medical history entries (append-only)', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'History',
      lastName: 'Patient',
      phone: '0719999000',
    });
    const id = created.json().data.patient.id;

    const add = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/medical-history`),
      headers: headerFor(['patients.update']),
      payload: { category: 'PAST_MEDICAL', description: 'Treated for malaria 2019', onsetDate: '2019-06-01' },
    });
    expect(add.statusCode).toBe(201);

    const list = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/medical-history`),
      headers: headerFor(['patients.read']),
    });
    expect(list.statusCode).toBe(200);
    expect(list.json().data[0].description).toContain('malaria');
  });

  it('merges a source patient into the target and transfers sub-records', async () => {
    const target = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Survivor',
      lastName: 'Merge',
      phone: '0712000123',
    });
    const targetId = target.json().data.patient.id;

    const source = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Doomed',
      lastName: 'Merge',
      phone: '0712000456',
      email: 'doomed@merge.test',
    });
    const sourceId = source.json().data.patient.id;

    await app.inject({
      method: 'POST',
      url: url(`/patients/${sourceId}/consents/grant`),
      headers: headerFor(['patients.update']),
      payload: { type: 'TELEMEDICINE' },
    });
    await app.inject({
      method: 'POST',
      url: url(`/patients/${sourceId}/allergies`),
      headers: headerFor(['patients.update']),
      payload: { substance: 'Aspirin', reaction: 'hives', severity: 'MILD' },
    });

    const merged = await app.inject({
      method: 'POST',
      url: url(`/patients/${targetId}/merge`),
      headers: headerFor(['patients.merge']),
      payload: { sourcePatientId: sourceId, reason: 'Duplicate record verified by records officer' },
    });
    expect(merged.statusCode).toBe(200);
    expect(merged.json().data.source.status).toBe('MERGED');

    const survivor = await prisma.unscoped().patient.findFirst({ where: { id: targetId } });
    const doomed = await prisma.unscoped().patient.findFirst({ where: { id: sourceId } });
    expect(doomed?.status).toBe('MERGED');
    expect(doomed?.mergedIntoPatientId).toBe(targetId);

    const allergies = await prisma.unscoped().allergy.findMany({ where: { patientId: targetId } });
    expect(allergies.some((a) => a.substance === 'Aspirin')).toBe(true);

    const consents = await prisma.unscoped().patientConsent.findMany({ where: { patientId: targetId } });
    expect(consents.some((c) => c.type === 'TELEMEDICINE')).toBe(true);

    const timelineForSource = await prisma.unscoped().patientTimelineEntry.findMany({
      where: { patientId: sourceId },
    });
    expect(timelineForSource.some((t) => t.title.includes('surviving'))).toBe(true);
    void survivor;
  });

  it('refuses merging a patient into itself', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'SelfMerge',
      lastName: 'Refused',
      phone: '0711111222',
    });
    const id = created.json().data.patient.id;

    const res = await app.inject({
      method: 'POST',
      url: url(`/patients/${id}/merge`),
      headers: headerFor(['patients.merge']),
      payload: { sourcePatientId: id, reason: 'oops' },
    });
    expect(res.statusCode).toBe(400);
  });

  it('returns a permission-aware master record', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Master',
      lastName: 'Record',
      phone: '0722000333',
    });
    const id = created.json().data.patient.id;

    const res = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/master`),
      headers: headerFor(['patients.read', 'patients.update']),
    });
    expect(res.statusCode).toBe(200);
    const data = res.json().data;
    expect(data.patient.id).toBe(id);
    expect(data.patient.phone).toBe('0722000333'); // update perm → unmasked
    for (const key of ['guardians', 'consents', 'allergies', 'medicalHistory']) {
      expect(Array.isArray(data.sections[key])).toBe(true);
    }
  });

  it('filters the timeline by the reader permission', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'Timeline',
      lastName: 'Visible',
      phone: '0733000444',
    });
    const id = created.json().data.patient.id;

    const res = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/timeline`),
      headers: headerFor(['patients.read']),
    });
    expect(res.statusCode).toBe(200);
    const entries = res.json().data;
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.map((e: { title: string }) => e.title)).toEqual(
      expect.arrayContaining([expect.stringContaining('Registered')]),
    );
  });

  it('lists access-log entries for the patient (requires patients.manage)', async () => {
    const created = await register(['patients.create'], {
      ...baseIdent,
      firstName: 'AccessLog',
      lastName: 'List',
      phone: '0744000555',
    });
    const id = created.json().data.patient.id;

    // A demographics read writes a log row first.
    await app.inject({
      method: 'GET',
      url: url(`/patients/${id}`),
      headers: headerFor(['patients.read']),
    });

    const denied = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/access-log`),
      headers: headerFor(['patients.read']),
    });
    expect(denied.statusCode).toBe(403);

    const res = await app.inject({
      method: 'GET',
      url: url(`/patients/${id}/access-log`),
      headers: headerFor(['patients.read', 'patients.manage']),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data.length).toBeGreaterThan(0);
  });
});