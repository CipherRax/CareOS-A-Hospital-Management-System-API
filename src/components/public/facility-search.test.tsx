import { describe, expect, it } from 'vitest';

import { extractItems, FACILITY_TYPES } from '@/components/public/facility-search';

describe('extractItems (facilities envelope)', () => {
  const row = { id: 'fac-1', name: 'EXAMPLE Hospital', type: 'GENERAL', status: 'ACTIVE' };

  it('reads the documented `{ data: { items } }` envelope', () => {
    const result = extractItems({ success: true, data: { items: [row], total: 1 } });
    expect(result).toEqual({ ok: true, items: [row] });
  });

  it('treats a 2xx carrying an error body as not-a-directory', () => {
    const result = extractItems({ success: false, error: { code: 'X' } });
    expect(result).toEqual({ ok: false });
  });

  it('fails into unavailable when the documented shapes drift', () => {
    // The contract is provisional; a body that changed shape must never read as a
    // directory full of nothing.
    expect(extractItems([])).toEqual({ ok: false });
    expect(extractItems({ success: true, data: [] })).toEqual({ ok: false });
    expect(extractItems({ success: true, data: { items: 'nope' } })).toEqual({ ok: false });
    expect(extractItems(null)).toEqual({ ok: false });
  });

  it('rejects an envelope whose rows are not usable facilities', () => {
    const result = extractItems({ success: true, data: { items: [{ name: 'no id' }] } });
    expect(result).toEqual({ ok: false });
  });

  it('allows a genuinely empty directory as a result, not an error', () => {
    const result = extractItems({ success: true, data: { items: [], total: 0 } });
    expect(result).toEqual({ ok: true, items: [] });
  });
});

describe('FACILITY_TYPES', () => {
  it('matches the contract enum exactly', () => {
    expect(FACILITY_TYPES).toEqual(['GENERAL', 'REFERRAL', 'SPECIALIST', 'CLINIC', 'PRIMARY_CARE']);
  });
});
