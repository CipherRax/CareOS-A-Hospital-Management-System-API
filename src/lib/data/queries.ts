'use client';

import {
  useMutation,
  useQuery,
  useQueryClient,
  type UseMutationResult,
} from '@tanstack/react-query';
import type { UseQueryResult } from '@tanstack/react-query';

import { api } from '@/api/client';
import {
  extractPatientMaster,
  extractPatientPage,
  fetchPatientSearch,
  readTimelineEvent,
  type PatientMasterRecord,
  type PatientCallError,
  type PatientListPage,
  type TimelineEventRow,
} from '@/lib/data/patients';
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

/** Pulls an untyped patient call (raw search) onto the query error contract. */
function toQueryError(call: PatientCallError): QueryError {
  const code = typeof call?.code === 'string' ? call.code : 'INTERNAL_ERROR';
  const status = typeof call?.status === 'number' ? call.status : 0;
  return { code, status, resolved: resolveApiError(code) } satisfies QueryError;
}

// The typed envelope read is shared by the master, timeline and access-log hooks.
async function fetchPatientEnvelope<T>(
  call: PromiseLike<ApiCallResult> | ApiCallResult,
  parse: (body: unknown) => { ok: true; data: T } | { ok: false },
): Promise<Fetched<T>> {
  const fetched = await unwrap<unknown>(call);
  const parsed = parse(fetched.data);
  if (!parsed.ok) {
    throw {
      code: 'INTERNAL_ERROR',
      status: 200,
      resolved: resolveApiError('INTERNAL_ERROR'),
    } satisfies QueryError;
  }
  return { data: parsed.data, response: fetched.response } satisfies Fetched<T>;
}

/**
 * Debounced-free registry search. The *screen* owns the debounce; this hook owns
 * the contract. `q` rides the raw-fetch path because the export leaves the query
 * unmodelled (GAP-012) — see `src/lib/data/patients.ts`.
 */
export function usePatientSearch(
  query: string,
): UseQueryResult<Fetched<PatientListPage>, QueryError> {
  const needle = query.trim();
  return useQuery<Fetched<PatientListPage>, QueryError>({
    queryKey: ['patients', 'search', needle],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPatientSearch(needle, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<PatientListPage>;
      } catch (call) {
        throw toQueryError(call as PatientCallError);
      }
    },
    enabled: needle.length > 0,
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Master record `/patients/{id}/master`. The export types the 200 as a plain
 * patient while the API returns `{ patient, sections }` (GAP-013), so the body is
 * validated structurally rather than trusted.
 */
export function usePatientMaster(
  id: string,
): UseQueryResult<Fetched<PatientMasterRecord>, QueryError> {
  return useQuery<Fetched<PatientMasterRecord>, QueryError>({
    queryKey: ['patients', id, 'master'],
    queryFn: () =>
      fetchPatientEnvelope<PatientMasterRecord>(
        api.GET('/patients/{id}/master', { params: { path: { id } } }),
        (body) => {
          const parsed = extractPatientMaster(body);
          return parsed.ok ? { ok: true as const, data: parsed.record } : { ok: false as const };
        },
      ),
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Patient timeline `/patients/{id}/timeline`. Raw rows mapped to the clinical
 * Timeline's shape; a row that does not read as a timeline entry fails only its
 * own row (the screen falls back to what parsed), never the whole list.
 */
export function usePatientTimeline(
  id: string,
): UseQueryResult<Fetched<TimelineEventRow[]>, QueryError> {
  return useQuery<Fetched<TimelineEventRow[]>, QueryError>({
    queryKey: ['patients', id, 'timeline'],
    queryFn: async () => {
      const fetched = await fetchPatientEnvelope<TimelineEventRow[]>(
        api.GET('/patients/{id}/timeline', { params: { path: { id } } }),
        (body) => {
          const page = extractPatientPage(body);
          if (!page.ok) return { ok: false as const };
          const events = page.items.flatMap((row) => {
            const read = readTimelineEvent(row);
            return read.ok ? [read.event] : [];
          });
          return { ok: true as const, data: events };
        },
      );
      return fetched satisfies Fetched<TimelineEventRow[]>;
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Patient access log `/patients/{id}/access-log`. Rows are returned raw and the
 * export models only `id`, `action`, `section`, `createdAt` (the rest is
 * permission-shaped), so the screen renders exactly those fields.
 */
export function usePatientAccessLog(
  id: string,
): UseQueryResult<Fetched<AccessLogRow[]>, QueryError> {
  return useQuery<Fetched<AccessLogRow[]>, QueryError>({
    queryKey: ['patients', id, 'access-log'],
    queryFn: async () => {
      const fetched = await fetchPatientEnvelope<AccessLogRow[]>(
        api.GET('/patients/{id}/access-log', { params: { path: { id } } }),
        (body) => {
          const page = extractPatientPage(body);
          if (!page.ok) return { ok: false as const };
          const rows = page.items.flatMap((row) => {
            const read = readAccessLogRow(row);
            return read.ok ? [read.row] : [];
          });
          return { ok: true as const, data: rows };
        },
      );
      return fetched;
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface AccessLogRow {
  readonly id: string;
  readonly action: string;
  readonly section: string;
  readonly createdAt: string;
}

function readAccessLogRow(row: unknown): { ok: boolean; row: AccessLogRow } {
  if (!row || typeof row !== 'object')
    return { ok: false, row: { id: '', action: '', section: '', createdAt: '' } };
  const record = row as Record<string, unknown>;
  const createdAt = typeof record.createdAt === 'string' ? record.createdAt : '';
  if (!createdAt) return { ok: false, row: { id: '', action: '', section: '', createdAt: '' } };
  return {
    ok: true,
    row: {
      id: typeof record.id === 'string' ? record.id : '',
      action: typeof record.action === 'string' ? record.action : '',
      section: typeof record.section === 'string' ? record.section : '',
      createdAt,
    },
  };
}

export type RegisterPatientInput = {
  firstName: string;
  lastName: string;
  otherNames?: string | null;
  dateOfBirth?: string | null;
  sex?: 'MALE' | 'FEMALE' | 'OTHER';
  county?: string | null;
  town?: string | null;
  phone?: string | null;
  email?: string | null;
  address?: string | null;
  confirmDuplicate?: boolean;
  duplicateConfirmReason?: string;
};

/** The candidates a 409 `POSSIBLE_DUPLICATE` carries. See the API's register flow. */
export interface DuplicateCandidate {
  readonly patientId: string;
  readonly patientNumber: string;
  readonly firstName: string;
  readonly lastName: string;
  readonly dateOfBirth: string | null;
  readonly score: number;
  readonly reasons: readonly string[];
}

/**
 * Reads candidate ids out of a failed register attempt.
 *
 * The 409 body nests them at `error.details.candidates` (the API's own envelope),
 * which the generic `codeFrom` recursion does not surface — hence this explicit
 * read so the wizard can offer "this is the same person / a different person".
 */
export function candidatesFromRegisterError(error: unknown): DuplicateCandidate[] {
  if (!error || typeof error !== 'object') return [];
  const record = error as { error?: unknown };
  const err = record.error;
  if (!err || typeof err !== 'object') return [];
  const errorRecord = err as { details?: unknown };
  const details = errorRecord.details;
  if (!details || typeof details !== 'object') return [];
  const candidates = (details as { candidates?: unknown }).candidates;
  if (!Array.isArray(candidates)) return [];
  return candidates.flatMap((candidate): DuplicateCandidate[] => {
    if (!candidate || typeof candidate !== 'object') return [];
    const row = candidate as Record<string, unknown>;
    if (typeof row.patientId !== 'string' || typeof row.firstName !== 'string') return [];
    return [
      {
        patientId: row.patientId,
        patientNumber: typeof row.patientNumber === 'string' ? row.patientNumber : '',
        firstName: row.firstName,
        lastName: typeof row.lastName === 'string' ? row.lastName : '',
        dateOfBirth: typeof row.dateOfBirth === 'string' ? row.dateOfBirth : null,
        score: typeof row.score === 'number' ? row.score : 0,
        reasons: Array.isArray(row.reasons)
          ? row.reasons.filter((reason): reason is string => typeof reason === 'string')
          : [],
      },
    ];
  });
}

/**
 * Registers a walk-in. On `POSSIBLE_DUPLICATE` this rejects with the 409's code so
 * the wizard can present candidates; the created patient's `data` resolves on a
 * clean registration (or one made with `confirmDuplicate`).
 */
export function useRegisterPatient(): UseMutationResult<unknown, QueryError, RegisterPatientInput> {
  const queryClient = useQueryClient();
  return useMutation<unknown, QueryError, RegisterPatientInput>({
    mutationFn: async (body) => {
      const fetched = await unwrap<unknown>(api.POST('/patients', { body }));
      return fetched.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['patients'] });
    },
  });
}

/**
 * Marks a candidate record as reviewed-and-not-a-duplicate. Reception's answer to
 * a duplicate hit is never a merge (that is the records office, GAP-gated); it is
 * an audit note on the candidate followed by a confirmed registration.
 */
export function useConfirmNotDuplicate(): UseMutationResult<
  unknown,
  QueryError,
  { id: string; reason: string }
> {
  const queryClient = useQueryClient();
  return useMutation<unknown, QueryError, { id: string; reason: string }>({
    mutationFn: async ({ id, reason }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/patients/{id}/confirm-not-duplicate', {
          params: { path: { id } },
          body: { reason },
        }),
      );
      return fetched.data;
    },
    onSuccess: (_data, variables) => {
      queryClient.invalidateQueries({ queryKey: ['patients', variables.id] });
    },
  });
}
