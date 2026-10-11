import { http, HttpResponse } from 'msw';

import {
  DEPARTMENTS,
  FIRST_TICKET_SEQUENCE,
  QUEUE_BRANCH_ID,
  QUEUE_ENTRIES,
  type QueueEntryFixture,
} from '@/mocks/fixtures/queue-registry';
import { apiError, apiOk, delay, MOCK_LATENCY_MS } from './handlers';

/**
 * F3 queue handlers (reception desk).
 *
 * Same contract and same records as `e2e/stub-api.mjs`. The board is mutable for
 * the session so a walk-in registered in the UI appears on the board, and status
 * moves persist — the flow is worth exercising end to end, not just as isolated
 * screens.
 *
 * The transition graph mirrors the API's `queue-flow.ts`. An illegal move answers
 * 409 `INVALID_WORKFLOW_TRANSITION`, exactly as the server does, so the board's
 * "only offer legal moves" isn't the sole thing standing between a stale tab and
 * a bad state.
 */

const ACTIVE_STATUSES = new Set(['WAITING', 'CALLED', 'IN_SERVICE']);

const TRANSITIONS: Record<string, readonly string[]> = {
  WAITING: ['CALLED', 'NO_SHOW', 'ABANDONED', 'CANCELLED', 'TRANSFERRED'],
  CALLED: ['IN_SERVICE', 'WAITING', 'NO_SHOW', 'CANCELLED', 'TRANSFERRED'],
  IN_SERVICE: ['COMPLETED', 'CANCELLED', 'TRANSFERRED'],
  COMPLETED: [],
  NO_SHOW: [],
  ABANDONED: [],
  CANCELLED: [],
  TRANSFERRED: [],
};

interface LiveEntry {
  id: string;
  ticketNumber: string;
  patientId: string;
  patient: string;
  visitId: string;
  departmentId: string;
  branchId: string;
  status: string;
  operationalPriority: string;
  enteredAt: string;
  calledAt: string | null;
  serviceStartedAt: string | null;
  completedAt: string | null;
  note: string | null;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function fromFixture(fixture: QueueEntryFixture): LiveEntry {
  return {
    id: fixture.id,
    ticketNumber: fixture.ticketNumber,
    patientId: fixture.patientId,
    patient: fixture.patient,
    visitId: fixture.visitId,
    departmentId: fixture.departmentId,
    branchId: fixture.branchId,
    status: fixture.status,
    operationalPriority: fixture.operationalPriority,
    enteredAt: minutesAgo(fixture.enteredMinutesAgo),
    calledAt: fixture.calledMinutesAgo === null ? null : minutesAgo(fixture.calledMinutesAgo),
    serviceStartedAt:
      fixture.serviceStartedMinutesAgo === null ? null : minutesAgo(fixture.serviceStartedMinutesAgo),
    completedAt:
      fixture.completedMinutesAgo === null ? null : minutesAgo(fixture.completedMinutesAgo),
    note: fixture.note,
  };
}

const LIVE: LiveEntry[] = QUEUE_ENTRIES.map(fromFixture);
let ticketSequence = FIRST_TICKET_SEQUENCE;

/** Patients joined to the queue fixtures, so a walk-in knows its display name. */
const PATIENT_NAMES: Record<string, string> = {
  pat_example_1001: 'EXAMPLE Amina Yusuf',
  pat_example_1002: 'EXAMPLE O. Omondi',
  pat_example_1003: 'EXAMPLE Chebet',
  pat_example_1004: 'EXAMPLE Njoroge',
};

function nextTicket(): { ticketNumber: string; sequence: number } {
  const sequence = ticketSequence;
  ticketSequence += 1;
  return { ticketNumber: `Q-${String(sequence).padStart(3, '0')}`, sequence };
}

function pageEnvelope<T>(items: readonly T[], total: number) {
  return apiOk({
    items,
    meta: { page: 1, limit: 25, total, totalPages: Math.max(1, Math.ceil(total / 25)) },
  });
}

/** Waiting-room metrics, computed from the live board the way the API does. */
function currentStats() {
  const waiting = LIVE.filter((entry) => entry.status === 'WAITING');
  const callWaits = LIVE.filter((entry) => entry.calledAt).map(
    (entry) => (Date.parse(entry.calledAt as string) - Date.parse(entry.enteredAt)) / 60_000,
  );
  const services = LIVE.filter((entry) => entry.serviceStartedAt && entry.completedAt).map(
    (entry) => (Date.parse(entry.completedAt as string) - Date.parse(entry.serviceStartedAt as string)) / 60_000,
  );
  const left = LIVE.filter((entry) => entry.status === 'ABANDONED' || entry.status === 'NO_SHOW').length;
  const avg = (values: number[]) =>
    values.length === 0 ? null : Math.round(values.reduce((sum, value) => sum + value, 0) / values.length);
  return {
    avgCallWaitMinutes: avg(callWaits),
    avgServiceMinutes: avg(services),
    abandonmentRate: LIVE.length === 0 ? 0 : Math.round((left / LIVE.length) * 100) / 100,
    currentlyWaiting: waiting.length,
  };
}

function findEntry(id: string): LiveEntry | undefined {
  return LIVE.find((entry) => entry.id === id);
}

export const queueHandlers = [
  // Registered before `/queue` so the literal suffix wins over the board route.
  http.get('*/api/v1/queue/metrics', () => HttpResponse.json(apiOk({ stats: currentStats() }))),

  http.get('*/api/v1/queue/status', () => {
    // Self-service view for the scoped patient: first WAITING ticket, if any.
    const mine = LIVE.find((entry) => entry.status === 'WAITING' || entry.status === 'CALLED');
    if (!mine) {
      return HttpResponse.json(
        apiOk({ queued: false, ticketNumber: null, position: null, estimate: null }),
      );
    }
    const ahead = LIVE.filter(
      (entry) => entry.status === 'WAITING' && entry.id !== mine.id,
    ).length;
    return HttpResponse.json(
      apiOk({
        queued: true,
        ticketNumber: mine.ticketNumber,
        position: ahead + 1,
        estimate: (ahead + 1) * 10,
      }),
    );
  }),

  http.get('*/api/v1/queue', ({ request }) => {
    const url = new URL(request.url);
    const departmentId = url.searchParams.get('departmentId');
    const status = url.searchParams.get('status');
    let items = [...LIVE];
    if (departmentId) items = items.filter((entry) => entry.departmentId === departmentId);
    if (status) items = items.filter((entry) => entry.status === status);
    // Newest first, then longest-waiting, matching the API's list ordering.
    items.sort((a, b) => Date.parse(b.enteredAt) - Date.parse(a.enteredAt));
    return HttpResponse.json(pageEnvelope(items, items.length));
  }),

  http.get('*/api/v1/departments', () => {
    const departments = DEPARTMENTS.map((department) => ({ ...department, branchId: QUEUE_BRANCH_ID }));
    return HttpResponse.json(
      apiOk({ departments, meta: { page: 1, limit: 100, total: departments.length, totalPages: 1 } }),
    );
  }),

  http.post('*/api/v1/queue/walk-ins/register', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (typeof body.patientId !== 'string' || typeof body.departmentId !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'patientId and departmentId required'), {
        status: 400,
      });
    }
    const patientId = body.patientId;
    // A patient already in an active queue slot cannot hold two tickets.
    const existing = LIVE.find(
      (entry) => entry.patientId === patientId && ACTIVE_STATUSES.has(entry.status),
    );
    if (existing) {
      return HttpResponse.json(
        apiError('VISIT_ALREADY_ACTIVE', 'This patient already has an active visit in the queue.'),
        { status: 409 },
      );
    }
    const { ticketNumber, sequence } = nextTicket();
    const entry: LiveEntry = {
      id: `qe_example_${2000 + sequence}`,
      ticketNumber,
      patientId,
      patient: PATIENT_NAMES[patientId] ?? 'EXAMPLE Patient',
      visitId: `vis_example_${3000 + sequence}`,
      departmentId: body.departmentId,
      branchId: typeof body.branchId === 'string' ? body.branchId : QUEUE_BRANCH_ID,
      status: 'WAITING',
      operationalPriority: typeof body.priority === 'string' ? body.priority : 'NORMAL',
      enteredAt: new Date().toISOString(),
      calledAt: null,
      serviceStartedAt: null,
      completedAt: null,
      note: typeof body.note === 'string' ? body.note : null,
    };
    LIVE.push(entry);
    const ahead = LIVE.filter(
      (candidate) => candidate.status === 'WAITING' && candidate.operationalPriority !== 'URGENT',
    ).length;
    return HttpResponse.json(
      apiOk(
        {
          id: entry.id,
          ticketNumber: entry.ticketNumber,
          visitId: entry.visitId,
          status: entry.status,
          position: ahead,
        },
        'req_mock_queue_walkin',
      ),
      { status: 201 },
    );
  }),

  http.patch('*/api/v1/queue/entries/:id/status', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const entry = findEntry(String(params.id));
    if (!entry) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Queue entry not found.'), {
        status: 404,
      });
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    const status = typeof body.status === 'string' ? body.status : '';
    if (!TRANSITIONS[entry.status]?.includes(status)) {
      return HttpResponse.json(
        apiError(
          'INVALID_WORKFLOW_TRANSITION',
          `Cannot move a ticket from ${entry.status} to ${status}.`,
        ),
        { status: 409 },
      );
    }
    const now = new Date().toISOString();
    entry.status = status;
    if (status === 'CALLED') entry.calledAt = now;
    if (status === 'IN_SERVICE') entry.serviceStartedAt = now;
    if (status === 'COMPLETED') entry.completedAt = now;
    if (status === 'WAITING') entry.calledAt = null;
    return HttpResponse.json(apiOk({ ...entry }, 'req_mock_queue_status'));
  }),

  http.patch('*/api/v1/queue/entries/:id/priority', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const entry = findEntry(String(params.id));
    if (!entry) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Queue entry not found.'), {
        status: 404,
      });
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (typeof body.operationalPriority !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'operationalPriority required'), {
        status: 400,
      });
    }
    if (!ACTIVE_STATUSES.has(entry.status)) {
      return HttpResponse.json(
        apiError('INVALID_WORKFLOW_TRANSITION', 'Only an active ticket can be reprioritised.'),
        { status: 409 },
      );
    }
    entry.operationalPriority = body.operationalPriority;
    return HttpResponse.json(apiOk({ ...entry }, 'req_mock_queue_priority'));
  }),
];
