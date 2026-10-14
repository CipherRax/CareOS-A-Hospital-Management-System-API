import { publicEnv } from '@/lib/env';

import {
  isRecord,
  nullableString,
  pageTotal,
  queryString,
  readEnvelope,
  type EnvelopeCallError,
} from '@/lib/data/envelope';

/**
 * Insurance (F7 — payers, patient policies and claims).
 *
 * Every list endpoint in this family mis-types its 200: `GET /insurance/payers`
 * is declared as the bare `InsurancePayerResponseDto`, and the policies/claims
 * lists as their request DTOs (`ListPoliciesQueryDto`, `ListClaimsQueryDto`),
 * while the service answers a `PageResult` for all three (GAP-020 family). The
 * single claim read is typed as the bare entity but answers `{ claim }`. So every
 * read here rides the raw-fetch path and is validated structurally.
 *
 * A claim's `amount` and `approvedAmount` are decimal **strings** (ADR-029),
 * surfaced through `MoneyText`; this layer only checks the type and never parses
 * or computes an amount.
 */

export const CLAIM_STATUSES = [
  'DRAFT',
  'SUBMITTED',
  'APPROVED',
  'PARTIALLY_APPROVED',
  'DENIED',
  'PAID',
] as const;
export type ClaimStatus = (typeof CLAIM_STATUSES)[number];

export const COVERAGE_TYPES = ['FULL', 'PARTIAL'] as const;
export type CoverageType = (typeof COVERAGE_TYPES)[number];

export interface InsurancePayerRow {
  readonly id: string;
  readonly organizationId: string;
  readonly name: string;
  readonly contactPhone: string | null;
  readonly email: string | null;
  readonly isActive: boolean;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface InsurancePolicyRow {
  readonly id: string;
  readonly organizationId: string;
  readonly patientId: string;
  readonly payerId: string;
  readonly policyNumber: string;
  readonly coverageType: CoverageType;
  readonly coveragePercent: number;
  readonly validityStart: string | null;
  readonly validityEnd: string | null;
  readonly isActive: boolean;
  readonly version: number;
}

export interface InsuranceClaimRow {
  readonly id: string;
  readonly organizationId: string;
  readonly claimNumber: string;
  readonly invoiceId: string;
  readonly policyId: string;
  readonly patientId: string;
  readonly amount: string;
  readonly status: ClaimStatus;
  readonly notes: string | null;
  readonly submittedAt: string | null;
  readonly approvedAt: string | null;
  readonly approvedAmount: string | null;
  readonly deniedAt: string | null;
  readonly denyReason: string | null;
  readonly paidAt: string | null;
  readonly version: number;
  readonly createdAt: string | null;
  readonly updatedAt: string | null;
}

export interface InsurancePayerPage {
  readonly rows: readonly InsurancePayerRow[];
  readonly total: number;
}

export interface InsurancePolicyPage {
  readonly rows: readonly InsurancePolicyRow[];
  readonly total: number;
}

export interface InsuranceClaimPage {
  readonly rows: readonly InsuranceClaimRow[];
  readonly total: number;
}

export interface PolicyQuery {
  readonly patientId?: string;
  readonly payerId?: string;
  readonly page?: number;
  readonly limit?: number;
}

export interface ClaimQuery {
  readonly invoiceId?: string;
  readonly patientId?: string;
  readonly status?: ClaimStatus;
  readonly page?: number;
  readonly limit?: number;
}

export type InsuranceCallError = EnvelopeCallError;

export interface CreateInsurancePayerInput {
  readonly name: string;
  readonly contactPhone?: string;
  readonly email?: string;
  readonly isActive?: boolean;
}

export interface CreateInsurancePolicyInput {
  readonly patientId: string;
  readonly payerId: string;
  readonly policyNumber: string;
  /** Defaults to `PARTIAL` server-side; `PARTIAL` requires `coveragePercent`. */
  readonly coverageType?: CoverageType;
  readonly coveragePercent?: number;
  readonly validityStart?: string;
  readonly validityEnd?: string;
  readonly isActive?: boolean;
}

/** Reads a money field; a non-string is drift, so it fails closed. */
function money(value: unknown): string | null {
  return typeof value === 'string' ? value : null;
}

function readPayer(value: unknown): InsurancePayerRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.name !== 'string') return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    name: value.name,
    contactPhone: nullableString(value.contactPhone),
    email: nullableString(value.email),
    isActive: value.isActive === true,
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

function readPolicy(value: unknown): InsurancePolicyRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.policyNumber !== 'string') return null;
  if (typeof value.patientId !== 'string' || typeof value.payerId !== 'string') return null;
  if (typeof value.coverageType !== 'string') return null;
  if (!COVERAGE_TYPES.includes(value.coverageType as CoverageType)) return null;
  if (typeof value.coveragePercent !== 'number') return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    patientId: value.patientId,
    payerId: value.payerId,
    policyNumber: value.policyNumber,
    coverageType: value.coverageType as CoverageType,
    coveragePercent: value.coveragePercent,
    validityStart: nullableString(value.validityStart),
    validityEnd: nullableString(value.validityEnd),
    isActive: value.isActive === true,
    version: typeof value.version === 'number' ? value.version : 0,
  };
}

/** Reads one serialized claim; returns null when a required field has drifted. */
export function readClaim(value: unknown): InsuranceClaimRow | null {
  if (!isRecord(value)) return null;
  if (typeof value.id !== 'string' || typeof value.claimNumber !== 'string') return null;
  if (typeof value.invoiceId !== 'string' || typeof value.policyId !== 'string') return null;
  if (typeof value.patientId !== 'string') return null;
  if (typeof value.status !== 'string' || !CLAIM_STATUSES.includes(value.status as ClaimStatus)) {
    return null;
  }
  const amount = money(value.amount);
  if (amount === null) return null;
  return {
    id: value.id,
    organizationId: typeof value.organizationId === 'string' ? value.organizationId : '',
    claimNumber: value.claimNumber,
    invoiceId: value.invoiceId,
    policyId: value.policyId,
    patientId: value.patientId,
    amount,
    status: value.status as ClaimStatus,
    notes: nullableString(value.notes),
    submittedAt: nullableString(value.submittedAt),
    approvedAt: nullableString(value.approvedAt),
    approvedAmount: money(value.approvedAmount),
    deniedAt: nullableString(value.deniedAt),
    denyReason: nullableString(value.denyReason),
    paidAt: nullableString(value.paidAt),
    version: typeof value.version === 'number' ? value.version : 0,
    createdAt: nullableString(value.createdAt),
    updatedAt: nullableString(value.updatedAt),
  };
}

export function extractPayerPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: InsurancePayerPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readPayer);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly InsurancePayerRow[], total: pageTotal(meta, rows.length) },
  };
}

export function extractPolicyPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: InsurancePolicyPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readPolicy);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly InsurancePolicyRow[], total: pageTotal(meta, rows.length) },
  };
}

export function extractClaimPage(
  data: unknown,
  meta: unknown,
): { ok: true; page: InsuranceClaimPage } | { ok: false } {
  if (!Array.isArray(data)) return { ok: false };
  const rows = data.map(readClaim);
  if (rows.some((row) => row === null)) return { ok: false };
  return {
    ok: true,
    page: { rows: rows as readonly InsuranceClaimRow[], total: pageTotal(meta, rows.length) },
  };
}

/** Reads a single-claim body: the service answers `{ claim }`. */
export function extractClaimRecord(
  payload: unknown,
): { ok: true; claim: InsuranceClaimRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const claim = readClaim(payload.claim);
  return claim ? { ok: true, claim } : { ok: false };
}

/** Reads a single-payer body: the service answers `{ payer }`. */
export function extractPayerRecord(
  payload: unknown,
): { ok: true; payer: InsurancePayerRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const payer = readPayer(payload.payer);
  return payer ? { ok: true, payer } : { ok: false };
}

/** Reads a single-policy body: the service answers `{ policy }`. */
export function extractPolicyRecord(
  payload: unknown,
): { ok: true; policy: InsurancePolicyRow } | { ok: false } {
  if (!isRecord(payload)) return { ok: false };
  const policy = readPolicy(payload.policy);
  return policy ? { ok: true, policy } : { ok: false };
}

/** Raw read against `GET /insurance/payers` (the 200 is typed as the bare entity). */
export async function fetchPayers(signal?: AbortSignal): Promise<InsurancePayerPage> {
  const url = `${publicEnv.apiBasePath}/insurance/payers`;
  return readEnvelope<InsurancePayerPage>(
    url,
    (data, meta) => {
      const page = extractPayerPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /insurance/policies?{filters}` (the 200 is the query DTO). */
export async function fetchPolicies(
  query: PolicyQuery = {},
  signal?: AbortSignal,
): Promise<InsurancePolicyPage> {
  const suffix = queryString({
    patientId: query.patientId,
    payerId: query.payerId,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/insurance/policies${suffix}`;
  return readEnvelope<InsurancePolicyPage>(
    url,
    (data, meta) => {
      const page = extractPolicyPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /insurance/claims?{filters}` (the 200 is the query DTO). */
export async function fetchClaims(
  query: ClaimQuery = {},
  signal?: AbortSignal,
): Promise<InsuranceClaimPage> {
  const suffix = queryString({
    invoiceId: query.invoiceId,
    patientId: query.patientId,
    status: query.status,
    page: query.page !== undefined ? String(query.page) : undefined,
    limit: query.limit !== undefined ? String(query.limit) : undefined,
  });
  const url = `${publicEnv.apiBasePath}/insurance/claims${suffix}`;
  return readEnvelope<InsuranceClaimPage>(
    url,
    (data, meta) => {
      const page = extractClaimPage(data, meta);
      return page.ok ? { ok: true, value: page.page } : { ok: false };
    },
    signal,
  );
}

/** Raw read against `GET /insurance/claims/{id}` (the service answers `{ claim }`). */
export async function fetchClaim(id: string, signal?: AbortSignal): Promise<InsuranceClaimRow> {
  const url = `${publicEnv.apiBasePath}/insurance/claims/${encodeURIComponent(id)}`;
  return readEnvelope<InsuranceClaimRow>(
    url,
    (data) => {
      const parsed = extractClaimRecord(data);
      return parsed.ok ? { ok: true, value: parsed.claim } : { ok: false };
    },
    signal,
  );
}
