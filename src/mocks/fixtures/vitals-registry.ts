/**
 * F3 vitals fixtures.
 *
 * Fabricated throughout and prefixed EXAMPLE, per `src/mocks/handlers.ts`. The
 * same records appear in `e2e/stub-api.mjs`.
 *
 * Observations are stored as *minutes ago from handler load*, because the
 * recorder lists a patient's most recent vitals first and a fixed timestamp would
 * age out of a screenshot. BMI is not stored — it is computed by the handler from
 * height/weight, exactly as the API computes it server-side.
 *
 * `vr_example_7002` is a correction of `vr_example_7001` (append-only: the
 * original is never edited), so the chart shows the correction chain.
 */

export interface VitalFixture {
  readonly id: string;
  readonly patientId: string;
  readonly visitId: string | null;
  readonly observedMinutesAgo: number;
  readonly temperatureC: number | null;
  readonly systolicMmHg: number | null;
  readonly diastolicMmHg: number | null;
  readonly pulseBpm: number | null;
  readonly respiratoryRate: number | null;
  readonly spo2: number | null;
  readonly weightKg: number | null;
  readonly heightCm: number | null;
  readonly painScore: number | null;
  readonly notes: string | null;
  readonly correctionOfId: string | null;
  readonly correctionReason: string | null;
}

export const VITAL_RECORDS: readonly VitalFixture[] = [
  {
    id: 'vr_example_7001',
    patientId: 'pat_example_1001',
    visitId: 'vis_example_3001',
    observedMinutesAgo: 180,
    temperatureC: 38.9,
    systolicMmHg: 132,
    diastolicMmHg: 84,
    pulseBpm: 96,
    respiratoryRate: 20,
    spo2: 94,
    weightKg: null,
    heightCm: null,
    painScore: 4,
    notes: 'Presented febrile.',
    correctionOfId: null,
    correctionReason: null,
  },
  {
    id: 'vr_example_7002',
    patientId: 'pat_example_1001',
    visitId: 'vis_example_3001',
    observedMinutesAgo: 175,
    temperatureC: 37.2,
    systolicMmHg: 128,
    diastolicMmHg: 80,
    pulseBpm: 88,
    respiratoryRate: 18,
    spo2: 97,
    weightKg: 68.4,
    heightCm: 165,
    painScore: 2,
    notes: null,
    correctionOfId: 'vr_example_7001',
    correctionReason: 'Thermometer re-check after rest.',
  },
  {
    id: 'vr_example_7003',
    patientId: 'pat_example_1003',
    visitId: 'vis_example_3003',
    observedMinutesAgo: 40,
    temperatureC: 36.8,
    systolicMmHg: 118,
    diastolicMmHg: 76,
    pulseBpm: 72,
    respiratoryRate: 16,
    spo2: 98,
    weightKg: 72,
    heightCm: 170,
    painScore: 0,
    notes: null,
    correctionOfId: null,
    correctionReason: null,
  },
];

export const FIRST_VITAL_SEQUENCE = 7004;
