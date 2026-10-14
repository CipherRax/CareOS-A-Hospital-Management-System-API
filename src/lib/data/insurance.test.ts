import { describe, expect, it } from 'vitest';

import {
  extractClaimPage,
  extractClaimRecord,
  extractPayerPage,
  extractPayerRecord,
  extractPolicyPage,
  extractPolicyRecord,
  readClaim,
} from '@/lib/data/insurance';

/**
 * F7 insurance data layer.
 *
 * `GET /insurance/payers` types the 200 as the bare entity and the policies and
 * claims lists as their request DTOs, while the service answers a `PageResult`
 * for all three (GAP-020 family); the single claim read is typed as the bare
 * entity but answers `{ claim }`. Claim money is a decimal string (ADR-029) and
 * is only type-checked here — never parsed.
 */

const payer = {
  id: 'payer_example_1',
  organizationId: 'org_example_1',
  name: 'EXAMPLE Jubilee Health',
  contactPhone: '+254700000010',
  email: 'claims@example.org',
  isActive: true,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-01T08:00:00.000Z',
};

const policy = {
  id: 'pol_example_1',
  organizationId: 'org_example_1',
  patientId: 'pat_example_1001',
  payerId: 'payer_example_1',
  policyNumber: 'POL-2026-000001',
  coverageType: 'PARTIAL',
  coveragePercent: 80,
  validityStart: '2026-01-01T00:00:00.000Z',
  validityEnd: '2026-12-31T00:00:00.000Z',
  isActive: true,
  version: 1,
};

const claim = {
  id: 'claim_example_1',
  organizationId: 'org_example_1',
  claimNumber: 'CLM-2026-000001',
  invoiceId: 'inv_example_8001',
  policyId: 'pol_example_1',
  patientId: 'pat_example_1001',
  amount: '1500.00',
  status: 'SUBMITTED',
  notes: 'EXAMPLE claim.',
  submittedAt: '2026-10-02T09:00:00.000Z',
  approvedAt: null,
  approvedAmount: null,
  deniedAt: null,
  denyReason: null,
  paidAt: null,
  version: 2,
  createdAt: '2026-10-01T08:00:00.000Z',
  updatedAt: '2026-10-02T09:00:00.000Z',
};

describe('extractPayerPage', () => {
  it('reads rows and total, and accepts an empty list', () => {
    const parsed = extractPayerPage([payer], { total: 1 });
    expect(parsed.ok && parsed.page.rows[0]?.name).toBe('EXAMPLE Jubilee Health');
    expect(extractPayerPage([], undefined).ok).toBe(true);
  });

  it('fails closed on a broken body', () => {
    expect(extractPayerPage([{ id: 'x' }], undefined)).toEqual({ ok: false });
    expect(extractPayerPage(null, undefined)).toEqual({ ok: false });
  });
});

describe('extractPolicyPage', () => {
  it('reads a policy row, keeping coverage a number', () => {
    const parsed = extractPolicyPage([policy], { total: 1 });
    expect(parsed.ok && parsed.page.rows[0]?.coverageType).toBe('PARTIAL');
    expect(parsed.ok && parsed.page.rows[0]?.coveragePercent).toBe(80);
  });

  it('fails closed on a drifted coverage type or a broken body', () => {
    expect(extractPolicyPage([{ ...policy, coverageType: 'SOME' }], undefined)).toEqual({
      ok: false,
    });
    expect(extractPolicyPage({ items: [] }, undefined)).toEqual({ ok: false });
  });
});

describe('readClaim', () => {
  it('reads the amount and approvedAmount as decimal strings', () => {
    const parsed = readClaim({ ...claim, status: 'APPROVED', approvedAmount: '1500.00' });
    expect(parsed?.amount).toBe('1500.00');
    expect(parsed?.approvedAmount).toBe('1500.00');
    expect(parsed?.status).toBe('APPROVED');
  });

  it('keeps a null approvedAmount null', () => {
    expect(readClaim(claim)?.approvedAmount).toBeNull();
  });

  it('fails closed on a drifted status or a non-string amount', () => {
    expect(readClaim({ ...claim, status: 'SETTLED' })).toBeNull();
    expect(readClaim({ ...claim, amount: 1500 })).toBeNull();
    expect(readClaim({ ...claim, id: undefined })).toBeNull();
    expect(readClaim(null)).toBeNull();
  });
});

describe('extractClaimPage', () => {
  it('reads rows and total from the sibling meta', () => {
    const parsed = extractClaimPage([claim], { total: 1, page: 1, limit: 20 });
    expect(parsed.ok && parsed.page.rows[0]?.claimNumber).toBe('CLM-2026-000001');
    expect(parsed.ok && parsed.page.total).toBe(1);
  });

  it('fails closed on a broken body', () => {
    expect(extractClaimPage([{}], undefined)).toEqual({ ok: false });
    expect(extractClaimPage(null, undefined)).toEqual({ ok: false });
  });
});

describe('extractClaimRecord', () => {
  it('unwraps the { claim } body', () => {
    const parsed = extractClaimRecord({ claim });
    expect(parsed.ok && parsed.claim.id).toBe('claim_example_1');
  });

  it('fails closed on a bare claim or a broken body', () => {
    expect(extractClaimRecord(claim)).toEqual({ ok: false });
    expect(extractClaimRecord({ claim: {} })).toEqual({ ok: false });
    expect(extractClaimRecord(null)).toEqual({ ok: false });
  });
});

describe('extractPayerRecord', () => {
  it('unwraps the { payer } body', () => {
    const parsed = extractPayerRecord({ payer });
    expect(parsed.ok && parsed.payer.name).toBe('EXAMPLE Jubilee Health');
  });

  it('fails closed on a bare payer or a broken body', () => {
    expect(extractPayerRecord(payer)).toEqual({ ok: false });
    expect(extractPayerRecord({ payer: { id: 'x' } })).toEqual({ ok: false });
    expect(extractPayerRecord(null)).toEqual({ ok: false });
  });
});

describe('extractPolicyRecord', () => {
  it('unwraps the { policy } body, keeping coverage a number', () => {
    const parsed = extractPolicyRecord({ policy });
    expect(parsed.ok && parsed.policy.coveragePercent).toBe(80);
  });

  it('fails closed on a drifted coverage type or a broken body', () => {
    expect(extractPolicyRecord({ policy: { ...policy, coverageType: 'SOME' } })).toEqual({
      ok: false,
    });
    expect(extractPolicyRecord(policy)).toEqual({ ok: false });
    expect(extractPolicyRecord(null)).toEqual({ ok: false });
  });
});
