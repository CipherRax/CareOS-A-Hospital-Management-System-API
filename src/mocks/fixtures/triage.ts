import type { StatusTone } from '@/components/clinical/status-pill';

/**
 * Triage queue fixtures.
 *
 * Every name here is prefixed EXAMPLE and every record is fabricated, per the
 * rule in `src/mocks/handlers.ts`: a screenshot of this screen must never be
 * mistakable for a real patient list.
 *
 * The text lengths are chosen to be awkward on purpose — a long presenting reason,
 * a long patient name — because that is what actually breaks a dense table, and
 * it is much cheaper to discover now than after the queue holds real records.
 */

export interface TriageRow {
  readonly reference: string;
  readonly patientName: string;
  readonly reason: string;
  readonly waitMinutes: number;
  readonly waitLabel: string;
  readonly acuityLabel: string;
  readonly acuityTone: StatusTone;
  readonly statusLabel: string;
  readonly statusTone: StatusTone;
}

export const TRIAGE_ROWS: readonly TriageRow[] = [
  {
    reference: 'EX-0001',
    patientName: 'EXAMPLE Achieng Otieno',
    reason: 'Post-operative wound review, day four',
    waitMinutes: 94,
    waitLabel: '1h 34m',
    acuityLabel: 'Urgent',
    acuityTone: 'warning',
    statusLabel: 'Awaiting review',
    statusTone: 'warning',
  },
  {
    reference: 'EX-0002',
    patientName: 'EXAMPLE Brian Otieno Omondi',
    reason: 'Chest pain radiating to the left arm, onset this morning',
    waitMinutes: 12,
    waitLabel: '12m',
    acuityLabel: 'Critical',
    acuityTone: 'critical',
    statusLabel: 'Assigned',
    statusTone: 'info',
  },
  {
    reference: 'EX-0003',
    patientName: 'EXAMPLE Wanjiru Kamau',
    reason: 'Antenatal check, 28 weeks',
    waitMinutes: 7,
    waitLabel: '7m',
    acuityLabel: 'Routine',
    acuityTone: 'success',
    statusLabel: 'Awaiting review',
    statusTone: 'warning',
  },
  {
    reference: 'EX-0004',
    patientName: 'EXAMPLE Fatuma Abdi',
    reason: 'Prescription renewal — inhalers',
    waitMinutes: 3,
    waitLabel: '3m',
    acuityLabel: 'Routine',
    acuityTone: 'success',
    statusLabel: 'Cleared',
    statusTone: 'success',
  },
  {
    reference: 'EX-0005',
    patientName: 'EXAMPLE Peter Mwangi',
    reason: 'Suspected fracture, left wrist, fall at work',
    waitMinutes: 41,
    waitLabel: '41m',
    acuityLabel: 'Urgent',
    acuityTone: 'warning',
    statusLabel: 'In progress',
    statusTone: 'info',
  },
];
