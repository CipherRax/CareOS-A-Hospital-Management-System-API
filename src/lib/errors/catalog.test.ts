import { describe, expect, it } from 'vitest';

import {
  API_ERROR_CODES,
  ERROR_CATALOGUE,
  UNMAPPED_ERROR_CODES,
  isApiErrorCode,
  resolveApiError,
} from './catalog';

/**
 * The catalogue is the only thing standing between a raw API payload and a
 * clinician-facing message, so its invariants are worth asserting rather than
 * trusting.
 */
describe('error catalogue', () => {
  it('gives every code a unique title and message key', () => {
    const titleKeys = Object.values(ERROR_CATALOGUE).map((e) => e.titleKey);
    expect(new Set(titleKeys).size).toBe(titleKeys.length);
  });

  it('never marks a client error as retryable', () => {
    // Showing "Try again" on a 400 teaches staff to retry work that cannot
    // succeed and delays escalation.
    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      if (entry.status >= 400 && entry.status < 500 && entry.status !== 429) {
        expect(`${code}=${entry.retryable}`).toBe(`${code}=false`);
      }
    }
  });

  it('marks transient server and transport failures retryable', () => {
    for (const code of [
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
      'NETWORK_ERROR',
      'TIMEOUT',
    ] as const) {
      expect(ERROR_CATALOGUE[code].retryable).toBe(true);
    }
  });

  it('uses status 0 only for transport failures that never reached the API', () => {
    const zeroStatus = Object.entries(ERROR_CATALOGUE)
      .filter(([, entry]) => entry.status === 0)
      .map(([code]) => code);

    expect(zeroStatus.sort()).toEqual(['NETWORK_ERROR', 'TIMEOUT']);

    for (const [code, entry] of Object.entries(ERROR_CATALOGUE)) {
      if (entry.status !== 0) {
        expect(entry.status, `${code} should carry a real HTTP status`).toBeGreaterThan(0);
      }
    }
  });

  it('routes every message through an i18n key rather than a literal string', () => {
    for (const entry of Object.values(ERROR_CATALOGUE)) {
      expect(entry.titleKey.startsWith('error.')).toBe(true);
      expect(entry.messageKey.startsWith('error.')).toBe(true);
    }
  });

  it('returns null for an unmapped code instead of guessing', () => {
    expect(resolveApiError('NOT_A_REAL_CODE')).toBeNull();
    expect(resolveApiError(undefined)).toBeNull();
    expect(resolveApiError(500)).toBeNull();
  });

  it('resolves a known code', () => {
    const resolved = resolveApiError('CONFLICT');
    expect(resolved?.status).toBe(409);
    expect(resolved?.retryable).toBe(false);
  });

  it('keeps its type guard and catalogue in agreement', () => {
    for (const code of API_ERROR_CODES) {
      expect(isApiErrorCode(code)).toBe(true);
    }
    for (const code of UNMAPPED_ERROR_CODES) {
      expect(isApiErrorCode(code)).toBe(false);
    }
  });
});
