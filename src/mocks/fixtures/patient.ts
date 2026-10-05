import type { StatusTone } from '@/components/staff/status-pill';
import type { TimelineEvent } from '@/components/staff/timeline';
import type { DisplayBoardEntry } from '@/components/staff/display-board';

/**
 * Patient and board fixtures.
 *
 * Fabricated throughout and prefixed EXAMPLE, per `src/mocks/handlers.ts`.
 *
 * `dateOfBirth` is deliberately inconsistent in format between records — one
 * ISO, one written out — because date handling is where clinical UIs quietly
 * disagree with each other, and a fixture set that is uniformly tidy hides it.
 */

export interface PatientFixture {
  readonly reference: string;
  readonly displayName: string;
  readonly dateOfBirth: string;
  readonly sex: string;
  readonly allergies?: readonly string[];
  readonly flags?: readonly string[];
  readonly statusLabel: string;
  readonly statusTone: StatusTone;
  readonly events: readonly TimelineEvent[];
}

export const PATIENT: PatientFixture = {
  reference: 'EX-0001',
  displayName: 'EXAMPLE Achieng Otieno',
  dateOfBirth: '1984-03-11',
  sex: 'Female',
  allergies: ['Penicillin', 'Latex'],
  flags: ['Falls risk'],
  statusLabel: 'In ward',
  statusTone: 'info',
  events: [
    {
      id: 'evt-4',
      timestamp: '2026-10-05T09:12:00Z',
      author: 'EXAMPLE Dr N. Wanjiru, Registrar',
      eventType: 'observation',
      summary: 'Escalated to consultant review',
      detail: 'Systolic 92 on recheck. Called the on-call consultant.',
      tone: 'critical',
      tag: 'Escalated',
    },
    {
      id: 'evt-3',
      timestamp: '2026-10-05T07:40:00Z',
      author: 'EXAMPLE S. Kimani, Intern',
      eventType: 'observation',
      summary: 'Observations recorded',
      detail: 'Temperature 38.4, pulse 104, BP 118/74, SpO2 96% on room air.',
    },
    {
      id: 'evt-2',
      timestamp: '2026-10-05T07:05:00Z',
      author: 'EXAMPLE B. Otieno, Triage Nurse',
      eventType: 'handover',
      summary: 'Shift handover received',
      detail: 'Three patients outstanding from the night team. See the night list.',
    },
    {
      id: 'evt-1',
      timestamp: '2026-10-05T06:48:00Z',
      author: 'EXAMPLE B. Otieno, Triage Nurse',
      eventType: 'triage',
      summary: 'Triaged as urgent',
      detail: 'Presenting with a post-operative wound review, day four.',
      tone: 'warning',
      tag: 'Urgent',
    },
  ],
};

export const DISPLAY_BOARD_ENTRIES: readonly DisplayBoardEntry[] = [
  { callNumber: 'A-014', desk: 'Clinic 2', state: 'now' },
  { callNumber: 'A-015', desk: 'Clinic 2', state: 'next' },
  { callNumber: 'A-016', desk: 'Clinic 4', state: 'next' },
  { callNumber: 'A-017', desk: 'Clinic 1', state: 'waiting' },
  { callNumber: 'A-018', desk: 'Clinic 3', state: 'waiting' },
  { callNumber: 'A-019', desk: 'Clinic 2', state: 'waiting' },
];
