'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api/client';
import { resolveApiError, type ResolvedApiError } from '@/lib/errors/catalog';

/**
 * Typed queries.
 *
 * These sit on the exported careOS document (`openapi/careos.openapi.json`, run
 * `npm run openapi:export` in the API repository). Where the export types a
 * response as `unknown` (the search and intake responses carry only `@example`
 * shapes), screens validate structurally instead. See docs/api-contract-gaps.md
 * and docs/limitations.md.
 *
 * `toQueryError` converts an openapi-fetch error into the catalogue's shape, so a
 * screen renders a mapped message and never the API's diagnostic `message`, which
 * is not written for display.
 */

/** Thrown shape every query in the app rejects with. */
export interface QueryError {
  code: string;
  status: number;
  resolved: ResolvedApiError | null;
}

interface Fetched<T> {
  data: T;
  response: Response;
}

/**
 * Pulls an error code out of a response body, whatever depth it sits at.
 *
 * The envelope nests the code, so the body is `{ error: { code } }`. openapi-fetch
 * hands a non-2xx body back as `error` rather than `data`, which puts the code at
 * `error.error.code` — one level deeper than a flat read reaches. When that was
 * missed, every nested error silently degraded to `INTERNAL_ERROR` and told a
 * clinician "something went wrong" for problems that had a specific, correct
 * message in the catalogue. Recursing costs nothing and cannot pick the wrong one.
 */
function codeFrom(body: unknown): string | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as { code?: unknown; error?: unknown };
  if (typeof record.code === 'string') return record.code;
  return codeFrom(record.error);
}

/**
 * Unwraps the API's success envelope.
 *
 * A 2xx with `success: false` is treated as an error, not as data. Trusting the
 * HTTP status alone would let an error body render as if it were a patient list.
 */
type ApiCallResult = { data?: unknown; error?: unknown; response: Response };

async function unwrap<T>(call: PromiseLike<ApiCallResult> | ApiCallResult): Promise<Fetched<T>> {
  const result = await call;
  const status = result.response.status;

  if (!result.response.ok || (result.data as { success?: boolean } | undefined)?.success !== true) {
    const code = codeFrom(result.error) ?? codeFrom(result.data) ?? 'INTERNAL_ERROR';
    throw { code, status, resolved: resolveApiError(code) } satisfies QueryError;
  }

  const envelope = result.data as { data: T };
  return { data: envelope.data, response: result.response } satisfies Fetched<T>;
}

/**
 * Exposed for tests only. The unwrapping rules are the contract every screen
 * depends on, and they were wrong once; they are pinned by direct test rather than
 * only through a screen that happens to exercise them.
 */
export const unwrapForTest = unwrap;

/** Current user. `/auth/me` is the one staff endpoint in the partial spec. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<Fetched<SessionUser>> => {
      const result = await api.GET('/auth/me');
      // The export types the 200 body as unknown, so the identity is a guest
      // until its own shape is proven — the gate depends on a 2xx meaning
      // "signed in", and the header on the fields below, which are mapped
      // structurally rather than trusted.
      const fetched = await unwrap<unknown>(result);
      return {
        data: normaliseSessionUser(fetched.data),
        response: fetched.response,
      } satisfies Fetched<SessionUser>;
    },
    // Identity does not go stale on its own, and refetching it on every window
    // focus would be noise. It is invalidated explicitly at sign-in and sign-out.
    staleTime: 5 * 60_000,
    refetchOnWindowFocus: false,
  }) as UseQueryResult<Fetched<SessionUser>, QueryError>;
}

export interface SessionUser {
  id: string;
  displayName: string;
  roleLabel: string;
  facilityId?: string;
}

/**
 * Maps `/auth/me`'s `data` (typed `unknown` in the export) onto the header's
 * persona. The identity endpoint returns `user` plus `roleDetails`; the fallbacks
 * are for a body that drifts again, so a malformed response starves the header
 * rather than crashing it.
 */
export function normaliseSessionUser(data: unknown): SessionUser {
  if (!data || typeof data !== 'object') {
    return { id: '', displayName: '', roleLabel: '' };
  }
  const record = data as {
    user?: { id?: unknown; firstName?: unknown; otherNames?: unknown; lastName?: unknown };
    roleDetails?: ReadonlyArray<{ name?: unknown }> | null;
  };
  const user = record.user;
  const id = typeof user?.id === 'string' ? user.id : '';
  const parts = [user?.firstName, user?.otherNames, user?.lastName].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  const displayName = parts.join(' ').trim();
  const roleLabel =
    typeof record.roleDetails?.[0]?.name === 'string' ? record.roleDetails[0].name : '';
  return { id, displayName, roleLabel };
}
