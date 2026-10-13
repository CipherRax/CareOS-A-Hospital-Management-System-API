import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Pharmacy inventory (F6 — dispensing).
 *
 * `POST /pharmacy/stock/dispense` is the pharmacy's step in the prescription
 * lifecycle: it decrements the branch's stock FEFO and advances the prescription
 * to DISPENSED or PARTIALLY_DISPENSED. The service answers a **bare**
 * `{ prescriptionStatus, dispensedLines }` (not the `InventoryResponseDto` the
 * export fastens to the 201, GAP-020), so the unwrapped body is validated
 * structurally here.
 *
 * `GET /pharmacy/stock/on-hand` carries `query: never` and a 200 typed as the
 * request DTO (`OnHandQueryDto`) while the service answers `{ onHand: [...] }`,
 * so it rides the raw-fetch path like the other list reads.
 */

/** Stock on hand for one medication at one branch, reconstructed from the ledger. */
export interface StockOnHandRow {
  readonly medicationId: string;
  readonly name: string | null;
  readonly unit: string | null;
  readonly branchId: string;
  readonly quantity: number;
}

/** Reads one serialized on-hand row; returns null when the row is unusable. */
export function readStockOnHandRow(value: unknown): StockOnHandRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.medicationId !== 'string') return null;
  if (typeof value.branchId !== 'string') return null;
  if (typeof value.quantity !== 'number') return null;
  return {
    medicationId: value.medicationId,
    name: nullableString(value.name),
    unit: nullableString(value.unit),
    branchId: value.branchId,
    quantity: value.quantity,
  };
}

/** Reads the on-hand list from the unwrapped `data`: `{ onHand: [...] }`. */
export function extractStockOnHand(
  payload: unknown,
): { ok: true; rows: readonly StockOnHandRow[] } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (!Array.isArray(payload.onHand)) return { ok: false };
  const rows = payload.onHand.map(readStockOnHandRow);
  if (rows.some((row) => row === null)) return { ok: false };
  return { ok: true, rows: rows as readonly StockOnHandRow[] };
}

/** Shape every inventory raw call rejects with, matching the query error contract. */
export type InventoryCallError = EnvelopeCallError;

export interface StockOnHandQuery {
  readonly branchId?: string;
}

/**
 * Raw read against `GET /pharmacy/stock/on-hand?…`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO, so this uses the same
 * raw-fetch precedent as the other list reads.
 */
export async function fetchStockOnHand(
  query: StockOnHandQuery = {},
  signal?: AbortSignal,
): Promise<readonly StockOnHandRow[]> {
  const suffix = queryString({ branchId: query.branchId });
  const url = `${publicEnv.apiBasePath}/pharmacy/stock/on-hand${suffix}`;
  return readEnvelope<readonly StockOnHandRow[]>(
    url,
    (data) => {
      const rows = extractStockOnHand(data);
      return rows.ok ? { ok: true, value: rows.rows } : { ok: false };
    },
    signal,
  );
}

export interface DispenseLine {
  readonly medicationId: string;
  readonly quantity: number;
}

export interface DispenseInput {
  readonly prescriptionId: string;
  readonly branchId: string;
  readonly lines: readonly DispenseLine[];
}

export interface DispenseResult {
  readonly prescriptionStatus: string;
  readonly dispensedLines: readonly string[];
}

/** Reads the dispense body: the service answers a bare `{ prescriptionStatus, dispensedLines }`. */
export function readDispenseResult(
  payload: unknown,
): { ok: true; result: DispenseResult } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  if (typeof payload.prescriptionStatus !== 'string') return { ok: false };
  if (!Array.isArray(payload.dispensedLines)) return { ok: false };
  if (payload.dispensedLines.some((line) => typeof line !== 'string')) return { ok: false };
  return {
    ok: true,
    result: {
      prescriptionStatus: payload.prescriptionStatus,
      dispensedLines: payload.dispensedLines as readonly string[],
    },
  };
}
