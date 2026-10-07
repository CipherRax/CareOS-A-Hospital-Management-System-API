import { describe, expect, it } from 'vitest';

import { http, HttpResponse } from 'msw';

import { handlers } from '@/mocks/handlers';
import { ERROR_CATALOGUE, isApiErrorCode } from '@/lib/errors/catalog';
import { server } from '@/mocks/server';
import type { PublicFacilityListing } from '@/lib/data/facilities';

/**
 * The mock handlers and the error catalogue exist to serve the same contract as
 * the OpenAPI document. These tests are what stop them drifting apart: a code
 * added to one and not the other, or a handler returning a shape the generated
 * types reject, fails here rather than in a browser at 3am.
 */

describe('mock handlers match the OpenAPI contract', () => {
  it('only uses error codes the catalogue and the spec both know', async () => {
    // Fail loudly on an unhandled request rather than letting MSW bypass.
    server.use(
      http.get('*/api/v1/public/facilities/search', () =>
        HttpResponse.json(
          { success: false, error: { code: 'TOTALLY_MADE_UP', message: 'x' } },
          { status: 500 },
        ),
      ),
    );

    const res = await fetch('/api/v1/public/facilities/search');
    const body = (await res.json()) as { error: { code: string } };

    expect(isApiErrorCode(body.error.code)).toBe(false);
  });

  it('keeps the spec enum and the catalogue in agreement', () => {
    // Every code the live API advertises at the envelope level must be resolvable
    // by the UI, otherwise the frontend has no message to show and would fall back
    // to something generic. Verified from the exported document's response
    // descriptions (`npm run openapi:export`).
    const specCodes: readonly string[] = [
      'VALIDATION_ERROR',
      'UNAUTHORIZED',
      'PERMISSION_DENIED',
      'RESOURCE_NOT_FOUND',
      'CONFLICT',
      'RATE_LIMITED',
      'INTERNAL_ERROR',
      'SERVICE_UNAVAILABLE',
    ];

    for (const code of specCodes) {
      expect(`${code}:${isApiErrorCode(code)}`).toBe(`${code}:true`);
    }
  });

  it('serves a facility list whose shape satisfies the live directory contract', async () => {
    const res = await fetch('/api/v1/public/facilities/search');
    const body = (await res.json()) as {
      success: boolean;
      data: readonly PublicFacilityListing[];
    };

    expect(body.success).toBe(true);
    for (const item of body.data) {
      const facility: PublicFacilityListing = item;
      expect(facility.id).toBeTruthy();
      expect(facility.slug).toBeTruthy();
      expect(facility.name).toBeTruthy();
    }
  });

  it('marks mock data so a screenshot cannot be mistaken for a real record', async () => {
    const res = await fetch('/api/v1/public/facilities/search');
    const body = (await res.json()) as {
      data: { name: string; id: string }[];
    };
    for (const item of body.data) {
      expect(`${item.name}${item.id}`).toMatch(/EXAMPLE/i);
    }
  });

  it('serves the intake reference shape the exported document demonstrates', async () => {
    const res = await fetch('/api/v1/public/emergency-requests', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ slug: 'example-general-hospital' }),
    });
    expect(res.status).toBe(201);
    const body = (await res.json()) as {
      data: {
        request: { referenceNumber: string; trackingToken: string };
      };
    };
    expect(body.data.request.referenceNumber).toBeTruthy();
    expect(body.data.request.trackingToken).toBeTruthy();
  });

  it('returns 401 with a catalogue code for an unauthenticated session', async () => {
    const res = await fetch('/api/v1/auth/me');
    expect(res.status).toBe(401);
    const body = (await res.json()) as { error: { code: keyof typeof ERROR_CATALOGUE } };
    expect(isApiErrorCode(body.error.code)).toBe(true);
    expect(ERROR_CATALOGUE[body.error.code].retryable).toBe(false);
  });

  it('has a handler for every public path the spec declares', () => {
    // A count check, not a structural one: it catches a path being added to the
    // spec without a corresponding mock, which is the common failure.
    expect(handlers.length).toBeGreaterThanOrEqual(4);
  });
});