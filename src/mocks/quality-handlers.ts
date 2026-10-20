import { http, HttpResponse } from 'msw';

import { ADMIN_USERS } from '@/mocks/fixtures/admin-registry';
import {
  QUALITY_COMPLAINTS,
  QUALITY_FEEDBACK,
  QUALITY_INCIDENTS,
  type RegistryComplaint,
  type RegistryFeedback,
  type RegistryIncident,
} from '@/mocks/fixtures/quality-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * Quality handlers (feedback, complaints, incidents — brief Phase 10).
 *
 * Each list filters on exactly the query parameters its service does and answers
 * the `pageOf(...)` shape the service returns while the export types something
 * else (GAP-020 family). Every single-record read and write answers the envelope
 * the service uses — `{ feedback }`, `{ complaint }` — while the export types the
 * bare entity, so the client validates each body structurally.
 *
 * Feedback and complaint state are mutable clones of the fixture registry for the
 * length of the mock session: a write moves the same record the worklist reads
 * back. Their guards mirror `domain/quality-flow.ts` — one linear move forward,
 * same-status patches a no-op, feedback cannot leave NEW without a response, a
 * complaint is assigned only while ASSIGNED/INVESTIGATING and cannot close without
 * a resolution. Incidents are still read-only; their writes arrive with their own
 * workspace.
 */

type Mutable<T> = { -readonly [K in keyof T]: T[K] };

const feedback: Mutable<RegistryFeedback>[] = QUALITY_FEEDBACK.map((row) => ({ ...row }));
const complaints: Mutable<RegistryComplaint>[] = QUALITY_COMPLAINTS.map((row) => ({ ...row }));
const incidents: Mutable<RegistryIncident>[] = QUALITY_INCIDENTS.map((row) => ({ ...row }));

const REPORTER = 'usr_example_0001';
const HANDLER = 'usr_example_0002';

const FEEDBACK_NEXT: Record<string, string | null> = {
  NEW: 'ACKNOWLEDGED',
  ACKNOWLEDGED: 'RESOLVED',
  RESOLVED: 'CLOSED',
};

const COMPLAINT_NEXT: Record<string, string | null> = {
  OPEN: 'ASSIGNED',
  ASSIGNED: 'INVESTIGATING',
  INVESTIGATING: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

const COMPLAINT_ASSIGNABLE = new Set(['ASSIGNED', 'INVESTIGATING']);

const COMPLAINT_ORIGINS = new Set(['PATIENT', 'STAFF', 'OTHER']);

const INCIDENT_NEXT: Record<string, string | null> = {
  OPEN: 'INVESTIGATING',
  INVESTIGATING: 'ACTION_PLAN',
  ACTION_PLAN: 'RESOLVED',
  RESOLVED: 'CLOSED',
  CLOSED: null,
};

const INCIDENT_CATEGORIES = new Set([
  'OUTAGE',
  'EQUIPMENT',
  'STOCK_DISCREPANCY',
  'DATA_ACCESS',
  'FACILITY',
  'PATIENT_SAFETY',
  'OTHER',
]);

const INCIDENT_SEVERITIES = new Set(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);

let complaintSeq = 6206;
let incidentSeq = 6306;

function findFeedback(id: string): Mutable<RegistryFeedback> | undefined {
  return feedback.find((row) => row.id === id);
}

function findComplaint(id: string): Mutable<RegistryComplaint> | undefined {
  return complaints.find((row) => row.id === id);
}

function findIncident(id: string): Mutable<RegistryIncident> | undefined {
  return incidents.find((row) => row.id === id);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
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

function isUserInOrg(userId: string): boolean {
  return ADMIN_USERS.some((user) => user.id === userId);
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
      if (!row) return notFound('Feedback not found');
      return HttpResponse.json(apiOk({ feedback: { ...row } }));
    }),

    http.patch('*/api/v1/feedback/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findFeedback(String(params.id));
      if (!row) return notFound('Feedback not found');
      const body = await readJson(request);
      if (!body) return validationError('A feedback response body is required.');

      const next = typeof body.status === 'string' ? body.status : null;
      if (!next || !(next in FEEDBACK_NEXT)) {
        return validationError('Unknown feedback status.');
      }

      if (row.status !== next && FEEDBACK_NEXT[row.status] !== next) {
        return workflowConflict(`Invalid workflow transition: ${row.status} → ${next}.`);
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
      const rows = complaints.filter(
        (row) =>
          (!status || row.status === status) &&
          (!assignedToId || row.assignedToId === assignedToId),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.post('*/api/v1/complaints', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      if (!body) return validationError('A complaint body is required.');

      const origin = typeof body.origin === 'string' ? body.origin : '';
      if (!COMPLAINT_ORIGINS.has(origin)) {
        return validationError('Unknown complaint origin.');
      }
      const category = typeof body.category === 'string' ? body.category.trim() : '';
      if (category.length === 0 || category.length > 200) {
        return validationError('A category is required (max 200 characters).');
      }
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length === 0 || description.length > 5000) {
        return validationError('A description is required (max 5000 characters).');
      }
      const assignedToId = typeof body.assignedToId === 'string' ? body.assignedToId : null;
      if (assignedToId && !isUserInOrg(assignedToId)) {
        return notFound('Assigned user not found in this organization');
      }

      const now = new Date().toISOString();
      const complaint: Mutable<RegistryComplaint> = {
        id: `cmp_example_${complaintSeq++}`,
        organizationId: 'org_example_1',
        branchId: typeof body.branchId === 'string' ? body.branchId : null,
        origin: origin as RegistryComplaint['origin'],
        patientId: typeof body.patientId === 'string' ? body.patientId : null,
        submittedById: REPORTER,
        category,
        description,
        status: assignedToId ? 'ASSIGNED' : 'OPEN',
        assignedToId,
        dueAt: typeof body.dueAt === 'string' ? body.dueAt : null,
        resolution: null,
        closedById: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      complaints.unshift(complaint);
      return HttpResponse.json(apiOk({ complaint: { ...complaint } }), { status: 201 });
    }),

    http.get('*/api/v1/complaints/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findComplaint(String(params.id));
      if (!row) return notFound('Complaint not found');
      return HttpResponse.json(apiOk({ complaint: { ...row } }));
    }),

    http.patch('*/api/v1/complaints/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findComplaint(String(params.id));
      if (!row) return notFound('Complaint not found');
      const body = await readJson(request);
      if (!body) return validationError('A complaint update body is required.');

      const next = typeof body.status === 'string' ? body.status : null;
      if (!next || !(next in COMPLAINT_NEXT)) {
        return validationError('Unknown complaint status.');
      }

      if (row.status !== next && COMPLAINT_NEXT[row.status] !== next) {
        return workflowConflict(`Invalid workflow transition: ${row.status} → ${next}.`);
      }

      const appliesAssignment =
        body.assignedToId !== undefined || body.dueAt !== undefined || next === 'ASSIGNED';
      if (appliesAssignment && !COMPLAINT_ASSIGNABLE.has(next)) {
        return workflowConflict(
          'A complaint may only be assigned while it is ASSIGNED or INVESTIGATING.',
        );
      }
      if (appliesAssignment && typeof body.assignedToId === 'string' && body.assignedToId) {
        if (!isUserInOrg(body.assignedToId)) {
          return notFound('Assigned user not found in this organization');
        }
      }

      const effectiveResolution =
        body.resolution !== undefined && body.resolution !== null
          ? String(body.resolution)
          : row.resolution;
      if (row.status !== next && next === 'CLOSED') {
        if (!effectiveResolution || effectiveResolution.trim().length === 0) {
          return workflowConflict('A complaint cannot be closed without a resolution.');
        }
      }

      const now = new Date().toISOString();
      row.status = next as RegistryComplaint['status'];
      if (body.assignedToId !== undefined) {
        row.assignedToId = typeof body.assignedToId === 'string' ? body.assignedToId : null;
      }
      if (body.dueAt !== undefined) {
        row.dueAt = typeof body.dueAt === 'string' ? body.dueAt : null;
      }
      if (body.resolution !== undefined) {
        row.resolution = typeof body.resolution === 'string' ? body.resolution : null;
      }
      if (next === 'CLOSED') {
        row.closedById = HANDLER;
        row.closedAt = now;
      }
      row.updatedAt = now;
      return HttpResponse.json(apiOk({ complaint: { ...row } }));
    }),

    http.get('*/api/v1/incidents', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const status = url.searchParams.get('status');
      const severity = url.searchParams.get('severity');
      const category = url.searchParams.get('category');
      const rows = incidents.filter(
        (row) =>
          (!status || row.status === status) &&
          (!severity || row.severity === severity) &&
          (!category || row.category === category),
      );
      return HttpResponse.json(apiPage(rows.map((row) => ({ ...row }))));
    }),

    http.post('*/api/v1/incidents', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      if (!body) return validationError('An incident body is required.');

      if (typeof body.branchId !== 'string' || body.branchId.length === 0) {
        return validationError('A branch is required.');
      }
      const category = typeof body.category === 'string' ? body.category : '';
      if (!INCIDENT_CATEGORIES.has(category)) {
        return validationError('Unknown incident category.');
      }
      const severity = typeof body.severity === 'string' ? body.severity : '';
      if (!INCIDENT_SEVERITIES.has(severity)) {
        return validationError('Unknown incident severity.');
      }
      const description = typeof body.description === 'string' ? body.description.trim() : '';
      if (description.length === 0 || description.length > 5000) {
        return validationError('A description is required (max 5000 characters).');
      }

      const now = new Date().toISOString();
      const incident: Mutable<RegistryIncident> = {
        id: `inc_example_${incidentSeq++}`,
        organizationId: 'org_example_1',
        branchId: body.branchId,
        category: category as RegistryIncident['category'],
        severity: severity as RegistryIncident['severity'],
        description,
        reportedById: REPORTER,
        status: 'OPEN',
        actionsTaken: null,
        resolution: null,
        resolvedById: null,
        resolvedAt: null,
        closedById: null,
        closedAt: null,
        createdAt: now,
        updatedAt: now,
      };
      incidents.unshift(incident);
      return HttpResponse.json(apiOk({ incident: { ...incident } }), { status: 201 });
    }),

    http.get('*/api/v1/incidents/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findIncident(String(params.id));
      if (!row) return notFound('Incident not found');
      return HttpResponse.json(apiOk({ incident: { ...row } }));
    }),

    http.patch('*/api/v1/incidents/:id', async ({ params, request }) => {
      await delay(MOCK_LATENCY_MS);
      const row = findIncident(String(params.id));
      if (!row) return notFound('Incident not found');
      const body = await readJson(request);
      if (!body) return validationError('An incident update body is required.');

      const next = typeof body.status === 'string' ? body.status : null;
      if (!next || !(next in INCIDENT_NEXT)) {
        return validationError('Unknown incident status.');
      }

      if (row.status !== next && INCIDENT_NEXT[row.status] !== next) {
        return workflowConflict(`Invalid workflow transition: ${row.status} → ${next}.`);
      }

      const now = new Date().toISOString();
      row.status = next as RegistryIncident['status'];
      if (body.actionsTaken !== undefined) {
        row.actionsTaken = typeof body.actionsTaken === 'string' ? body.actionsTaken : null;
      }
      if (body.resolution !== undefined) {
        row.resolution = typeof body.resolution === 'string' ? body.resolution : null;
      }
      if (next === 'RESOLVED') {
        row.resolvedById = HANDLER;
        row.resolvedAt = now;
      }
      if (next === 'CLOSED') {
        row.closedById = HANDLER;
        row.closedAt = now;
      }
      row.updatedAt = now;
      return HttpResponse.json(apiOk({ incident: { ...row } }));
    }),
  ];
}
