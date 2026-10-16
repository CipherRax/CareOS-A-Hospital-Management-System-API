import { describe, expect, it } from 'vitest';

import {
  readAnalyticsBottleneck,
  readAnalyticsCapacity,
  readAnalyticsMetrics,
} from '@/lib/data/analytics';

/**
 * F10 analytics data layer.
 *
 * `GET /analytics/metrics` is typed `unknown`, so it is validated structurally.
 * The series and summary are critical and fail closed; the labelled snapshots
 * stay loose so a new API block appears rather than blanking the dashboard.
 */

const payload = {
  scope: { branchId: null, departmentId: null },
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
  granularity: 'day',
  series: [
    {
      date: '2026-02-01',
      patientVolume: 12,
      appointmentVolume: 8,
      noShowRate: 0.125,
      cancellationRate: null,
      rescheduleRate: null,
      avgWaitingMinutes: 14,
      avgConsultationMinutes: 22,
      revenue: '15400.00',
      invoicesIssued: 9,
      invoicesTotal: '16000.00',
      refundsTotal: '0.00',
      labTatAvgMinutes: null,
      admissions: 2,
      discharges: 1,
      emergencyArrivals: 3,
      feedbackSubmitted: 4,
    },
  ],
  summary: {
    patientVolume: 12,
    revenue: '15400.00',
    noShowRate: 0.125,
    prescriptionsDispensed: 20,
    nested: { would: 'drift' },
  },
  snapshots: {
    bedOccupancy: { occupied: 3, total: 10, percent: 30, label: 'Point-in-time bed occupancy.' },
  },
  label: 'All values are measurements or labelled estimates.',
};

describe('readAnalyticsMetrics', () => {
  it('reads the series, summary and snapshots', () => {
    const metrics = readAnalyticsMetrics(payload);
    expect(metrics).not.toBeNull();
    expect(metrics?.series[0]?.revenue).toBe('15400.00');
    expect(metrics?.summary.prescriptionsDispensed).toBe(20);
    expect(metrics?.snapshots.bedOccupancy).toBeDefined();
  });

  it('drops a non-scalar summary member rather than failing the page', () => {
    const metrics = readAnalyticsMetrics(payload);
    expect(metrics?.summary).not.toHaveProperty('nested');
  });

  it('defaults missing counts to 0 and missing rates to null', () => {
    const metrics = readAnalyticsMetrics({
      ...payload,
      series: [{ date: '2026-02-01' }],
    });
    expect(metrics?.series[0]?.patientVolume).toBe(0);
    expect(metrics?.series[0]?.noShowRate).toBeNull();
    expect(metrics?.series[0]?.revenue).toBe('0.00');
  });

  it('fails closed when the period, summary or series drift', () => {
    expect(readAnalyticsMetrics(null)).toBeNull();
    expect(readAnalyticsMetrics({ ...payload, period: undefined })).toBeNull();
    expect(readAnalyticsMetrics({ ...payload, summary: undefined })).toBeNull();
    expect(readAnalyticsMetrics({ ...payload, series: 'nope' })).toBeNull();
    expect(readAnalyticsMetrics({ ...payload, series: [{ notDate: true }] })).toBeNull();
  });
});

const bottleneckPayload = {
  interpretation: 'Reception to triage is the slowest stage in this window.',
  order: ['triage', 'consultation', 'checkout'],
  stages: [
    { key: 'triage', label: 'Reception to triage', avgMinutes: 34.5, medianMinutes: 31, samples: 40 },
    { key: 'consultation', label: 'Triage to consultation', avgMinutes: 12, medianMinutes: null, samples: 1 },
  ],
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
};

describe('readAnalyticsBottleneck', () => {
  it('reads the interpretation, order, stages and period', () => {
    const bottleneck = readAnalyticsBottleneck(bottleneckPayload);
    expect(bottleneck?.stages[0]?.avgMinutes).toBe(34.5);
    expect(bottleneck?.stages[1]?.medianMinutes).toBeNull();
    expect(bottleneck?.order).toEqual(['triage', 'consultation', 'checkout']);
  });

  it('defaults a missing interpretation and filters non-string order keys', () => {
    const bottleneck = readAnalyticsBottleneck({
      ...bottleneckPayload,
      interpretation: undefined,
      order: ['triage', 7, 'checkout'],
    });
    expect(bottleneck?.interpretation).toBe('');
    expect(bottleneck?.order).toEqual(['triage', 'checkout']);
  });

  it('fails closed when the period or a stage drifts', () => {
    expect(readAnalyticsBottleneck(null)).toBeNull();
    expect(readAnalyticsBottleneck({ ...bottleneckPayload, period: undefined })).toBeNull();
    expect(readAnalyticsBottleneck({ ...bottleneckPayload, stages: 'nope' })).toBeNull();
    expect(
      readAnalyticsBottleneck({ ...bottleneckPayload, stages: [{ label: 'no key' }] }),
    ).toBeNull();
  });
});

const capacityPayload = {
  interpretation: 'Peak arrivals cluster on weekday mornings.',
  period: { from: '2026-02-01T00:00:00.000Z', to: '2026-03-01T00:00:00.000Z' },
  peakHours: [{ hour: '09', count: 24 }],
  peakDays: [{ day: 'Monday', count: 88 }],
  departmentLoad: {
    total: 40,
    label: 'Open tickets per department.',
    items: [{ departmentId: 'dept_example_1', tickets: 12 }],
  },
  providerUtilization: {
    label: 'Completed over scheduled (non-cancelled).',
    items: [
      { providerId: 'usr_example_doc', completedAppointments: 18, scheduledNonCancelled: 20, percent: 90 },
    ],
  },
  bedOccupancy: {
    occupied: 6,
    total: 10,
    percent: 60,
    label: 'Beds occupied at end of each day.',
    admissionsPerDay: [{ date: '2026-02-01', admissions: 2 }],
  },
  appointmentDemand: {
    label: 'Appointment demand, weekly seasonal baseline.',
    forecast: {
      kind: 'forecast',
      model: { name: 'weekly-seasonal-naive', version: '1' },
      period: { from: '2026-02-01', to: '2026-02-28' },
      horizon: 7,
      points: [{ date: '2026-03-01', value: 12.5, lower: 9, upper: 16 }],
      notes: ['Statistical baseline only; forecast/estimate, not a promise.'],
    },
  },
};

describe('readAnalyticsCapacity', () => {
  it('reads every block and the labelled forecast', () => {
    const capacity = readAnalyticsCapacity(capacityPayload);
    expect(capacity?.peakHours[0]).toEqual({ label: '09', count: 24 });
    expect(capacity?.peakDays[0]?.label).toBe('Monday');
    expect(capacity?.providerUtilization.items[0]?.percent).toBe(90);
    expect(capacity?.appointmentDemand.forecast?.model.name).toBe('weekly-seasonal-naive');
    expect(capacity?.appointmentDemand.forecast?.points[0]).toEqual({
      date: '2026-03-01',
      value: 12.5,
      lower: 9,
      upper: 16,
    });
  });

  it('keeps the page readable when only the embedded forecast drifts', () => {
    const capacity = readAnalyticsCapacity({
      ...capacityPayload,
      appointmentDemand: { label: 'Appointment demand', forecast: { model: 'nope' } },
    });
    expect(capacity).not.toBeNull();
    expect(capacity?.appointmentDemand.forecast).toBeNull();
  });

  it('drops forecast points missing a date rather than inventing one', () => {
    const capacity = readAnalyticsCapacity({
      ...capacityPayload,
      appointmentDemand: {
        label: '',
        forecast: { ...capacityPayload.appointmentDemand.forecast, points: [{ value: 3 }] },
      },
    });
    expect(capacity?.appointmentDemand.forecast).toBeNull();
  });

  it('fails closed when a critical block drifts', () => {
    expect(readAnalyticsCapacity(null)).toBeNull();
    expect(readAnalyticsCapacity({ ...capacityPayload, period: undefined })).toBeNull();
    expect(readAnalyticsCapacity({ ...capacityPayload, peakHours: 'nope' })).toBeNull();
    expect(readAnalyticsCapacity({ ...capacityPayload, departmentLoad: undefined })).toBeNull();
    expect(
      readAnalyticsCapacity({
        ...capacityPayload,
        providerUtilization: { label: '', items: [{ noProvider: true }] },
      }),
    ).toBeNull();
  });
});
