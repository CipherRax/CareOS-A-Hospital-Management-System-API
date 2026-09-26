/**
 * Pure helpers for the daily rollup projection. Numeric aggregates are
 * integers or Decimal-precision sums (serialized as strings exactly like money,
 * ADR-029); rate/average math here is kept pure and unit-testable.
 */

export interface RollupCellKey {
  /** '' = org-wide. */
  branchId: string;
  /** '' = branch/org-wide. */
  departmentId: string;
}

export function cellKeyOf(branchId: string, departmentId: string): string {
  return `${branchId}\u0000${departmentId}`;
}

export function cellKeyParts(key: string): RollupCellKey {
  const [branchId, departmentId] = key.split('\u0000');
  return { branchId: branchId ?? '', departmentId: departmentId ?? '' };
}

/** UTC midnight on the given date — the business day key for rollups. */
export function businessDay(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

export function addUTCDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

export function* eachDay(from: Date, to: Date): Generator<Date> {
  const start = businessDay(from);
  const end = businessDay(to);
  for (let d = start; d <= end; d = addUTCDays(d, 1)) {
    yield d;
  }
}

/** Counts/sums accumulated during a day's recompute. */
export interface RollupCounters {
  visitsRegistered: number;
  visitsCompleted: number;
  queueTickets: number;
  queueServed: number;
  queueNoShow: number;
  waitMinutes: string;
  waitSamples: number;
  appointmentsBooked: number;
  appointmentsCompleted: number;
  appointmentsCancelled: number;
  appointmentsNoShow: number;
  appointmentsRescheduled: number;
  encountersOpened: number;
  encountersCompleted: number;
  consultationMinutes: string;
  consultationSamples: number;
  diagnosesRecorded: number;
  tasksCompleted: number;
  prescriptionsIssued: number;
  prescriptionsDispensed: number;
  unitsDispensed: number;
  stockReceivedLots: number;
  labOrdersCreated: number;
  labOrdersReleased: number;
  labSamplesRejected: number;
  labTatMinutes: string;
  labTatSamples: number;
  radiologyOrdersCreated: number;
  radiologyReportsReleased: number;
  admissionsCreated: number;
  admissionsDischarged: number;
  emergencyArrivals: number;
  emergencyTriaged: number;
  emergencyTimeToTriageMinutes: string;
  emergencySamples: number;
  invoicesIssued: number;
  invoicesTotal: string;
  paymentsCompleted: number;
  paymentsTotal: string;
  refundsCount: number;
  refundsTotal: string;
  claimsSubmitted: number;
  claimsPaid: number;
  claimsPaidTotal: string;
  feedbackSubmitted: number;
  feedbackRatingSum: number;
}

export function emptyCounters(): RollupCounters {
  return {
    visitsRegistered: 0,
    visitsCompleted: 0,
    queueTickets: 0,
    queueServed: 0,
    queueNoShow: 0,
    waitMinutes: '0.00',
    waitSamples: 0,
    appointmentsBooked: 0,
    appointmentsCompleted: 0,
    appointmentsCancelled: 0,
    appointmentsNoShow: 0,
    appointmentsRescheduled: 0,
    encountersOpened: 0,
    encountersCompleted: 0,
    consultationMinutes: '0.00',
    consultationSamples: 0,
    diagnosesRecorded: 0,
    tasksCompleted: 0,
    prescriptionsIssued: 0,
    prescriptionsDispensed: 0,
    unitsDispensed: 0,
    stockReceivedLots: 0,
    labOrdersCreated: 0,
    labOrdersReleased: 0,
    labSamplesRejected: 0,
    labTatMinutes: '0.00',
    labTatSamples: 0,
    radiologyOrdersCreated: 0,
    radiologyReportsReleased: 0,
    admissionsCreated: 0,
    admissionsDischarged: 0,
    emergencyArrivals: 0,
    emergencyTriaged: 0,
    emergencyTimeToTriageMinutes: '0.00',
    emergencySamples: 0,
    invoicesIssued: 0,
    invoicesTotal: '0.00',
    paymentsCompleted: 0,
    paymentsTotal: '0.00',
    refundsCount: 0,
    refundsTotal: '0.00',
    claimsSubmitted: 0,
    claimsPaid: 0,
    claimsPaidTotal: '0.00',
    feedbackSubmitted: 0,
    feedbackRatingSum: 0,
  };
}

/** percentage (0..100) of `part` in `whole`; null when the whole is empty. */
export function rateOf(part: number, whole: number): number | null {
  if (whole <= 0) return null;
  return Math.round((part / whole) * 1000) / 10;
}

/** average of sum/samples as a rounded number; null when no samples. */
export function averageOf(sum: number, samples: number): number | null {
  if (samples <= 0) return null;
  return Math.round((sum / samples) * 100) / 100;
}