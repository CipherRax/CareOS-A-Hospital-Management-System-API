/**
 * F4 clinical-notes fixtures (doctor workspace).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e render the same content. Encounter ids line up with
 * `encounters-registry.ts`; patient ids with `patients-registry.ts`.
 *
 * Versions are stored as relative stamps and flattened at serialize time, so
 * mock dev and the stub produce the same "minutes ago" values only at the same
 * moment — each keeps its own clock, which is fine because neither asserts the
 * other's timestamps.
 */

export interface NoteVersionFixture {
  readonly versionNumber: number;
  readonly kind: 'ORIGINAL' | 'AMENDMENT' | 'NEW_VERSION';
  readonly title: string | null;
  readonly sections: Readonly<Record<string, string>>;
  readonly reason: string | null;
  readonly authorId: string;
  readonly minutesAgo: number;
}

export interface NoteFixture {
  readonly id: string;
  readonly encounterId: string;
  readonly patientId: string;
  readonly authorId: string;
  readonly status: 'DRAFT' | 'FINAL';
  readonly title: string | null;
  readonly sections: Readonly<Record<string, string>>;
  readonly reason: string | null;
  readonly templateId: string | null;
  /** Stamped against the current clock so "created" reads sensibly on any day. */
  readonly createdMinutesAgo: number;
  readonly updatedMinutesAgo: number;
  readonly finalizedMinutesAgo: number | null;
  readonly versions: readonly NoteVersionFixture[];
}

export interface NoteTemplateFixture {
  readonly id: string;
  readonly name: string;
  readonly description: string | null;
  readonly departmentId: string | null;
  readonly sections: readonly string[];
  readonly isActive: boolean;
}

export const NOTE_AUTHOR_ID = 'usr_example_9001';

export const NOTES: readonly NoteFixture[] = [
  {
    id: 'cn_example_8001',
    encounterId: 'enc_example_6001',
    patientId: 'pat_example_1001',
    authorId: NOTE_AUTHOR_ID,
    status: 'FINAL',
    title: 'Initial assessment',
    sections: {
      chiefComplaint: 'Cough with yellow sputum for three days.',
      history: 'No fever reported at home; otherwise well.',
      assessment: 'Suspect acute bronchitis.',
      plan: 'Chest X-ray and symptomatic treatment.',
    },
    reason: null,
    templateId: 'cnt_example_8201',
    createdMinutesAgo: 22,
    updatedMinutesAgo: 12,
    finalizedMinutesAgo: 12,
    versions: [
      {
        versionNumber: 1,
        kind: 'ORIGINAL',
        title: 'Initial assessment',
        sections: {
          chiefComplaint: 'Cough with yellow sputum for three days.',
          history: 'No fever reported at home; otherwise well.',
          assessment: 'Suspect acute bronchitis.',
          plan: 'Chest X-ray and symptomatic treatment.',
        },
        reason: null,
        authorId: NOTE_AUTHOR_ID,
        minutesAgo: 12,
      },
    ],
  },
  {
    id: 'cn_example_8002',
    encounterId: 'enc_example_6001',
    patientId: 'pat_example_1001',
    authorId: NOTE_AUTHOR_ID,
    status: 'DRAFT',
    title: null,
    sections: {
      objective: 'BP 124/78, HR 88, SpO2 97% on room air.',
      plan: 'Oral antibiotics pending sputum culture.',
    },
    reason: null,
    templateId: null,
    createdMinutesAgo: 8,
    updatedMinutesAgo: 3,
    finalizedMinutesAgo: null,
    versions: [],
  },
  {
    id: 'cn_example_8003',
    encounterId: 'enc_example_6002',
    patientId: 'pat_example_1002',
    authorId: 'usr_example_9002',
    status: 'FINAL',
    title: 'Resuscitation note',
    sections: {
      history: 'Chest pain radiating to the left arm, onset 45 minutes ago.',
      objective: 'ECG shows anterior ST elevation.',
      assessment: 'STEMI.',
      plan: 'Thrombolysis and transfer to the cath lab.',
    },
    reason: null,
    templateId: 'cnt_example_8202',
    createdMinutesAgo: 70,
    updatedMinutesAgo: 60,
    finalizedMinutesAgo: 60,
    versions: [
      {
        versionNumber: 1,
        kind: 'ORIGINAL',
        title: 'Resuscitation note',
        sections: {
          history: 'Chest pain radiating to the left arm, onset 45 minutes ago.',
          objective: 'ECG shows anterior ST elevation.',
          assessment: 'STEMI.',
          plan: 'Thrombolysis and transfer to the cath lab.',
        },
        reason: null,
        authorId: 'usr_example_9002',
        minutesAgo: 60,
      },
      {
        versionNumber: 2,
        kind: 'AMENDMENT',
        title: 'Resuscitation note',
        sections: {
          history: 'Chest pain radiating to the left arm, onset 45 minutes ago.',
          objective: 'ECG shows anterior ST elevation. Troponin raised.',
          assessment: 'STEMI.',
          plan: 'Thrombolysed; transfer to the cath lab confirmed. Aspirin and heparin given.',
        },
        reason: 'Laboratory results returned after finalization.',
        authorId: 'usr_example_9002',
        minutesAgo: 40,
      },
    ],
  },
];

export const NOTE_TEMPLATES: readonly NoteTemplateFixture[] = [
  {
    id: 'cnt_example_8201',
    name: 'EXAMPLE outpatient note',
    description: 'Standard outpatient consultation.',
    departmentId: 'dep_example_outpatient',
    sections: ['chiefComplaint', 'history', 'assessment', 'plan'],
    isActive: true,
  },
  {
    id: 'cnt_example_8202',
    name: 'EXAMPLE emergency note',
    description: 'A&E resuscitation and clerking.',
    departmentId: 'dep_example_emergency',
    sections: ['history', 'objective', 'assessment', 'plan'],
    isActive: true,
  },
];