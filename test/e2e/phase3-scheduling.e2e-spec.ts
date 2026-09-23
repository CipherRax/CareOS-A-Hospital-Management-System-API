import http from 'node:http';
import type { NestFastifyApplication } from '@nestjs/platform-fastify';
import { createTestApp, principalHeaders } from '../support/test-app';
import { ENV, type Env } from '../../src/config/config.module';
import { PrismaService } from '../../src/database/prisma.service';
import { ErrorCodes } from '../../src/common/errors/codes';
import { newId } from '../../src/common/lib/uuidv7';

/**
 * Brief Phase 3 — scheduling & patient flow. Exercises provider schedules and
 * slot discovery, the concurrency acceptance test (exactly one 201 + one 409
 * for a capacity-1 slot double-booked by two patients), appointment lifecycle
 * transitions, reschedule, waitlist offers, the walk-in digital queue with
 * sequential per-department tickets + waiting-room metrics, append-only vitals
 * with server-computed BMI, display-device pairing + token scoping + pairing
 * throttle, tenant-scoped staff SSE, and department-scoped device SSE.
 */

const sleep = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

interface SseFrame {
  event?: string;
  data?: string;
}

function openSse(url: string, headers: Record<string, string>): Promise<{
  frames: SseFrame[];
  close: () => void;
}> {
  return new Promise((resolve, reject) => {
    const req = http.get(
      url,
      { headers, timeout: 15_000 },
      (res) => {
        const frames: SseFrame[] = [];
        let buffer = '';
        res.setEncoding('utf8');
        res.on('data', (chunk: string) => {
          buffer += chunk;
          const blocks = buffer.split('\n\n');
          buffer = blocks.pop() ?? '';
          for (const block of blocks) {
            const event = /^event:\s*(\S+)/m.exec(block)?.[1];
            const data = /^data:\s*(.+)$/m.exec(block)?.[1];
            if (event !== undefined || data !== undefined) frames.push({ event, data });
          }
        });
        resolve({ frames, close: () => res.destroy() });
      },
    );
    req.on('error', reject);
  });
}

async function waitForFrame(
  frames: SseFrame[],
  predicate: (frame: SseFrame) => boolean,
  timeoutMs = 4000,
): Promise<SseFrame | undefined> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const hit = frames.find(predicate);
    if (hit) return hit;
    if (Date.now() >= deadline) return undefined;
    await sleep(60);
  }
}

describe('phase3 scheduling & patient flow', () => {
  jest.setTimeout(120_000);

  let app: NestFastifyApplication;
  let prisma: PrismaService;
  let env: Env;
  let serverUrl: string;
  let orgA: string;
  let orgB: string;
  let clerk: string;
  let provider: string;
  let branchA: string;
  let deptGen: string; // bookings + waitlist (prefix O)
  let deptQ: string; // walk-in queue + transitions (prefix W)
  let deptM: string; // metrics isolation (prefix M)
  let deptStats: string; // waiting-room metrics (prefix S) — no other traffic
  let deptBoard: string; // device-covered queue (prefix B)
  let deptLab: string; // device non-covered queue (prefix L) — negative

  const url = (path: string): string => `${env.API_PREFIX}${path}`;
  const sseUrl = (path: string): string => `${serverUrl}${url(path)}`;

  const headerFor = (permissions: string[], opts?: { org?: string; patientId?: string }) =>
    principalHeaders({
      organizationId: opts?.org ?? orgA,
      userId: clerk,
      permissions,
      ...(opts?.patientId ? { patientId: opts.patientId } : {}),
    });

  const request = (
    method: 'GET' | 'POST' | 'PATCH',
    path: string,
    permissions: string[],
    payload?: Record<string, unknown>,
    opts?: { org?: string; patientId?: string; headers?: Record<string, string> },
  ) =>
    app.inject({
      method,
      headers: { ...headerFor(permissions, opts), ...(opts?.headers ?? {}) },
      url: url(path),
      ...(payload ? { payload } : {}),
    });

  const post = (path: string, permissions: string[], payload: Record<string, unknown>, opts?: Record<string, unknown>) =>
    request('POST', path, permissions, payload, opts);
  const get = (path: string, permissions: string[], opts?: Record<string, unknown>) =>
    request('GET', path, permissions, undefined, opts);
  const patch = (path: string, permissions: string[], payload: Record<string, unknown>) =>
    request('PATCH', path, permissions, payload);

  const registerPatient = async (firstName: string, phone: string): Promise<string> => {
    const res = await post(
      '/patients',
      ['patients.create'],
      { firstName, lastName: 'Phase3', phone, dateOfBirth: '1990-01-01', sex: 'FEMALE' },
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.patient.id;
  };

  const addTemplate = async (date: Date, providerId: string, branchId: string, departmentId: string) => {
    const dayOfWeek = (date.getUTCDay() + 6) % 7; // 0=Mon..6=Sun
    const res = await post(
      '/schedules/templates',
      ['schedules.manage'],
      {
        providerId,
        branchId,
        departmentId,
        dayOfWeek,
        startMinutes: 480, // 08:00 UTC
        endMinutes: 600, // 10:00 UTC
        slotDurationMinutes: 30,
        capacity: 1,
      },
    );
    expect(res.statusCode).toBe(201);
    return res.json().data.schedule;
  };

  const book = (payload: Record<string, unknown>, perms = ['appointments.create'], opts?: Record<string, unknown>) =>
    post('/appointments', perms, payload, opts);

  const walkIn = (patientId: string, departmentId: string) =>
    post('/queue/walk-ins/register', ['queue.create'], { patientId, departmentId, branchId: branchA });

  beforeAll(async () => {
    app = await createTestApp({ tenantHeaders: true });
    prisma = app.get(PrismaService);
    env = app.get(ENV);
    await app.listen(0, '127.0.0.1');
    const addr = app.getHttpServer().address() as { port: number };
    serverUrl = `http://127.0.0.1:${addr.port}`;
    const sc = prisma.unscoped();

    orgA = newId();
    orgB = newId();
    clerk = newId();
    provider = newId();
    await sc.organization.createMany({
      data: [
        { id: orgA, name: 'Phase3 Org A' },
        { id: orgB, name: 'Phase3 Org B' },
      ],
    });
    await sc.user.createMany({
      data: [
        { id: clerk, organizationId: orgA, email: 'phase3.clerk@test.local', firstName: 'Phase', lastName: 'Clerk', status: 'ACTIVE' },
        { id: provider, organizationId: orgA, email: 'phase3.doc@test.local', firstName: 'Phase', lastName: 'Doc', status: 'ACTIVE' },
      ],
    });
    branchA = newId();
    await sc.branch.create({ data: { id: branchA, organizationId: orgA, name: 'Main Branch', code: 'MBR' } });

    const [g, q, m, s, b, l] = [newId(), newId(), newId(), newId(), newId(), newId()];
    deptGen = g;
    deptQ = q;
    deptM = m;
    deptStats = s;
    deptBoard = b;
    deptLab = l;
    const depts: Array<{ id: string; name: string }> = [
      { id: deptGen, name: 'Outpatient' },
      { id: deptQ, name: 'WalkIn' },
      { id: deptM, name: 'Metrics' },
      { id: deptStats, name: 'Stats' },
      { id: deptBoard, name: 'Boardroom' },
      { id: deptLab, name: 'Laboratory' },
    ];
    await Promise.all(
      depts.map((d) => sc.department.create({ data: { id: d.id, organizationId: orgA, name: d.name, code: d.name.toUpperCase().slice(0, 4) } })),
    );
  });

  afterAll(async () => {
    await app.close();
  });

  // --- scheduling + booking ------------------------------------------------

  it('guards booking behind appointments.create', async () => {
    const res = await book(
      {
        patientId: newId(),
        providerId: provider,
        branchId: branchA,
        departmentId: deptGen,
        startsAt: '2026-11-11T08:00:00.000Z',
      },
      ['queue.read'],
    );
    expect(res.statusCode).toBe(403);
    expect(res.json().error.code).toBe(ErrorCodes.PERMISSION_DENIED);
  });

  it('exposes bookable slots from a weekly template', async () => {
    const date = new Date('2026-10-07T00:00:00.000Z');
    await addTemplate(date, provider, branchA, deptGen);

    const res = await get(
      `/schedules/slots?providerId=${provider}&branchId=${branchA}&departmentId=${deptGen}&date=${date.toISOString()}`,
      ['schedules.read'],
    );
    expect(res.statusCode).toBe(200);
    const slots = res.json().data.slots as Array<{ startsAt: string; status: string }>;
    expect(slots).toHaveLength(4);
    expect(slots[0]!.startsAt).toBe('2026-10-07T08:00:00.000Z');
    expect(slots.every((s) => s.status === 'AVAILABLE')).toBe(true);
  });

  it('books a slot; concurrent double-booking yields exactly one 201 and one 409', async () => {
    const patientA = await registerPatient('DoubleA', '0711111001');
    const patientB = await registerPatient('DoubleB', '0711111002');
    const payload: Record<string, unknown> = {
      patientId: patientA,
      providerId: provider,
      branchId: branchA,
      departmentId: deptGen,
      startsAt: '2026-10-07T08:00:00.000Z',
      mode: 'IN_PERSON',
      appointmentType: 'FOLLOW_UP',
    };

    const [one, two] = await Promise.all([book(payload), book({ ...payload, patientId: patientB })]);
    const statuses = [one.statusCode, two.statusCode].sort();
    expect(statuses).toEqual([201, 409]);

    const winner = one.statusCode === 201 ? one : two;
    const loser = one.statusCode === 201 ? two : one;
    expect(loser.json().error.code).toBe(ErrorCodes.APPOINTMENT_CONFLICT);
    expect(winner.json().data.appointment.status).toBe('BOOKED');
    expect(winner.json().data.appointment.version).toBe(1);

    const rows = await prisma.unscoped().appointment.count({
      where: {
        organizationId: orgA,
        providerId: provider,
        startsAt: new Date('2026-10-07T08:00:00.000Z'),
        status: 'BOOKED',
      },
    });
    expect(rows).toBe(1);
  });

  it('walks the appointment lifecycle to completion', async () => {
    const date = new Date('2026-10-14T00:00:00.000Z');
    await addTemplate(date, provider, branchA, deptGen);
    const patient = await registerPatient('Lifecycle', '0711111003');
    const booked = await book({
      patientId: patient,
      providerId: provider,
      branchId: branchA,
      departmentId: deptGen,
      startsAt: '2026-10-14T08:00:00.000Z',
    });
    expect(booked.statusCode).toBe(201);
    const id = booked.json().data.appointment.id;

    for (const status of ['CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS', 'COMPLETED']) {
      const res = await patch(`/appointments/${id}/status`, ['appointments.manage'], { status });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.appointment.status).toBe(status);
    }
  });

  it('rejects an illegal appointment transition', async () => {
    const date = new Date('2026-11-04T00:00:00.000Z');
    await addTemplate(date, provider, branchA, deptGen);
    const patient = await registerPatient('IllegalMove', '0711111004');
    const booked = await book({
      patientId: patient,
      providerId: provider,
      branchId: branchA,
      departmentId: deptGen,
      startsAt: '2026-11-04T08:00:00.000Z',
    });
    const id = booked.json().data.appointment.id;

    const res = await patch(`/appointments/${id}/status`, ['appointments.manage'], {
      status: 'IN_PROGRESS',
    });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('reschedules into a free slot, marking the original RESCHEDULED', async () => {
    const date = new Date('2026-10-21T00:00:00.000Z');
    await addTemplate(date, provider, branchA, deptGen);
    const patient = await registerPatient('Reschedule', '0711111005');
    const booked = await book({
      patientId: patient,
      providerId: provider,
      branchId: branchA,
      departmentId: deptGen,
      startsAt: '2026-10-21T08:00:00.000Z',
    });
    const id = booked.json().data.appointment.id;

    const res = await post(`/appointments/${id}/reschedule`, ['appointments.reschedule'], {
      startsAt: '2026-10-21T09:30:00.000Z',
      version: booked.json().data.appointment.version,
      reason: 'Work conflict',
    });
    expect(res.statusCode).toBe(201);
    const { appointment, superseded } = res.json().data;
    expect(superseded.status).toBe('RESCHEDULED');
    expect(appointment.rescheduledFromId).toBe(id);
    expect(appointment.startsAt).toBe('2026-10-21T09:30:00.000Z');

    const slots = await get(
      `/schedules/slots?providerId=${provider}&branchId=${branchA}&departmentId=${deptGen}&date=${date.toISOString()}`,
      ['schedules.read'],
    );
    const eight = slots.json().data.slots.find((s: { startsAt: string }) => s.startsAt === '2026-10-21T08:00:00.000Z');
    expect(eight.status).toBe('AVAILABLE');
    const nineThirty = slots.json().data.slots.find((s: { startsAt: string }) => s.startsAt === '2026-10-21T09:30:00.000Z');
    expect(nineThirty.booked).toBe(1);
  });

  it('offers a cancelled slot to the waitlist and accepts it into a booking', async () => {
    const date = new Date('2026-10-28T00:00:00.000Z');
    await addTemplate(date, provider, branchA, deptGen);
    const waiter = await registerPatient('Waiter', '0711111006');
    const canceller = await registerPatient('Canceller', '0711111007');

    const joined = await post('/appointments/waitlist/entries', ['waitlist.manage'], {
      patientId: waiter,
      branchId: branchA,
      departmentId: deptGen,
      notes: 'Any slot',
    });
    expect(joined.statusCode).toBe(201);
    const waitlistId = joined.json().data.entry.id;

    const made = await book({
      patientId: canceller,
      providerId: provider,
      branchId: branchA,
      departmentId: deptGen,
      startsAt: '2026-10-28T08:00:00.000Z',
    });
    const cancelled = await post(`/appointments/${made.json().data.appointment.id}/cancel`, ['appointments.cancel'], {});
    expect(cancelled.statusCode).toBe(201);
    expect(cancelled.json().data.appointment.status).toBe('CANCELLED');

    const offered = await get(`/appointments/waitlist/entries?departmentId=${deptGen}`, ['waitlist.read']);
    const entry = offered.json().data.find((e: { id: string }) => e.id === waitlistId);
    expect(entry.status).toBe('OFFERED');
    expect(entry.offeredStartAt).toBe('2026-10-28T08:00:00.000Z');

    const accept = await post(`/appointments/waitlist/entries/${waitlistId}/accept`, ['waitlist.manage'], {});
    expect(accept.statusCode).toBe(201);
    expect(accept.json().data.appointment.patientId).toBe(waiter);
    expect(accept.json().data.appointment.startsAt).toBe('2026-10-28T08:00:00.000Z');

    const forWaiter = await get(`/appointments?patientId=${waiter}`, ['appointments.read']);
    const apt = forWaiter.json().data.find((a: { startsAt: string }) => a.startsAt === '2026-10-28T08:00:00.000Z');
    expect(apt.status).toBe('BOOKED');
  });

  // --- walk-in queue --------------------------------------------------------

  it('issues sequential per-department walk-in tickets', async () => {
    const p1 = await registerPatient('WalkOne', '0711111008');
    const p2 = await registerPatient('WalkTwo', '0711111009');

    const r1 = await walkIn(p1, deptQ);
    expect(r1.statusCode).toBe(201);
    const r2 = await walkIn(p2, deptQ);
    expect(r2.statusCode).toBe(201);

    const t1 = r1.json().data.ticketNumber as string;
    const t2 = r2.json().data.ticketNumber as string;
    expect(t1).toMatch(/^W\d{3}$/);
    expect(t2).toBe(`W${String(Number(t1.slice(1)) + 1).padStart(3, '0')}`);
    expect(r2.json().data.status).toBe('WAITING');
  });

  it('blocks a second walk-in while a visit is active', async () => {
    const p = await registerPatient('Revisit', '0711111010');
    const first = await walkIn(p, deptM);
    expect(first.statusCode).toBe(201);
    const blocked = await walkIn(p, deptM);
    expect(blocked.statusCode).toBe(409);
    expect(blocked.json().error.code).toBe(ErrorCodes.VISIT_ALREADY_ACTIVE);
  });

  it('walks a queue entry through CALLED → IN_SERVICE → COMPLETED', async () => {
    const p = await registerPatient('Advance', '0711111011');
    await walkIn(p, deptQ);
    const row = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: p },
      select: { id: true },
    });

    for (const status of ['CALLED', 'IN_SERVICE', 'COMPLETED']) {
      const res = await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status });
      expect(res.statusCode).toBe(200);
      expect(res.json().data.status).toBe(status);
    }

    const list = await get(`/queue?departmentId=${deptQ}&status=COMPLETED`, ['queue.read']);
    expect(list.json().data.some((e: { id: string }) => e.id === row!.id)).toBe(true);
  });

  it('refuses an illegal queue transition', async () => {
    const p = await registerPatient('Skip', '0711111012');
    await walkIn(p, deptQ);
    const row = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: p },
      select: { id: true },
    });

    const res = await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'COMPLETED' });
    expect(res.statusCode).toBe(409);
    expect(res.json().error.code).toBe(ErrorCodes.INVALID_WORKFLOW_TRANSITION);
  });

  it('self-service queue status requires a patient scope and reports position', async () => {
    const p = await registerPatient('SelfServe', '0711111013');
    await walkIn(p, deptQ);

    const denied = await get('/queue/status', ['queue.read']);
    expect(denied.statusCode).toBe(403);

    const mine = await get('/queue/status', ['queue.read'], { patientId: p });
    expect(mine.statusCode).toBe(200);
    const data = mine.json().data;
    expect(data.queued).toBe(true);
    expect(data.ticketNumber).toMatch(/^W\d{3}$/);
    expect(typeof data.position).toBe('number');
  });

  it('aggregates call-wait, service time and abandonment for a department', async () => {
    const c1 = await registerPatient('MetricOne', '0711111014');
    const c2 = await registerPatient('MetricTwo', '0711111015');
    await walkIn(c1, deptStats);
    await walkIn(c2, deptStats);

    const [e1] = await prisma.unscoped().queueEntry.findMany({
      where: { organizationId: orgA, patientId: { in: [c1, c2] } },
      orderBy: { ticketNumber: 'asc' },
      select: { id: true },
    });
    const e2 = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: c2 },
      select: { id: true },
    });

    await patch(`/queue/entries/${e1!.id}/status`, ['queue.manage'], { status: 'CALLED' });
    await patch(`/queue/entries/${e1!.id}/status`, ['queue.manage'], { status: 'IN_SERVICE' });
    await patch(`/queue/entries/${e1!.id}/status`, ['queue.manage'], { status: 'COMPLETED' });
    await patch(`/queue/entries/${e2!.id}/status`, ['queue.manage'], { status: 'NO_SHOW' });

    const res = await get(`/queue/metrics?departmentId=${deptStats}`, ['queue.read']);
    expect(res.statusCode).toBe(200);
    const stats = res.json().data.stats;
    expect(typeof stats.avgCallWaitMinutes).toBe('number');
    expect(typeof stats.avgServiceMinutes).toBe('number');
    expect(stats.currentlyWaiting).toBe(0);
    expect(stats.abandonmentRate).toBeCloseTo(0.5);
  });

  // --- vitals ---------------------------------------------------------------

  it('records and corrects vitals append-only with BMI', async () => {
    const p = await registerPatient('Vitals', '0711111016');
    const rec = await post('/vitals', ['vitals.record'], {
      patientId: p,
      temperatureC: 37.0,
      weightKg: 70,
      heightCm: 175,
      notes: 'baseline',
    });
    expect(rec.statusCode).toBe(201);
    const original = rec.json().data.vitalRecord;
    expect(original.bmi).toBe(22.9);
    expect(original.bmiCategory).toBe('NORMAL');

    const corrected = await post(`/vitals/${original.id}/correct`, ['vitals.record'], {
      correctionReason: 'out-of-range reading corrected',
      temperatureC: 37.4,
      weightKg: 70,
      heightCm: 175,
    });
    expect(corrected.statusCode).toBe(201);
    const replacement = corrected.json().data.vitalRecord;
    expect(replacement.id).not.toBe(original.id);
    expect(replacement.correctionOfId).toBe(original.id);
    expect(replacement.temperatureC).toBe(37.4);

    const list = await get(`/vitals?patientId=${p}`, ['vitals.read']);
    expect(list.statusCode).toBe(200);
    expect(list.json().data).toHaveLength(2);
    expect(list.json().data.some((v: { correctionOfId: string | null }) => v.correctionOfId !== null)).toBe(true);
  });

  it('guards vitals reads behind vitals.read', async () => {
    const p = await registerPatient('VitalsGuard', '0711111017');
    await post('/vitals', ['vitals.record'], { patientId: p, pulseBpm: 72 });
    const res = await get(`/vitals?patientId=${p}`, ['queue.read']);
    expect(res.statusCode).toBe(403);
  });

  // --- display devices ------------------------------------------------------

  it('pairs a display device and serves a scoped board until revoked', async () => {
    const registered = await post('/display/devices', ['display.devices.manage'], {
      branchId: branchA,
      name: 'Reception Board',
      departmentIds: [deptBoard],
    });
    expect(registered.statusCode).toBe(201);
    const device = registered.json().data.device;
    const pairingCode = registered.json().data.pairingCode as string;
    expect(device.status).toBe('PENDING_PAIRING');

    const paired = await app.inject({
      method: 'POST',
      url: url('/display/devices/pair'),
      payload: { code: pairingCode },
    });
    expect(paired.statusCode).toBe(201);
    const token = paired.json().data.accessToken as string;
    expect(token).toContain(`${orgA}.`);

    const guardDenied = await app.inject({
      method: 'GET',
      url: url('/display/devices/board'),
    });
    expect(guardDenied.statusCode).toBe(401);

    const board = await app.inject({
      method: 'GET',
      url: url('/display/devices/board'),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(board.statusCode).toBe(200);
    expect(board.json().data.departments).toHaveLength(1);
    expect(board.json().data.departments[0].name).toBe('Boardroom');

    const revoked = await post(`/display/devices/${device.id}/revoke`, ['display.devices.manage'], {});
    expect(revoked.statusCode).toBe(201);
    expect(revoked.json().data.device.status).toBe('REVOKED');

    const afterRevoke = await app.inject({
      method: 'GET',
      url: url('/display/devices/board'),
      headers: { authorization: `Bearer ${token}` },
    });
    expect(afterRevoke.statusCode).toBe(401);
  });

  it('reflects queued tickets on the board and throttles bad pairings per IP', async () => {
    const registered = await post('/display/devices', ['display.devices.manage'], {
      branchId: branchA,
      name: 'Board Two',
      departmentIds: [deptBoard],
    });
    const pairingCode = registered.json().data.pairingCode as string;

    const p = await registerPatient('BoardTicket', '0711111018');
    await walkIn(p, deptBoard);

    const paired = await app.inject({
      method: 'POST',
      url: url('/display/devices/pair'),
      payload: { code: pairingCode },
    });
    const token = paired.json().data.accessToken as string;

    const board = await app.inject({
      method: 'GET',
      url: url('/display/devices/board'),
      headers: { authorization: `Bearer ${token}` },
    });
    const nextUp = board.json().data.departments[0].nextUp as Array<{ ticketNumber: string }>;
    expect(nextUp.some((e) => /^B\d{3}$/.test(e.ticketNumber))).toBe(true);

    // IP throttle: 7 failures are tolerated, then the 8th hits the 429 ceiling.
    const ipHeader = { 'x-forwarded-for': '10.99.0.7' };
    for (let i = 0; i < 7; i += 1) {
      const bad = await app.inject({
        method: 'POST',
        url: url('/display/devices/pair'),
        headers: ipHeader,
        payload: { code: 'NOPE78' },
      });
      expect(bad.statusCode).toBe(401);
      expect(bad.json().error.code).toBe(ErrorCodes.PAIRING_CODE_INVALID);
    }
    const throttled = await app.inject({
      method: 'POST',
      url: url('/display/devices/pair'),
      headers: ipHeader,
      payload: { code: 'NOPE79' },
    });
    expect(throttled.statusCode).toBe(429);
    expect(throttled.json().error.code).toBe(ErrorCodes.PAIRING_ATTEMPTS_EXCEEDED);
  });

  // --- realtime SSE ---------------------------------------------------------

  it('streams tenant-scoped queue events to staff SSE clients', async () => {
    const p = await registerPatient('SseStaff', '0711111019');
    const { ticketNumber } = (await walkIn(p, deptQ)).json().data as { ticketNumber: string };
    const row = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: p },
      select: { id: true },
    });

    const stream = await openSse(sseUrl('/realtime/stream?topics=queue'), headerFor(['queue.read']));
    try {
      await waitForFrame(stream.frames, (f) => f.event === 'connected');
      await sleep(300);

      let hit: SseFrame | undefined;
      for (let i = 0; i < 6 && !hit; i += 1) {
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'CALLED' });
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'WAITING' });
        hit = await waitForFrame(
          stream.frames,
          (f) => f.data?.includes(`"ticketNumber":"${ticketNumber}"`) === true,
          900,
        );
      }
      expect(hit).toBeDefined();
      const parsed = JSON.parse(hit!.data!) as {
        event: string;
        payload: { ticketNumber: string; status: string };
      };
      expect(parsed.payload.ticketNumber).toBe(ticketNumber);
      expect(parsed.payload).not.toHaveProperty('patientId');
    } finally {
      stream.close();
    }
  });

  it('does not leak queue events across tenants', async () => {
    const p = await registerPatient('SseHolder', '0711111020');
    await walkIn(p, deptQ);
    const row = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: p },
      select: { id: true },
    });

    const stream = await openSse(sseUrl('/realtime/stream?topics=queue'), headerFor(['queue.read'], { org: orgB }));
    try {
      await waitForFrame(stream.frames, (f) => f.event === 'connected');
      await sleep(300);

      const baseline = stream.frames.length;
      for (let i = 0; i < 4; i += 1) {
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'CALLED' });
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'WAITING' });
      }
      await sleep(1200);
      const leaked = stream.frames.slice(baseline).filter((f) => f.data !== undefined);
      expect(leaked).toHaveLength(0);
    } finally {
      stream.close();
    }
  });

  it('scopes the device stream to its own departments', async () => {
    const registered = await post('/display/devices', ['display.devices.manage'], {
      branchId: branchA,
      name: 'Stream Board',
      departmentIds: [deptBoard],
    });
    const pairingCode = registered.json().data.pairingCode as string;
    const paired = await app.inject({
      method: 'POST',
      url: url('/display/devices/pair'),
      payload: { code: pairingCode },
    });
    const token = paired.json().data.accessToken as string;

    const covered = await registerPatient('DevCovered', '0711111021');
    const { ticketNumber } = (await walkIn(covered, deptBoard)).json().data as { ticketNumber: string };
    const row = await prisma.unscoped().queueEntry.findFirst({
      where: { organizationId: orgA, patientId: covered },
      select: { id: true },
    });

    const stream = await openSse(sseUrl('/display/devices/stream'), { authorization: `Bearer ${token}` });
    try {
      await waitForFrame(stream.frames, (f) => f.event === 'connected');
      await sleep(300);

      let hit: SseFrame | undefined;
      for (let i = 0; i < 6 && !hit; i += 1) {
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'CALLED' });
        await patch(`/queue/entries/${row!.id}/status`, ['queue.manage'], { status: 'WAITING' });
        hit = await waitForFrame(
          stream.frames,
          (f) => f.data?.includes(`"ticketNumber":"${ticketNumber}"`) === true,
          900,
        );
      }
      expect(hit).toBeDefined();

      // A different department (not covered) must never reach the device.
      const lab = await registerPatient('DevLab', '0711111022');
      const baseline = stream.frames.length;
      await walkIn(lab, deptLab);
      await sleep(1200);
      const extraneous = stream.frames.slice(baseline).filter((f) => f.data !== undefined);
      expect(extraneous).toHaveLength(0);
    } finally {
      stream.close();
    }
  });

  // --- tenant isolation -----------------------------------------------------

  it('isolates booking lookups across tenants (404 for a foreign provider)', async () => {
    const patient = await registerPatient('TenantSealed', '0711111023');
    const res = await book(
      {
        patientId: patient,
        providerId: provider,
        branchId: branchA,
        departmentId: deptGen,
        startsAt: '2026-10-07T09:00:00.000Z',
      },
      ['appointments.create'],
      { org: orgB },
    );
    expect(res.statusCode).toBe(404);
    expect(res.json().error.code).toBe(ErrorCodes.PATIENT_NOT_FOUND);
  });
});