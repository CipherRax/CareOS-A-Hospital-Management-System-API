/**
 * F2 patient registry fixtures.
 *
 * Fabricated throughout and prefixed EXAMPLE, per `src/mocks/handlers.ts`. These
 * are the *same* records the e2e stub answers with (`e2e/stub-api.mjs` duplicates
 * the set), so a screenshot taken in mock dev matches what the production build
 * renders — the two datasets cannot silently drift.
 *
 * Field names follow the exported contract where it models them (`PatientResponseDto`,
 * `PatientTimelineResponseDto`, `PatientAccessLogResponseDto`) and the raw rows
 * observed for the sub-entities (GAP-014) elsewhere.
 *
 * The register flow is scripted: posting `EXAMPLE Amina Yusuf` born 1992-05-14
 * hits the duplicate detection against `pat_example_1001`, which is what makes
 * the 409 comparison reachable in a demo. Everything else registers cleanly.
 */

export interface RegistryContact {
  readonly phone: string | null;
  readonly email: string | null;
}

export interface RegistryPatient {
  readonly id: string;
  readonly patientNumber: string;
  readonly firstName: string;
  readonly otherNames: string | null;
  readonly lastName: string;
  readonly dateOfBirth: string | null;
  readonly sex: 'MALE' | 'FEMALE' | 'OTHER' | null;
  readonly phone: string | null;
  readonly email: string | null;
  readonly address: string | null;
  readonly county: string | null;
  readonly town: string | null;
  readonly photoUrl: string | null;
  readonly status: 'ACTIVE' | 'MERGED' | 'ARCHIVED';
  readonly duplicateConfirmedAt: string | null;
  readonly duplicateConfirmReason: string | null;
  readonly mergedIntoPatientId: string | null;
  readonly version: number;
  readonly createdAt: string;
  readonly updatedAt: string;
  readonly age: number;
  readonly flags?: readonly string[];
  readonly legalHold?: boolean;
  readonly location?: string;
  readonly insurance?: { providerName: string; scheme?: string; memberNumber?: string };
}

/** The identity phone/DOB/name shortlist the master banner needs beyond the export. */
export interface RegistryMasterSections {
  readonly guardians: readonly unknown[];
  readonly consents: readonly unknown[];
  readonly allergies: readonly unknown[];
  readonly medicalHistory: readonly unknown[];
}

export interface RegistryFixtures {
  readonly patients: readonly RegistryPatient[];
  readonly sections: Record<string, RegistryMasterSections>;
  readonly timeline: Record<string, readonly unknown[]>;
  readonly accessLog: Record<string, readonly unknown[]>;
}

export const REGISTRY: RegistryFixtures = {
  patients: [
    {
      id: 'pat_example_1001',
      patientNumber: 'PAT-2026-000001',
      firstName: 'EXAMPLE',
      otherNames: 'Amina',
      lastName: 'Yusuf',
      dateOfBirth: '1992-05-14',
      sex: 'FEMALE',
      phone: '+254700111222',
      email: 'example.aminayusuf@example.org',
      address: 'Studio 4, Swahili Lane',
      county: 'Mombasa County',
      town: 'Mombasa',
      photoUrl: null,
      status: 'ACTIVE',
      duplicateConfirmedAt: null,
      duplicateConfirmReason: null,
      mergedIntoPatientId: null,
      version: 3,
      createdAt: '2026-09-02T08:31:00.000Z',
      updatedAt: '2026-10-04T14:12:00.000Z',
      age: 34,
      location: 'Clinic 2',
    },
    {
      id: 'pat_example_1002',
      patientNumber: 'PAT-2026-000002',
      firstName: 'EXAMPLE',
      otherNames: 'O.',
      lastName: 'Omondi',
      dateOfBirth: '1978-11-02',
      sex: 'MALE',
      phone: '+254722333444',
      email: 'example.davoomondi@example.org',
      address: 'Plot 9, Voi Road',
      county: 'Taita-Taveta County',
      town: 'Voi',
      photoUrl: null,
      status: 'ACTIVE',
      duplicateConfirmedAt: null,
      duplicateConfirmReason: null,
      mergedIntoPatientId: null,
      version: 1,
      createdAt: '2026-08-19T10:05:00.000Z',
      updatedAt: '2026-08-19T10:05:00.000Z',
      age: 48,
      flags: ['Falls risk'],
    },
    {
      id: 'pat_example_1003',
      patientNumber: 'PAT-2026-000003',
      firstName: 'EXAMPLE',
      otherNames: null,
      lastName: 'Chebet',
      dateOfBirth: '2001-09-30',
      sex: 'FEMALE',
      phone: '+254733555666',
      email: 'example.margaretchebet@example.org',
      address: 'House 12, Academy Close',
      county: 'Uasin Gishu County',
      town: 'Eldoret',
      photoUrl: null,
      status: 'ACTIVE',
      duplicateConfirmedAt: null,
      duplicateConfirmReason: null,
      mergedIntoPatientId: null,
      version: 2,
      createdAt: '2026-10-01T12:20:00.000Z',
      updatedAt: '2026-10-05T09:00:00.000Z',
      age: 25,
      legalHold: true,
      location: 'In ward, bed 4',
    },
  ],
  sections: {
    pat_example_1001: {
      guardians: [
        {
          id: 'grd_example_1001',
          firstName: 'EXAMPLE',
          lastName: 'Kibet',
          relationship: 'HUSBAND_OR_WIFE',
          phone: '+254722444555',
          email: null,
          isPrimary: true,
          isEmergencyContact: true,
        },
      ],
      consents: [
        { type: 'TREATMENT', status: 'GRANTED' },
        { type: 'SHARING', status: 'GRANTED' },
      ],
      allergies: [
        { substance: 'Penicillin', severity: 'SEVERE', status: 'ACTIVE', reaction: 'Anaphylaxis' },
      ],
      medicalHistory: [
        {
          category: 'CHRONIC_CONDITION',
          description: 'Hormone replacement therapy under endocrinology follow-up.',
          onsetDate: '2021-03-01',
        },
      ],
    },
    pat_example_1002: {
      guardians: [],
      consents: [{ type: 'TREATMENT', status: 'GRANTED' }],
      allergies: [],
      medicalHistory: [
        {
          category: 'PAST_SURGERY',
          description: 'Right knee arthroscopy, 2019.',
          onsetDate: '2019-07-15',
        },
      ],
    },
    pat_example_1003: {
      guardians: [
        {
          id: 'grd_example_1003',
          firstName: 'EXAMPLE',
          lastName: 'Chebet',
          relationship: 'FATHER',
          phone: '+254711222333',
          email: null,
          isPrimary: false,
          isEmergencyContact: true,
        },
      ],
      consents: [],
      allergies: [{ substance: 'Latex', severity: 'MILD', status: 'ACTIVE', reaction: 'Rash' }],
      medicalHistory: [],
    },
  },
  timeline: {
    pat_example_1001: [
      {
        id: 'tl_example_1001_4',
        patientId: 'pat_example_1001',
        type: 'APPOINTMENT',
        title: 'Booked for follow-up review',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-10-05T09:12:00.000Z',
      },
      {
        id: 'tl_example_1001_3',
        patientId: 'pat_example_1001',
        type: 'ENCOUNTER',
        title: 'Consulted in Clinic 2',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-10-04T14:10:00.000Z',
      },
      {
        id: 'tl_example_1001_2',
        patientId: 'pat_example_1001',
        type: 'DOCUMENT',
        title: 'Allergy recorded: Penicillin',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-09-02T08:40:00.000Z',
      },
      {
        id: 'tl_example_1001_1',
        patientId: 'pat_example_1001',
        type: 'REGISTRATION',
        title: 'Registered at reception',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-09-02T08:31:00.000Z',
      },
    ],
    pat_example_1002: [
      {
        id: 'tl_example_1002_2',
        patientId: 'pat_example_1002',
        type: 'OBSERVATION',
        title: 'Blood pressure recorded: 138/88',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-10-05T06:48:00.000Z',
      },
      {
        id: 'tl_example_1002_1',
        patientId: 'pat_example_1002',
        type: 'REGISTRATION',
        title: 'Registered at reception',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-08-19T10:05:00.000Z',
      },
    ],
    pat_example_1003: [
      {
        id: 'tl_example_1003_2',
        patientId: 'pat_example_1003',
        type: 'NOTE',
        title: 'Legal hold placed on this record',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-10-05T09:00:00.000Z',
      },
      {
        id: 'tl_example_1003_1',
        patientId: 'pat_example_1003',
        type: 'REGISTRATION',
        title: 'Registered at reception',
        requiredPermission: 'patients:read',
        actorId: 'usr_example_1001',
        occurredAt: '2026-10-01T12:20:00.000Z',
      },
    ],
  },
  accessLog: {
    pat_example_1001: [
      {
        id: 'al_example_1001_4',
        patientId: 'pat_example_1001',
        userId: 'usr_example_1001',
        action: 'VIEW',
        section: 'master',
        reason: null,
        ip: '127.0.0.1',
        userAgent: 'careOS-web',
        requestId: 'req_example_4',
        createdAt: '2026-10-05T09:12:00.000Z',
      },
      {
        id: 'al_example_1001_3',
        patientId: 'pat_example_1001',
        userId: 'usr_example_1001',
        action: 'VIEW',
        section: 'timeline',
        reason: null,
        ip: '127.0.0.1',
        userAgent: 'careOS-web',
        requestId: 'req_example_3',
        createdAt: '2026-10-05T07:40:00.000Z',
      },
      {
        id: 'al_example_1001_2',
        patientId: 'pat_example_1001',
        userId: 'usr_example_1001',
        action: 'UPDATE',
        section: 'allergies',
        reason: 'New allergy reported at reception',
        ip: '127.0.0.1',
        userAgent: 'careOS-web',
        requestId: 'req_example_2',
        createdAt: '2026-09-02T08:40:00.000Z',
      },
      {
        id: 'al_example_1001_1',
        patientId: 'pat_example_1001',
        userId: 'usr_example_1001',
        action: 'CREATE',
        section: 'patient',
        reason: 'Registered at reception',
        ip: '127.0.0.1',
        userAgent: 'careOS-web',
        requestId: 'req_example_1',
        createdAt: '2026-09-02T08:31:00.000Z',
      },
    ],
    pat_example_1002: [
      {
        id: 'al_example_1002_1',
        patientId: 'pat_example_1002',
        userId: 'usr_example_1001',
        action: 'VIEW',
        section: 'master',
        reason: null,
        ip: '127.0.0.1',
        userAgent: 'careOS-web',
        requestId: 'req_example_5',
        createdAt: '2026-10-05T06:50:00.000Z',
      },
    ],
    pat_example_1003: [],
  },
};

/** The identity shortlist the duplicate scan compares against. */
export function duplicateCandidatesFor(input: {
  firstName?: string;
  lastName?: string;
  dateOfBirth?: string | null;
  phone?: string | null;
}): RegistryPatient[] {
  const haystack = REGISTRY.patients;
  const needle = `${(input.firstName ?? '').trim()} ${(input.lastName ?? '').trim()}`.toLowerCase();
  if (!needle) return [];
  return haystack.filter((patient) => {
    const name = `${patient.firstName} ${patient.lastName}`.toLowerCase();
    const dobMatches = input.dateOfBirth && patient.dateOfBirth === input.dateOfBirth;
    return name === needle && (dobMatches || Boolean(input.phone && patient.phone === input.phone));
  });
}

export function registryById(id: string): RegistryPatient | undefined {
  return REGISTRY.patients.find((patient) => patient.id === id);
}
