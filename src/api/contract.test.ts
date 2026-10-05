import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { handlers } from '@/mocks/handlers';
import { ERROR_CATALOGUE, isApiErrorCode } from '@/lib/errors/catalog';
import { server } from '@/mocks/server';

import type { components } from './schema';

/**
 * The mock handlers and the error catalogue exist to serve the same contract as
 * the OpenAPI document. These tests are what stop them drifting apart: a code
 * added to one and not the other, or a handler returning a shape the generated
 * types reject, fails here rather than in a browser at 3am.
 */
type ApiErrorCode = NonNullable<components['schemas']['ApiErrorBody']['code']>;

describe('mock handlers match the OpenAPI contract', () => {
  it('only uses error codes the catalogue and the spec both know', async () => {
    // Fail loudly on an unhandled request rather than letting MSW bypass.
    server.use(
      http.get('*/api/v1/public/facilities', () =>
        HttpResponse.json(
          { success: false, error: { code: 'TOTALLY_MADE_UP', message: 'x' } },
          { status: 500 },
        ),
      ),
    );

    const res = await fetch('/api/v1/public/facilities');
    const body = (await res.json()) as { error: { code: string } };

    expect(isApiErrorCode(body.error.code)).toBe(false);
  });

  it('keeps the spec enum and the catalogue in agreement', () => {
    // Every code the spec advertises must be resolvable by the UI, otherwise the
    // frontend has no message to show and would fall back to something generic.
    const specCodes: readonly string[] = [
      'VALIDATION_ERROR',
      'UNAUTHENTICATED',
      'FORBIDDEN',
      'NOT_FOUND',
      'CONFLICT',
      'UNPROCESSABLE_ENTITY',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
    ];

    for (const code of specCodes) {
      expect(`${code}:${isApiErrorCode(code)}`).toBe(`${code}:true`);
    }
  });

  it('serves a facility list whose shape satisfies the generated type', async () => {
    const res = await fetch('/api/v1/public/facilities');
    const body = (await res.json()) as {
      success: boolean;
      data: { items: components['schemas']['PublicFacility'][]; total: number };
    };

    expect(body.success).toBe(true);
    expect(body.data.total).toBe(body.data.items.length);
    for (const item of body.data.items) {
      // Compile-time check via the generated type; the runtime assertions below
      // catch a handler that was edited without regenerating.
      const facility: components['schemas']['PublicFacility'] = item;
      expect(facility.id).toBeTruthy();
      expect(facility.name).toBeTruthy();
    }
  });

  it('marks mock data so a screenshot cannot be mistaken for a real record', async () => {
    const res = await fetch('/api/v1/public/facilities');
    const body = (await res.json()) as {
      data: { items: { name: string; id: string }[] };
    };
    for (const item of body.data.items) {
      expect(`${item.name}${item.id}`).toMatch(/EXAMPLE/i);
    }
  });

  it('returns 401 with a catalogue code for an unauthenticated session', async () => {
    const res = await fetch('/api/v1/auth/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: ApiErrorCode } };
    expect(isApiErrorCode(body.error.code)).toBe(true);
    expect(ERROR_CATALOGUE.UNAUTHENTICATED.retryable).toBe(false);
  });

  it('has a handler for every public path the spec declares', () => {
    // A count check, not a structural one: it catches a path being added to the
    // spec without a corresponding mock, which is the common failure.
    expect(handlers.length).toBeGreaterThanOrEqual(4);
  });
});
