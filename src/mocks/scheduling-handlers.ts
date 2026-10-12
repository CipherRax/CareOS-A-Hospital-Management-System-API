import { http, HttpResponse } from 'msw';

import {
  APPOINTMENTS,
  FIRST_APPOINTMENT_SEQUENCE,
  FIRST_WAITLIST_SEQUENCE,
  PROVIDERS,
  SCHEDULES,
  SCHEDULING_BRANCH,
  WAITLIST,
  workdayIndexFor,
  type AppointmentFixture,
  type ScheduleTemplateFixture,
  type WaitlistFixture,
} from '@/mocks/fixtures/scheduling-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from './handlers';

/**
 * F3 scheduling handlers (reception desk).
 *
 * Same contract and same records as `e2e/stub-api.mjs`. Appointments and the
 * waitlist are mutable for the session, and slots are computed from the seeded
 * weekly templates, so booking → the day book → status moves all behave as the
 * API does rather than as a bag of fixtures.
 *
 * The transition graph mirrors the API's `appointment-flow.ts`. An illegal move
 * answers 409 `INVALID_WORKFLOW_TRANSITION`, and a full slot answers 409
 * `APPOINTMENT_CONFLICT`, exactly as the server does.
 */

const TRANSITIONS: Record<string, readonly string[]> = {
  BOOKED: ['CONFIRMED', 'CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CONFIRMED: ['CHECKED_IN', 'CANCELLED', 'NO_SHOW'],
  CHECKED_IN: ['IN_PROGRESS', 'CANCELLED', 'NO_SHOW'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
  CANCELLED: [],
  NO_SHOW: [],
  RESCHEDULED: [],
};

const OCCUPYING = new Set(['BOOKED', 'CONFIRMED', 'CHECKED_IN', 'IN_PROGRESS']);
const TERMINAL = new Set(['COMPLETED', 'CANCELLED', 'NO_SHOW', 'RESCHEDULED']);
const ACTIONABLE_WAITLIST = new Set(['WAITING', 'OFFERED']);

interface LiveAppointment {
  id: string;
  organizationId: string;
  branchId: string;
  departmentId: string;
  patientId: string;
  providerId: string;
  startsAt: string;
  endsAt: string;
  mode: string;
  appointmentType: string | null;
  reason: string | null;
  status: string;
  version: number;
  checkedInAt: string | null;
  inProgressAt: string | null;
  completedAt: string | null;
  noShowAt: string | null;
  cancelledAt: string | null;
  cancelReason: string | null;
  rescheduledFromId: string | null;
  rescheduledToId: string | null;
  rescheduledAt: string | null;
  createdAt: string;
  updatedAt: string;
}

interface LiveWaitlist {
  id: string;
  branchId: string;
  departmentId: string;
  patientId: string;
  providerId: string | null;
  status: string;
  offeredAt: string | null;
  offerExpiresAt: string | null;
  offeredStartAt: string | null;
  acceptedAppointmentId: string | null;
  resolvedAt: string | null;
  preferredDate: string | null;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

const SLOT_MINUTES = 30;

function utcDayStart(dateISO: string): Date {
  const [year = 0, month = 1, day = 1] = dateISO.split('-').map(Number);
  return new Date(Date.UTC(year, month - 1, day, 0, 0, 0, 0));
}

function todayISO(): string {
  const now = new Date();
  const month = String(now.getUTCMonth() + 1).padStart(2, '0');
  const day = String(now.getUTCDate()).padStart(2, '0');
  return `${now.getUTCFullYear()}-${month}-${day}`;
}

/** The `YYYY-MM-DD` business day of a timestamp. */
function businessDayKey(iso: string): string {
  const date = new Date(iso);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');
  return `${date.getUTCFullYear()}-${month}-${day}`;
}

function fromAppointmentFixture(fixture: AppointmentFixture): LiveAppointment {
  const day = utcDayStart(todayISO());
  const startsAt = new Date(day.getTime() + fixture.startMinutes * 60_000);
  const endsAt = new Date(startsAt.getTime() + SLOT_MINUTES * 60_000);
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    branchId: SCHEDULING_BRANCH,
    departmentId: fixture.departmentId,
    patientId: fixture.patientId,
    providerId: fixture.providerId,
    startsAt: startsAt.toISOString(),
    endsAt: endsAt.toISOString(),
    mode: fixture.mode,
    appointmentType: fixture.appointmentType,
    reason: fixture.reason,
    status: fixture.status,
    version: 1,
    checkedInAt: null,
    inProgressAt: null,
    completedAt: fixture.status === 'COMPLETED' ? endsAt.toISOString() : null,
    noShowAt: fixture.status === 'NO_SHOW' ? endsAt.toISOString() : null,
    cancelledAt: null,
    cancelReason: null,
    rescheduledFromId: null,
    rescheduledToId: null,
    rescheduledAt: null,
    createdAt: new Date(day.getTime() - 86_400_000).toISOString(),
    updatedAt: new Date(day.getTime()).toISOString(),
  };
}

function fromWaitlistFixture(fixture: WaitlistFixture): LiveWaitlist {
  const day = utcDayStart(todayISO());
  const offeredStartAt =
    fixture.offerMinutes === null
      ? null
      : new Date(day.getTime() + fixture.offerMinutes * 60_000).toISOString();
  return {
    id: fixture.id,
    branchId: SCHEDULING_BRANCH,
    departmentId: fixture.departmentId,
    patientId: fixture.patientId,
    providerId: fixture.providerId,
    status: fixture.status,
    offeredAt: offeredStartAt ? new Date(day.getTime() - 3_600_000).toISOString() : null,
    offerExpiresAt: offeredStartAt
      ? new Date(day.getTime() + 86_400_000).toISOString()
      : null,
    offeredStartAt,
    acceptedAppointmentId: null,
    resolvedAt: null,
    preferredDate: null,
    notes: fixture.notes,
    createdAt: new Date(day.getTime() - 7_200_000).toISOString(),
    updatedAt: new Date(day.getTime()).toISOString(),
  };
}

const LIVE_APPOINTMENTS: LiveAppointment[] = APPOINTMENTS.map(fromAppointmentFixture);
const LIVE_WAITLIST: LiveWaitlist[] = WAITLIST.map(fromWaitlistFixture);
let appointmentSequence = FIRST_APPOINTMENT_SEQUENCE;
let waitlistSequence = FIRST_WAITLIST_SEQUENCE;

interface LiveTemplate extends Mutable<ScheduleTemplateFixture> {
  id: string;
  branchId: string;
  isAvailable: boolean;
  note: string | null;
}

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

interface LiveOverride {
  id: string;
  providerId: string;
  branchId: string;
  departmentId: string;
  date: string;
  type: string;
  startMinutes: number | null;
  endMinutes: number | null;
  slotDurationMinutes: number | null;
  capacity: number | null;
  note: string | null;
}

/**
 * Weekly templates are mutable for the session. There is no override seed: the
 * API has no list endpoint for overrides (GAP-019), so the admin screen starts
 * unknown and overrides only exist once this session creates one.
 */
const LIVE_TEMPLATES: LiveTemplate[] = SCHEDULES.map((template, index) => ({
  ...template,
  id: `sch_example_${800 + index}`,
  branchId: SCHEDULING_BRANCH,
  isAvailable: true,
  note: null,
}));
const LIVE_OVERRIDES: LiveOverride[] = [];
let templateSequence = 800 + SCHEDULES.length;
let overrideSequence = 900;

function pageEnvelope<T>(items: readonly T[], total: number) {
  return apiPage(items, total, 100);
}

function providerRows() {
  return PROVIDERS.map((provider) => ({ ...provider }));
}

function findAppointment(id: string): LiveAppointment | undefined {
  return LIVE_APPOINTMENTS.find((appointment) => appointment.id === id);
}

function findWaitlist(id: string): LiveWaitlist | undefined {
  return LIVE_WAITLIST.find((entry) => entry.id === id);
}

interface GeneratedSlot {
  startsAt: string;
  endsAt: string;
  capacity: number;
  booked: number;
  remaining: number;
  status: string;
}

/**
 * Mirrors `schedules/domain/slots.ts`: per-date overrides win over the weekly
 * template. A LEAVE/HOLIDAY/BLOCKED override closes the whole day; a WORKING
 * override replaces the template's windows entirely. Bookings are subtracted
 * from each slot's capacity.
 */
function generateSlots(providerId: string, departmentId: string, dateISO: string): GeneratedSlot[] {
  const day = utcDayStart(dateISO);
  const dayIndex = workdayIndexFor(day);

  const overrides = LIVE_OVERRIDES.filter(
    (override) => override.providerId === providerId && override.date === dateISO,
  );
  if (overrides.some((override) => override.type !== 'WORKING')) return [];

  const working = overrides.filter((override) => override.type === 'WORKING');
  const windows = working.length
    ? working.map((override) => ({
        startMinutes: override.startMinutes ?? 0,
        endMinutes: override.endMinutes ?? 1440,
        slotDurationMinutes: override.slotDurationMinutes ?? SLOT_MINUTES,
        capacity: override.capacity ?? 1,
      }))
    : SCHEDULES.filter(
        (template) =>
          template.providerId === providerId &&
          template.departmentId === departmentId &&
          template.dayOfWeek === dayIndex,
      ).map((template) => ({
        startMinutes: template.startMinutes,
        endMinutes: template.endMinutes,
        slotDurationMinutes: template.slotDurationMinutes,
        capacity: template.capacity,
      }));

  const bookings = LIVE_APPOINTMENTS.filter(
    (appointment) =>
      appointment.providerId === providerId &&
      businessDayKey(appointment.startsAt) === dateISO &&
      OCCUPYING.has(appointment.status),
  );
  const now = Date.now();
  const slots: GeneratedSlot[] = [];
  for (const window of windows) {
    for (
      let start = window.startMinutes;
      start + window.slotDurationMinutes <= window.endMinutes;
      start += window.slotDurationMinutes
    ) {
      const startsAt = new Date(day.getTime() + start * 60_000);
      const endsAt = new Date(startsAt.getTime() + window.slotDurationMinutes * 60_000);
      const booked = bookings.filter((booking) => booking.startsAt === startsAt.toISOString()).length;
      const remaining = Math.max(0, window.capacity - booked);
      let status = 'AVAILABLE';
      if (remaining <= 0) status = 'FULL';
      else if (startsAt.getTime() <= now) status = 'PAST';
      slots.push({
        startsAt: startsAt.toISOString(),
        endsAt: endsAt.toISOString(),
        capacity: window.capacity,
        booked,
        remaining,
        status,
      });
    }
  }
  slots.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
  return slots;
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export const schedulingHandlers = [
  // --- providers ----------------------------------------------------------
  http.get('*/api/v1/providers', ({ request }) => {
    const url = new URL(request.url);
    const departmentId = url.searchParams.get('departmentId');
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let rows = providerRows();
    if (departmentId) rows = rows.filter((provider) => provider.departmentIds.includes(departmentId));
    if (q) rows = rows.filter((provider) => provider.name.toLowerCase().includes(q));
    return HttpResponse.json(pageEnvelope(rows, rows.length));
  }),

  // --- slots --------------------------------------------------------------
  http.get('*/api/v1/schedules/slots', ({ request }) => {
    const url = new URL(request.url);
    const providerId = url.searchParams.get('providerId') ?? '';
    const departmentId = url.searchParams.get('departmentId') ?? '';
    const date = url.searchParams.get('date') ?? todayISO();
    return HttpResponse.json(
      apiOk({ date: utcDayStart(date).toISOString(), slots: generateSlots(providerId, departmentId, date) }),
    );
  }),

  // --- schedule templates (admin) ----------------------------------------
  http.get('*/api/v1/schedules/templates', ({ request }) => {
    const url = new URL(request.url);
    const providerId = url.searchParams.get('providerId');
    const departmentId = url.searchParams.get('departmentId');
    const dayOfWeek = url.searchParams.get('dayOfWeek');
    let rows = [...LIVE_TEMPLATES];
    if (providerId) rows = rows.filter((template) => template.providerId === providerId);
    if (departmentId) rows = rows.filter((template) => template.departmentId === departmentId);
    if (dayOfWeek !== null) {
      const day = Number(dayOfWeek);
      rows = rows.filter((template) => template.dayOfWeek === day);
    }
    rows.sort((a, b) => a.dayOfWeek - b.dayOfWeek || a.startMinutes - b.startMinutes);
    return HttpResponse.json(pageEnvelope(rows, rows.length));
  }),

  http.post('*/api/v1/schedules/templates', async ({ request }) => {
    const body = await readJson(request);
    if (!body || typeof body.providerId !== 'string' || typeof body.departmentId !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'providerId and departmentId required'), {
        status: 422,
      });
    }
    const template: LiveTemplate = {
      id: `sch_example_${templateSequence}`,
      providerId: body.providerId,
      branchId: typeof body.branchId === 'string' ? body.branchId : SCHEDULING_BRANCH,
      departmentId: body.departmentId,
      dayOfWeek: typeof body.dayOfWeek === 'number' ? body.dayOfWeek : 0,
      startMinutes: typeof body.startMinutes === 'number' ? body.startMinutes : 480,
      endMinutes: typeof body.endMinutes === 'number' ? body.endMinutes : 780,
      slotDurationMinutes: typeof body.slotDurationMinutes === 'number' ? body.slotDurationMinutes : 30,
      capacity: typeof body.capacity === 'number' ? body.capacity : 1,
      isAvailable: typeof body.isAvailable === 'boolean' ? body.isAvailable : true,
      note: typeof body.note === 'string' && body.note.length > 0 ? body.note : null,
    };
    templateSequence += 1;
    LIVE_TEMPLATES.push(template);
    return HttpResponse.json(apiOk({ schedule: template }, 'req_mock_template_create'), {
      status: 201,
    });
  }),

  http.patch('*/api/v1/schedules/templates/:id', async ({ params, request }) => {
    const template = LIVE_TEMPLATES.find((row) => row.id === String(params.id));
    if (!template) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Schedule not found.'), { status: 404 });
    }
    const body = await readJson(request);
    if (body) {
      for (const key of [
        'dayOfWeek',
        'startMinutes',
        'endMinutes',
        'slotDurationMinutes',
        'capacity',
      ] as const) {
        const value = body[key];
        if (typeof value === 'number') template[key] = value;
      }
      if (typeof body.isAvailable === 'boolean') template.isAvailable = body.isAvailable;
      if (typeof body.note === 'string' && body.note.length > 0) template.note = body.note;
    }
    return HttpResponse.json(apiOk({ schedule: template }, 'req_mock_template_update'));
  }),

  http.delete('*/api/v1/schedules/templates/:id', ({ params }) => {
    const index = LIVE_TEMPLATES.findIndex((row) => row.id === String(params.id));
    if (index < 0) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Schedule not found.'), { status: 404 });
    }
    LIVE_TEMPLATES.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- schedule overrides (admin) ----------------------------------------
  http.post('*/api/v1/schedules/overrides', async ({ request }) => {
    const body = await readJson(request);
    if (!body || typeof body.providerId !== 'string' || typeof body.date !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'providerId and date required'), {
        status: 422,
      });
    }
    const duplicate = LIVE_OVERRIDES.find(
      (override) => override.providerId === body.providerId && override.date === body.date,
    );
    if (duplicate) {
      return HttpResponse.json(
        apiError('CONFLICT', 'An override already exists for that provider and date.'),
        { status: 409 },
      );
    }
    const override: LiveOverride = {
      id: `ovr_example_${overrideSequence}`,
      providerId: body.providerId,
      branchId: typeof body.branchId === 'string' ? body.branchId : SCHEDULING_BRANCH,
      departmentId: typeof body.departmentId === 'string' ? body.departmentId : '',
      date: body.date,
      type: typeof body.type === 'string' ? body.type : 'BLOCKED',
      startMinutes: typeof body.startMinutes === 'number' ? body.startMinutes : null,
      endMinutes: typeof body.endMinutes === 'number' ? body.endMinutes : null,
      slotDurationMinutes:
        typeof body.slotDurationMinutes === 'number' ? body.slotDurationMinutes : null,
      capacity: typeof body.capacity === 'number' ? body.capacity : null,
      note: typeof body.note === 'string' && body.note.length > 0 ? body.note : null,
    };
    overrideSequence += 1;
    LIVE_OVERRIDES.push(override);
    return HttpResponse.json(apiOk({ override }, 'req_mock_override_create'), { status: 201 });
  }),

  http.patch('*/api/v1/schedules/overrides/:id', async ({ params, request }) => {
    const override = LIVE_OVERRIDES.find((row) => row.id === String(params.id));
    if (!override) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Override not found.'), { status: 404 });
    }
    const body = await readJson(request);
    if (body) {
      if (typeof body.type === 'string') override.type = body.type;
      if (typeof body.startMinutes === 'number' || body.startMinutes === null) {
        override.startMinutes = body.startMinutes as number | null;
      }
      if (typeof body.endMinutes === 'number' || body.endMinutes === null) {
        override.endMinutes = body.endMinutes as number | null;
      }
      if (typeof body.slotDurationMinutes === 'number' || body.slotDurationMinutes === null) {
        override.slotDurationMinutes = body.slotDurationMinutes as number | null;
      }
      if (typeof body.capacity === 'number' || body.capacity === null) {
        override.capacity = body.capacity as number | null;
      }
      if (typeof body.note === 'string') override.note = body.note;
    }
    return HttpResponse.json(apiOk({ override }, 'req_mock_override_update'));
  }),

  http.delete('*/api/v1/schedules/overrides/:id', ({ params }) => {
    const index = LIVE_OVERRIDES.findIndex((row) => row.id === String(params.id));
    if (index < 0) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Override not found.'), { status: 404 });
    }
    LIVE_OVERRIDES.splice(index, 1);
    return new HttpResponse(null, { status: 204 });
  }),

  // --- waitlist (before the appointment :id routes) -----------------------
  http.get('*/api/v1/appointments/waitlist/entries', ({ request }) => {
    const url = new URL(request.url);
    const departmentId = url.searchParams.get('departmentId');
    const status = url.searchParams.get('status');
    let items = [...LIVE_WAITLIST];
    if (departmentId) items = items.filter((entry) => entry.departmentId === departmentId);
    if (status) items = items.filter((entry) => entry.status === status);
    items.sort((a, b) => Date.parse(b.createdAt) - Date.parse(a.createdAt));
    return HttpResponse.json(pageEnvelope(items, items.length));
  }),

  http.post('*/api/v1/appointments/waitlist/entries', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    const body = await readJson(request);
    if (!body || typeof body.patientId !== 'string' || typeof body.departmentId !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'patientId and departmentId required'), {
        status: 400,
      });
    }
    const duplicate = LIVE_WAITLIST.find(
      (entry) =>
        entry.patientId === body.patientId &&
        entry.departmentId === body.departmentId &&
        ACTIONABLE_WAITLIST.has(entry.status),
    );
    if (duplicate) {
      return HttpResponse.json(
        apiError('WAITLIST_DUPLICATE', 'This patient is already on the waitlist.'),
        { status: 409 },
      );
    }
    const sequence = waitlistSequence;
    waitlistSequence += 1;
    const now = new Date().toISOString();
    const entry: LiveWaitlist = {
      id: `wl_example_${5000 + sequence}`,
      branchId: typeof body.branchId === 'string' ? body.branchId : SCHEDULING_BRANCH,
      departmentId: body.departmentId,
      patientId: body.patientId,
      providerId: typeof body.providerId === 'string' ? body.providerId : null,
      status: 'WAITING',
      offeredAt: null,
      offerExpiresAt: null,
      offeredStartAt: null,
      acceptedAppointmentId: null,
      resolvedAt: null,
      preferredDate: typeof body.preferredDate === 'string' ? body.preferredDate : null,
      notes: typeof body.notes === 'string' ? body.notes : null,
      createdAt: now,
      updatedAt: now,
    };
    LIVE_WAITLIST.push(entry);
    return HttpResponse.json(apiOk({ entry }, 'req_mock_waitlist_join'), { status: 201 });
  }),

  http.post('*/api/v1/appointments/waitlist/entries/:id/accept', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const entry = findWaitlist(String(params.id));
    if (!entry) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Waitlist entry not found.'), {
        status: 404,
      });
    }
    if (entry.status !== 'OFFERED') {
      return HttpResponse.json(
        apiError('INVALID_WORKFLOW_TRANSITION', 'This offer is no longer open.'),
        { status: 409 },
      );
    }
    const body = (await readJson(request)) ?? {};
    const now = new Date().toISOString();
    const startsAt = entry.offeredStartAt ?? now;
    const sequence = appointmentSequence;
    appointmentSequence += 1;
    const appointment: LiveAppointment = {
      id: `apt_example_${4000 + sequence}`,
      organizationId: 'org_example_0001',
      branchId: entry.branchId,
      departmentId: entry.departmentId,
      patientId: entry.patientId,
      providerId: entry.providerId ?? 'usr_example_9101',
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + SLOT_MINUTES * 60_000).toISOString(),
      mode: 'IN_PERSON',
      appointmentType: null,
      reason: 'Accepted from waitlist.',
      status: 'BOOKED',
      version: 1,
      checkedInAt: null,
      inProgressAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      cancelReason: null,
      rescheduledFromId: null,
      rescheduledToId: null,
      rescheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    LIVE_APPOINTMENTS.push(appointment);
    entry.status = 'ACCEPTED';
    entry.resolvedAt = now;
    entry.acceptedAppointmentId = appointment.id;
    entry.updatedAt = now;
    void body;
    return HttpResponse.json(apiOk({ appointment }, 'req_mock_waitlist_accept'), { status: 201 });
  }),

  http.post('*/api/v1/appointments/waitlist/entries/:id/decline', async ({ params }) => {
    await delay(MOCK_LATENCY_MS);
    const entry = findWaitlist(String(params.id));
    if (!entry) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Waitlist entry not found.'), {
        status: 404,
      });
    }
    entry.status = 'DECLINED';
    entry.resolvedAt = new Date().toISOString();
    return HttpResponse.json(apiOk({ declined: true }, 'req_mock_waitlist_decline'), { status: 201 });
  }),

  http.post('*/api/v1/appointments/waitlist/entries/:id/leave', async ({ params }) => {
    await delay(MOCK_LATENCY_MS);
    const index = LIVE_WAITLIST.findIndex((entry) => entry.id === String(params.id));
    if (index === -1) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Waitlist entry not found.'), {
        status: 404,
      });
    }
    const [entry] = LIVE_WAITLIST.splice(index, 1);
    return HttpResponse.json(
      apiOk({ entry: { ...entry, status: 'REMOVED' } }, 'req_mock_waitlist_leave'),
      { status: 201 },
    );
  }),

  // --- appointments -------------------------------------------------------
  http.get('*/api/v1/appointments', ({ request }) => {
    const url = new URL(request.url);
    const departmentId = url.searchParams.get('departmentId');
    const providerId = url.searchParams.get('providerId');
    const patientId = url.searchParams.get('patientId');
    const status = url.searchParams.get('status');
    const dateFrom = url.searchParams.get('dateFrom');
    const dateTo = url.searchParams.get('dateTo');
    let items = [...LIVE_APPOINTMENTS];
    if (departmentId) items = items.filter((appointment) => appointment.departmentId === departmentId);
    if (providerId) items = items.filter((appointment) => appointment.providerId === providerId);
    if (patientId) items = items.filter((appointment) => appointment.patientId === patientId);
    if (status) items = items.filter((appointment) => appointment.status === status);
    if (dateFrom) items = items.filter((appointment) => appointment.startsAt >= dateFrom);
    if (dateTo) items = items.filter((appointment) => appointment.startsAt <= dateTo);
    items.sort((a, b) => Date.parse(a.startsAt) - Date.parse(b.startsAt));
    return HttpResponse.json(pageEnvelope(items, items.length));
  }),

  http.post('*/api/v1/appointments', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    const body = await readJson(request);
    if (
      !body ||
      typeof body.patientId !== 'string' ||
      typeof body.providerId !== 'string' ||
      typeof body.departmentId !== 'string' ||
      typeof body.startsAt !== 'string' ||
      typeof body.mode !== 'string'
    ) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'missing required fields'), {
        status: 400,
      });
    }
    const startsAt = new Date(body.startsAt).toISOString();
    const departmentId = body.departmentId;
    // Capacity is checked against the generated slot, exactly as booking does.
    const slots = generateSlots(body.providerId, departmentId, businessDayKey(startsAt));
    const slot = slots.find((candidate) => candidate.startsAt === startsAt);
    if (!slot || slot.remaining <= 0) {
      return HttpResponse.json(
        apiError('APPOINTMENT_CONFLICT', 'That slot is no longer available.'),
        { status: 409 },
      );
    }
    const sequence = appointmentSequence;
    appointmentSequence += 1;
    const now = new Date().toISOString();
    const appointment: LiveAppointment = {
      id: `apt_example_${4000 + sequence}`,
      organizationId: 'org_example_0001',
      branchId: typeof body.branchId === 'string' ? body.branchId : SCHEDULING_BRANCH,
      departmentId,
      patientId: body.patientId,
      providerId: body.providerId,
      startsAt,
      endsAt: new Date(Date.parse(startsAt) + SLOT_MINUTES * 60_000).toISOString(),
      mode: body.mode,
      appointmentType: typeof body.appointmentType === 'string' ? body.appointmentType : null,
      reason: typeof body.reason === 'string' ? body.reason : null,
      status: 'BOOKED',
      version: 1,
      checkedInAt: null,
      inProgressAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      cancelReason: null,
      rescheduledFromId: null,
      rescheduledToId: null,
      rescheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    LIVE_APPOINTMENTS.push(appointment);
    return HttpResponse.json(apiOk({ appointment }, 'req_mock_appointment_book'), { status: 201 });
  }),

  http.patch('*/api/v1/appointments/:id/status', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const appointment = findAppointment(String(params.id));
    if (!appointment) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Appointment not found.'), {
        status: 404,
      });
    }
    const body = await readJson(request);
    const status = body && typeof body.status === 'string' ? body.status : '';
    if (!(TRANSITIONS[appointment.status] ?? []).includes(status)) {
      return HttpResponse.json(
        apiError(
          'INVALID_WORKFLOW_TRANSITION',
          `An appointment cannot move from ${appointment.status} to ${status}.`,
        ),
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    appointment.status = status;
    if (status === 'CHECKED_IN') appointment.checkedInAt = now;
    if (status === 'IN_PROGRESS') appointment.inProgressAt = now;
    if (status === 'COMPLETED') appointment.completedAt = now;
    if (status === 'NO_SHOW') appointment.noShowAt = now;
    if (status === 'CANCELLED') {
      appointment.cancelledAt = now;
      appointment.cancelReason = body && typeof body.reason === 'string' ? body.reason : null;
    }
    appointment.version += 1;
    appointment.updatedAt = now;
    return HttpResponse.json(apiOk({ appointment }, 'req_mock_appointment_status'));
  }),

  http.post('*/api/v1/appointments/:id/cancel', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const appointment = findAppointment(String(params.id));
    if (!appointment) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Appointment not found.'), {
        status: 404,
      });
    }
    const body = await readJson(request);
    if (appointment.status === 'COMPLETED' || appointment.status === 'CANCELLED') {
      return HttpResponse.json(
        apiError('INVALID_WORKFLOW_TRANSITION', 'This appointment cannot be cancelled.'),
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    appointment.status = 'CANCELLED';
    appointment.cancelledAt = now;
    appointment.cancelReason = body && typeof body.reason === 'string' ? body.reason : null;
    appointment.version += 1;
    appointment.updatedAt = now;
    return HttpResponse.json(apiOk({ appointment }, 'req_mock_appointment_cancel'), { status: 201 });
  }),

  http.post('*/api/v1/appointments/:id/reschedule', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const original = findAppointment(String(params.id));
    if (!original) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Appointment not found.'), {
        status: 404,
      });
    }
    if (TERMINAL.has(original.status)) {
      return HttpResponse.json(
        apiError('INVALID_WORKFLOW_TRANSITION', 'A terminal appointment cannot be rescheduled.'),
        { status: 409 },
      );
    }
    const body = await readJson(request);
    const startsAt = body && typeof body.startsAt === 'string' ? body.startsAt : '';
    if (!startsAt) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'startsAt is required.'), { status: 422 });
    }
    const startsAtDate = new Date(startsAt);
    const now = new Date().toISOString();
    const replacement: LiveAppointment = {
      ...original,
      id: `apt_example_${appointmentSequence}`,
      startsAt: startsAtDate.toISOString(),
      endsAt: new Date(startsAtDate.getTime() + SLOT_MINUTES * 60_000).toISOString(),
      status: 'BOOKED',
      version: 1,
      checkedInAt: null,
      inProgressAt: null,
      completedAt: null,
      noShowAt: null,
      cancelledAt: null,
      cancelReason: null,
      rescheduledFromId: original.id,
      rescheduledToId: null,
      rescheduledAt: null,
      createdAt: now,
      updatedAt: now,
    };
    appointmentSequence += 1;
    original.status = 'RESCHEDULED';
    original.rescheduledToId = replacement.id;
    original.rescheduledAt = now;
    original.version += 1;
    original.updatedAt = now;
    LIVE_APPOINTMENTS.push(replacement);
    return HttpResponse.json(
      apiOk({ appointment: replacement, superseded: original }, 'req_mock_appointment_reschedule'),
      { status: 201 },
    );
  }),
];
