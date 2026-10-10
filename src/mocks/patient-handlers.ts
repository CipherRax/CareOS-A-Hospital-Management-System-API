import { http, HttpResponse } from 'msw';

import {
  duplicateCandidatesFor,
  REGISTRY,
  registryById,
  type RegistryPatient,
} from '@/mocks/fixtures/patients-registry';
import { apiError, apiOk, delay, MOCK_LATENCY_MS } from './handlers';

/**
 * F2 patient registry handlers (reception).
 *
 * Same contract and same records as `e2e/stub-api.mjs`, so mock dev and the
 * production-build e2e render the same patients. Two deliberate behaviours:
 *
 *  - Search rides `GET /patients?q=` because the live API has no `/search` path.
 *  - Registration returns 409 `POSSIBLE_DUPLICATE` with `details.candidates`
 *    nested exactly where the live API puts them (`error.details.candidates`),
 *    because that envelope is what the wizard's comparison panel reads.
 *
 * A patient id that is not in the registry 404s with the API's `RESOURCE_NOT_FOUND`
 * code, so a stale link fails the same way it would against a real deployment.
 */

function pageEnvelope(items: readonly unknown[], total: number) {
  return apiOk({
    items,
    meta: { page: 1, limit: 25, total, totalPages: Math.ceil(total / 25) },
  });
}

/** Patients created through `POST /patients` this mock session, so a freshly
 *  registered record resolves in search and in the master screen. */
const CREATED_PATIENTS: RegistryPatient[] = [];

function serializePatient(patient: RegistryPatient) {
  return { ...patient };
}

function allPatients(): readonly RegistryPatient[] {
  return [...CREATED_PATIENTS, ...REGISTRY.patients];
}

function findPatient(id: string): RegistryPatient | undefined {
  return CREATED_PATIENTS.find((patient) => patient.id === id) ?? registryById(id);
}

/** A fresh registration builds the API's `PAT-YYYY-NNNNNN` number shape. */
function formatNextPatientNumber(): string {
  const seq = 5 + CREATED_PATIENTS.length;
  return `PAT-2026-${String(seq).padStart(6, '0')}`;
}

function candidateEnvelope(
  firstName: string,
  lastName: string,
): {
  success: false;
  error: { code: string; message: string; details: { candidates: unknown[] } };
} {
  return {
    ...apiError('POSSIBLE_DUPLICATE', 'A patient with matching identity already exists.'),
    error: {
      code: 'POSSIBLE_DUPLICATE',
      message:
        'A patient with matching identity already exists. Confirm it is a duplicate or review the record.',
      details: {
        candidates: duplicateCandidatesFor({ firstName, lastName }).map((patient) => ({
          patientId: patient.id,
          patientNumber: patient.patientNumber,
          firstName: patient.firstName,
          lastName: patient.lastName,
          dateOfBirth: patient.dateOfBirth,
          score: 0.82,
          reasons: ['MATCHED_NAME', 'MATCHED_DATE_OF_BIRTH'],
        })),
      },
    },
  };
}

export const patientHandlers = [
  http.get('*/api/v1/patients', ({ request }) => {
    const url = new URL(request.url);
    const q = (url.searchParams.get('q') ?? '').trim().toLowerCase();
    let items = allPatients();
    if (q) {
      items = items.filter((patient) =>
        [
          patient.patientNumber,
          `${patient.firstName} ${patient.otherNames ?? ''} ${patient.lastName}`,
          patient.phone ?? '',
        ]
          .join(' ')
          .toLowerCase()
          .includes(q),
      );
    }
    return HttpResponse.json(pageEnvelope(items.map(serializePatient), items.length));
  }),

  http.post('*/api/v1/patients', async ({ request }) => {
    await delay(MOCK_LATENCY_MS);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (typeof body.firstName !== 'string' || typeof body.lastName !== 'string') {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'firstName and lastName required'), {
        status: 400,
      });
    }
    // Mirror the live duplicate detection: a same-name record that also matches on
    // date of birth or phone answers 409 unless the caller has already confirmed.
    if (body.confirmDuplicate !== true) {
      const candidates = duplicateCandidatesFor({
        firstName: body.firstName,
        lastName: body.lastName,
        dateOfBirth: typeof body.dateOfBirth === 'string' ? body.dateOfBirth : null,
        phone: typeof body.phone === 'string' ? body.phone : null,
      });
      if (candidates.length > 0) {
        return HttpResponse.json(candidateEnvelope(body.firstName, body.lastName), { status: 409 });
      }
    }

    const now = new Date().toISOString();
    const created: RegistryPatient = {
      id: `pat_example_${1005 + CREATED_PATIENTS.length}`,
      patientNumber: formatNextPatientNumber(),
      firstName: body.firstName,
      otherNames: typeof body.otherNames === 'string' ? body.otherNames : null,
      lastName: body.lastName,
      dateOfBirth:
        typeof body.dateOfBirth === 'string'
          ? body.dateOfBirth
          : body.dateOfBirth instanceof Date
            ? body.dateOfBirth.toISOString()
            : null,
      sex: typeof body.sex === 'string' ? (body.sex as RegistryPatient['sex']) : 'OTHER',
      phone: typeof body.phone === 'string' ? body.phone : null,
      email: typeof body.email === 'string' ? body.email : null,
      address: typeof body.address === 'string' ? body.address : null,
      county: typeof body.county === 'string' ? body.county : null,
      town: typeof body.town === 'string' ? body.town : null,
      photoUrl: null,
      status: 'ACTIVE',
      duplicateConfirmedAt: body.confirmDuplicate === true ? now : null,
      duplicateConfirmReason:
        typeof body.duplicateConfirmReason === 'string' ? body.duplicateConfirmReason : null,
      mergedIntoPatientId: null,
      version: 1,
      createdAt: now,
      updatedAt: now,
      age: 0,
    };
    CREATED_PATIENTS.push(created);
    return HttpResponse.json(apiOk(serializePatient(created), 'req_mock_patient_register'), {
      status: 201,
    });
  }),

  http.get('*/api/v1/patients/:id/master', ({ params }) => {
    const id = String(params.id);
    const patient = findPatient(id);
    if (!patient) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Patient not found.'), {
        status: 404,
      });
    }
    return HttpResponse.json(
      apiOk(
        {
          patient: serializePatient(patient),
          sections: REGISTRY.sections[id] ?? {
            guardians: [],
            consents: [],
            allergies: [],
            medicalHistory: [],
          },
        },
        `req_mock_master_${id}`,
      ),
      { status: 200 },
    );
  }),

  http.get('*/api/v1/patients/:id/timeline', ({ params }) => {
    const id = String(params.id);
    if (!findPatient(id)) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Patient not found.'), {
        status: 404,
      });
    }
    const rows = REGISTRY.timeline[id] ?? [];
    return HttpResponse.json(pageEnvelope(rows, rows.length));
  }),

  http.get('*/api/v1/patients/:id/access-log', ({ params }) => {
    const id = String(params.id);
    if (!findPatient(id)) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Patient not found.'), {
        status: 404,
      });
    }
    const rows = REGISTRY.accessLog[id] ?? [];
    return HttpResponse.json(pageEnvelope(rows, rows.length));
  }),

  http.post('*/api/v1/patients/:id/confirm-not-duplicate', async ({ params, request }) => {
    await delay(MOCK_LATENCY_MS);
    const id = String(params.id);
    const patient = findPatient(id);
    if (!patient) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Patient not found.'), {
        status: 404,
      });
    }
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'bad json'), { status: 400 });
    }
    if (typeof body.reason !== 'string' || body.reason.length === 0) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'reason required'), { status: 400 });
    }
    return HttpResponse.json(
      apiOk(
        {
          ...serializePatient(patient),
          duplicateConfirmedAt: new Date().toISOString(),
          duplicateConfirmReason: body.reason,
        },
        `req_mock_confirm_${id}`,
      ),
      { status: 200 },
    );
  }),
];
