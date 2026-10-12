import { http, HttpResponse } from 'msw';

import {
  ENCOUNTERS,
  ENCOUNTER_BRANCH_ID,
  type EncounterFixture,
} from '@/mocks/fixtures/encounters-registry';
import { delay, apiError, apiOk, apiPage, MOCK_LATENCY_MS } from './handlers';

/**
 * F4 encounters handlers (doctor workspace).
 *
 * Same contract and records as `e2e/stub-api.mjs`. The list is mutable so a
 * transition made in the workspace appears on the list, and the status flow
 * mirrors the API: OPEN → IN_PROGRESS → COMPLETED, with COMPLETED locked even
 * against a workflow the server cannot reopen. An illegal move answers 409
 * `INVALID_WORKFLOW_TRANSITION`, exactly as the API's workflow engine does.
 */

const TRANSITIONS: Record<string, readonly string[]> = {
  OPEN: ['IN_PROGRESS'],
  IN_PROGRESS: ['COMPLETED'],
  COMPLETED: [],
};

const TERMINAL = new Set(['COMPLETED']);

interface LiveEncounter {
  id: string;
  organizationId: string;
  branchId: string;
  departmentId: string;
  patientId: string;
  providerId: string | null;
  type: string;
  status: string;
  visitId: string | null;
  appointmentId: string | null;
  note: string | null;
  openedById: string;
  openedAt: string;
  inProgressAt: string | null;
  completedAt: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
}

function minutesAgo(minutes: number): string {
  return new Date(Date.now() - minutes * 60_000).toISOString();
}

function serialize(fixture: EncounterFixture): LiveEncounter {
  const stamp = minutesAgo(fixture.openedMinutesAgo);
  const inProgressAt =
    fixture.inProgressMinutesAgo === null ? null : minutesAgo(fixture.inProgressMinutesAgo);
  const completedAt =
    fixture.completedMinutesAgo === null ? null : minutesAgo(fixture.completedMinutesAgo);
  return {
    id: fixture.id,
    organizationId: 'org_example_0001',
    branchId: ENCOUNTER_BRANCH_ID,
    departmentId: fixture.departmentId,
    patientId: fixture.patientId,
    providerId: fixture.providerId,
    type: fixture.type,
    status: fixture.status,
    visitId: fixture.visitId,
    appointmentId: null,
    note: fixture.note,
    openedById: fixture.providerId ?? 'usr_example_9004',
    openedAt: stamp,
    inProgressAt,
    completedAt,
    version: 1,
    createdAt: stamp,
    updatedAt: completedAt ?? inProgressAt ?? stamp,
  };
}

const LIVE: LiveEncounter[] = ENCOUNTERS.map(serialize);

export function encountersHandlers() {
  return [
    http.get('*/api/v1/encounters', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const departmentId = url.searchParams.get('departmentId');
      const status = url.searchParams.get('status');
      const type = url.searchParams.get('type');
      const patientId = url.searchParams.get('patientId');

      let rows = [...LIVE];
      if (departmentId) rows = rows.filter((row) => row.departmentId === departmentId);
      if (status) rows = rows.filter((row) => row.status === status);
      if (type) rows = rows.filter((row) => row.type === type);
      if (patientId) rows = rows.filter((row) => row.patientId === patientId);
      rows.sort((a, b) => Date.parse(b.openedAt) - Date.parse(a.openedAt));
      return HttpResponse.json(apiPage(rows, rows.length, 50));
    }),

    http.get('*/api/v1/encounters/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const encounter = LIVE.find((row) => row.id === params.id);
      if (!encounter) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Encounter not found'), {
          status: 404,
        });
      }
      return HttpResponse.json(apiOk({ encounter }, 'req_mock_encounter_get'));
    }),

    http.patch('*/api/v1/encounters/:id/status', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      let body: Record<string, unknown>;
      try {
        body = (await request.json()) as Record<string, unknown>;
      } catch {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
      }
      if (typeof body.status !== 'string') {
        return HttpResponse.json(apiError('VALIDATION_ERROR', 'status required'), { status: 400 });
      }
      const encounter = LIVE.find((row) => row.id === params.id);
      if (!encounter) {
        return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Encounter not found'), {
          status: 404,
        });
      }
      const next = body.status;
      if (!TERMINAL.has(encounter.status) && TRANSITIONS[encounter.status]?.includes(next)) {
        const now = new Date().toISOString();
        encounter.status = next;
        encounter.version += 1;
        encounter.updatedAt = now;
        if (next === 'COMPLETED') encounter.completedAt = now;
        else encounter.inProgressAt = now;
      } else {
        return HttpResponse.json(
          apiError(
            'INVALID_WORKFLOW_TRANSITION',
            `The encounter cannot move from ${encounter.status} to ${next}.`,
          ),
          { status: 409 },
        );
      }
      return HttpResponse.json(apiOk({ encounter }, 'req_mock_encounter_transition'));
    }),
  ];
}