/**
 * careOS error catalogue.
 *
 * Single source of truth for the error codes the API returns, their HTTP status,
 * the user-facing message, and — critically — whether retrying is safe.
 *
 * The rule this file exists to enforce: the UI never renders a raw API message
 * and never invents a human sentence from a status code. It looks the code up
 * here. An unmapped code is a visible gap (`UNMAPPED_ERROR_CODES`) rather than a
 * silent fallback that shows a user something reassuring and wrong.
 *
 * `retryable` drives the UI's affordance, not just the copy: showing a "Try
 * again" button on a validation failure trains staff to retry things that cannot
 * succeed.
 */

export const ERROR_CATALOGUE = {
  VALIDATION_ERROR: {
    status: 400,
    titleKey: 'error.validation.title',
    messageKey: 'error.validation.body',
    retryable: false,
  },
  UNAUTHORIZED: {
    status: 401,
    titleKey: 'error.unauthenticated.title',
    messageKey: 'error.unauthenticated.body',
    retryable: false,
  },
  PERMISSION_DENIED: {
    status: 403,
    titleKey: 'error.forbidden.title',
    messageKey: 'error.forbidden.body',
    retryable: false,
  },
  RESOURCE_NOT_FOUND: {
    status: 404,
    titleKey: 'error.notFound.title',
    messageKey: 'error.notFound.body',
    retryable: false,
  },
  CONFLICT: {
    status: 409,
    titleKey: 'error.conflict.title',
    messageKey: 'error.conflict.body',
    retryable: false,
  },
  UNPROCESSABLE_ENTITY: {
    status: 422,
    titleKey: 'error.unprocessable.title',
    messageKey: 'error.unprocessable.body',
    retryable: false,
  },
  POSSIBLE_DUPLICATE: {
    status: 409,
    titleKey: 'error.possibleDuplicate.title',
    messageKey: 'error.possibleDuplicate.body',
    retryable: false,
  },
  RATE_LIMITED: {
    status: 429,
    titleKey: 'error.rateLimited.title',
    messageKey: 'error.rateLimited.body',
    retryable: true,
  },
  INTERNAL_ERROR: {
    status: 500,
    titleKey: 'error.internal.title',
    messageKey: 'error.internal.body',
    retryable: true,
  },
  SERVICE_UNAVAILABLE: {
    status: 503,
    titleKey: 'error.unavailable.title',
    messageKey: 'error.unavailable.body',
    retryable: true,
  },
  NETWORK_ERROR: {
    // Not an HTTP status: the request never reached the API. Retryable, because
    // the outcome is genuinely unknown rather than known-bad.
    status: 0,
    titleKey: 'error.network.title',
    messageKey: 'error.network.body',
    retryable: true,
  },
  TIMEOUT: {
    status: 0,
    titleKey: 'error.timeout.title',
    messageKey: 'error.timeout.body',
    retryable: true,
  },
} as const satisfies Record<string, ApiErrorEntry>;

export interface ApiErrorEntry {
  readonly status: number;
  readonly titleKey: string;
  readonly messageKey: string;
  readonly retryable: boolean;
}

export type ApiErrorCode = keyof typeof ERROR_CATALOGUE;

export const API_ERROR_CODES = Object.keys(ERROR_CATALOGUE) as readonly ApiErrorCode[];

export function isApiErrorCode(value: unknown): value is ApiErrorCode {
  return typeof value === 'string' && value in ERROR_CATALOGUE;
}

/**
 * Codes the catalogue deliberately does not cover.
 *
 * Kept as an explicit list rather than left implicit, because the honest response
 * to an unmapped code is a visible gap that gets logged, not a generic message
 * that hides it. Add entries here as gaps are closed so the list stays a to-do
 * list rather than a graveyard.
 */
export const UNMAPPED_ERROR_CODES: readonly string[] = [
  // Verified present in the exported OpenAPI document but not covered by the
  // catalogue yet, so no message is authored for them without guessing at intent.
  // Tracked in docs/api-contract-gaps.md and docs/limitations.md.
  'PUBLIC_LISTING_NOT_PUBLISHED',
  'FACILITY_NOT_ACCEPTING_REQUESTS',
  'LOCATION_REQUIRED',
  'EMERGENCY_CALL_NOW',
];

export interface ResolvedApiError {
  readonly code: ApiErrorCode;
  readonly status: number;
  readonly titleKey: string;
  readonly messageKey: string;
  readonly retryable: boolean;
}

export function resolveApiError(code: unknown): ResolvedApiError | null {
  if (!isApiErrorCode(code)) return null;
  const entry = ERROR_CATALOGUE[code];
  return { code, ...entry };
}
