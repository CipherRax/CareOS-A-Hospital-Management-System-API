/**
 * Session cookie names, shared by the two places that must agree: the same-origin
 * proxy that owns the HttpOnly session cookies (`src/app/api/v1/[...path]/route.ts`)
 * and the mock handlers that mirror the bridge in development and tests
 * (`src/mocks/handlers.ts`).
 */

/** The access token. The proxy translates it into `Authorization: Bearer` upstream. */
export const SESSION_COOKIE = 'careos_session';

/** The refresh token. The proxy rotates it on the API on a 401, and injects it
 * into `/auth/logout`. */
export const REFRESH_COOKIE = 'careos_refresh';
