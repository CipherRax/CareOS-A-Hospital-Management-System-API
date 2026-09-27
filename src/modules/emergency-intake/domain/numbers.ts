export interface NationalEmergencyNumber {
  country: string;
  purpose: string;
  label: string;
  phone: string;
  hours?: string;
}

/**
 * Built-in fallback national numbers used when the `EmergencyNumber` table is
 * unseeded (the anonymous path must always be able to tell a caller who to
 * ring, even before reference data is loaded). Operator reference data in the
 * table overrides these at read time.
 */
export const DEFAULT_NATIONAL_NUMBERS: readonly NationalEmergencyNumber[] = [
  {
    country: 'KE',
    purpose: 'ambulance',
    label: 'Kenya National Emergency Ambulance',
    phone: '199',
    hours: '24/7',
  },
  {
    country: 'KE',
    purpose: 'police',
    label: 'Kenya Police (999)',
    phone: '999',
    hours: '24/7',
  },
  {
    country: 'KE',
    purpose: 'fire',
    label: 'Kenya Fire Services (999)',
    phone: '999',
    hours: '24/7',
  },
  {
    country: 'KE',
    purpose: 'national',
    label: 'National Emergency Line',
    phone: '112',
    hours: '24/7',
  },
];

/** EU-equivalent fallback for non-KE deployments without seeded reference data. */
export const DEFAULT_EU_NUMBERS: readonly NationalEmergencyNumber[] = [
  {
    country: 'EU',
    purpose: 'emergency',
    label: 'European emergency number',
    phone: '112',
    hours: '24/7',
  },
];

export function defaultNumbersFor(country: string): NationalEmergencyNumber[] {
  if (country === 'KE') return [...DEFAULT_NATIONAL_NUMBERS];
  return [...DEFAULT_EU_NUMBERS];
}