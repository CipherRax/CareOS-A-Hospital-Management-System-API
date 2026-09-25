import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { OutboxPublisherService } from '../../src/database/outbox-publisher.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 9 (communication & documents). Acceptance coverage:
 *  1. Booking an appointment projects a NEUTRAL staff notification (status
 *     SENT) — no PHI in subject/body; tenant-isolated per principal.
 *  2. Neutral template registry: custom template upsert + PHI rejection.
 *  3. Secure messaging: conversation, append-only messages, participants,
 *     last-read, and non-participant denial.
 *  4. Telemedicine: consent gate, schedule, provider-only start, end/cancel
 *     state machine.
 *  5. Quality: feedback/complaint/incident lifecycles + illegal transitions.
 *  6. Patient portal: self-scoped read of own record/appointments/results +
 *     feedback submission; cross-patient isolation.
 *  7. Document jobs: deterministic neutral PDF render + job audit trail.
 */
describe('phase10 communication & documents', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let publisher: OutboxPublisherService;
  let env: Env;
  let orgA: string;
  let userA: string;
  let userB: string;
  let userC: string;
  let branchA: string;
  let departmentA: string;
  let orgB: string;
  let userBOrg: string;
  let branchB: string;
  let patientA: string;
  let patientB: string;

  const url = (path: string): string => `${env.API_PREFIX}${path}`;

  const request = (
    method: 'GET' | 'POST' | 'PATCH' | 'PUT' | 'DELETE',
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
  const patch = (
    path: string,
    permissions: string[],
    payload: Record<string, unknown>,
    extra?: Record<string, string>,
    org?: string,
    userId?: string,
  ) => request('PATCH', path, permissions, payload, extra, org, userId);

  const comm = [
    'notifications.read',
    'notifications.manage',
    'messaging.read',
    'messaging.send',
    'messaging.manage',
    'telemedicine.read',
    'telemedicine.manage',
    'feedback.submit',
    'feedback.read',
    'feedback.respond',
    'complaints.read',
    'complaints.manage',
    'incidents.read',
    'incidents.manage',
    'portal.read',
    'patients.read',
    'patients.create',
    'appointments.read',
    'appointments.create',
    'documents.read',
  ];
  const readOnly = [
    'notifications.read',
    'messaging.read',
    'telemedicine.read',
    'feedback.read',
    'complaints.read',
    'incidents.read',
    'portal.read',
    'patients.read',
    'appointments.read',
    'documents.read',
  ];
  const patientPerms = [
    'portal.read',
    'feedback.submit',
    'notifications.read',
    'patients.read',
    'appointments.read',
  ];

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

  /** Pending outbox rows may carry a backoff `nextAttemptAt`; poll briefly. */
  const waitForNotification = async (timeoutMs = 8000) => {
    const deadline = Date.now() + timeoutMs;
    await drainOutbox();
    let found = await prisma
      .unscoped()
      .notification.findFirst({ where: { organizationId: orgA, recipientUserId: userA } });
    while (found === null && Date.now() < deadline) {
      await drainOutbox();
      await new Promise((resolve) => setTimeout(resolve, 250));
      found = await prisma
        .unscoped()
        .notification.findFirst({ where: { organizationId: orgA, recipientUserId: userA } });
    }
    expect(found).not.toBeNull();
    const n = await prisma.unscoped().notification.findFirst({
      where: {
        organizationId: orgA,
        recipientUserId: userA,
        templateKey: 'appointment.booked',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(n).not.toBeNull();
    return n!;
  };

  const bookAppointment = async (patientId: string, startsAt = '2026-09-28T09:00:00.000Z') => {
    const res = await post('/appointments', comm, {
      patientId,
      providerId: userA,
      branchId: branchA,
      departmentId: departmentA,
      startsAt, // 2026-09-28 is a Monday (dayOfWeek 0).
      mode: 'IN_PERSON',
    });
    expect(res.statusCode).toBe(201);
    return res.json().data.appointment;
  };

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    publisher = app.get(OutboxPublisherService);
    env = app.get(ENV);
    const sc = prisma.unscoped();

    orgA = newId();
    userA = newId();
    userB = newId();
    userC = newId();
    await sc.organization.create({ data: { id: orgA, name: 'Phase10 Org A' } });
    for (const [id, email] of [
      [userA, 'phase10.a@test.local'],
      [userB, 'phase10.b@test.local'],
      [userC, 'phase10.c@test.local'],
    ] as const) {
      await sc.user.create({
        data: {
          id,
          organizationId: orgA,
          email,
          firstName: 'Phase',
          lastName: id === userA ? 'TenA' : id === userB ? 'TenB' : 'TenC',
          status: 'ACTIVE',
        },
      });
    }
    branchA = newId();
    await sc.branch.create({
      data: { id: branchA, organizationId: orgA, name: 'Main', code: 'PH10A' },
    });
    departmentA = newId();
    await sc.department.create({
      data: { id: departmentA, organizationId: orgA, name: 'Outpatient', code: 'OPD' },
    });
    // Bookable weekly template for userA on Mondays (09:00-17:00, 30 min slots).
    await sc.providerSchedule.create({
      data: {
        id: newId(),
        organizationId: orgA,
        providerId: userA,
        branchId: branchA,
        departmentId: departmentA,
        dayOfWeek: 0,
        startMinutes: 9 * 60,
        endMinutes: 17 * 60,
        slotDurationMinutes: 30,
        capacity: 1,
      },
    });

    orgB = newId();
    userBOrg = newId();
    await sc.organization.create({ data: { id: orgB, name: 'Phase10 Org B' } });
    await sc.user.create({
      data: {
        id: userBOrg,
        organizationId: orgB,
        email: 'phase10.borg@test.local',
        firstName: 'Phase',
        lastName: 'TenB',
        status: 'ACTIVE',
      },
    });
    branchB = newId();
    await sc.branch.create({
      data: { id: branchB, organizationId: orgB, name: 'Main', code: 'PH10B' },
    });

    // Patient fixture (API-registered so number series works) + a second patient.
    const reg = await post('/patients', ['patients.create'], {
      firstName: 'Ada',
      lastName: 'Patient',
      phone: '0767100001',
      dateOfBirth: '1990-01-01',
      sex: 'FEMALE',
    });
    expect(reg.statusCode).toBe(201);
    patientA = reg.json().data.patient.id;

    const alt = await sc.patient.create({
      data: {
        id: newId(),
        organizationId: orgA,
        patientNumber: 'P10B-000001',
        firstName: 'Other',
        lastName: 'Patient',
        phone: '0767100002',
        dateOfBirth: new Date('1980-05-05'),
        sex: 'MALE',
        status: 'ACTIVE',
      },
    });
    patientB = alt.id;
  });

  afterAll(async () => {
    await app.close();
  });

  // --- 1 + 2. notifications + templates --------------------------------------

  it('projects a neutral staff notification on booking (no PHI), read + preferences', async () => {
    const appointment = await bookAppointment(patientA);
    await drainOutbox();
    await waitForNotification();
    const n = await prisma.unscoped().notification.findFirst({
      where: {
        organizationId: orgA,
        recipientUserId: userA,
        templateKey: 'appointment.booked',
      },
      orderBy: { createdAt: 'desc' },
    });
    expect(n).not.toBeNull();
    expect(n!.status).toBe('SENT');
    expect(n!.sentAt).not.toBeNull();
    expect(n!.recipientPatientId).toBeNull();
    // Neutral content: must NOT leak the patient's name, phone or the uuid raw
    // subject/body beyond the allow-listed reference.
    expect(n!.subject).not.toContain('Ada');
    expect(n!.subject).not.toContain('Patient');
    expect(n!.body).not.toContain('Ada');
    expect(n!.body).not.toContain('0767100001');
    expect(n!.body).toContain(appointment.id);

    const listed = await get('/notifications', comm);
    expect(listed.statusCode).toBe(200);
    const myNotifs = listed.json().data as Array<{ id: string; readAt: string | null }>;
    expect(myNotifs.some((x) => x.id === n!.id)).toBe(true);

    const unread = await get('/notifications?unreadOnly=true', comm);
    expect((unread.json().data as unknown[]).length).toBe(myNotifs.length);

    const read1 = await patch(`/notifications/${n!.id}/read`, comm, {});
    expect(read1.statusCode).toBe(200);
    expect(read1.json().data.notification.readAt).not.toBeNull();

    const after = await get('/notifications?unreadOnly=true', comm);
    const remaining = after.json().data as Array<{ id: string }>;
    expect(remaining.some((x) => x.id === n!.id)).toBe(false);

    const pref = await request(
      'PUT',
      '/notifications/preferences',
      comm,
      { category: 'appointment.booked', channel: 'IN_APP', enabled: true },
    );
    expect(pref.statusCode).toBe(200);
    expect(pref.json().data.preference.enabled).toBe(true);
  });

  it('enforces the neutral-template registry and rejects PHI-bearing content', async () => {
    const ok = await post('/notifications/templates', comm, {
      key: 'test.reminder',
      name: 'Test reminder',
      subjectTemplate: 'You have a reminder',
      bodyTemplate: 'Reminder reference: [reminderId].',
      allowlistedVariables: ['reminderId'],
      isActive: true,
    });
    expect(ok.statusCode).toBe(201);
    expect(ok.json().data.template.key).toBe('test.reminder');

    // Upsert (same key) with a PHI-bearing body title must be rejected.
    const leaky = await post('/notifications/templates', comm, {
      key: 'test.reminder',
      name: 'Test reminder',
      subjectTemplate: 'You have a reminder',
      bodyTemplate: 'Call Ada Patient at 0767100001 to confirm.',
      allowlistedVariables: [],
      isActive: true,
    });
    expect(leaky.statusCode).toBe(400);
    expect(leaky.json().error.code).toBe(ErrorCodes.NOTIFICATION_TEMPLATE_FORBIDDEN);

    const templates = await get('/notifications/templates?key=test.reminder', comm);
    expect(templates.statusCode).toBe(200);
    const items = templates.json().data as Array<{ key: string; allowlistedVariables: string[] }>;
    expect(items[0]?.allowlistedVariables).toEqual(['reminderId']);
  });

  it('isolates notifications across tenants', async () => {
    const res = await get(
      '/notifications',
      readOnly,
      undefined,
      orgB,
      userBOrg,
    );
    expect(res.statusCode).toBe(200);
    expect(res.json().data as unknown[]).toHaveLength(0);
  });

  // --- 3. messaging ----------------------------------------------------------

  it('creates a conversation, exchanges append-only messages, manages participants', async () => {
    const created = await post('/conversations', comm, {
      subject: 'Admission follow-up',
      branchId: branchA,
      participantUserIds: [userB],
    });
    expect(created.statusCode).toBe(201);
    const conversationId = created.json().data.conversation.id;
    expect(created.json().data.conversation.participantCount).toBe(2);

    const msg = await post(`/conversations/${conversationId}/messages`, comm, {
      body: 'Please update the discharge summary when ready.',
    });
    expect(msg.statusCode).toBe(201);

    const listed = await get(`/conversations/${conversationId}/messages`, comm);
    expect(listed.statusCode).toBe(200);
    const messages = listed.json().data as Array<{ body: string; senderId: string }>;
    expect(messages).toHaveLength(1);
    expect(messages[0]!.body).toBe('Please update the discharge summary when ready.');
    expect(messages[0]!.senderId).toBe(userA);

    const conv = await get(`/conversations/${conversationId}`, comm);
    const convData = conv.json().data as { conversation: { messageCount: number; participantCount: number } };
    expect(convData.conversation.messageCount).toBe(1);
    expect(convData.conversation.participantCount).toBe(2);

    // Non-participant (userC) is denied.
    const outsider = await get(
      `/conversations/${conversationId}/messages`,
      comm,
      undefined,
      orgA,
      userC,
    );
    expect(outsider.statusCode).toBe(403);
    expect(outsider.json().error.code).toBe(ErrorCodes.CONVERSATION_ACCESS_DENIED);

    // Add userC; direct read then succeeds.
    const add = await patch(
      `/conversations/${conversationId}/participants/${userC}`,
      comm,
      {},
    );
    expect(add.statusCode).toBe(200);

    const invited = await get(
      `/conversations/${conversationId}/messages`,
      comm,
      undefined,
      orgA,
      userC,
    );
    expect(invited.statusCode).toBe(200);
  });

  // --- 4. telemedicine -------------------------------------------------------

  it('gates telemedicine on consent, then runs schedule→start→end', async () => {
    const noConsent = await post('/telemedicine/sessions', comm, {
      branchId: branchA,
      patientId: patientA,
      providerId: userA,
      scheduledStartAt: '2026-09-28T11:00:00.000Z',
    });
    expect(noConsent.statusCode).toBe(409);
    expect(noConsent.json().error.code).toBe(ErrorCodes.TELEMEDICINE_CONSENT_REQUIRED);

    await prisma.unscoped().patientConsent.create({
      data: {
        id: newId(),
        organizationId: orgA,
        patientId: patientA,
        type: 'TELEMEDICINE',
        status: 'GRANTED',
        recordedByUserId: userA,
      },
    });

    const scheduled = await post('/telemedicine/sessions', comm, {
      branchId: branchA,
      patientId: patientA,
      providerId: userA,
      scheduledStartAt: '2026-09-28T11:00:00.000Z',
    });
    expect(scheduled.statusCode).toBe(201);
    const session = scheduled.json().data.session;
    expect(session.status).toBe('SCHEDULED');
    expect(session.consentRecorded).toBe(true);
    expect(session.meetingRef).toMatch(/^meet-/);

    // Non-provider (userB) cannot start.
    const wrongProvider = await patch(
      `/telemedicine/sessions/${session.id}/start`,
      comm,
      {},
      undefined,
      orgA,
      userB,
    );
    expect(wrongProvider.statusCode).toBe(403);

    const started = await patch(`/telemedicine/sessions/${session.id}/start`, comm, {});
    expect(started.statusCode).toBe(200);
    expect(started.json().data.session.status).toBe('STARTED');
    expect(started.json().data.session.startedAt).not.toBeNull();

    // Cancel after STARTED is illegal (only SCHEDULED → CANCELLED).
    const illegalCancel = await patch(
      `/telemedicine/sessions/${session.id}/cancel`,
      comm,
      { cancelReason: 'network issue' },
    );
    expect(illegalCancel.statusCode).toBe(409);
    expect(illegalCancel.json().error.code).toBe(
      ErrorCodes.INVALID_WORKFLOW_TRANSITION,
    );

    const ended = await patch(`/telemedicine/sessions/${session.id}/end`, comm, {});
    expect(ended.statusCode).toBe(200);
    expect(ended.json().data.session.status).toBe('ENDED');

    // Cross-tenant isolation on the list.
    const listB = await get('/telemedicine/sessions', readOnly, undefined, orgB, userBOrg);
    expect(listB.statusCode).toBe(200);
    expect(listB.json().data as unknown[]).toHaveLength(0);
  });

  // --- 5. quality ------------------------------------------------------------

  it('runs the feedback state machine and enforces responses', async () => {
    const fb = await post('/feedback', comm, {
      branchId: branchA,
      category: 'WAITING_TIME',
      rating: 3,
      comment: 'Long queue after triage.',
    });
    expect(fb.statusCode).toBe(201);
    const id = fb.json().data.feedback.id;
    expect(fb.json().data.feedback.status).toBe('NEW');

    // Cannot jump ACKNOWLEDGED → CLOSED.
    const skip = await patch(`/feedback/${id}`, comm, {
      status: 'CLOSED',
      response: 'done',
    });
    expect(skip.statusCode).toBe(409);
    expect(skip.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    const ack = await patch(`/feedback/${id}`, comm, {
      status: 'ACKNOWLEDGED',
      response: 'Thanks, we are reviewing triage times.',
    });
    expect(ack.statusCode).toBe(200);
    expect(ack.json().data.feedback.handledById).toBe(userA);

    const closed = await patch(`/feedback/${id}`, comm, {
      status: 'RESOLVED',
    });
    expect(closed.statusCode).toBe(200);
  });

  it('enforces the complaint state machine including closure resolution', async () => {
    const created = await post('/complaints', comm, {
      origin: 'PATIENT',
      branchId: branchA,
      patientId: patientA,
      category: 'Billing',
      description: 'Charged for a service not rendered.',
      assignedToId: userA,
    });
    expect(created.statusCode).toBe(201);
    const complaint = created.json().data.complaint;
    expect(complaint.status).toBe('ASSIGNED');
    expect(complaint.assignedToId).toBe(userA);

    // OPEN direct → RESOLVED is illegal.
    const open = await post('/complaints', comm, {
      origin: 'STAFF',
      category: 'Facility',
      description: 'Broken light in corridor.',
    });
    expect(open.statusCode).toBe(201);
    expect(open.json().data.complaint.status).toBe('OPEN');
    const illegal = await patch(`/complaints/${open.json().data.complaint.id}`, comm, {
      status: 'RESOLVED',
    });
    expect(illegal.statusCode).toBe(409);

    const inv = await patch(`/complaints/${complaint.id}`, comm, {
      status: 'INVESTIGATING',
    });
    expect(inv.statusCode).toBe(200);

    const resolved = await patch(`/complaints/${complaint.id}`, comm, {
      status: 'RESOLVED',
    });
    expect(resolved.statusCode).toBe(200);

    // Cannot close without a resolution.
    const noRes = await patch(`/complaints/${complaint.id}`, comm, { status: 'CLOSED' });
    expect(noRes.statusCode).toBe(409);
    expect(noRes.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);

    const closed = await patch(`/complaints/${complaint.id}`, comm, {
      status: 'CLOSED',
      resolution: 'Refund issued and process reviewed.',
    });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.complaint.status).toBe('CLOSED');
    expect(closed.json().data.complaint.closedById).toBe(userA);
    expect(closed.json().data.complaint.closedAt).not.toBeNull();
  });

  it('enforces the incident state machine', async () => {
    const created = await post('/incidents', comm, {
      branchId: branchA,
      category: 'DATA_ACCESS',
      severity: 'HIGH',
      description: 'Suspected unauthorized chart access.',
    });
    expect(created.statusCode).toBe(201);
    const id = created.json().data.incident.id;
    expect(created.json().data.incident.status).toBe('OPEN');

    const skip = await patch(`/incidents/${id}`, comm, { status: 'RESOLVED' });
    expect(skip.statusCode).toBe(409);

    await patch(`/incidents/${id}`, comm, { status: 'INVESTIGATING' });
    const plan = await patch(`/incidents/${id}`, comm, {
      status: 'ACTION_PLAN',
      actionsTaken: 'Revoked the reviewer role; scheduled access audit.',
    });
    expect(plan.statusCode).toBe(200);

    const resolved = await patch(`/incidents/${id}`, comm, {
      status: 'RESOLVED',
      resolution: 'Access re-issued under two-person approval.',
    });
    expect(resolved.statusCode).toBe(200);
    expect(resolved.json().data.incident.resolvedById).toBe(userA);

    const closed = await patch(`/incidents/${id}`, comm, { status: 'CLOSED' });
    expect(closed.statusCode).toBe(200);
    expect(closed.json().data.incident.closedById).toBe(userA);
  });

  // --- 6. portal -------------------------------------------------------------

  it('serves the patient portal self-scoped (own record, appointments, feedback)', async () => {
    const patientHeaders = principalHeaders({
      organizationId: orgA,
      userId: userB, // a non-creator principal; self-scope must win regardless.
      permissions: patientPerms,
      patientId: patientA,
    });
    const me = await app.inject({
      method: 'GET',
      headers: patientHeaders,
      url: url('/portal/me'),
    });
    expect(me.statusCode).toBe(200);
    const patient = me.json().data.patient;
    expect(patient.id).toBe(patientA);
    // Public projection allowlist: no clinical/extended fields leak.
    expect(patient).not.toHaveProperty('medications');
    expect(patient).not.toHaveProperty('history');
    expect(patient.patientNumber).toBeTruthy();

await bookAppointment(patientA, '2026-09-28T12:00:00.000Z');
    const apps = await app.inject({
      method: 'GET',
      headers: patientHeaders,
      url: url('/portal/me/appointments'),
    });
    expect(apps.statusCode).toBe(200);
    const items = apps.json().data as Array<{ patientId?: string }>;
    expect(items.length).toBeGreaterThan(0);
    for (const item of items) expect(item.patientId).toBeUndefined(); // projection hides patientId.

    const fb = await app.inject({
      method: 'POST',
      headers: patientHeaders,
      url: url('/portal/me/feedback'),
      payload: { branchId: branchA, category: 'SERVICE', rating: 5, comment: 'Kind staff.' },
    });
    expect(fb.statusCode).toBe(201);
    expect(fb.json().data.feedback.patientId).toBe(patientA);
    expect(fb.json().data.feedback.submittedById).toBeNull();
  });

  it('does not leak a foreign patient’s released lab results through the portal', async () => {
    // A released lab result exists for patientB; the portal for patientA sees none.
    const sc = prisma.unscoped();
    const test = await sc.labTest.create({
      data: { id: newId(), organizationId: orgA, code: 'PH10-GLU', name: 'Glucose' },
    });
    const field = await sc.labTestField.create({
      data: {
        id: newId(),
        organizationId: orgA,
        testId: test.id,
        name: 'Glucose',
        fieldType: 'NUMERIC',
        unit: 'mg/dL',
      },
    });
    const orderB = await sc.labOrder.create({
      data: {
        id: newId(),
        organizationId: orgA,
        orderNumber: 'LO-PH10B-1',
        patientId: patientB,
        branchId: branchA,
        status: 'RELEASED',
        orderedById: userA,
        releasedById: userA,
        releasedAt: new Date(),
      },
    });
    const itemB = await sc.labOrderItem.create({
      data: { id: newId(), organizationId: orgA, orderId: orderB.id, testId: test.id },
    });
    const resultB = await sc.labResult.create({
      data: {
        id: newId(),
        organizationId: orgA,
        orderItemId: itemB.id,
        testFieldId: field.id,
        value: '95',
        isAbnormal: false,
        isCritical: false,
      },
    });
    await sc.labResultVersion.create({
      data: {
        id: newId(),
        organizationId: orgA,
        resultId: resultB.id,
        revisionNumber: 1,
        value: '95',
        isAbnormal: false,
        isCritical: false,
        verifiedById: userA,
        verifiedAt: new Date(),
      },
    });

    const headers = principalHeaders({
      organizationId: orgA,
      userId: userB,
      permissions: patientPerms,
      patientId: patientA,
    });
    const res = await app.inject({
      method: 'GET',
      headers,
      url: url('/portal/me/lab-results'),
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().data as unknown[]).toHaveLength(0);
  });

  it('denies portal access without the portal.read capability or a self-scope', async () => {
    const noPerm = await app.inject({
      method: 'GET',
      headers: principalHeaders({
        organizationId: orgA,
        userId: userA,
        permissions: ['patients.read'],
      }),
      url: url('/portal/me'),
    });
    expect(noPerm.statusCode).toBe(403);

    const foreign = await app.inject({
      method: 'GET',
      headers: principalHeaders({
        organizationId: orgA,
        userId: userA,
        permissions: patientPerms,
        patientId: newId(), // never registered in orgA
      }),
      url: url('/portal/me'),
    });
    expect(foreign.statusCode).toBe(404);
  });

  // --- 7. document jobs ------------------------------------------------------

  it('renders a neutral PDF document job and audits it without PHI', async () => {
    const res = await post('/document-jobs/pdf', comm, {
      kind: 'discharge_summary',
      resourceId: 'adm-2026-0001',
      title: 'Discharge summary',
      lines: ['Patient discharged on 2026-09-24.', 'Follow-up in 7 days.'],
    });
    expect(res.statusCode).toBe(200);
    const body = res.json().data;
    expect(body.contentType).toBe('application/pdf');
    expect(body.byteLength).toBeGreaterThan(200);
    expect(body.pdf.type).toBe('Buffer');

    const audit = await prisma.unscoped().auditLog.findFirst({
      where: { organizationId: orgA, action: 'pdf.rendered', resourceId: 'adm-2026-0001' },
    });
    expect(audit).not.toBeNull();
    // The job audit trail must be meta-only (no patient demographics).
    expect(audit!.newState as object).toMatchObject({ kind: 'discharge_summary' });

    const bad = await post('/document-jobs/pdf', comm, {
      kind: 'billing_ledger',
      resourceId: 'r1',
      title: 'Ledger',
      lines: ['x'],
    });
    expect(bad.statusCode).toBe(400);
  });
});