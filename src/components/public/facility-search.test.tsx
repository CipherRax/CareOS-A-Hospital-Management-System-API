import { describe, expect, it } from 'vitest';

import { FACILITY_FACETS, extractListingItems, filterByFacets } from '@/lib/data/facilities';

describe('extractListingItems (facilities envelope)', () => {
  const row = { id: 'fac-1', slug: 'example-general', name: 'EXAMPLE Hospital' };

  it('reads the live `{ success, data: […] }` flat envelope', () => {
    const result = extractListingItems({ success: true, data: [row] });
    expect(result).toEqual({ ok: true, items: [row] });
  });

  it('treats a 2xx carrying an error body as not-a-directory', () => {
    const result = extractListingItems({ success: false, error: { code: 'X' } });
    expect(result).toEqual({ ok: false });
  });

  it('fails into unavailable when the documented shapes drift', () => {
    // The export types this response as `unknown`, so the structure is pinned
    // here rather than by the compiler. A body that changed shape must never read
    // as a directory full of nothing.
    expect(extractListingItems([])).toEqual({ ok: false });
    expect(extractListingItems({ success: true, data: { items: [row] } })).toEqual({
      ok: false,
    });
    expect(extractListingItems({ success: true, data: 'nope' })).toEqual({ ok: false });
    expect(extractListingItems(null)).toEqual({ ok: false });
  });

  it('rejects an envelope whose rows are not usable listings', () => {
    const result = extractListingItems({ success: true, data: [{ id: 'no-slug-name' }] });
    expect(result).toEqual({ ok: false });
  });

  it('allows an empty directory as a genuine zero-result search', () => {
    // Unlike the partial document's `{ items, total }` rule, an empty array is a
    // real answer here — the search found nothing, and the empty state must show.
    const result = extractListingItems({ success: true, data: [] });
    expect(result).toEqual({ ok: true, items: [] });
  });
});

describe('FACILITY_FACETS', () => {
  it('mirrors the live contract fields, not the partial doc type enum', () => {
    expect(FACILITY_FACETS).toEqual(['open24h', 'emergency24h', 'ambulanceAvailable']);
  });
});

describe('filterByFacets', () => {
  const all = [
    { id: '1', slug: 'a', name: 'A', open24h: true, ambulanceAvailable: true },
    { id: '2', slug: 'b', name: 'B', open24h: false, ambulanceAvailable: true },
    { id: '3', slug: 'c', name: 'C', ambulanceAvailable: false },
  ];

  it('passes everything through when no facet is active', () => {
    expect(filterByFacets(all, [])).toHaveLength(3);
  });

  it('keeps only rows satisfying every active facet', () => {
    expect(filterByFacets(all, ['ambulanceAvailable'])).toHaveLength(2);
    expect(filterByFacets(all, ['open24h', 'ambulanceAvailable'])).toHaveLength(1);
  });

  it('treats an absent or false field as not matching', () => {
    expect(filterByFacets(all, ['open24h'])).toHaveLength(1);
  });
});