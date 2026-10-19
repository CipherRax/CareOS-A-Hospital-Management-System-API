import { http, HttpResponse } from 'msw';

import {
  QUALITY_COMPLAINTS,
  QUALITY_FEEDBACK,
  QUALITY_INCIDENTS,
  type RegistryFeedback,
} from '@/mocks/fixtures/quality-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * Quality handlers (feedback, complaints, incidents — brief Phase 10).
 *
 * Each list filters on exactly the query parameters its service does and answers
 * the `pageOf(...)` shape the service returns while the export types something
 * else (GAP-020 family). The feedback single-record read and its one write (a
 * response) answer the `{ feedback }` envelope the service uses while the export
 * types the bare entity, so the client validates each body structurally.
 *
 * Feedback state is a mutable clone of the fixture registry for the length of the
 * mock session: a respond moves the same record the worklist reads back. Its
 * guards mirror `domain/quality-flow.ts` — one linear move forward, same-status
 * patches a no-op, and feedback cannot leave NEW without a response. The
 * complaints and incidents writes arrive with their own workspaces.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const feedback: Mutable<RegistryFeedback>[] = QUALITY_FEEDBACK.map((row) => ({ ...row }));

const HANDLER = 'usr-example-2';

const FEEDBACK_NEXT: Record<string, string | null> = {
  NEW: 'ACKNOWLEDGED',
  ACKNOWLEDGED: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

function findFeedback(id: string): Mutable<RegistryFeedback> | undefined {
  return feedback.find((row) => row.id === id);
}

function notFound() {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Feedback not found'), { status: 404 });
}

function workflowConflict(message: string) {
  return HttpResponse.json(apiError('INVALID_WORKFLOW_TRANSITION', message), { status: 409 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function qualityHandlers() {
  return [
    http.get('*/api/v1/feedback', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const category = url.searchParams.get('category');
      const rows = feedback.filter(
        (row) =>
          (!status || row.status === status) && (!category || row.category === category),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.get('*/api/v1/feedback/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findFeedback(String(params.id));
      if (!row) return notFound();
      return HttpResponse.json(apiOk({ feedback: { ...row } }));
    }),

    http.patch('*/api/v1/feedback/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findFeedback(String(params.id));
      if (!row) return notFound();
      const body = await readJson(request);
      if (!body) return validationError('A feedback response body is required.');

      const next = typeof body.status === 'string' ? body.status : null;
      if (!next || !(next in FEEDBACK_NEXT)) {
        return validationError('Unknown feedback status.');
      }

      if (row.status !== next) {
        if (FEEDBACK_NEXT[row.status] !== next) {
          return workflowConflict(`Invalid workflow transition: ${row.status} → ${next}.`);
        }
      }

      const hasResponseText =
        typeof body.response === 'string' && body.response.trim().length > 0;
      if (typeof body.response === 'string' && !hasResponseText) {
        return validationError('A response must not be blank.');
      }

      if (next !== 'NEW') {
        const effective = (hasResponseText ? (body.response as string) : row.response) ?? '';
        if (effective.trim().length === 0) {
          return workflowConflict('Feedback cannot move out of NEW without a response.');
        }
      }

      const now = new Date().toISOString();
      row.status = next as RegistryFeedback['status'];
      if (hasResponseText) row.response = body.response as string;
      row.handledById = HANDLER;
      row.handledAt = now;
      row.updatedAt = now;
      return HttpResponse.json(apiOk({ feedback: { ...row } }));
    }),

    http.get('*/api/v1/complaints', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const assignedToId = url.searchParams.get('assignedToId');
      const rows = QUALITY_COMPLAINTS.filter(
        (row) =>
          (!status || row.status === status) &&
          (!assignedToId || row.assignedToId === assignedToId),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.get('*/api/v1/incidents', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const severity = url.searchParams.get('severity');
      const category = url.searchParams.get('category');
      const rows = QUALITY_INCIDENTS.filter(
        (row) =>
          (!status || row.status === status) &&
          (!severity || row.severity === severity) &&
          (!category || row.category === category),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),
  ];
}
