import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 4 — clinical core. Acceptance coverage:
 *  1. Encounters: open → in progress → complete; COMPLETED is hard-locked and
 *     no clinical entries can be added afterwards.
 *  2. Clinical notes: DRAFT → FINAL writes the ORIGINAL version; amendments
 *     append new superseding versions with a required reason (never in-place).
 *  3. Coded diagnoses: import a coding system + concepts, record a coded
 *     diagnosis, read the active problem list, resolve it.
 *  4. Follow-ups / referrals / tasks: status machines via the workflow engine.
 *  5. Workflow engine: orgs may ADD optional edges; terminal locks hold.
 *  6. Timeline projection from outbox events, idempotent under replay.
 *  7. Role separation: receptionist / accountant / nurse-shaped permission sets
 *     are enforced (403 where the role matrix denies).
 */

describe('phase4 clinical core', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let publisher: OutboxPublisherService;
  let orgA: string;
  let provider: string;
  let branchA: string;
  let deptGen: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const headerFor = (permissions: string[]) =>
    principalHeaders({ organizationId: orgA, userId: provider, permissions });

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
  ) =>
    app.inject({
      method,
      headers: headerFor(permissions),
      url: url(path),
      ...(payload ? { payload } : {}),
    });

  const post = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('POST', path, permissions, payload);
  const get = (path: string, permissions: string[]) => request('GET', path, permissions);
  const patch = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('PATCH', path, permissions, payload);

  const clinician = [
    'encounters.read', 'encounters.create', 'encounters.update',
    'clinical_notes.read', 'clinical_notes.create', 'clinical_notes.update',
    'diagnosis.read', 'diagnosis.create', 'diagnosis.update',
    'coding.read', 'coding.manage',
    'follow_ups.read', 'follow_ups.create', 'follow_ups.update',
    'referrals.read', 'referrals.create', 'referrals.update',
    'tasks.read', 'tasks.create', 'tasks.update',
    'workflows.read', 'workflows.manage',
    'patients.create', 'patients.read',
  ];

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post(
      '/patients',
      ['patients.create'],
      { firstName, lastName: 'Phase4', phone, dateOfBirth: '1992-03-04', sex: 'FEMALE' },
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    publisher = app.get(OutboxPublisherService);
    const sc = prisma.unscoped();

    orgA = newId();
    provider = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase4 Org A' } });
    await sc.user.create({
      data: {
        id: provider,
        organizationId: orgA,
        email: 'phase4.doc@test.local',
        firstName: 'Phase',
        lastName: 'Doc',
        status: 'ACTIVE',
      },
    });
    branchA = newId();
    deptGen = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH4' } });
    await sc.department.create({ data: { id: deptGen, organizationId: orgA, name: 'Outpatient', code: 'PH4D' } });
  });

  afterAll(async () => {
    await app.close();
  });

  const openEncounter = async (patientId: string) => {
    const res = await post(
      '/encounters',
      clinician,
      { patientId, branchId: branchA, departmentId: deptGen },
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.encounter;
  };

  // --- 1. encounters --------------------------------------------------------

  it('opens an encounter and walks OPEN → IN_PROGRESS → COMPLETED', async () => {
    const patient = await registerPatient('Enc1', '0744000001');
    const encounter = await openEncounter(patient);
    expect(encounter.status).toBe('OPEN');

    const started = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'IN_PROGRESS' });
    expect(started.statusCode).toBe(200);
    expect(started.json().data.encounter.status).toBe('IN_PROGRESS');

    const completed = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'COMPLETED' });
    expect(completed.statusCode).toBe(200);
    expect(completed.json().data.encounter.status).toBe('COMPLETED');
    expect(completed.json().data.encounter.completedAt).not.toBeNull();
  });

  it('hard-locks a COMPLETED encounter: no status change and no new clinical entries', async () => {
    const patient = await registerPatient('Enc2', '0744000002');
    const encounter = await openEncounter(patient);
    await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'IN_PROGRESS' });
    await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'COMPLETED' });

    const reopen = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'OPEN' });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    const note = await post(
      '/clinical-notes',
      clinician,
      { encounterId: encounter.id, sections: { plan: 'Late note' } },
    );
    expect(note.statusCode).toBe(409);
    expect(note.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('lists encounters with filters', async () => {
    const patient = await registerPatient('Enc3', '0744000003');
    await openEncounter(patient);
    const res = await get(
      `/encounters?patientId=${patient}&status=OPEN`,
      ['encounters.read'],
    );
    expect(res.statusCode).toBe(200);
    const items = res.json().data as Array<{ patientId: string; status: string }>;
    expect(items.length).toBeGreaterThan(0);
    expect(items.every((i) => i.patientId === patient && i.status === 'OPEN')).toBe(true);
  });

  // --- 2. clinical notes + amendment workflow -------------------------------

  it('drafts, edits, finalizes and amends a clinical note with full history', async () => {
    const patient = await registerPatient('Note1', '0744000004');
    const encounter = await openEncounter(patient);

    const draft = await post('/clinical-notes', clinician, {
      encounterId: encounter.id,
      title: 'Consult',
      sections: { chiefComplaint: 'Headache', plan: 'Rest' },
    });
    expect(draft.statusCode).toBe(201);
    const noteId = draft.json().data.note.id;
    expect(draft.json().data.note.status).toBe('DRAFT');

    const edited = await patch(`/clinical-notes/${noteId}`, clinician, {
      sections: { chiefComplaint: 'Headache', history: 'Sudden onset', plan: 'Rest + hydration' },
    });
    expect(edited.statusCode).toBe(200);

    const finalized = await post(`/clinical-notes/${noteId}/finalize`, clinician, {});
    expect(finalized.statusCode).toBe(201);
    expect(finalized.json().data.note.status).toBe('FINAL');

    const amended = await post(`/clinical-notes/${noteId}/amend`, clinician, {
      sections: { chiefComplaint: 'Headache', history: 'Sudden onset', plan: 'Rest + hydration + analgesia' },
      reason: 'Added analgesia after reassessment',
    });
    expect(amended.statusCode).toBe(201);
    expect(amended.json().data.note.status).toBe('FINAL');

    const got = await get(`/clinical-notes/${noteId}`, ['clinical_notes.read']);
    expect(got.statusCode).toBe(200);
    const versions = got.json().data.note.versions as Array<{
      versionNumber: number;
      kind: string;
      reason: string | null;
    }>;
    expect(versions).toHaveLength(2);
    expect(versions[0]!.kind).toBe('ORIGINAL');
    expect(versions[0]!.reason).toBeNull();
    expect(versions[1]!.kind).toBe('AMENDMENT');
    expect(versions[1]!.reason).toBe('Added analgesia after reassessment');
  });

  it('rejects editing a FINAL note in place and amending a DRAFT note', async () => {
    const patient = await registerPatient('Note2', '0744000005');
    const encounter = await openEncounter(patient);
    const draft = await post('/clinical-notes', clinician, {
      encounterId: encounter.id,
      sections: { plan: 'Initial' },
    });
    const noteId = draft.json().data.note.id;

    const amendDraft = await post(`/clinical-notes/${noteId}/amend`, clinician, {
      sections: { plan: 'X' },
      reason: 'blocked',
    });
    expect(amendDraft.statusCode).toBe(409);
    expect(amendDraft.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    await post(`/clinical-notes/${noteId}/finalize`, clinician, {});

    const editFinal = await patch(`/clinical-notes/${noteId}`, clinician, { sections: { plan: 'Forged' } });
    expect(editFinal.statusCode).toBe(409);
    expect(editFinal.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('rejects invalid note sections', async () => {
    const patient = await registerPatient('Note3', '0744000006');
    const encounter = await openEncounter(patient);
    const res = await post('/clinical-notes', clinician, {
      encounterId: encounter.id,
      sections: { bogusSection: 'x' },
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error.code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  // --- 3. coding + coded diagnoses + problem list ---------------------------

  it('imports a coding system and records/resolves a coded diagnosis', async () => {
    const patient = await registerPatient('Dx1', '0744000007');
    const encounter = await openEncounter(patient);

    const system = await post('/coding-systems', clinician, { key: 'ICD10', name: 'ICD-10' });
    expect(system.statusCode).toBe(201);
    const systemId = system.json().data.codingSystem.id;

    const imported = await post(`/coding-systems/${systemId}/import`, clinician, {
      concepts: [
        { code: 'J18.9', display: 'Pneumonia, unspecified' },
        { code: 'E11.9', display: 'Type 2 diabetes without complications' },
      ],
    });
    expect(imported.statusCode).toBe(201);
    expect(imported.json().data.importResult.inserted).toBe(2);

    const concepts = await get(`/coding-systems/${systemId}/concepts?query=pneumonia`, ['coding.read']);
    expect(concepts.statusCode).toBe(200);
    const found = (concepts.json().data as Array<{ id: string; code: string }>)[0];
    expect(found?.code).toBe('J18.9');

    const recorded = await post('/diagnoses', clinician, {
      encounterId: encounter.id,
      codeConceptId: found!.id,
      classification: 'PRIMARY',
    });
    expect(recorded.statusCode).toBe(201);
    const diagnosis = recorded.json().data.diagnosis;
    expect(diagnosis.code).toBe('J18.9');
    expect(diagnosis.codeSystemKey).toBe('ICD10');
    expect(diagnosis.status).toBe('ACTIVE');

    const problems = await get(`/diagnoses/problems?patientId=${patient}`, ['diagnosis.read']);
    expect(problems.statusCode).toBe(200);
    expect(problems.json().data.problems).toHaveLength(1);

    const resolved = await patch(`/diagnoses/${diagnosis.id}`, clinician, {
      action: 'resolve',
      resolvedNotes: 'Resolved after antibiotics',
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.diagnosis.status).toBe('RESOLVED');

    const problemsAfter = await get(`/diagnoses/problems?patientId=${patient}`, ['diagnosis.read']);
    expect(problemsAfter.json().data.problems).toHaveLength(0);
  });

  it('validates diagnosis codes: fabricated codes are impossible', async () => {
    const patient = await registerPatient('Dx2', '0744000008');
    const encounter = await openEncounter(patient);
    const res = await post('/diagnoses', clinician, {
      encounterId: encounter.id,
      codeConceptId: newId(),
    });
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(ErrorCodes.RESOURCE_NOT_FOUND);
  });

  // --- 4. follow-ups, referrals, tasks --------------------------------------

  const scheduleAndCompleteFollowUp = async (patientId: string) => {
    const fu = await post('/follow-ups', clinician, {
      patientId,
      dueAt: '2026-12-01T00:00:00.000Z',
      reason: 'Review labs',
    });
    expect(fu.statusCode).toBe(201);
    const fuId = fu.json().data.followUp.id;
    const done = await post(`/follow-ups/${fuId}/transition`, clinician, { action: 'complete' });
    expect(done.statusCode).toBe(201);
    expect(done.json().data.followUp.status).toBe('COMPLETED');
  };

  const runReferralFlow = async (patientId: string) => {
    const created = await post('/referrals', clinician, {
      patientId,
      reason: 'Orthopaedic consult',
      toDepartmentId: deptGen,
    });
    expect(created.statusCode).toBe(201);
    const refId = created.json().data.referral.id;

    const sent = await post(`/referrals/${refId}/action`, clinician, { action: 'send' });
    expect(sent.statusCode).toBe(201);
    expect(sent.json().data.referral.status).toBe('SENT');

    const accepted = await post(`/referrals/${refId}/action`, clinician, { action: 'accept' });
    expect(accepted.statusCode).toBe(201);
    expect(accepted.json().data.referral.status).toBe('ACCEPTED');

    const completed = await post(`/referrals/${refId}/action`, clinician, { action: 'complete' });
    expect(completed.statusCode).toBe(201);
    expect(completed.json().data.referral.status).toBe('COMPLETED');
  };

  const runTaskFlow = async (patientId: string) => {
    const created = await post('/tasks', clinician, { title: 'Educate on inhaler', patientId });
    expect(created.statusCode).toBe(201);
    const taskId = created.json().data.task.id;

    const started = await post(`/tasks/${taskId}/transition`, clinician, { action: 'start' });
    expect(started.statusCode).toBe(201);
    expect(started.json().data.task.status).toBe('IN_PROGRESS');

    const done = await post(`/tasks/${taskId}/transition`, clinician, { action: 'complete' });
    expect(done.statusCode).toBe(201);
    expect(done.json().data.task.status).toBe('DONE');

    const reopen = await post(`/tasks/${taskId}/transition`, clinician, { action: 'start' });
    expect(reopen.statusCode).toBe(409);
  };

  it('runs follow-up / referral / task flows', async () => {
    const patient = await registerPatient('Flow1', '0744000009');
    const encounter = await openEncounter(patient);
    await scheduleAndCompleteFollowUp(patient);
    await runReferralFlow(patient);
    await runTaskFlow(patient);
    expect(encounter.id).toBeDefined();
  });

  // --- 5. workflow engine ---------------------------------------------------

  it('enforces system edges, allows additive custom edges, keeps terminal locks', async () => {
    const before = await get('/workflows/encounter', ['workflows.read']);
    expect(before.statusCode).toBe(200);
    expect(before.json().data.systemEdges).toEqual(
      expect.arrayContaining([
        { fromStatus: 'OPEN', toStatus: 'IN_PROGRESS' },
        { fromStatus: 'IN_PROGRESS', toStatus: 'COMPLETED' },
      ]),
    );

    const patient = await registerPatient('Wf1', '0744000010');
    const encounter = await openEncounter(patient);

    // Illegal directly (no custom edge yet).
    const blocked = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'COMPLETED' });
    expect(blocked.statusCode).toBe(409);

    // Operator adds the optional OPEN → COMPLETED shortcut.
    const added = await post('/workflows/encounter/transitions', clinician, {
      fromStatus: 'OPEN',
      toStatus: 'COMPLETED',
    });
    expect(added.statusCode).toBe(201);

    const after = await get('/workflows/encounter', ['workflows.read']);
    expect(after.json().data.customEdges).toEqual([{ fromStatus: 'OPEN', toStatus: 'COMPLETED' }]);
    expect(after.json().data.edges).toEqual(
      expect.arrayContaining([{ fromStatus: 'OPEN', toStatus: 'COMPLETED' }]),
    );

    const viaCustom = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'COMPLETED' });
    expect(viaCustom.statusCode).toBe(200);
    expect(viaCustom.json().data.encounter.status).toBe('COMPLETED');

    // Even with a custom edge, the hard lock holds (module guard).
    const addReopen = await post('/workflows/encounter/transitions', clinician, {
      fromStatus: 'COMPLETED',
      toStatus: 'OPEN',
    });
    expect(addReopen.statusCode).toBe(201);
    const reopen = await patch(`/encounters/${encounter.id}/status`, clinician, { status: 'OPEN' });
    expect(reopen.statusCode).toBe(409);
    expect(reopen.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  // --- 6. timeline projection from outbox events ----------------------------

  it('builds the patient timeline from events, idempotently, under replay', async () => {
    const patient = await registerPatient('Timeline1', '0744000011');
    const encounter = await openEncounter(patient);

    const note = await post('/clinical-notes', clinician, {
      encounterId: encounter.id,
      sections: { plan: 'Timeline note' },
    });
    await post(`/clinical-notes/${note.json().data.note.id}/finalize`, clinician, {});

    // Events are queued in the outbox (PENDING); publish drives consumers.
    // Drain completely so the assertions hold even when the shared e2e DB still
    // holds unclaimed events from earlier suites (each pass claims `limit`).
    let published = 0;
    for (
      let n = await publisher.publishReadyEvents(100);
      n > 0;
      n = await publisher.publishReadyEvents(100)
    ) {
      published += n;
      expect(published).toBeLessThanOrEqual(1000);
    }
    expect(published).toBeGreaterThan(0);

    const timeline = await get(`/patients/${patient}/timeline?limit=50`, [
      'patients.read',
      'encounters.read',
      'clinical_notes.read',
      'diagnosis.read',
    ]);
    expect(timeline.statusCode).toBe(200);
    const entries = timeline.json().data as Array<{ type: string; sourceEventId: string | null }>;
    const types = new Set(entries.map((e) => e.type));
    expect(types).toContain('encounter.created');
    expect(types).toContain('clinical_note.created');
    expect(types).toContain('clinical_note.finalized');
    // Event-sourced rows carry sourceEventId; inline patient.registered does not.
    expect(entries.filter((e) => !e.type.startsWith('patient.')).every((e) => e.sourceEventId !== null)).toBe(true);

    const rowCount = await prisma
      .unscoped()
      .processedEvent.count({ where: { organizationId: orgA } });

    // Replay is a no-op: nothing new to publish, no duplicate rows.
    const again = await publisher.publishReadyEvents(100);
    expect(again).toBe(0);
    const timelineAgain = await get(`/patients/${patient}/timeline?limit=50`, [
      'patients.read',
      'encounters.read',
      'clinical_notes.read',
    ]);
    expect((timelineAgain.json().data as unknown[]).length).toBe(entries.length);

    const rowCountAgain = await prisma
      .unscoped()
      .processedEvent.count({ where: { organizationId: orgA } });
    expect(rowCountAgain).toBe(rowCount);
  });

  // --- 7. role separation ---------------------------------------------------

  it('denies diagnosis writes to receptionist-shaped permissions and clinical reads to accountant-shaped permissions', async () => {
    const patient = await registerPatient('Roles1', '0744000012');
    const encounter = await openEncounter(patient);

    // Receptionist: no diagnosis.* and no clinical_notes.* per the role matrix.
    const receptionist = [
      'patients.read',
      'encounters.read',
      'tasks.read',
      'workflows.read',
    ];
    const dxAttempt = await request('POST', '/diagnoses', receptionist, {
      encounterId: encounter.id,
      text: 'Should not work',
    });
    expect(dxAttempt.statusCode).toBe(403);
    expect(dxAttempt.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);

    const noteAttempt = await request('POST', '/clinical-notes', receptionist, {
      encounterId: encounter.id,
      sections: { plan: 'x' },
    });
    expect(noteAttempt.statusCode).toBe(403);

    // Accountant: no clinical_notes.read per the role matrix.
    const accountant = ['patients.read'];
    const readDiagnoses = await request('GET', '/diagnoses?patientId='.concat(patient), accountant);
    expect(readDiagnoses.statusCode).toBe(403);

    // Timeline is ALSO permission-filtered: receptionist sees only encounter + patient rows.
    await publisher.publishReadyEvents(100);
    const timeline = await get(`/patients/${patient}/timeline?limit=50`, receptionist);
    expect(timeline.statusCode).toBe(200);
    const types = new Set(
      (timeline.json().data as Array<{ type: string }>).map((e) => e.type),
    );
    expect(types.size).toBeGreaterThan(0);
    // Receptionist may see encounter + patient (registration) rows, never clinical rows.
    expect(types).toContain('patient.registered');
    expect(types).toContain('encounter.created');
    expect([...types].every((t) => t.startsWith('encounter.') || t.startsWith('patient.'))).toBe(true);
  });

  it('allows nurse-shaped permissions to create drafts but not finalize/amend', async () => {
    const patient = await registerPatient('Roles2', '0744000013');
    const encounter = await openEncounter(patient);

    const nurse = [
      'patients.read',
      'encounters.read',
      'clinical_notes.read',
      'clinical_notes.create',
      'diagnosis.read',
      'follow_ups.read',
      'referrals.read',
    ];
    const draft = await request('POST', '/clinical-notes', nurse, {
      encounterId: encounter.id,
      sections: { subjective: 'Temp 38.9' },
    });
    expect(draft.statusCode).toBe(201);
    const noteId = draft.json().data.note.id;

    const finalize = await request('POST', `/clinical-notes/${noteId}/finalize`, nurse, {});
    expect(finalize.statusCode).toBe(403);
    expect(finalize.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
  });
});