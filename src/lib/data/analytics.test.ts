import { describe, expect, it } from 'vitest';

import { readAnalyticsMetrics } from '@/lib/data/analytics';

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
