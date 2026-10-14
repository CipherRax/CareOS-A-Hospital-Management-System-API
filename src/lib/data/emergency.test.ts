import { describe, expect, it } from 'vitest';

import {
  extractEmergencySummary,
  extractEmergencyVisitPage,
  extractEmergencyVisitRecord,
  isEmergencyTerminal,
  readEmergencyVisit,
} from '@/lib/data/emergency';

/**
 * F8 emergency data layer.
 *
 * `GET /emergency/visits` types the 200 as the request DTO and
 * `GET /emergency/visits/{id}` types the bare entity while the service answers
 * `{ visit }` (GAP-020 family). The list is a page of visits, the single read and
 * every write unwrap a `{ visit }`, and the summary is a metrics body — all
 * validated structurally so a drifted body fails closed rather than rendering an
 * ED row with the wrong status or priority.
 */

const visit = {
  id: 'erv_example_7001',
  organizationId: 'org_example_1',
  visitNumber: 'ER-2026-000001',
  branchId: 'br_example_0001',
  patientId: 'pat_example_1001',
  status: 'TRIAGED',
  priority: 'URGENT',
  registeredById: 'usr_example_0001',
  arrivedById: 'usr_example_0001',
  arrivedAt: '2026-10-10T06:05:00.000Z',
  chiefComplaint: 'EXAMPLE severe abdominal pain.',
  triagedById: 'usr_example_0001',
  triagedAt: '2026-10-10T06:12:00.000Z',
  assessedAt: null,
  assessment: null,
  treatmentStartedAt: null,
  treatment: null,
  observedAt: null,
  dispositionAt: null,
  disposition: null,
  admittedAdmissionId: null,
  referredTo: null,
  referralNotes: null,
  version: 2,
  createdAt: '2026-10-10T06:05:00.000Z',
  updatedAt: '2026-10-10T06:12:00.000Z',
};

describe('readEmergencyVisit', () => {
  it('parses a serialized visit', () => {
    const row = readEmergencyVisit(visit);
    expect(row?.id).toBe('erv_example_7001');
    expect(row?.status).toBe('TRIAGED');
    expect(row?.priority).toBe('URGENT');
    expect(row?.chiefComplaint).toBe('EXAMPLE severe abdominal pain.');
  });

  it('keeps an untriaged visit and its null priority', () => {
    const row = readEmergencyVisit({ ...visit, status: 'ARRIVED', priority: null, triagedAt: null });
    expect(row?.status).toBe('ARRIVED');
    expect(row?.priority).toBeNull();
    expect(row?.triagedAt).toBeNull();
  });

  it('rejects an unknown status', () => {
    expect(readEmergencyVisit({ ...visit, status: 'WAITING' })).toBeNull();
  });

  it('rejects an unknown priority', () => {
    expect(readEmergencyVisit({ ...visit, priority: 'VERY_URGENT' })).toBeNull();
  });

  it('rejects an unknown disposition', () => {
    expect(readEmergencyVisit({ ...visit, disposition: 'SENT_HOME' })).toBeNull();
  });

  it('rejects a non-record', () => {
    expect(readEmergencyVisit('erv_example_7001')).toBeNull();
    expect(readEmergencyVisit(null)).toBeNull();
  });
});

describe('extractEmergencyVisitPage', () => {
  it('reads rows with the page total', () => {
    const result = extractEmergencyVisitPage([visit], { total: 9 });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.page.rows).toHaveLength(1);
      expect(result.page.total).toBe(9);
    }
  });

  it('falls back to the row count without a total', () => {
    const result = extractEmergencyVisitPage([visit], {});
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.page.total).toBe(1);
  });

  it('fails closed when a row drifts', () => {
    const result = extractEmergencyVisitPage([visit, { ...visit, status: 'WAITING' }], { total: 2 });
    expect(result.ok).toBe(false);
  });

  it('fails closed when data is not an array', () => {
    expect(extractEmergencyVisitPage({ rows: [visit] }, {}).ok).toBe(false);
  });
});

describe('extractEmergencyVisitRecord', () => {
  it('unwraps a { visit } body', () => {
    const result = extractEmergencyVisitRecord({ visit });
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.visit.visitNumber).toBe('ER-2026-000001');
  });

  it('fails closed when the visit is missing or drifted', () => {
    expect(extractEmergencyVisitRecord({}).ok).toBe(false);
    expect(extractEmergencyVisitRecord({ visit: { ...visit, id: 7 } }).ok).toBe(false);
  });
});

describe('extractEmergencySummary', () => {
  it('reads the metrics body', () => {
    const summary = extractEmergencySummary({
      period: 'TODAY',
      arrivals: 12,
      active: 5,
      avgMinutesToTriage: 8.5,
      avgMinutesToDisposition: 121,
      byPriority: { URGENT: 4, EMERGENT: 2 },
      byDisposition: { DISCHARGED: 6 },
    });
    expect(summary?.arrivals).toBe(12);
    expect(summary?.active).toBe(5);
    expect(summary?.byPriority.URGENT).toBe(4);
    expect(summary?.byDisposition.DISCHARGED).toBe(6);
  });

  it('coerces missing optional metrics to zero', () => {
    const summary = extractEmergencySummary({ arrivals: 3, active: 1 });
    expect(summary?.avgMinutesToTriage).toBe(0);
    expect(summary?.byPriority).toEqual({});
  });

  it('fails closed without the required counts', () => {
    expect(extractEmergencySummary({ active: 1 })).toBeNull();
    expect(extractEmergencySummary(null)).toBeNull();
  });
});

describe('isEmergencyTerminal', () => {
  it('is true only for the disposition statuses', () => {
    expect(isEmergencyTerminal('DISCHARGED')).toBe(true);
    expect(isEmergencyTerminal('ADMITTED')).toBe(true);
    expect(isEmergencyTerminal('REFERRED')).toBe(true);
    expect(isEmergencyTerminal('ARRIVED')).toBe(false);
    expect(isEmergencyTerminal('IN_TREATMENT')).toBe(false);
    expect(isEmergencyTerminal('OBSERVATION')).toBe(false);
  });
});
