/**
 * F4 medication catalog fixtures (doctor workspace).
 *
 * Fabricated and EXAMPLE-prefixed throughout, per `src/mocks/handlers.ts`. The
 * same set is duplicated in `e2e/stub-api.mjs` so mock dev and the
 * production-build e2e offer the same pick list in the prescription composer.
 */

export interface MedicationFixture {
  readonly id: string;
  readonly name: string;
  readonly genericName: string | null;
  readonly strength: string | null;
  readonly form: string | null;
  readonly unit: string;
  readonly category: 'MEDICATION' | 'SUPPLY';
  readonly isControlled: boolean;
  readonly isActive: boolean;
}

export const MEDICATIONS: readonly MedicationFixture[] = [
  {
    id: 'med_example_7101',
    name: 'EXAMPLE Amoxicillin',
    genericName: 'Amoxicillin',
    strength: '500mg',
    form: 'capsule',
    unit: 'capsule',
    category: 'MEDICATION',
    isControlled: false,
    isActive: true,
  },
  {
    id: 'med_example_7102',
    name: 'EXAMPLE Paracetamol',
    genericName: 'Paracetamol',
    strength: '500mg',
    form: 'tablet',
    unit: 'tablet',
    category: 'MEDICATION',
    isControlled: false,
    isActive: true,
  },
  {
    id: 'med_example_7103',
    name: 'EXAMPLE Salbutamol inhaler',
    genericName: 'Salbutamol',
    strength: '100mcg/dose',
    form: 'inhaler',
    unit: 'dose',
    category: 'MEDICATION',
    isControlled: false,
    isActive: true,
  },
  {
    id: 'med_example_7104',
    name: 'EXAMPLE Metformin',
    genericName: 'Metformin',
    strength: '500mg',
    form: 'tablet',
    unit: 'tablet',
    category: 'MEDICATION',
    isControlled: false,
    isActive: true,
  },
  {
    id: 'med_example_7105',
    name: 'EXAMPLE Morphine (controlled)',
    genericName: 'Morphine',
    strength: '10mg/mL',
    form: 'ampoule',
    unit: 'ampoule',
    category: 'MEDICATION',
    isControlled: true,
    isActive: true,
  },
  {
    id: 'med_example_7106',
    name: 'EXAMPLE Gauze roll',
    genericName: null,
    strength: null,
    form: 'roll',
    unit: 'roll',
    category: 'SUPPLY',
    isControlled: false,
    isActive: true,
  },
];