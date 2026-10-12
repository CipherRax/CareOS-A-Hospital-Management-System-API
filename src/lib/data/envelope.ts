/**
 * Shared raw-fetch envelope reader (F2/F3/F4 lists).
 *
 * The live API's global `TransformInterceptor` wraps every handler return as
 * `{ success: true, data, meta? }` and **unwraps page results**: a list handler
 * that returns `{ items, meta }` becomes `{ success: true, data: [...items],
 * meta: { page, limit, total, totalPages } }`. Single resources keep their value
 * under `data` (a record), with no `meta`.
 *
 * The exported OpenAPI types fasten either the *query* DTO onto list responses
 * (GAP-017) or a bare entity, so no list body can be trusted from the wire. Every
 * raw reader here fetches same-origin (cookies ride along), checks the envelope,
 * then validates the unwrapped `data` structurally. A body that drifts again
 * fails loudly rather than reading as an empty list.
 *
 * `readEnvelope` hands `parse` both `data` and `meta`, because pages split the
 * items and the total across those two slots.
 */

export interface PageMeta {
  readonly page: number;
  readonly limit: number;
  readonly total: number;
  readonly totalPages: number;
}

/** Shape every raw call rejects with, matching the query error contract. */
export interface EnvelopeCallError {
  readonly code: string;
  readonly status: number;
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function nullableString(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

export function nullableNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string');
}

/** Reads the row count out of a pagination `meta`; lacks one, defaults to the array length. */
export function pageTotal(meta: unknown, fallback: number): number {
  return isRecord(meta) && typeof meta.total === 'number' ? meta.total : fallback;
}

export function callErrorCodeFrom(body: unknown): string {
  if (!isRecord(body)) return 'INTERNAL_ERROR';
  const envelope = isRecord(body.error) ? body.error : body;
  return typeof envelope.code === 'string' ? envelope.code : 'INTERNAL_ERROR';
}

/**
 * Shared raw read: same-origin fetch, a drift-safe success envelope check and
 * structural validation of the unwrapped `data`. `parse` resolves `data` (the
 * array for list endpoints) together with the sibling `meta`.
 */
export async function readEnvelope<T>(
  url: string,
  parse: (data: unknown, meta: unknown) => { ok: true; value: T } | { ok: false },
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(url, { signal, credentials: 'same-origin' });
  let body: unknown;
  try {
    body = await response.json();
  } catch {
    body = undefined;
  }
  if (!response.ok) {
    throw { code: callErrorCodeFrom(body), status: response.status } satisfies EnvelopeCallError;
  }
  const envelope = isRecord(body) ? body : {};
  if (envelope.success !== true) {
    throw { code: 'INTERNAL_ERROR', status: 200 } satisfies EnvelopeCallError;
  }
  const parsed = parse(envelope.data, envelope.meta);
  if (!parsed.ok) {
    throw { code: 'INTERNAL_ERROR', status: 200 } satisfies EnvelopeCallError;
  }
  return parsed.value;
}

/** Appends only the present query parameters, matching the exported query DTOs. */
export function queryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value);
  }
  const suffix = search.toString();
  return suffix ? `?${suffix}` : '';
}