import { http, HttpResponse } from 'msw';

import {
  EMERGENCY_VISITS,
  type RegistryEmergencyDisposition,
  type RegistryEmergencyPriority,
  type RegistryEmergencyStatus,
  type RegistryEmergencyVisit,
} from '@/mocks/fixtures/emergency-registry';
import { admitFromEmergency } from '@/mocks/inpatient-handlers';
import { INPATIENT_BRANCH_ID } from '@/mocks/fixtures/inpatient-registry';
import { apiError, apiOk, apiPage, delay, MOCK_LATENCY_MS } from '@/mocks/handlers';

/**
 * F8 emergency handlers (emergency desk).
 *
 * State is a deep clone of the fixture registry, mutable for the length of the
 * mock session: triaging, assessing, treating, observing, admitting, referring
 * and discharging all move the same records the worklist and the workspace read
 * back. The guards mirror `assertEmergencyAction` — a terminal visit is closed to
 * every action (EMERGENCY_VISIT_CLOSED), a wrong source status is
 * INVALID_WORKFLOW_TRANSITION, and admit shares the ward/admission state the
 * admissions desk uses.
 */

type MutableVisit = { -readonly [K in keyof RegistryEmergencyVisit]: RegistryEmergencyVisit[K] };

const TERMINAL: readonly RegistryEmergencyStatus[] = ['DISCHARGED', 'ADMITTED', 'REFERRED'];

const SOURCES: Record<string, readonly RegistryEmergencyStatus[]> = {
  triage: ['ARRIVED'],
  assess: ['TRIAGED'],
  treat: ['ASSESSED'],
  observe: ['ASSESSED', 'IN_TREATMENT'],
  admit: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
  refer: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
  discharge: ['ASSESSED', 'IN_TREATMENT', 'OBSERVATION'],
};

const visits: MutableVisit[] = EMERGENCY_VISITS.map((visit) => ({ ...visit }));
let visitSeq = 7009;

function findVisit(id: string): MutableVisit | undefined {
  return visits.find((visit) => visit.id === id);
}

function isTerminal(status: RegistryEmergencyStatus): boolean {
  return TERMINAL.includes(status);
}

function notFound(message: string) {
  return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', message), { status: 404 });
}

function validationError(message: string) {
  return HttpResponse.json(apiError('VALIDATION_ERROR', message), { status: 400 });
}

function closed() {
  return HttpResponse.json(
    apiError('EMERGENCY_VISIT_CLOSED', 'The emergency visit is already closed.'),
    { status: 409 },
  );
}

function invalidTransition(from: RegistryEmergencyStatus, action: string) {
  return HttpResponse.json(
    apiError('INVALID_WORKFLOW_TRANSITION', `An ${from} emergency visit cannot be ${action}ed.`),
    { status: 409 },
  );
}

async function readJson(request: Request): Promise<Record<string, unknown> | null> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function stringField(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function isPriority(value: unknown): value is RegistryEmergencyPriority {
  return (
    typeof value === 'string' &&
    ['RESUSCITATION', 'EMERGENT', 'URGENT', 'SEMI_URGENT', 'NON_URGENT'].includes(value)
  );
}

/** Runs `fn` against a visit, refusing a closed one and a wrong transition. */
function advance(
  id: string,
  action: keyof typeof SOURCES,
  fn: (visit: MutableVisit, now: string) => void,
): Response {
  const visit = findVisit(id);
  if (!visit) return notFound('Emergency visit not found');
  if (isTerminal(visit.status)) return closed();
  if (!SOURCES[action]!.includes(visit.status)) {
    return invalidTransition(visit.status, action);
  }
  const now = new Date().toISOString();
  fn(visit, now);
  visit.version += 1;
  visit.updatedAt = now;
  return HttpResponse.json(apiOk({ visit }, 'req_mock_emergency'));
}

export function emergencyHandlers() {
  return [
    http.get('*/api/v1/emergency/visits', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const url = new URL(request.url);
      const branchId = url.searchParams.get('branchId');
      const patientId = url.searchParams.get('patientId');
      const status = url.searchParams.get('status');
      const priority = url.searchParams.get('priority');
      const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
      const limit = Math.min(100, Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20));

      const filtered = visits
        .filter((visit) => {
          if (branchId && visit.branchId !== branchId) return false;
          if (patientId && visit.patientId !== patientId) return false;
          if (status && visit.status !== status) return false;
          if (priority && visit.priority !== priority) return false;
          return true;
        })
        .sort((a, b) => b.arrivedAt.localeCompare(a.arrivedAt));
      const start = (page - 1) * limit;
      const rows = filtered.slice(start, start + limit);
      return HttpResponse.json(apiPage(rows, filtered.length, limit));
    }),

    http.get('*/api/v1/emergency/summary', async () => {
      await delay(MOCK_LATENCY_MS);
      const terminal = visits.filter((visit) => isTerminal(visit.status));
      const triaged = visits.filter((visit) => visit.triagedAt !== null);
      const disposed = visits.filter((visit) => visit.dispositionAt !== null);
      const byPriority: Record<string, number> = {};
      for (const visit of visits) {
        if (visit.priority) byPriority[visit.priority] = (byPriority[visit.priority] ?? 0) + 1;
      }
      const byDisposition: Record<string, number> = {};
      for (const visit of visits) {
        if (visit.disposition) {
          byDisposition[visit.disposition] = (byDisposition[visit.disposition] ?? 0) + 1;
        }
      }
      return HttpResponse.json(
        apiOk(
          {
            period: 'TODAY',
            arrivals: visits.length,
            active: visits.length - terminal.length,
            avgMinutesToTriage: avg(triaged, (v) => minutes(v.arrivedAt, v.triagedAt)),
            avgMinutesToDisposition: avg(disposed, (v) => minutes(v.arrivedAt, v.dispositionAt)),
            byPriority,
            byDisposition,
          },
          'req_mock_emergency_summary',
        ),
      );
    }),

    http.post('*/api/v1/emergency/visits', async ({ request }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const patientId = stringField(body?.patientId);
      if (!patientId) return validationError('A patient is required.');
      if (body?.branchId !== INPATIENT_BRANCH_ID) return notFound('Branch not found');

      const now = new Date().toISOString();
      const id = `erv_example_${visitSeq++}`;
      const visit: MutableVisit = {
        id,
        organizationId: 'org_example_1',
        visitNumber: `ER-${now.slice(0, 4)}-${String(visitSeq - 1).padStart(6, '0')}`,
        branchId: INPATIENT_BRANCH_ID,
        patientId,
        status: 'ARRIVED',
        priority: null,
        registeredById: 'usr_example_0001',
        arrivedById: 'usr_example_0001',
        arrivedAt: stringField(body?.arrivedAt) ?? now,
        chiefComplaint: null,
        triagedById: null,
        triagedAt: null,
        assessedAt: null,
        assessment: null,
        treatmentStartedAt: null,
        treatment: null,
        observedAt: null,
        dispositionAt: null,
        disposition: null,
        admittedAdmissionId: null,
        referredTo: null,
        referralNotes: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      };
      visits.push(visit);
      return HttpResponse.json(apiOk({ visit }, 'req_mock_emergency_register'), { status: 201 });
    }),

    http.post('*/api/v1/emergency/visits/:id/triage', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      if (!isPriority(body?.priority)) return validationError('A valid priority is required.');
      return advance(String(params.id), 'triage', (visit, now) => {
        visit.status = 'TRIAGED';
        visit.priority = body!.priority as RegistryEmergencyPriority;
        visit.chiefComplaint = stringField(body?.complaint);
        visit.triagedById = 'usr_example_0001';
        visit.triagedAt = now;
      });
    }),

    http.patch('*/api/v1/emergency/visits/:id/priority', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const visit = findVisit(String(params.id));
      if (!visit) return notFound('Emergency visit not found');
      if (isTerminal(visit.status)) return closed();
      const body = await readJson(request);
      if (!isPriority(body?.priority)) return validationError('A valid priority is required.');
      const now = new Date().toISOString();
      visit.priority = body.priority as RegistryEmergencyPriority;
      visit.version += 1;
      visit.updatedAt = now;
      return HttpResponse.json(apiOk({ visit }, 'req_mock_emergency_priority'));
    }),

    http.post('*/api/v1/emergency/visits/:id/assess', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      return advance(String(params.id), 'assess', (visit, now) => {
        visit.status = 'ASSESSED';
        visit.assessment = stringField(body?.assessment);
        visit.assessedAt = now;
      });
    }),

    http.post('*/api/v1/emergency/visits/:id/treat', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      return advance(String(params.id), 'treat', (visit, now) => {
        visit.status = 'IN_TREATMENT';
        visit.treatment = stringField(body?.treatment);
        visit.treatmentStartedAt = now;
      });
    }),

    http.post('*/api/v1/emergency/visits/:id/observe', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      return advance(String(params.id), 'observe', (visit, now) => {
        visit.status = 'OBSERVATION';
        visit.observedAt = now;
      });
    }),

    http.post('*/api/v1/emergency/visits/:id/admit', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const visit = findVisit(String(params.id));
      if (!visit) return notFound('Emergency visit not found');
      if (isTerminal(visit.status)) return closed();
      if (!SOURCES.admit!.includes(visit.status)) return invalidTransition(visit.status, 'admit');
      const body = await readJson(request);
      const bedId = stringField(body?.bedId);
      if (!bedId) return validationError('A bed is required.');

      const admitted = admitFromEmergency({
        patientId: visit.patientId,
        bedId,
        departmentId: stringField(body?.departmentId),
        provisionalDiagnosis: stringField(body?.provisionalDiagnosis),
        expectedDischargeAt: stringField(body?.expectedDischargeAt),
      });
      if (!admitted.ok) {
        if (admitted.reason === 'BED_NOT_FOUND') return notFound('Bed not found');
        return HttpResponse.json(
          apiError(
            admitted.reason,
            admitted.reason === 'ADMISSION_ALREADY_ACTIVE'
              ? 'The patient already has an active admission.'
              : 'The selected bed is not available.',
          ),
          { status: 409 },
        );
      }
      const now = new Date().toISOString();
      visit.status = 'ADMITTED';
      visit.disposition = 'ADMITTED';
      visit.dispositionAt = now;
      visit.admittedAdmissionId = admitted.admissionId;
      visit.version += 1;
      visit.updatedAt = now;
      return HttpResponse.json(apiOk({ visit }, 'req_mock_emergency_admit'), { status: 201 });
    }),

    http.post('*/api/v1/emergency/visits/:id/refer', async ({ request, params }) => {
      await delay(MOCK_LATENCY_MS);
      const body = await readJson(request);
      const referredTo = stringField(body?.referredTo);
      if (!referredTo) return validationError('A referral destination is required.');
      return advance(String(params.id), 'refer', (visit, now) => {
        visit.status = 'REFERRED';
        visit.disposition = 'REFERRED' as RegistryEmergencyDisposition;
        visit.dispositionAt = now;
        visit.referredTo = referredTo;
        visit.referralNotes = stringField(body?.referralNotes);
      });
    }),

    http.post('*/api/v1/emergency/visits/:id/discharge', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      return advance(String(params.id), 'discharge', (visit, now) => {
        visit.status = 'DISCHARGED';
        visit.disposition = 'DISCHARGED' as RegistryEmergencyDisposition;
        visit.dispositionAt = now;
      });
    }),

    http.get('*/api/v1/emergency/visits/:id', async ({ params }) => {
      await delay(MOCK_LATENCY_MS);
      const visit = findVisit(String(params.id));
      if (!visit) return notFound('Emergency visit not found');
      return HttpResponse.json(apiOk({ visit }, 'req_mock_emergency'));
    }),
  ];
}

function minutes(from: string, to: string | null): number {
  if (!to) return 0;
  return (new Date(to).getTime() - new Date(from).getTime()) / 60_000;
}

function avg(rows: readonly MutableVisit[], pick: (visit: MutableVisit) => number): number {
  if (rows.length === 0) return 0;
  return Math.round((rows.reduce((sum, visit) => sum + pick(visit), 0) / rows.length) * 10) / 10;
}
