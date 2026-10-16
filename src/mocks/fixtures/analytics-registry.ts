/**
 * F10 analytics fixtures (operational metrics).
 *
 * Fabricated and EXAMPLE-scoped. The same payload is duplicated in
 * `e2e/stub-api.mjs` so mock dev and the production build's e2e run cannot
 * silently drift.
 *
 * The shape mirrors `MetricsService.metrics()`: a scope, a period, a granularity,
 * a daily rollup series, a headline summary and a set of point-in-time snapshots.
 * Every snapshot carries the API's own `label`, which is what the dashboard
 * surfaces instead of paraphrasing the measurement.
 */

export const ANALYTICS_METRICS = {
  scope: { branchId: null, departmentId: null },
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-02-07T00:00:00.000Z' },
  granularity: 'day',
  series: [
    {
      date: '2026-02-01',
      patientVolume: 12,
      appointmentVolume: 8,
      noShowRate: 0.125,
      cancellationRate: 0,
      rescheduleRate: 0.125,
      avgWaitingMinutes: 14,
      avgConsultationMinutes: 22,
      revenue: '15400.00',
      invoicesIssued: 9,
      invoicesTotal: '16000.00',
      refundsTotal: '0.00',
      labTatAvgMinutes: 95,
      admissions: 2,
      discharges: 1,
      emergencyArrivals: 3,
      feedbackSubmitted: 4,
    },
    {
      date: '2026-02-02',
      patientVolume: 15,
      appointmentVolume: 10,
      noShowRate: 0.1,
      cancellationRate: 0.1,
      rescheduleRate: 0,
      avgWaitingMinutes: 11,
      avgConsultationMinutes: 19,
      revenue: '20150.00',
      invoicesIssued: 12,
      invoicesTotal: '21000.00',
      refundsTotal: '500.00',
      labTatAvgMinutes: 88,
      admissions: 3,
      discharges: 2,
      emergencyArrivals: 5,
      feedbackSubmitted: 6,
    },
    {
      date: '2026-02-03',
      patientVolume: 9,
      appointmentVolume: 7,
      noShowRate: 0.286,
      cancellationRate: 0,
      rescheduleRate: 0,
      avgWaitingMinutes: 18,
      avgConsultationMinutes: 25,
      revenue: '9800.00',
      invoicesIssued: 6,
      invoicesTotal: '10200.00',
      refundsTotal: '0.00',
      labTatAvgMinutes: 120,
      admissions: 1,
      discharges: 3,
      emergencyArrivals: 2,
      feedbackSubmitted: 2,
    },
  ],
  summary: {
    patientVolume: 36,
    visitsCompleted: 33,
    appointmentVolume: 25,
    appointmentsCompleted: 21,
    noShowRate: 0.16,
    cancellationRate: 0.04,
    rescheduleRate: 0.04,
    avgWaitingMinutes: 14,
    avgConsultationMinutes: 22,
    revenue: '45350.00',
    invoicesIssued: 27,
    invoicesTotal: '47200.00',
    refundsTotal: '500.00',
    labTatAvgMinutes: 101,
    admissions: 6,
    discharges: 6,
    emergencyArrivals: 10,
    prescriptionsDispensed: 58,
    feedbackSubmitted: 12,
  },
  snapshots: {
    outstandingInvoices: {
      count: 14,
      balanceDue: '76250.00',
      label: 'Sum of ISSUED/PARTIALLY_PAID invoice balances due, current state.',
    },
    medicationWastage: {
      events: 3,
      units: 24,
      value: '1860.00',
      label: 'Inventory write-offs in the window (WASTAGE ledger rows).',
    },
    stockTurnover: {
      onHandUnits: 1240,
      dispensedUnits: 320,
      avgDispensedPerDay: 45.71,
      turnover: 0.26,
      label: 'Estimate: units dispensed in window divided by current on-hand stock.',
    },
    providerUtilization: {
      completedAppointments: 21,
      scheduledNonCancelled: 25,
      percent: 84,
      label:
        'Booking fill estimate = completed appointments / scheduled-and-not-cancelled appointments in the window.',
    },
    bedOccupancy: {
      occupied: 6,
      total: 24,
      percent: 25,
      label: 'Point-in-time bed occupancy (active admissions in beds).',
    },
    claimAging: {
      buckets: { current: 5, d30: 2, d60: 1, d90: 0, plus: 0 },
      label: 'Open insurance claims by age from submission (days).',
    },
    emergencyIntake: {
      arrivals: 10,
      avgTimeToTriageMinutes: 6,
      untriagedNow: 1,
      perBranch: [{ branchId: 'br_example_0001', count: 10 }],
      perHour: [
        { hour: '08:00', count: 2 },
        { hour: '14:00', count: 4 },
        { hour: '20:00', count: 4 },
      ],
      label:
        'Emergency department walk-in intake from EmergencyVisit timestamps (arrivedAt → triagedAt).',
    },
    emergencyRequests: {
      received: 7,
      acknowledged: 6,
      dispatched: 5,
      closed: 4,
      cancelled: 1,
      escalated: 2,
      acknowledgementRate: 0.857,
      escalationRate: 0.286,
      timeToAcknowledge: { samples: 6, p50Minutes: 3, p90Minutes: 9, maxMinutes: 14 },
      timeToDispatch: { samples: 5, p50Minutes: 8, p90Minutes: 20, maxMinutes: 22 },
      ackToDispatch: { samples: 5, p50Minutes: 5, p90Minutes: 12, maxMinutes: 13 },
      byEscalationLevel: [{ level: 1, count: 2 }],
      byBranch: [{ branchId: 'br_example_0001', received: 7, escalated: 2 }],
      unacknowledgedNow: 1,
      awaitingDispatchNow: 1,
      unacknowledgedPastSlaNow: 0,
      openNow: 2,
      walkInArrivalsInWindow: 10,
      label:
        'Anonymous public emergency requests keyed on createdAt (when the caller asked for help).',
    },
    revenue: '45350.00',
  },
  label:
    'Time-series values are read from the daily rollup projection; point-in-time snapshots are read from current state. All values are measurements or labelled estimates.',
};

/**
 * F10 slice 3 journey bottleneck fixture. Mirrors `BottleneckService.analyze()`:
 * stages ranked by mean duration, with the service's fixed `order` and its
 * descriptive interpretation.
 */
export const ANALYTICS_BOTTLENECK = {
  interpretation:
    'Descriptive averages from recorded timestamps. LABORATORY/PHARMACY/BILLING use order-level timestamps where per-visit phase timestamps are not recorded. No causal or clinical claims.',
  order: [
    'REGISTRATION_TO_TRIAGE',
    'TRIAGE_TO_PROVIDER',
    'CONSULTATION',
    'LABORATORY',
    'PHARMACY',
    'BILLING',
  ],
  stages: [
    { key: 'LABORATORY', label: 'Laboratory (order → release)', avgMinutes: 96.5, medianMinutes: 88, samples: 34 },
    { key: 'REGISTRATION_TO_TRIAGE', label: 'Registration → triage', avgMinutes: 18.25, medianMinutes: 15, samples: 52 },
    { key: 'BILLING', label: 'Billing (invoice issued → first completed payment)', avgMinutes: 14.5, medianMinutes: 12, samples: 27 },
    { key: 'TRIAGE_TO_PROVIDER', label: 'Triage → provider', avgMinutes: 11.75, medianMinutes: 10, samples: 48 },
    { key: 'CONSULTATION', label: 'Provider consultation', avgMinutes: 9.5, medianMinutes: null, samples: 1 },
    { key: 'PHARMACY', label: 'Pharmacy (prescription issued → dispensed)', avgMinutes: 7.25, medianMinutes: 6, samples: 41 },
  ],
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-02T00:00:00.000Z' },
};

/**
 * F10 slice 3 capacity fixture. Mirrors `CapacityService.capacity()`: peak
 * hours/days, department load, provider booking fill, bed occupancy and the
 * embedded appointment-demand forecast (a labelled estimate with its notes).
 */
export const ANALYTICS_CAPACITY = {
  interpretation:
    'Historical analytics over recorded queue/appointment/admission data. Forecasts are labelled estimates from a statistical baseline.',
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-05-02T00:00:00.000Z' },
  peakHours: [
    { hour: '09:00', count: 64 },
    { hour: '08:00', count: 51 },
    { hour: '14:00', count: 43 },
    { hour: '10:00', count: 38 },
    { hour: '16:00', count: 22 },
  ],
  peakDays: [
    { day: 'Monday', count: 188 },
    { day: 'Tuesday', count: 162 },
    { day: 'Wednesday', count: 141 },
  ],
  departmentLoad: {
    total: 384,
    label: 'Queue tickets per department; departments with no recorded tickets are omitted.',
    items: [
      { departmentId: 'dept_example_opd', tickets: 176 },
      { departmentId: 'dept_example_lab', tickets: 121 },
      { departmentId: 'dept_example_pharmacy', tickets: 87 },
    ],
  },
  providerUtilization: {
    label: 'Booking fill estimate per provider = completed / scheduled-and-not-cancelled appointments.',
    items: [
      { providerId: 'usr_example_doc_a', completedAppointments: 84, scheduledNonCancelled: 92, percent: 91.3 },
      { providerId: 'usr_example_doc_b', completedAppointments: 61, scheduledNonCancelled: 80, percent: 76.25 },
      { providerId: 'usr_example_doc_c', completedAppointments: 40, scheduledNonCancelled: 62, percent: 64.52 },
      { providerId: 'usr_example_doc_d', completedAppointments: 12, scheduledNonCancelled: 0, percent: null },
    ],
  },
  bedOccupancy: {
    occupied: 14,
    total: 24,
    percent: 58.33,
    label: 'Point-in-time bed occupancy.',
    admissionsPerDay: [
      { date: '2026-04-29', admissions: 3 },
      { date: '2026-04-30', admissions: 2 },
      { date: '2026-05-01', admissions: 5 },
    ],
  },
  appointmentDemand: {
    label: 'Labelled estimate of daily appointment demand (weekly-seasonal-naive v1).',
    forecast: {
      kind: 'forecast',
      model: { name: 'weekly-seasonal-naive', version: '1' },
      period: { from: '2026-04-05', to: '2026-05-02' },
      horizon: 7,
      points: [
        { date: '2026-05-03', value: 9.14, lower: 3.82, upper: 14.46 },
        { date: '2026-05-04', value: 11.57, lower: 5.9, upper: 17.24 },
        { date: '2026-05-05', value: 10.29, lower: 4.44, upper: 16.13 },
        { date: '2026-05-06', value: 8.71, lower: 3.11, upper: 14.32 },
        { date: '2026-05-07', value: 9.86, lower: 4.03, upper: 15.69 },
        { date: '2026-05-08', value: 10.43, lower: 4.53, upper: 16.33 },
        { date: '2026-05-09', value: 7.29, lower: 1.61, upper: 12.97 },
      ],
      notes: [
        'Statistical baseline only; forecast/estimate, not a promise.',
        'Fit on 28 data points (2026-04-05..2026-05-02).',
        'Uncertainty band from model residuals over history.',
        'Based on daily appointment bookings.',
      ],
    },
  },
};
