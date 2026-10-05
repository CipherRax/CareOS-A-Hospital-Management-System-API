'use client';

import { useQuery, type UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api/client';
import { resolveApiError, type ResolvedApiError } from '@/lib/errors/catalog';

/**
 * Typed queries.
 *
 * These sit on a provisional contract (`openapi/careos.partial.json`, see
 * docs/api-contract-gaps.md). That is a deliberate, recorded position rather than
 * a shortcut: the API exports its real document via `npm run openapi:export`, and
 * when that can be run these types become the generated ones with no code change
 * here — only in the generated file.
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

/** Current user. Provisional: `/auth/me` is the one staff endpoint in the partial spec. */
export function useSession() {
  return useQuery({
    queryKey: ['session'],
    queryFn: async (): Promise<Fetched<SessionUser>> => {
      const result = await api.GET('/auth/me');
      return unwrap<SessionUser>(result);
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
