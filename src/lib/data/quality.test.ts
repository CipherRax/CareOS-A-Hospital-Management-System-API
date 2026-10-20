import { describe, expect, it } from 'vitest';

import {
  COMPLAINT_ASSIGNABLE,
  COMPLAINT_NEXT,
  COMPLAINT_STATUSES,
  extractComplaintPage,
  extractFeedbackPage,
  extractIncidentPage,
  FEEDBACK_NEXT,
  FEEDBACK_STATUSES,
  INCIDENT_NEXT,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  QUALITY_BRANCH_ID,
  readComplaint,
  readComplaintRecord,
  readFeedback,
  readFeedbackRecord,
  readIncident,
  readIncidentRecord,
  type ComplaintRow,
  type FeedbackRow,
  type IncidentRow,
} from '@/lib/data/quality';

/**
 * Quality data layer (feedback, complaints, incidents).
 *
 * All three list reads are mis-typed in the export (the item response DTO, or the
 * request query DTO, fastened onto the 200 while the service answers
 * `pageOf(...)`), so every row is validated structurally. Each reader fails
 * closed on drift rather than rendering an empty worklist that a quality officer
 * would read as "nothing reported".
 */

const feedback: FeedbackRow = {
  id: 'fb_example_6101',
  branchId: 'br_example_0001',
  patientId: 'pat_example_0001',
  submittedById: null,
  category: 'WAITING_TIME',
  rating: 2,
  comment: 'EXAMPLE waited over an hour to be triaged.',
  status: 'NEW',
  response: null,
  handledById: null,
  handledAt: null,
  createdAt: '2026-10-02T09:15:00.000Z',
  updatedAt: '2026-10-02T09:15:00.000Z',
};

const complaint: ComplaintRow = {
  id: 'cmp_example_6201',
  branchId: null,
  origin: 'PATIENT',
  patientId: 'pat_example_0001',
  submittedById: null,
  category: 'Billing dispute',
  description: 'EXAMPLE claims a duplicate charge on invoice INV-2026-000004.',
  status: 'OPEN',
  assignedToId: null,
  dueAt: '2026-10-09T00:00:00.000Z',
  resolution: null,
  closedById: null,
  closedAt: null,
  createdAt: '2026-10-02T10:00:00.000Z',
  updatedAt: '2026-10-02T10:00:00.000Z',
};

const incident: IncidentRow = {
  id: 'inc_example_6301',
  branchId: 'br_example_0001',
  category: 'STOCK_DISCREPANCY',
  severity: 'HIGH',
  description: 'EXAMPLE count found 12 fewer amoxicillin units than the ledger.',
  reportedById: 'usr-example-1',
  status: 'OPEN',
  actionsTaken: null,
  resolution: null,
  resolvedById: null,
  resolvedAt: null,
  closedById: null,
  closedAt: null,
  createdAt: '2026-10-02T11:30:00.000Z',
  updatedAt: '2026-10-02T11:30:00.000Z',
};

describe('readFeedback', () => {
  it('reads a full projection, keeping the rating and the response fields', () => {
    expect(readFeedback(feedback)).toEqual(feedback);
    const handled = {
      ...feedback,
      status: 'RESOLVED' as const,
      response: 'EXAMPLE apology issued and queue staffing reviewed.',
      handledById: 'usr-example-2',
      handledAt: '2026-10-03T08:00:00.000Z',
    };
    expect(readFeedback(handled)).toEqual(handled);
  });

  it('fails closed on an unknown category, status or a non-numeric rating', () => {
    expect(readFeedback({ ...feedback, category: 'CATERING' })).toBeNull();
    expect(readFeedback({ ...feedback, status: 'PENDING' })).toBeNull();
    expect(readFeedback({ ...feedback, rating: '2' })).toBeNull();
    expect(readFeedback({ ...feedback, rating: null })).toBeNull();
    expect(readFeedback('fb_example_6101')).toBeNull();
  });

  it('defines exactly the four feedback states the schema declares', () => {
    expect([...FEEDBACK_STATUSES]).toEqual(['NEW', 'ACKNOWLEDGED', 'RESOLVED', 'CLOSED']);
  });
});

describe('readComplaint', () => {
  it('reads a full projection, keeping the assignment, due date and resolution', () => {
    expect(readComplaint(complaint)).toEqual(complaint);
    const closed = {
      ...complaint,
      status: 'CLOSED' as const,
      assignedToId: 'usr-example-2',
      resolution: 'EXAMPLE duplicate charge reversed.',
      closedById: 'usr-example-2',
      closedAt: '2026-10-08T12:00:00.000Z',
    };
    expect(readComplaint(closed)).toEqual(closed);
  });

  it('fails closed on an unknown origin or status, or a blank category', () => {
    expect(readComplaint({ ...complaint, origin: 'VENDOR' })).toBeNull();
    expect(readComplaint({ ...complaint, status: 'ESCALATED' })).toBeNull();
    expect(readComplaint({ ...complaint, category: '' })).toBeNull();
    expect(readComplaint({ ...complaint, description: undefined })).toBeNull();
    expect(readComplaint(null)).toBeNull();
  });

  it('defines exactly the five complaint states the schema declares', () => {
    expect([...COMPLAINT_STATUSES]).toEqual([
      'OPEN',
      'ASSIGNED',
      'INVESTIGATING',
      'RESOLVED',
      'CLOSED',
    ]);
  });
});

describe('readIncident', () => {
  it('reads a full projection, keeping severity and the resolver/closer stamps', () => {
    expect(readIncident(incident)).toEqual(incident);
    const resolved = {
      ...incident,
      status: 'RESOLVED' as const,
      actionsTaken: 'EXAMPLE recount scheduled and dispensing double-checked.',
      resolution: 'EXAMPLE ledger corrected after a recount.',
      resolvedById: 'usr-example-2',
      resolvedAt: '2026-10-05T09:00:00.000Z',
    };
    expect(readIncident(resolved)).toEqual(resolved);
  });

  it('fails closed on an unknown category, severity or status, or a missing id', () => {
    expect(readIncident({ ...incident, category: 'WEATHER' })).toBeNull();
    expect(readIncident({ ...incident, severity: 'SEVERE' })).toBeNull();
    expect(readIncident({ ...incident, status: 'TRIAGED' })).toBeNull();
    expect(readIncident({ ...incident, branchId: '' })).toBeNull();
    expect(readIncident({ ...incident, reportedById: '' })).toBeNull();
    expect(readIncident([])).toBeNull();
  });

  it('defines exactly the four severities and five states the schema declares', () => {
    expect([...INCIDENT_SEVERITIES]).toEqual(['LOW', 'MEDIUM', 'HIGH', 'CRITICAL']);
    expect([...INCIDENT_STATUSES]).toEqual([
      'OPEN',
      'INVESTIGATING',
      'ACTION_PLAN',
      'RESOLVED',
      'CLOSED',
    ]);
  });
});

describe('readFeedbackRecord', () => {
  it('unwraps the { feedback } envelope the single read and the write answer', () => {
    expect(readFeedbackRecord({ feedback })).toEqual({ ok: true, feedback });
  });

  it('fails closed on the bare entity, on drift, and on a non-object body', () => {
    expect(readFeedbackRecord(feedback).ok).toBe(false);
    expect(readFeedbackRecord({ feedback: { ...feedback, status: 'PENDING' } }).ok).toBe(false);
    expect(readFeedbackRecord(null).ok).toBe(false);
  });
});

describe('FEEDBACK_NEXT', () => {
  it('is the single forward move the server allows from each state', () => {
    expect(FEEDBACK_NEXT).toEqual({
      NEW: 'ACKNOWLEDGED',
      ACKNOWLEDGED: 'RESOLVED',
      RESOLVED: 'CLOSED',
      CLOSED: null,
    });
  });
});

describe('readComplaintRecord', () => {
  it('unwraps the { complaint } envelope every single read and write answer', () => {
    expect(readComplaintRecord({ complaint })).toEqual({ ok: true, complaint });
  });

  it('fails closed on the bare entity, on drift, and on a non-object body', () => {
    expect(readComplaintRecord(complaint).ok).toBe(false);
    expect(readComplaintRecord({ complaint: { ...complaint, status: 'PENDING' } }).ok).toBe(false);
    expect(readComplaintRecord(null).ok).toBe(false);
  });
});

describe('COMPLAINT_NEXT', () => {
  it('is the single forward move the server allows from each state', () => {
    expect(COMPLAINT_NEXT).toEqual({
      OPEN: 'ASSIGNED',
      ASSIGNED: 'INVESTIGATING',
      INVESTIGATING: 'RESOLVED',
      RESOLVED: 'CLOSED',
      CLOSED: null,
    });
  });
});

describe('COMPLAINT_ASSIGNABLE', () => {
  it('is exactly the states a complaint may be (re)assigned while in', () => {
    expect([...COMPLAINT_ASSIGNABLE]).toEqual(['ASSIGNED', 'INVESTIGATING']);
  });
});

describe('readIncidentRecord', () => {
  it('unwraps the { incident } envelope every single read and write answer', () => {
    expect(readIncidentRecord({ incident })).toEqual({ ok: true, incident });
  });

  it('fails closed on the bare entity, on drift, and on a non-object body', () => {
    expect(readIncidentRecord(incident).ok).toBe(false);
    expect(readIncidentRecord({ incident: { ...incident, status: 'PENDING' } }).ok).toBe(false);
    expect(readIncidentRecord(null).ok).toBe(false);
  });
});

describe('INCIDENT_NEXT', () => {
  it('is the single forward move the server allows from each state', () => {
    expect(INCIDENT_NEXT).toEqual({
      OPEN: 'INVESTIGATING',
      INVESTIGATING: 'ACTION_PLAN',
      ACTION_PLAN: 'RESOLVED',
      RESOLVED: 'CLOSED',
      CLOSED: null,
    });
  });
});

describe('QUALITY_BRANCH_ID', () => {
  it('is the single example branch a report is raised against (GAP-018)', () => {
    expect(QUALITY_BRANCH_ID).toBe('br_example_0001');
  });
});

describe('extract*Page', () => {
  it('reads rows out of the unwrapped data and the total out of meta', () => {
    expect(extractFeedbackPage([feedback], { total: 37 })).toEqual({
      ok: true,
      page: { rows: [feedback], total: 37 },
    });
    expect(extractComplaintPage([complaint], { total: 4 })).toEqual({
      ok: true,
      page: { rows: [complaint], total: 4 },
    });
    expect(extractIncidentPage([incident], { total: 9 })).toEqual({
      ok: true,
      page: { rows: [incident], total: 9 },
    });
  });

  it('accepts an empty page and falls back to the row count without meta', () => {
    expect(extractComplaintPage([], undefined)).toEqual({
      ok: true,
      page: { rows: [], total: 0 },
    });
    expect(extractIncidentPage([incident], undefined)).toEqual({
      ok: true,
      page: { rows: [incident], total: 1 },
    });
  });

  it('fails closed when the body is not the page the service returns', () => {
    expect(extractFeedbackPage({ feedback: [feedback] }, {}).ok).toBe(false);
    expect(extractComplaintPage(null, {}).ok).toBe(false);
    expect(extractIncidentPage([incident, { id: 'inc_broken' }], {}).ok).toBe(false);
  });
});
