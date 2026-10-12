import { http, HttpResponse } from 'msw';

import { apiError, apiOk, apiPage } from '@/mocks/handlers';
import {
  FIRST_VITAL_SEQUENCE,
  VITAL_RECORDS,
  type VitalFixture,
} from '@/mocks/fixtures/vitals-registry';

/**
 * MSW handlers for `vitals` (F3: nursing).
 *
 * Mirrors `vitals.service.ts`: append-only recording, corrections that write a
 * superseding row rather than an edit, BMI computed from height/weight, and a
 * newest-first page. The contract and records match `e2e/stub-api.mjs`.
 */

interface LiveVital {
  id: string;
  patientId: string;
  visitId: string | null;
  temperatureC: number | null;
  systolicMmHg: number | null;
  diastolicMmHg: number | null;
  pulseBpm: number | null;
  respiratoryRate: number | null;
  spo2: number | null;
  weightKg: number | null;
  heightCm: number | null;
  painScore: number | null;
  notes: string | null;
  observedAt: string;
  correctionOfId: string | null;
  correctionReason: string | null;
  recordedByUserId: string;
  createdAt: string;
}

const RECORDER_ID = 'usr_example_0001';

let sequence = FIRST_VITAL_SEQUENCE;

/** The same rounding the API uses so mock and server agree to one decimal. */
function computeBmi(weightKg: number | null, heightCm: number | null): number | null {
  if (
    weightKg === null ||
    heightCm === null ||
    !Number.isFinite(weightKg) ||
    !Number.isFinite(heightCm) ||
    weightKg <= 0 ||
    heightCm <= 0 ||
    heightCm < 60 ||
    heightCm > 260 ||
    weightKg < 1 ||
    weightKg > 500
  ) {
    return null;
  }
  const metres = heightCm / 100;
  return Math.round((weightKg / (metres * metres)) * 10) / 10;
}

function bmiCategory(bmi: number | null): string | null {
  if (bmi === null) return null;
  if (bmi < 18.5) return 'UNDERWEIGHT';
  if (bmi < 25) return 'NORMAL';
  if (bmi < 30) return 'OVERWEIGHT';
  return 'OBESE';
}

function serialize(vital: LiveVital) {
  const bmi = computeBmi(vital.weightKg, vital.heightCm);
  return {
    id: vital.id,
    patientId: vital.patientId,
    visitId: vital.visitId,
    temperatureC: vital.temperatureC,
    systolicMmHg: vital.systolicMmHg,
    diastolicMmHg: vital.diastolicMmHg,
    pulseBpm: vital.pulseBpm,
    respiratoryRate: vital.respiratoryRate,
    spo2: vital.spo2,
    weightKg: vital.weightKg,
    heightCm: vital.heightCm,
    bmi,
    bmiCategory: bmiCategory(bmi),
    painScore: vital.painScore,
    notes: vital.notes,
    observedAt: vital.observedAt,
    correctionOfId: vital.correctionOfId,
    correctionReason: vital.correctionReason,
    recordedByUserId: vital.recordedByUserId,
    createdAt: vital.createdAt,
  };
}

const live: LiveVital[] = VITAL_RECORDS.map((fixture: VitalFixture) => {
  const observedAt = new Date(Date.now() - fixture.observedMinutesAgo * 60_000).toISOString();
  return {
    id: fixture.id,
    patientId: fixture.patientId,
    visitId: fixture.visitId,
    temperatureC: fixture.temperatureC,
    systolicMmHg: fixture.systolicMmHg,
    diastolicMmHg: fixture.diastolicMmHg,
    pulseBpm: fixture.pulseBpm,
    respiratoryRate: fixture.respiratoryRate,
    spo2: fixture.spo2,
    weightKg: fixture.weightKg,
    heightCm: fixture.heightCm,
    painScore: fixture.painScore,
    notes: fixture.notes,
    observedAt,
    correctionOfId: fixture.correctionOfId,
    correctionReason: fixture.correctionReason,
    recordedByUserId: RECORDER_ID,
    createdAt: observedAt,
  };
});

const MEASUREMENT_FIELDS = [
  'temperatureC',
  'systolicMmHg',
  'diastolicMmHg',
  'pulseBpm',
  'respiratoryRate',
  'spo2',
  'weightKg',
  'heightCm',
  'painScore',
] as const;

type MeasurementField = (typeof MEASUREMENT_FIELDS)[number];

function measurementsOf(body: Record<string, unknown>): Record<MeasurementField, number | null> {
  const data = {} as Record<MeasurementField, number | null>;
  for (const field of MEASUREMENT_FIELDS) {
    const value = body[field];
    data[field] = typeof value === 'number' ? value : null;
  }
  return data;
}

/** Mirrors the server refine: any measurement *or* a note counts as content. */
function hasContent(body: Record<string, unknown>): boolean {
  if (typeof body.notes === 'string' && body.notes.trim().length > 0) return true;
  return MEASUREMENT_FIELDS.some((field) => typeof body[field] === 'number');
}

function nextId(): string {
  const id = `vr_example_${sequence}`;
  sequence += 1;
  return id;
}

async function readJson(request: Request): Promise<Record<string, unknown>> {
  try {
    return (await request.json()) as Record<string, unknown>;
  } catch {
    return {};
  }
}

export const vitalsHandlers = [
  http.get('*/api/v1/vitals', ({ request }) => {
    const url = new URL(request.url);
    const patientId = url.searchParams.get('patientId');
    const visitId = url.searchParams.get('visitId');
    const page = Math.max(1, Number(url.searchParams.get('page') ?? '1') || 1);
    const limit = Math.max(1, Number(url.searchParams.get('limit') ?? '20') || 20);

    const filtered = live
      .filter((vital) => (patientId ? vital.patientId === patientId : true))
      .filter((vital) => (visitId ? vital.visitId === visitId : true))
      .sort((a, b) => {
        const byObserved = Date.parse(b.observedAt) - Date.parse(a.observedAt);
        if (byObserved !== 0) return byObserved;
        return Date.parse(b.createdAt) - Date.parse(a.createdAt);
      });

    const total = filtered.length;
    const start = (page - 1) * limit;
    const items = filtered.slice(start, start + limit).map(serialize);

    return HttpResponse.json(
      apiPage(items, total, limit),
    );
  }),

  http.post('*/api/v1/vitals', async ({ request }) => {
    const body = await readJson(request);
    const patientId = typeof body.patientId === 'string' ? body.patientId : '';
    if (!patientId) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'patientId is required.'), { status: 422 });
    }
    if (!hasContent(body)) {
      return HttpResponse.json(
        apiError('VALIDATION_ERROR', 'At least one measurement is required.'),
        { status: 422 },
      );
    }

    const observedAt =
      typeof body.observedAt === 'string' && body.observedAt.length > 0
        ? new Date(body.observedAt).toISOString()
        : new Date().toISOString();
    const now = new Date().toISOString();
    const record: LiveVital = {
      id: nextId(),
      patientId,
      visitId: typeof body.visitId === 'string' && body.visitId.length > 0 ? body.visitId : null,
      ...measurementsOf(body),
      notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null,
      observedAt,
      correctionOfId: null,
      correctionReason: null,
      recordedByUserId: RECORDER_ID,
      createdAt: now,
    };
    live.push(record);
    return HttpResponse.json(apiOk({ vitalRecord: serialize(record) }, 'req_mock_vital_record'), {
      status: 201,
    });
  }),

  http.post('*/api/v1/vitals/:id/correct', async ({ params, request }) => {
    const id = String(params.id);
    const original = live.find((vital) => vital.id === id);
    if (!original) {
      return HttpResponse.json(apiError('RESOURCE_NOT_FOUND', 'Vital record not found.'), {
        status: 404,
      });
    }
    const body = await readJson(request);
    const correctionReason =
      typeof body.correctionReason === 'string' ? body.correctionReason.trim() : '';
    if (correctionReason.length === 0) {
      return HttpResponse.json(apiError('VALIDATION_ERROR', 'correctionReason is required.'), {
        status: 422,
      });
    }
    if (!hasContent(body)) {
      return HttpResponse.json(
        apiError('VALIDATION_ERROR', 'At least one measurement is required.'),
        { status: 422 },
      );
    }

    const now = new Date().toISOString();
    const record: LiveVital = {
      id: nextId(),
      patientId: original.patientId,
      visitId: original.visitId,
      ...measurementsOf(body),
      notes: typeof body.notes === 'string' && body.notes.trim().length > 0 ? body.notes.trim() : null,
      observedAt: original.observedAt,
      correctionOfId: original.id,
      correctionReason,
      recordedByUserId: RECORDER_ID,
      createdAt: now,
    };
    live.push(record);
    return HttpResponse.json(apiOk({ vitalRecord: serialize(record) }, 'req_mock_vital_correct'), {
      status: 201,
    });
  }),
];
