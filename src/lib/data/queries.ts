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
  buildDisplayName,
  extractPatientMaster,
  extractPatientPage,
  fetchPatientSearch,
  readTimelineEvent,
  type PatientMasterRecord,
  type PatientCallError,
  type PatientListPage,
  type TimelineEventRow,
} from '@/lib/data/patients';
import {
  extractAppointmentRecord,
  extractWaitlistRecord,
  fetchAppointments,
  fetchProviders,
  fetchSlots,
  fetchWaitlist,
  type AppointmentPage,
  type AppointmentQuery,
  type AppointmentRow,
  type ProviderOption,
  type SchedulingCallError,
  type SlotDay,
  type SlotQuery,
  type WaitlistEntryRecord,
  type WaitlistPage,
} from '@/lib/data/scheduling';
import {
  extractOverrideRecord,
  extractTemplateRecord,
  fetchTemplates,
  SCHEDULES_BRANCH_ID,
  type CreateOverrideInput,
  type CreateTemplateInput,
  type ScheduleOverrideRow,
  type ScheduleTemplateRow,
  type SchedulesCallError,
  type TemplatePage,
  type TemplateQuery,
} from '@/lib/data/schedules';
import {
  extractVitalRecord,
  fetchVitals,
  type VitalMeasurementKey,
  type VitalPage,
  type VitalRow,
  type VitalsCallError,
} from '@/lib/data/vitals';
import {
  extractDepartmentList,
  extractQueueStats,
  extractRegisteredWalkIn,
  fetchQueue,
  type DepartmentOption,
  type QueueCallError,
  type QueuePage,
  type QueueQuery,
  type QueueStats,
  type QueueStatus,
  type OperationalPriority,
  type RegisteredWalkIn,
} from '@/lib/data/queue';
import {
  extractEncounterRecord,
  fetchEncounters,
  type EncounterPage,
  type EncounterQuery,
  type EncounterRow,
  type EncounterStatus,
  type EncountersCallError,
} from '@/lib/data/encounters';
import {
  extractNoteRecord,
  fetchClinicalNotes,
  fetchNoteTemplates,
  type ClinicalNotesCallError,
  type NotePage,
  type NoteQuery,
  type NoteRow,
  type NoteSections,
  type TemplatePage as NoteTemplatePage,
  type TemplateQuery as NoteTemplateQuery,
} from '@/lib/data/clinical-notes';
import {
  extractPrescriptionRecord,
  fetchPrescriptions,
  type PrescriptionRow,
  type PrescriptionStatus,
  type PrescriptionsCallError,
} from '@/lib/data/prescriptions';
import {
  extractMedicationRecord,
  fetchMedications,
  type MedicationQuery,
  type MedicationRow,
  type MedicationsCallError,
} from '@/lib/data/medications';
import {
  extractLabOrderRecord,
  fetchLabOrders,
  fetchLabTests,
  readCriticalResult,
  readLabResult,
  type CriticalResultRow,
  type LabOrderDetail,
  type LabOrderPage,
  type LabOrderPriority,
  type LabOrderQuery,
  type LabOrderTransition,
  type LabResultRow,
  type LabTestPage,
  type LabTestsQuery,
  type LaboratoryCallError,
} from '@/lib/data/laboratory';
import {
  extractRadiologyOrderRecord,
  fetchRadiologyOrders,
  type ImagingModality,
  type RadiologyCallError,
  type RadiologyOrderPage,
  type RadiologyOrderQuery,
  type RadiologyOrderRow,
  type RadiologyOrderTransition,
} from '@/lib/data/radiology';
import {
  extractInvoiceRecord,
  extractPaymentRecord,
  fetchInvoice,
  fetchInvoices,
  type BillingCallError,
  type InvoicePage,
  type InvoiceQuery,
  type InvoiceRow,
  type PaymentMethod,
  type PaymentRow,
} from '@/lib/data/billing';
import {
  fetchStockAlerts,
  fetchStockOnHand,
  readDispenseResult,
  readReceiveResult,
  readWriteOffResult,
  type DispenseInput,
  type DispenseResult,
  type InventoryCallError,
  type ReceiveStockInput,
  type ReceivedBatch,
  type StockAlertRow,
  type StockOnHandRow,
  type WriteOffInput,
  type WriteOffResult,
} from '@/lib/data/inventory';
import {
  extractClaimRecord,
  extractPayerRecord,
  extractPolicyRecord,
  fetchClaim,
  fetchClaims,
  fetchPayers,
  fetchPolicies,
  type ClaimQuery,
  type CreateInsurancePayerInput,
  type CreateInsurancePolicyInput,
  type InsuranceCallError,
  type InsuranceClaimPage,
  type InsuranceClaimRow,
  type InsurancePayerPage,
  type InsurancePayerRow,
  type InsurancePolicyPage,
  type InsurancePolicyRow,
  type PolicyQuery,
} from '@/lib/data/insurance';
import {
  extractAdmissionRecord,
  extractBedRecord,
  extractRoomRecord,
  extractWardRecord,
  fetchAdmission,
  fetchAdmissions,
  fetchWard,
  fetchWards,
  INPATIENT_BRANCH_ID,
  type AdmissionPage,
  type AdmissionQuery,
  type AdmissionRow,
  type BedRow,
  type CreateAdmissionInput,
  type CreateBedInput,
  type CreateRoomInput,
  type CreateWardInput,
  type DischargeAdmissionInput,
  type InpatientCallError,
  type ManualBedStatus,
  type RoomRow,
  type TransferAdmissionInput,
  type WardPage,
  type WardQuery,
  type WardRow,
} from '@/lib/data/inpatient';
import {
  EMERGENCY_BRANCH_ID,
  extractEmergencyVisitRecord,
  fetchEmergencySummary,
  fetchEmergencyVisit,
  fetchEmergencyVisits,
  type AdmitFromEmergencyInput,
  type AssessEmergencyVisitInput,
  type EmergencyCallError,
  type EmergencySummaryRow,
  type EmergencyVisitPage,
  type EmergencyVisitQuery,
  type EmergencyVisitRow,
  type ReferEmergencyVisitInput,
  type RegisterEmergencyVisitInput,
  type SetEmergencyPriorityInput,
  type TreatEmergencyVisitInput,
  type TriageEmergencyVisitInput,
} from '@/lib/data/emergency';
import {
  extractInvitedUser,
  extractOrganizationRecord,
  extractRevoked,
  extractRoleRecord,
  extractUserRecord,
  fetchOrganization,
  fetchRole,
  fetchRoleCatalog,
  fetchRoles,
  fetchUser,
  fetchUsers,
  type AdminCallError,
  type CreateRoleInput,
  type InviteUserInput,
  type InvitedUser,
  type OrganizationRow,
  type RoleCatalog,
  type RolePage,
  type RoleQuery,
  type RoleRow,
  type SetUserRolesInput,
  type UpdateOrganizationInput,
  type UpdateRoleInput,
  type UpdateUserInput,
  type UserPage,
  type UserQuery,
  type UserRow,
} from '@/lib/data/admin';
import {
  extractReportRecord,
  fetchReportExport,
  fetchReportExports,
  type ReportExportRow,
  type ReportPage,
  type ReportQuery,
  type ReportsCallError,
  type RequestReportInput,
} from '@/lib/data/reports';
import {
  fetchAnalyticsBottleneck,
  fetchAnalyticsCapacity,
  fetchAnalyticsForecast,
  fetchAnalyticsMetrics,
  fetchAnalyticsPatientExperience,
  fetchAnalyticsStaff,
  type AnalyticsBottleneck,
  type AnalyticsCallError,
  type AnalyticsCapacity,
  type AnalyticsForecastQuery,
  type AnalyticsMetrics,
  type AnalyticsMetricsQuery,
  type AnalyticsPatientExperience,
  type AnalyticsStaff,
  type ForecastResult,
} from '@/lib/data/analytics';
import {
  extractStaffRecord,
  fetchBranchOptions,
  fetchStaff,
  fetchStaffMember,
  type BranchOption,
  type SetStaffAssignmentsInput,
  type StaffCallError,
  type StaffPage,
  type StaffQuery,
  type StaffRow,
  type UpdateStaffInput,
} from '@/lib/data/staff';
import {
  fetchPortalAppointments,
  fetchPortalLabResults,
  fetchPortalMe,
  type PortalAppointmentPage,
  type PortalAppointmentQuery,
  type PortalCallError,
  type PortalLabResultPage,
  type PortalLabResultQuery,
  type PortalPatient,
} from '@/lib/data/portal';
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

/** The reserved role key for the patient portal (ADR-051, `patient-scope.ts`). */
export const PATIENT_ROLE_KEY = 'PATIENT';

export interface SessionUser {
  id: string;
  displayName: string;
  roleLabel: string;
  facilityId?: string;
  /** ISO 4217 for money display, from the org on `/auth/me`. */
  currency: string;
  /** Role keys from `/auth/me` (`roles`), used to tell staff from patient. */
  roles: readonly string[];
  /** The patient record this login is linked to (`patientLink.patientId`), if any. */
  patientId: string | null;
  /**
   * A patient principal. Both halves are required, mirroring
   * `resolvePatientScope` server-side: the `PATIENT` role *and* a linked record.
   * A staff login that happens to hold the role, or a provisioned patient that
   * has not been linked yet, is not a patient principal and must not be routed
   * to the portal.
   */
  isPatient: boolean;
}

/**
 * Maps `/auth/me`'s `data` (typed `unknown` in the export) onto the header's
 * persona. The identity endpoint returns `user` plus `roleDetails`; the fallbacks
 * are for a body that drifts again, so a malformed response starves the header
 * rather than crashing it.
 *
 * It also carries the principal's routing facts — `roles`, the patient link, and
 * the derived `isPatient` — because both gates (`StaffGate`, `PortalGate`) branch
 * on them. Deriving the flag once here keeps the two gates from disagreeing about
 * what a patient is.
 */
export function normaliseSessionUser(data: unknown): SessionUser {
  if (!data || typeof data !== 'object') {
    return emptySessionUser();
  }
  const record = data as {
    user?: { id?: unknown; firstName?: unknown; otherNames?: unknown; lastName?: unknown };
    roleDetails?: ReadonlyArray<{ name?: unknown }> | null;
    roles?: unknown;
    patientLink?: { patientId?: unknown } | null;
    organization?: { currency?: unknown } | null;
  };
  const user = record.user;
  const id = typeof user?.id === 'string' ? user.id : '';
  const parts = [user?.firstName, user?.otherNames, user?.lastName].filter(
    (part): part is string => typeof part === 'string' && part.length > 0,
  );
  const displayName = parts.join(' ').trim();
  const roleLabel =
    typeof record.roleDetails?.[0]?.name === 'string' ? record.roleDetails[0].name : '';
  const currency =
    typeof record.organization?.currency === 'string' && record.organization.currency.length > 0
      ? record.organization.currency
      : 'KES';
  const roles = Array.isArray(record.roles)
    ? record.roles.filter((key): key is string => typeof key === 'string')
    : [];
  const patientId =
    typeof record.patientLink?.patientId === 'string' && record.patientLink.patientId.length > 0
      ? record.patientLink.patientId
      : null;
  const isPatient = roles.includes(PATIENT_ROLE_KEY) && patientId !== null;
  return { id, displayName, roleLabel, currency, roles, patientId, isPatient };
}

/** The signed-out / malformed-body persona: nothing about it is known, so it is not a patient. */
function emptySessionUser(): SessionUser {
  return {
    id: '',
    displayName: '',
    roleLabel: '',
    currency: 'KES',
    roles: [],
    patientId: null,
    isPatient: false,
  };
}

/** Pulls an untyped call (raw search/queue/scheduling/vitals/schedules) onto the query error contract. */
function toQueryError(
  call:
    | PatientCallError
    | QueueCallError
    | SchedulingCallError
    | VitalsCallError
    | SchedulesCallError
    | LaboratoryCallError
    | RadiologyCallError
    | InventoryCallError
    | BillingCallError
    | InsuranceCallError
    | InpatientCallError
    | EmergencyCallError
    | AdminCallError
    | StaffCallError
    | ReportsCallError
    | AnalyticsCallError
    | PortalCallError,
): QueryError {
  const code = typeof call?.code === 'string' ? call.code : 'INTERNAL_ERROR';
  const status = typeof call?.status === 'number' ? call.status : 0;
  return { code, status, resolved: resolveApiError(code) } satisfies QueryError;
}

/**
 * Acknowledges a call whose success carries no body (a 204 delete).
 *
 * `unwrap` demands a `{ success, data }` envelope and would reject a correct
 * 204 for having none, so deletes use this instead: any 2xx is success, anything
 * else is mapped to the catalogue like every other call.
 */
async function unwrapVoid(call: PromiseLike<ApiCallResult> | ApiCallResult): Promise<void> {
  const result = await call;
  if (!result.response.ok) {
    const code = codeFrom(result.error) ?? codeFrom(result.data) ?? 'INTERNAL_ERROR';
    throw { code, status: result.response.status, resolved: resolveApiError(code) } satisfies QueryError;
  }
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

/**
 * The queue board `GET /queue`. `departmentId`/`status` ride the raw-fetch path
 * because the export leaves the query unmodelled and mis-types the body as the
 * request DTO (GAP-017).
 */
export function useQueue(query: QueueQuery = {}): UseQueryResult<Fetched<QueuePage>, QueryError> {
  return useQuery<Fetched<QueuePage>, QueryError>({
    queryKey: ['queue', 'list', query.departmentId ?? null, query.status ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchQueue(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<QueuePage>;
      } catch (call) {
        throw toQueryError(call as QueueCallError);
      }
    },
    staleTime: 15_000,
    refetchInterval: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** Waiting-room metrics `GET /queue/metrics` (unmodelled body, read structurally). */
export function useQueueMetrics(): UseQueryResult<Fetched<QueueStats>, QueryError> {
  return useQuery<Fetched<QueueStats>, QueryError>({
    queryKey: ['queue', 'metrics'],
    queryFn: () =>
      fetchPatientEnvelope<QueueStats>(
        api.GET('/queue/metrics'),
        (body) => {
          const parsed = extractQueueStats(body);
          return parsed.ok ? { ok: true as const, data: parsed.stats } : { ok: false as const };
        },
      ),
    staleTime: 30_000,
    refetchInterval: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** Active departments for the walk-in picker. The export types this one right. */
export function useDepartmentList(): UseQueryResult<Fetched<readonly DepartmentOption[]>, QueryError> {
  return useQuery<Fetched<readonly DepartmentOption[]>, QueryError>({
    queryKey: ['departments', 'list'],
    queryFn: () =>
      fetchPatientEnvelope<readonly DepartmentOption[]>(
        api.GET('/departments'),
        (body) => {
          const parsed = extractDepartmentList(body);
          return parsed.ok ? { ok: true as const, data: parsed.departments } : { ok: false as const };
        },
      ),
    staleTime: 10 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface RegisterWalkInInput {
  patientId: string;
  departmentId: string;
  branchId?: string | null;
  source: 'WALK_IN' | 'APPOINTMENT' | 'EMERGENCY';
  priority: OperationalPriority;
  note?: string | null;
}

/**
 * Registers a walk-in into the queue (`POST /queue/walk-ins/register`, 201). A
 * patient with an open visit earns `VISIT_ALREADY_ACTIVE`; the receipt carries
 * the ticket number and position.
 */
export function useRegisterWalkIn(): UseMutationResult<
  RegisteredWalkIn,
  QueryError,
  RegisterWalkInInput
> {
  const queryClient = useQueryClient();
  return useMutation<RegisteredWalkIn, QueryError, RegisterWalkInInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/queue/walk-ins/register', {
          body: {
            patientId: input.patientId,
            departmentId: input.departmentId,
            source: input.source,
            priority: input.priority,
            ...(input.branchId ? { branchId: input.branchId } : {}),
            ...(input.note ? { note: input.note } : {}),
          },
        }),
      );
      const parsed = extractRegisteredWalkIn(fetched.data);
      if (!parsed.ok) {
        throw {
          code: 'INTERNAL_ERROR',
          status: 201,
          resolved: resolveApiError('INTERNAL_ERROR'),
        } satisfies QueryError;
      }
      return parsed.receipt;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

export interface UpdateQueueStatusInput {
  id: string;
  status: QueueStatus;
  reason?: string;
  transferredToDepartmentId?: string;
}

/** Moves a ticket through the queue flow (`PATCH /queue/entries/{id}/status`). */
export function useUpdateQueueStatus(): UseMutationResult<unknown, QueryError, UpdateQueueStatusInput> {
  const queryClient = useQueryClient();
  return useMutation<unknown, QueryError, UpdateQueueStatusInput>({
    mutationFn: async ({ id, ...body }) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/queue/entries/{id}/status', { params: { path: { id } }, body }),
      );
      return fetched.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

export interface UpdateQueuePriorityInput {
  id: string;
  operationalPriority: OperationalPriority;
  reason?: string;
}

/** Reprioritises a waiting ticket (`PATCH /queue/entries/{id}/priority`). */
export function useUpdateQueuePriority(): UseMutationResult<
  unknown,
  QueryError,
  UpdateQueuePriorityInput
> {
  const queryClient = useQueryClient();
  return useMutation<unknown, QueryError, UpdateQueuePriorityInput>({
    mutationFn: async ({ id, ...body }) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/queue/entries/{id}/priority', { params: { path: { id } }, body }),
      );
      return fetched.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['queue'] });
    },
  });
}

// --- scheduling: appointments, providers, slots, waitlist (F3) ---------------

/**
 * The day book `GET /appointments`. The export leaves the query unmodelled and
 * mis-types the 200 as the request DTO (GAP-017), so this rides the raw-fetch path
 * in `src/lib/data/scheduling.ts`.
 */
export function useAppointments(
  query: AppointmentQuery = {},
): UseQueryResult<Fetched<AppointmentPage>, QueryError> {
  return useQuery<Fetched<AppointmentPage>, QueryError>({
    queryKey: [
      'appointments',
      'list',
      query.departmentId ?? null,
      query.providerId ?? null,
      query.status ?? null,
      query.date ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchAppointments(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<AppointmentPage>;
      } catch (call) {
        throw toQueryError(call as SchedulingCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * The bookable-provider directory `GET /providers`, narrowed to a department.
 * `/providers` is unmodelled in the export (no response schema), so the raw read
 * validates each row.
 */
export function useProviderDirectory(
  departmentId?: string,
): UseQueryResult<Fetched<readonly ProviderOption[]>, QueryError> {
  return useQuery<Fetched<readonly ProviderOption[]>, QueryError>({
    queryKey: ['providers', 'list', departmentId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const providers = await fetchProviders({ departmentId }, signal);
        return {
          data: providers,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<readonly ProviderOption[]>;
      } catch (call) {
        throw toQueryError(call as SchedulingCallError);
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Computed bookable slots `GET /schedules/slots`. Disabled until a provider,
 * department and date are all chosen, because the endpoint requires all three.
 */
export function useSlots(
  query: SlotQuery | null,
): UseQueryResult<Fetched<SlotDay>, QueryError> {
  return useQuery<Fetched<SlotDay>, QueryError>({
    queryKey: ['slots', query?.providerId ?? null, query?.departmentId ?? null, query?.date ?? null],
    queryFn: async ({ signal }) => {
      if (!query) throw { code: 'INTERNAL_ERROR', status: 0, resolved: null } satisfies QueryError;
      try {
        const day = await fetchSlots(query, signal);
        return { data: day, response: new Response(null, { status: 200 }) } satisfies Fetched<SlotDay>;
      } catch (call) {
        throw toQueryError(call as SchedulingCallError);
      }
    },
    enabled: Boolean(query?.providerId && query?.departmentId && query?.date),
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** The department waitlist `GET /appointments/waitlist/entries` (unmodelled query). */
export function useWaitlist(
  query: { departmentId?: string; status?: string } = {},
): UseQueryResult<Fetched<WaitlistPage>, QueryError> {
  return useQuery<Fetched<WaitlistPage>, QueryError>({
    queryKey: ['waitlist', 'list', query.departmentId ?? null, query.status ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchWaitlist(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<WaitlistPage>;
      } catch (call) {
        throw toQueryError(call as SchedulingCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Resolves a patient display name from `GET /patients/{id}`.
 *
 * Appointment rows carry only `patientId` — the list is not joined to the registry
 * (GAP-018) — so the day book names each row with this lookup, cached by React
 * Query and deduped by id. It is a workaround for a contract gap, not a design
 * choice: a real day book would ship the name with the row.
 */
export function usePatientName(id: string): UseQueryResult<Fetched<string>, QueryError> {
  return useQuery<Fetched<string>, QueryError>({
    queryKey: ['patients', id, 'name'],
    queryFn: () =>
      fetchPatientEnvelope<string>(api.GET('/patients/{id}', { params: { path: { id } } }), (body) => {
        if (!body || typeof body !== 'object') return { ok: false as const };
        const patient = (body as { patient?: unknown }).patient;
        if (!patient || typeof patient !== 'object') return { ok: false as const };
        const record = patient as Record<string, unknown>;
        const name = buildDisplayName(record.firstName, record.otherNames, record.lastName);
        return name ? { ok: true as const, data: name } : { ok: false as const };
      }),
    enabled: id.length > 0,
    staleTime: 5 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface BookAppointmentInput {
  patientId: string;
  providerId: string;
  branchId: string;
  departmentId: string;
  startsAt: string;
  mode: 'IN_PERSON' | 'VIRTUAL';
  appointmentType?: string;
  reason?: string;
}

/**
 * Books an appointment (`POST /appointments`, 201). A slot taken between the read
 * and the write answers 409 `APPOINTMENT_CONFLICT`; the booking panel shows it in
 * place rather than as a generic failure.
 */
export function useBookAppointment(): UseMutationResult<AppointmentRow, QueryError, BookAppointmentInput> {
  const queryClient = useQueryClient();
  return useMutation<AppointmentRow, QueryError, BookAppointmentInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments', {
          body: {
            patientId: input.patientId,
            providerId: input.providerId,
            branchId: input.branchId,
            departmentId: input.departmentId,
            startsAt: input.startsAt,
            mode: input.mode,
            ...(input.appointmentType ? { appointmentType: input.appointmentType } : {}),
            ...(input.reason ? { reason: input.reason } : {}),
          },
        }),
      );
      const parsed = extractAppointmentRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

export interface UpdateAppointmentStatusInput {
  id: string;
  status: 'CONFIRMED' | 'CHECKED_IN' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED' | 'NO_SHOW';
  reason?: string;
}

/** Moves an appointment through its flow (`PATCH /appointments/{id}/status`). */
export function useUpdateAppointmentStatus(): UseMutationResult<
  AppointmentRow,
  QueryError,
  UpdateAppointmentStatusInput
> {
  const queryClient = useQueryClient();
  return useMutation<AppointmentRow, QueryError, UpdateAppointmentStatusInput>({
    mutationFn: async ({ id, ...body }) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/appointments/{id}/status', { params: { path: { id } }, body }),
      );
      const parsed = extractAppointmentRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
    },
  });
}

export interface CancelAppointmentInput {
  id: string;
  reason?: string;
  version?: number;
}

/**
 * Cancels an appointment (`POST /appointments/{id}/cancel`). The dedicated
 * endpoint, not the generic transition, so `cancelReason` is recorded.
 */
export function useCancelAppointment(): UseMutationResult<AppointmentRow, QueryError, CancelAppointmentInput> {
  const queryClient = useQueryClient();
  return useMutation<AppointmentRow, QueryError, CancelAppointmentInput>({
    mutationFn: async ({ id, reason, version }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/{id}/cancel', {
          params: { path: { id } },
          body: { ...(reason ? { reason } : {}), ...(version !== undefined ? { version } : {}) },
        }),
      );
      const parsed = extractAppointmentRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

export interface JoinWaitlistInput {
  patientId: string;
  branchId: string;
  departmentId: string;
  providerId?: string;
  preferredDate?: string;
  notes?: string;
}

/** Joins the department waitlist (`POST /appointments/waitlist/entries`, 201). */
export function useJoinWaitlist(): UseMutationResult<WaitlistEntryRecord, QueryError, JoinWaitlistInput> {
  const queryClient = useQueryClient();
  return useMutation<WaitlistEntryRecord, QueryError, JoinWaitlistInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/waitlist/entries', {
          body: {
            patientId: input.patientId,
            branchId: input.branchId,
            departmentId: input.departmentId,
            ...(input.providerId ? { providerId: input.providerId } : {}),
            ...(input.preferredDate ? { preferredDate: input.preferredDate } : {}),
            ...(input.notes ? { notes: input.notes } : {}),
          },
        }),
      );
      const parsed = extractWaitlistRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });
}

/** Accepts a waitlist offer, booking the held slot (`POST .../entries/{id}/accept`). */
export function useAcceptWaitlistOffer(): UseMutationResult<
  AppointmentRow,
  QueryError,
  { id: string; appointmentId?: string }
> {
  const queryClient = useQueryClient();
  return useMutation<AppointmentRow, QueryError, { id: string; appointmentId?: string }>({
    mutationFn: async ({ id, appointmentId }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/waitlist/entries/{id}/accept', {
          params: { path: { id } },
          body: { ...(appointmentId ? { appointmentId } : {}) },
        }),
      );
      const parsed = extractAppointmentRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'on-hand'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'alerts'] });
    },
  });
}

// --- billing: invoices and payments (F7) -----------------------------------

/** A record body that fails structural validation is an internal contract break. */
function billingWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Invoice list `GET /invoices?{filters}`. The export types the 200 as the request
 * DTO while the service answers a paginated envelope (GAP-020 family), so it
 * rides the raw-fetch path.
 */
export function useInvoices(
  query: InvoiceQuery = {},
): UseQueryResult<Fetched<InvoicePage>, QueryError> {
  return useQuery<Fetched<InvoicePage>, QueryError>({
    queryKey: [
      'invoices',
      'list',
      query.branchId ?? null,
      query.patientId ?? null,
      query.status ?? null,
      query.page ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchInvoices(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<InvoicePage>;
      } catch (call) {
        throw toQueryError(call as BillingCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Full invoice `GET /invoices/{id}` — items plus payments. The service answers
 * `{ invoice }` while the export types the bare entity (GAP-020), so the
 * unwrapped body is validated structurally.
 */
export function useInvoice(id: string): UseQueryResult<Fetched<InvoiceRow>, QueryError> {
  return useQuery<Fetched<InvoiceRow>, QueryError>({
    queryKey: ['invoices', id],
    queryFn: async ({ signal }) => {
      try {
        const invoice = await fetchInvoice(id, signal);
        return {
          data: invoice,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<InvoiceRow>;
      } catch (call) {
        throw toQueryError(call as BillingCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export type InvoiceAction = 'issue' | 'cancel' | 'refund';

export interface InvoiceActionInput {
  id: string;
  action: InvoiceAction;
  /** `cancel`/`refund` capture a reason; `issue` takes none. */
  reason?: string;
}

/**
 * Issue, cancel or refund an invoice. Every action answers `{ invoice }` while
 * the export types the bare entity (GAP-020). The list and detail reads are
 * invalidated because both carry status and balance.
 */
export function useInvoiceAction(): UseMutationResult<InvoiceRow, QueryError, InvoiceActionInput> {
  const queryClient = useQueryClient();
  return useMutation<InvoiceRow, QueryError, InvoiceActionInput>({
    mutationFn: async (input) => {
      const path =
        input.action === 'issue'
          ? '/invoices/{id}/issue'
          : input.action === 'cancel'
            ? '/invoices/{id}/cancel'
            : '/invoices/{id}/refund';
      const fetched = await unwrap<unknown>(
        api.POST(path, {
          params: { path: { id: input.id } },
          body: { reason: input.reason },
        }),
      );
      const parsed = extractInvoiceRecord(fetched.data);
      if (!parsed.ok) throw billingWriteError();
      return parsed.invoice;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

export interface RecordPaymentInput {
  invoiceId: string;
  amount: string;
  method: PaymentMethod;
  externalReference?: string;
  note?: string;
}

/**
 * Records a desk payment `POST /invoices/{id}/payments`. The service answers
 * `{ payment }` while the export types the bare entity (GAP-020), so the
 * unwrapped body is validated structurally. The invoice's status and balance
 * move with the payment, so both invoice reads are invalidated too.
 */
export function useRecordPayment(): UseMutationResult<PaymentRow, QueryError, RecordPaymentInput> {
  const queryClient = useQueryClient();
  return useMutation<PaymentRow, QueryError, RecordPaymentInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/invoices/{id}/payments', {
          params: { path: { id: input.invoiceId } },
          body: {
            amount: input.amount,
            method: input.method,
            externalReference: input.externalReference,
            note: input.note,
          },
        }),
      );
      const parsed = extractPaymentRecord(fetched.data);
      if (!parsed.ok) throw billingWriteError();
      return parsed.payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

export interface RefundPaymentInput {
  id: string;
  reason?: string;
}

/**
 * Refunds a completed payment `POST /payments/{id}/refund`. The service answers
 * `{ payment }` while the export types the bare entity (GAP-020); the invoice
 * balance is restored, so the invoice reads are invalidated as well.
 */
export function useRefundPayment(): UseMutationResult<PaymentRow, QueryError, RefundPaymentInput> {
  const queryClient = useQueryClient();
  return useMutation<PaymentRow, QueryError, RefundPaymentInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/payments/{id}/refund', {
          params: { path: { id: input.id } },
          body: { reason: input.reason },
        }),
      );
      const parsed = extractPaymentRecord(fetched.data);
      if (!parsed.ok) throw billingWriteError();
      return parsed.payment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
      queryClient.invalidateQueries({ queryKey: ['payments'] });
    },
  });
}

/**
 * The org currency for money display, read off the session. Falls back to KES so
 * a drifted `/auth/me` still renders an amount rather than crashing the desk.
 */
export function useOrgCurrency(): string {
  const session = useSession();
  return session.data?.data.currency ?? 'KES';
}

// --- insurance: payers, policies and claims (F7) ----------------------------

/** A record body that fails structural validation is an internal contract break. */
function insuranceWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Insurance payers `GET /insurance/payers`. The export types the 200 as the bare
 * entity while the service answers a `PageResult` (GAP-020 family), so it rides
 * the raw-fetch path.
 */
export function useInsurancePayers(): UseQueryResult<Fetched<InsurancePayerPage>, QueryError> {
  return useQuery<Fetched<InsurancePayerPage>, QueryError>({
    queryKey: ['insurance', 'payers'],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPayers(signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<InsurancePayerPage>;
      } catch (call) {
        throw toQueryError(call as InsuranceCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Patient policies `GET /insurance/policies?{filters}`. The export types the 200
 * as the request DTO while the service answers a `PageResult` (GAP-020 family),
 * so it rides the raw-fetch path. Used to pick an active policy when a claim is
 * raised against an invoice.
 */
export function useInsurancePolicies(
  query: PolicyQuery = {},
): UseQueryResult<Fetched<InsurancePolicyPage>, QueryError> {
  return useQuery<Fetched<InsurancePolicyPage>, QueryError>({
    queryKey: ['insurance', 'policies', query.patientId ?? null, query.payerId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPolicies(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<InsurancePolicyPage>;
      } catch (call) {
        throw toQueryError(call as InsuranceCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Insurance claim list `GET /insurance/claims?{filters}`. The export types the
 * 200 as the request DTO while the service answers a `PageResult` (GAP-020
 * family), so it rides the raw-fetch path.
 */
export function useClaims(
  query: ClaimQuery = {},
): UseQueryResult<Fetched<InsuranceClaimPage>, QueryError> {
  return useQuery<Fetched<InsuranceClaimPage>, QueryError>({
    queryKey: [
      'claims',
      'list',
      query.invoiceId ?? null,
      query.patientId ?? null,
      query.status ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchClaims(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<InsuranceClaimPage>;
      } catch (call) {
        throw toQueryError(call as InsuranceCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Full claim `GET /insurance/claims/{id}`. The service answers `{ claim }` while
 * the export types the bare entity (GAP-020), so the unwrapped body is validated
 * structurally.
 */
export function useClaim(id: string): UseQueryResult<Fetched<InsuranceClaimRow>, QueryError> {
  return useQuery<Fetched<InsuranceClaimRow>, QueryError>({
    queryKey: ['claims', id],
    queryFn: async ({ signal }) => {
      try {
        const claim = await fetchClaim(id, signal);
        return { data: claim, response: new Response(null, { status: 200 }) } satisfies Fetched<InsuranceClaimRow>;
      } catch (call) {
        throw toQueryError(call as InsuranceCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface CreateClaimInput {
  invoiceId: string;
  policyId: string;
  /** Omitting the amount claims the whole invoice total, as the service does. */
  amount?: string;
  notes?: string;
}

/**
 * Raises a DRAFT claim `POST /insurance/claims`. The service answers `{ claim }`
 * while the export types the bare entity (GAP-020), so the unwrapped body is
 * validated structurally. A claim above the invoice total, or against a policy
 * that belongs to a different patient, answers 400/404.
 */
export function useCreateClaim(): UseMutationResult<InsuranceClaimRow, QueryError, CreateClaimInput> {
  const queryClient = useQueryClient();
  return useMutation<InsuranceClaimRow, QueryError, CreateClaimInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/insurance/claims', {
          body: {
            invoiceId: input.invoiceId,
            policyId: input.policyId,
            amount: input.amount,
            notes: input.notes,
          },
        }),
      );
      const parsed = extractClaimRecord(fetched.data);
      if (!parsed.ok) throw insuranceWriteError();
      return parsed.claim;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['claims'] });
    },
  });
}

export type ClaimAction = 'submit' | 'approve' | 'partial_approve' | 'deny' | 'pay';

export interface ClaimActionInput {
  id: string;
  action: ClaimAction;
  /** `partial_approve` requires it; `approve` may carry it (must equal the claim). */
  approvedAmount?: string;
  /** `deny` requires a reason. */
  reason?: string;
}

/**
 * Submits, approves, partially approves, denies or pays a claim
 * `POST /insurance/claims/{id}/action`. Every action answers `{ claim }` while
 * the export types the bare entity (GAP-020). A move the server refuses (stale
 * status, an approved amount out of range, a missing deny reason) answers 409/400
 * with the mapped code, surfaced in place. `pay` also posts an INSURANCE payment
 * against the invoice, so the invoice reads are invalidated as well.
 */
export function useClaimAction(): UseMutationResult<InsuranceClaimRow, QueryError, ClaimActionInput> {
  const queryClient = useQueryClient();
  return useMutation<InsuranceClaimRow, QueryError, ClaimActionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/insurance/claims/{id}/action', {
          params: { path: { id: input.id } },
          body: {
            action: input.action,
            approvedAmount: input.approvedAmount,
            reason: input.reason,
          },
        }),
      );
      const parsed = extractClaimRecord(fetched.data);
      if (!parsed.ok) throw insuranceWriteError();
      return parsed.claim;
    },
    onSuccess: (_claim, variables) => {
      queryClient.invalidateQueries({ queryKey: ['claims', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['claims', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['invoices'] });
    },
  });
}

/**
 * Registers a payer `POST /insurance/payers`. The service answers `{ payer }`
 * while the export types the bare entity (GAP-020), so the unwrapped body is
 * validated structurally. A duplicate name answers 409 `CONFLICT`.
 */
export function useCreatePayer(): UseMutationResult<
  InsurancePayerRow,
  QueryError,
  CreateInsurancePayerInput
> {
  const queryClient = useQueryClient();
  return useMutation<InsurancePayerRow, QueryError, CreateInsurancePayerInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/insurance/payers', {
          body: {
            name: input.name,
            contactPhone: input.contactPhone,
            email: input.email,
            isActive: input.isActive,
          },
        }),
      );
      const parsed = extractPayerRecord(fetched.data);
      if (!parsed.ok) throw insuranceWriteError();
      return parsed.payer;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'payers'] });
    },
  });
}

/**
 * Enrols a patient on a payer's plan `POST /insurance/policies`. The service
 * answers `{ policy }` while the export types the bare entity (GAP-020), so the
 * unwrapped body is validated structurally. An unknown patient or payer answers
 * 404; a `PARTIAL` policy without a `coveragePercent` answers 400.
 */
export function useCreatePolicy(): UseMutationResult<
  InsurancePolicyRow,
  QueryError,
  CreateInsurancePolicyInput
> {
  const queryClient = useQueryClient();
  return useMutation<InsurancePolicyRow, QueryError, CreateInsurancePolicyInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/insurance/policies', {
          body: {
            patientId: input.patientId,
            payerId: input.payerId,
            policyNumber: input.policyNumber,
            coverageType: input.coverageType,
            coveragePercent: input.coveragePercent,
            validityStart: input.validityStart,
            validityEnd: input.validityEnd,
            isActive: input.isActive,
          },
        }),
      );
      const parsed = extractPolicyRecord(fetched.data);
      if (!parsed.ok) throw insuranceWriteError();
      return parsed.policy;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['insurance', 'policies'] });
    },
  });
}

// --- inpatient: ward board and beds (F8) ------------------------------------

/** A record body that fails structural validation is an internal contract break. */
function inpatientWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Ward list `GET /wards?{filters}`. The export types the 200 as the request DTO
 * while the service answers a paginated envelope (GAP-020 family), so it rides
 * the raw-fetch path. Each ward carries its rooms and beds nested.
 */
export function useWards(query: WardQuery = {}): UseQueryResult<Fetched<WardPage>, QueryError> {
  return useQuery<Fetched<WardPage>, QueryError>({
    queryKey: ['wards', 'list', query.branchId ?? null, query.active ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchWards(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<WardPage>;
      } catch (call) {
        throw toQueryError(call as InpatientCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single ward `GET /wards/{id}` — its rooms and beds. The service answers
 * `{ ward }` while the export types the bare entity (GAP-020), so the unwrapped
 * body is validated structurally.
 */
export function useWard(id: string): UseQueryResult<Fetched<WardRow>, QueryError> {
  return useQuery<Fetched<WardRow>, QueryError>({
    queryKey: ['wards', id],
    queryFn: async ({ signal }) => {
      try {
        const ward = await fetchWard(id, signal);
        return { data: ward, response: new Response(null, { status: 200 }) } satisfies Fetched<WardRow>;
      } catch (call) {
        throw toQueryError(call as InpatientCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Creates a ward `POST /wards` (201 `{ ward }`). The app has no branch picker, so
 * creation posts to the EXAMPLE branch the rest of the desks use (GAP-018). The
 * ward list is invalidated so the board picks it up.
 */
export function useCreateWard(): UseMutationResult<WardRow, QueryError, CreateWardInput> {
  const queryClient = useQueryClient();
  return useMutation<WardRow, QueryError, CreateWardInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/wards', {
          body: {
            branchId: INPATIENT_BRANCH_ID,
            name: input.name,
            code: input.code,
            floor: input.floor,
            description: input.description,
          },
        }),
      );
      const parsed = extractWardRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.ward;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

/** Creates a room in a ward `POST /wards/{id}/rooms` (201 `{ room }`). */
export function useCreateRoom(): UseMutationResult<RoomRow, QueryError, CreateRoomInput> {
  const queryClient = useQueryClient();
  return useMutation<RoomRow, QueryError, CreateRoomInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/wards/{id}/rooms', {
          params: { path: { id: input.wardId } },
          body: { name: input.name, description: input.description },
        }),
      );
      const parsed = extractRoomRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.room;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

/** Creates a bed in a room `POST /rooms/{id}/beds` (201 `{ bed }`). */
export function useCreateBed(): UseMutationResult<BedRow, QueryError, CreateBedInput> {
  const queryClient = useQueryClient();
  return useMutation<BedRow, QueryError, CreateBedInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/rooms/{id}/beds', {
          params: { path: { id: input.roomId } },
          body: { bedNumber: input.bedNumber },
        }),
      );
      const parsed = extractBedRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.bed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

export interface SetBedStatusInput {
  id: string;
  status: ManualBedStatus;
  /** The version the operator saw; a mismatch is a 409 the desk surfaces. */
  version: number;
}

/**
 * Sets a bed status `PATCH /beds/{id}/status` — an optimistic-lock write. The
 * service answers `{ bed }`; a version that has moved answers 409
 * `OPTIMISTIC_LOCK_CONFLICT`, surfaced in place. The ward reads are invalidated
 * because the board shows the same bed.
 */
export function useSetBedStatus(): UseMutationResult<BedRow, QueryError, SetBedStatusInput> {
  const queryClient = useQueryClient();
  return useMutation<BedRow, QueryError, SetBedStatusInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/beds/{id}/status', {
          params: { path: { id: input.id } },
          body: { status: input.status, version: input.version },
        }),
      );
      const parsed = extractBedRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError(200);
      return parsed.bed;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

// --- inpatient: admissions (F8 slice 2) -------------------------------------

/**
 * Admission list `GET /admissions?{filters}`. The export types the 200 as the
 * request DTO while the service answers a paginated envelope (GAP-020 family),
 * so it rides the raw-fetch path.
 */
export function useAdmissions(
  query: AdmissionQuery = {},
): UseQueryResult<Fetched<AdmissionPage>, QueryError> {
  return useQuery<Fetched<AdmissionPage>, QueryError>({
    queryKey: ['admissions', 'list', query.patientId ?? null, query.status ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchAdmissions(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AdmissionPage>;
      } catch (call) {
        throw toQueryError(call as InpatientCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single admission `GET /admissions/{id}` — its bed-assignment history and
 * discharge. The service answers `{ admission }` while the export types the bare
 * entity (GAP-020), so the unwrapped body is validated structurally.
 */
export function useAdmission(id: string): UseQueryResult<Fetched<AdmissionRow>, QueryError> {
  return useQuery<Fetched<AdmissionRow>, QueryError>({
    queryKey: ['admissions', id],
    queryFn: async ({ signal }) => {
      try {
        const admission = await fetchAdmission(id, signal);
        return {
          data: admission,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AdmissionRow>;
      } catch (call) {
        throw toQueryError(call as InpatientCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Admits a patient `POST /admissions` (201 `{ admission }`). The bed is
 * row-locked and marked `OCCUPIED` server-side, so both the admission reads and
 * the ward board are invalidated. A patient already admitted or an unavailable
 * bed answers 409.
 */
export function useAdmitPatient(): UseMutationResult<AdmissionRow, QueryError, CreateAdmissionInput> {
  const queryClient = useQueryClient();
  return useMutation<AdmissionRow, QueryError, CreateAdmissionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/admissions', {
          body: {
            patientId: input.patientId,
            branchId: input.branchId ?? INPATIENT_BRANCH_ID,
            bedId: input.bedId,
            departmentId: input.departmentId,
            encounterId: input.encounterId,
            provisionalDiagnosis: input.provisionalDiagnosis,
            expectedDischargeAt: input.expectedDischargeAt,
          },
        }),
      );
      const parsed = extractAdmissionRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.admission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissions'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

/**
 * Transfers an admission to another bed `POST /admissions/{id}/transfer` (201
 * `{ admission }`). The status is unchanged — the active assignment moves — and
 * the vacated bed and target bed change status, so the ward reads are invalidated
 * too. An unavailable target or a discharged admission answers 409.
 */
export function useTransferAdmission(): UseMutationResult<
  AdmissionRow,
  QueryError,
  TransferAdmissionInput
> {
  const queryClient = useQueryClient();
  return useMutation<AdmissionRow, QueryError, TransferAdmissionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/admissions/{id}/transfer', {
          params: { path: { id: input.id } },
          body: { toBedId: input.toBedId, reason: input.reason },
        }),
      );
      const parsed = extractAdmissionRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.admission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissions'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

/**
 * Discharges an admission `POST /admissions/{id}/discharge` (201
 * `{ admission }`). The active bed is released to `CLEANING` server-side, so the
 * ward reads are invalidated as well. An already-discharged admission answers 409
 * `INVALID_WORKFLOW_TRANSITION`.
 */
export function useDischargeAdmission(): UseMutationResult<
  AdmissionRow,
  QueryError,
  DischargeAdmissionInput
> {
  const queryClient = useQueryClient();
  return useMutation<AdmissionRow, QueryError, DischargeAdmissionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/admissions/{id}/discharge', {
          params: { path: { id: input.id } },
          body: {
            summary: input.summary,
            instructions: input.instructions,
            followUp: input.followUp,
            hasOutstandingBilling: input.hasOutstandingBilling,
            dischargedAt: input.dischargedAt,
          },
        }),
      );
      const parsed = extractAdmissionRecord(fetched.data);
      if (!parsed.ok) throw inpatientWriteError();
      return parsed.admission;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['admissions'] });
      queryClient.invalidateQueries({ queryKey: ['wards'] });
    },
  });
}

// --- emergency: ED desk (F8 slice 3) ----------------------------------------

/** A record body that fails structural validation is an internal contract break. */
function emergencyWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Emergency visit list `GET /emergency/visits?{filters}`. The export types the
 * 200 as the request DTO while the service answers a paginated envelope (GAP-020
 * family), so it rides the raw-fetch path.
 */
export function useEmergencyVisits(
  query: EmergencyVisitQuery = {},
): UseQueryResult<Fetched<EmergencyVisitPage>, QueryError> {
  return useQuery<Fetched<EmergencyVisitPage>, QueryError>({
    queryKey: [
      'emergency',
      'visits',
      query.patientId ?? null,
      query.status ?? null,
      query.priority ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchEmergencyVisits(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<EmergencyVisitPage>;
      } catch (call) {
        throw toQueryError(call as EmergencyCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single emergency visit `GET /emergency/visits/{id}`. The service answers
 * `{ visit }` while the export types the bare entity (GAP-020), so the unwrapped
 * body is validated structurally.
 */
export function useEmergencyVisit(id: string): UseQueryResult<Fetched<EmergencyVisitRow>, QueryError> {
  return useQuery<Fetched<EmergencyVisitRow>, QueryError>({
    queryKey: ['emergency', 'visits', id],
    queryFn: async ({ signal }) => {
      try {
        const visit = await fetchEmergencyVisit(id, signal);
        return {
          data: visit,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<EmergencyVisitRow>;
      } catch (call) {
        throw toQueryError(call as EmergencyCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Today's ED metrics `GET /emergency/summary`. The service answers the metrics
 * body; the export types it as the response DTO, so the body is validated
 * structurally.
 */
export function useEmergencySummary(): UseQueryResult<Fetched<EmergencySummaryRow>, QueryError> {
  return useQuery<Fetched<EmergencySummaryRow>, QueryError>({
    queryKey: ['emergency', 'summary'],
    queryFn: async ({ signal }) => {
      try {
        const summary = await fetchEmergencySummary(signal);
        return {
          data: summary,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<EmergencySummaryRow>;
      } catch (call) {
        throw toQueryError(call as EmergencyCallError);
      }
    },
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** A visit write that shares the emergency invalidation. */
function useEmergencyVisitWrite<TInput>(
  mutationFn: (input: TInput) => Promise<EmergencyVisitRow>,
  extraInvalidation?: readonly string[],
): UseMutationResult<EmergencyVisitRow, QueryError, TInput> {
  const queryClient = useQueryClient();
  return useMutation<EmergencyVisitRow, QueryError, TInput>({
    mutationFn,
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['emergency'] });
      if (extraInvalidation) {
        for (const key of extraInvalidation) {
          queryClient.invalidateQueries({ queryKey: [key] });
        }
      }
    },
  });
}

async function emergencyVisitWrite(
  call: PromiseLike<ApiCallResult> | ApiCallResult,
  status = 201,
): Promise<EmergencyVisitRow> {
  const fetched = await unwrap<unknown>(call);
  const parsed = extractEmergencyVisitRecord(fetched.data);
  if (!parsed.ok) throw emergencyWriteError(status);
  return parsed.visit;
}

/**
 * Registers an ED arrival `POST /emergency/visits` (201 `{ visit }`). The branch
 * is the EXAMPLE branch (GAP-018) unless one is supplied.
 */
export function useRegisterEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  RegisterEmergencyVisitInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits', {
        body: {
          patientId: input.patientId,
          branchId: input.branchId ?? EMERGENCY_BRANCH_ID,
          arrivedAt: input.arrivedAt,
        },
      }),
    ),
  );
}

/** Triages an arrival `POST /emergency/visits/{id}/triage` (201 `{ visit }`). */
export function useTriageEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  TriageEmergencyVisitInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/triage', {
        params: { path: { id: input.id } },
        body: { priority: input.priority, complaint: input.complaint },
      }),
    ),
  );
}

/**
 * Re-records triage priority `PATCH /emergency/visits/{id}/priority` (200
 * `{ visit }`), for a priority that changes later in the visit.
 */
export function useSetEmergencyPriority(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  SetEmergencyPriorityInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.PATCH('/emergency/visits/{id}/priority', {
        params: { path: { id: input.id } },
        body: { priority: input.priority },
      }),
      200,
    ),
  );
}

/** Records the assessment `POST /emergency/visits/{id}/assess` (201 `{ visit }`). */
export function useAssessEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  AssessEmergencyVisitInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/assess', {
        params: { path: { id: input.id } },
        body: { assessment: input.assessment },
      }),
    ),
  );
}

/** Starts treatment `POST /emergency/visits/{id}/treat` (201 `{ visit }`). */
export function useTreatEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  TreatEmergencyVisitInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/treat', {
        params: { path: { id: input.id } },
        body: { treatment: input.treatment },
      }),
    ),
  );
}

/** Moves a visit into observation `POST /emergency/visits/{id}/observe` (201). */
export function useObserveEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  { id: string }
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/observe', {
        params: { path: { id: input.id } },
      }),
    ),
  );
}

/**
 * Admits from the ED `POST /emergency/visits/{id}/admit` (201 `{ visit }`). The
 * service creates the inpatient admission in the same transaction and row-locks
 * the bed, so the admission and ward reads are invalidated too.
 */
export function useAdmitFromEmergency(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  AdmitFromEmergencyInput
> {
  return useEmergencyVisitWrite(
    (input) =>
      emergencyVisitWrite(
        api.POST('/emergency/visits/{id}/admit', {
          params: { path: { id: input.id } },
          body: {
            bedId: input.bedId,
            departmentId: input.departmentId,
            provisionalDiagnosis: input.provisionalDiagnosis,
            expectedDischargeAt: input.expectedDischargeAt,
          },
        }),
      ),
    ['admissions', 'wards'],
  );
}

/** Refers onward `POST /emergency/visits/{id}/refer` (201 `{ visit }`). */
export function useReferEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  ReferEmergencyVisitInput
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/refer', {
        params: { path: { id: input.id } },
        body: { referredTo: input.referredTo, referralNotes: input.referralNotes },
      }),
    ),
  );
}

/** Discharges from the ED `POST /emergency/visits/{id}/discharge` (201). */
export function useDischargeEmergencyVisit(): UseMutationResult<
  EmergencyVisitRow,
  QueryError,
  { id: string }
> {
  return useEmergencyVisitWrite((input) =>
    emergencyVisitWrite(
      api.POST('/emergency/visits/{id}/discharge', {
        params: { path: { id: input.id } },
      }),
    ),
  );
}

/** Declines a waitlist offer, re-offering the slot (`POST .../entries/{id}/decline`). */
export function useDeclineWaitlistOffer(): UseMutationResult<
  unknown,
  QueryError,
  { id: string; reason?: string }
> {
  const queryClient = useQueryClient();
  return useMutation<unknown, QueryError, { id: string; reason?: string }>({
    mutationFn: async ({ id, reason }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/waitlist/entries/{id}/decline', {
          params: { path: { id } },
          body: { ...(reason ? { reason } : {}) },
        }),
      );
      return fetched.data;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });
}

/** Removes a WAITING/OFFERED entry from the waitlist (`POST .../entries/{id}/leave`). */
export function useLeaveWaitlist(): UseMutationResult<WaitlistEntryRecord, QueryError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<WaitlistEntryRecord, QueryError, { id: string }>({
    mutationFn: async ({ id }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/waitlist/entries/{id}/leave', {
          params: { path: { id } },
        }),
      );
      const parsed = extractWaitlistRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.entry;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['waitlist'] });
    },
  });
}

export interface RescheduleAppointmentInput {
  id: string;
  startsAt: string;
  version: number;
  reason?: string;
}

/**
 * Reschedules an appointment (`POST /appointments/{id}/reschedule`).
 *
 * The API supersedes the original row (`status: RESCHEDULED`) and creates a
 * replacement, answering `{ appointment: replacement, superseded }`. The desk
 * reads the replacement straight back, so the moved appointment appears under its
 * new time without a refetch race. A terminal appointment answers 409
 * `INVALID_WORKFLOW_TRANSITION`.
 */
export function useRescheduleAppointment(): UseMutationResult<
  AppointmentRow,
  QueryError,
  RescheduleAppointmentInput
> {
  const queryClient = useQueryClient();
  return useMutation<AppointmentRow, QueryError, RescheduleAppointmentInput>({
    mutationFn: async ({ id, startsAt, version, reason }) => {
      const fetched = await unwrap<unknown>(
        api.POST('/appointments/{id}/reschedule', {
          params: { path: { id } },
          body: { startsAt, version, ...(reason ? { reason } : {}) },
        }),
      );
      const parsed = extractAppointmentRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.appointment;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['appointments'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

// --- vitals (F3: nursing) ----------------------------------------------------

/** A patient's vitals `GET /vitals` (unmodelled query, mis-typed body — GAP-017). */
export function useVitals(patientId: string): UseQueryResult<Fetched<VitalPage>, QueryError> {
  return useQuery<Fetched<VitalPage>, QueryError>({
    queryKey: ['vitals', 'list', patientId],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchVitals({ patientId }, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<VitalPage>;
      } catch (call) {
        throw toQueryError(call as VitalsCallError);
      }
    },
    enabled: patientId.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** The measurement values a record/correct body carries. */
export type VitalValues = Partial<Record<VitalMeasurementKey, number>>;

export interface RecordVitalInput {
  patientId: string;
  visitId?: string;
  observedAt?: string;
  values: VitalValues;
  notes?: string;
}

type VitalWriteBody = { patientId: string } & VitalValues & {
  visitId?: string;
  observedAt?: string;
  notes?: string;
};

/** Records a vitals observation (`POST /vitals`, 201, append-only). */
export function useRecordVital(): UseMutationResult<VitalRow, QueryError, RecordVitalInput> {
  const queryClient = useQueryClient();
  return useMutation<VitalRow, QueryError, RecordVitalInput>({
    mutationFn: async (input) => {
      const body: VitalWriteBody = { patientId: input.patientId, ...input.values };
      if (input.visitId) body.visitId = input.visitId;
      if (input.observedAt) body.observedAt = input.observedAt;
      if (input.notes?.trim()) body.notes = input.notes.trim();
      const fetched = await unwrap<unknown>(api.POST('/vitals', { body }));
      const parsed = extractVitalRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.record;
    },
    onSuccess: (_record, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vitals', 'list', variables.patientId] });
    },
  });
}

export interface CorrectVitalInput {
  id: string;
  patientId: string;
  correctionReason: string;
  values: VitalValues;
  notes?: string;
}

type VitalCorrectBody = { correctionReason: string } & VitalValues & { notes?: string };

/**
 * Corrects a vitals observation (`POST /vitals/{id}/correct`, 201).
 *
 * Append-only: the API writes a superseding record rather than editing, so the
 * original stays legible in the chart. `correctionReason` is mandatory.
 */
export function useCorrectVital(): UseMutationResult<VitalRow, QueryError, CorrectVitalInput> {
  const queryClient = useQueryClient();
  return useMutation<VitalRow, QueryError, CorrectVitalInput>({
    mutationFn: async (input) => {
      const body: VitalCorrectBody = { correctionReason: input.correctionReason, ...input.values };
      if (input.notes?.trim()) body.notes = input.notes.trim();
      const fetched = await unwrap<unknown>(
        api.POST('/vitals/{id}/correct', { params: { path: { id: input.id } }, body }),
      );
      const parsed = extractVitalRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.record;
    },
    onSuccess: (_record, variables) => {
      queryClient.invalidateQueries({ queryKey: ['vitals', 'list', variables.patientId] });
    },
  });
}

// --- schedule administration (F3) --------------------------------------------

/**
 * Weekly templates `GET /schedules/templates`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO (GAP-017), so this rides
 * the raw-fetch path in `src/lib/data/schedules.ts`.
 */
export function useTemplates(query: TemplateQuery = {}): UseQueryResult<Fetched<TemplatePage>, QueryError> {
  return useQuery<Fetched<TemplatePage>, QueryError>({
    queryKey: ['schedules', 'templates', query.providerId ?? null, query.departmentId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchTemplates(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<TemplatePage>;
      } catch (call) {
        throw toQueryError(call as SchedulesCallError);
      }
    },
    staleTime: 30_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

function templateBody(input: CreateTemplateInput) {
  return {
    providerId: input.providerId,
    branchId: input.branchId,
    departmentId: input.departmentId,
    dayOfWeek: input.dayOfWeek,
    startMinutes: input.startMinutes,
    endMinutes: input.endMinutes,
    slotDurationMinutes: input.slotDurationMinutes,
    capacity: input.capacity,
    isAvailable: input.isAvailable,
    ...(input.note ? { note: input.note } : {}),
  };
}

/** Creates a weekly template (`POST /schedules/templates`, 201). */
export function useCreateTemplate(): UseMutationResult<
  ScheduleTemplateRow,
  QueryError,
  CreateTemplateInput
> {
  const queryClient = useQueryClient();
  return useMutation<ScheduleTemplateRow, QueryError, CreateTemplateInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/schedules/templates', { body: templateBody(input) }),
      );
      const parsed = extractTemplateRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', 'templates'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

export interface UpdateTemplateInput extends CreateTemplateInput {
  id: string;
}

/** Updates a weekly template (`PATCH /schedules/templates/{id}`). */
export function useUpdateTemplate(): UseMutationResult<
  ScheduleTemplateRow,
  QueryError,
  UpdateTemplateInput
> {
  const queryClient = useQueryClient();
  return useMutation<ScheduleTemplateRow, QueryError, UpdateTemplateInput>({
    mutationFn: async ({ id, ...input }) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/schedules/templates/{id}', { params: { path: { id } }, body: templateBody(input) }),
      );
      const parsed = extractTemplateRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.template;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', 'templates'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

/** Deletes a weekly template (`DELETE /schedules/templates/{id}`, 204). */
export function useDeleteTemplate(): UseMutationResult<void, QueryError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, QueryError, { id: string }>({
    mutationFn: async ({ id }) => {
      await unwrapVoid(api.DELETE('/schedules/templates/{id}', { params: { path: { id } } }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['schedules', 'templates'] });
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

/**
 * Creates a date override (`POST /schedules/overrides`, 201).
 *
 * There is no list endpoint, so an override that already exists for the provider
 * and date answers 409 `CONFLICT` (see GAP-019).
 */
export function useCreateOverride(): UseMutationResult<
  ScheduleOverrideRow,
  QueryError,
  CreateOverrideInput
> {
  const queryClient = useQueryClient();
  return useMutation<ScheduleOverrideRow, QueryError, CreateOverrideInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/schedules/overrides', {
          body: {
            providerId: input.providerId,
            branchId: input.branchId,
            departmentId: input.departmentId,
            date: input.date,
            type: input.type,
            ...(input.startMinutes !== undefined ? { startMinutes: input.startMinutes } : {}),
            ...(input.endMinutes !== undefined ? { endMinutes: input.endMinutes } : {}),
            ...(input.slotDurationMinutes !== undefined
              ? { slotDurationMinutes: input.slotDurationMinutes }
              : {}),
            ...(input.capacity !== undefined ? { capacity: input.capacity } : {}),
            ...(input.note ? { note: input.note } : {}),
          },
        }),
      );
      const parsed = extractOverrideRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.override;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

export interface UpdateOverrideInput {
  id: string;
  type?: 'WORKING' | 'LEAVE' | 'HOLIDAY' | 'BLOCKED';
  startMinutes?: number | null;
  endMinutes?: number | null;
  slotDurationMinutes?: number | null;
  capacity?: number | null;
  note?: string | null;
}

/** Updates a date override (`PATCH /schedules/overrides/{id}`). */
export function useUpdateOverride(): UseMutationResult<
  ScheduleOverrideRow,
  QueryError,
  UpdateOverrideInput
> {
  const queryClient = useQueryClient();
  return useMutation<ScheduleOverrideRow, QueryError, UpdateOverrideInput>({
    mutationFn: async ({ id, ...body }) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/schedules/overrides/{id}', { params: { path: { id } }, body }),
      );
      const parsed = extractOverrideRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.override;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

/** Deletes a date override (`DELETE /schedules/overrides/{id}`, 204). */
export function useDeleteOverride(): UseMutationResult<void, QueryError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, QueryError, { id: string }>({
    mutationFn: async ({ id }) => {
      await unwrapVoid(api.DELETE('/schedules/overrides/{id}', { params: { path: { id } } }));
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['slots'] });
    },
  });
}

/** The branch every schedule-admin write posts, matching the desk (GAP-018). */
export const SCHEDULES_ADMIN_BRANCH_ID = SCHEDULES_BRANCH_ID;

// --- encounters (F4) --------------------------------------------------------

/**
 * Encounter list `GET /encounters?{filters}`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO (GAP-020), so this rides
 * the raw-fetch path in `src/lib/data/encounters.ts`.
 */
export function useEncounters(
  query: EncounterQuery = {},
): UseQueryResult<Fetched<EncounterPage>, QueryError> {
  return useQuery<Fetched<EncounterPage>, QueryError>({
    queryKey: [
      'encounters',
      'list',
      query.patientId ?? null,
      query.departmentId ?? null,
      query.status ?? null,
      query.type ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchEncounters(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<EncounterPage>;
      } catch (call) {
        throw toQueryError(call as EncountersCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single encounter `GET /encounters/{id}`. The export types the 200 as the bare
 * entity, but the service answers `{ encounter }`, so the unwrapped body is
 * validated structurally.
 */
export function useEncounter(id: string): UseQueryResult<Fetched<EncounterRow>, QueryError> {
  return useQuery<Fetched<EncounterRow>, QueryError>({
    queryKey: ['encounters', id],
    queryFn: () =>
      fetchPatientEnvelope<EncounterRow>(
        api.GET('/encounters/{id}', { params: { path: { id } } }),
        (body) => {
          const parsed = extractEncounterRecord(body);
          return parsed.ok ? { ok: true as const, data: parsed.encounter } : { ok: false as const };
        },
      ),
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface TransitionEncounterInput {
  id: string;
  status: EncounterStatus;
}

/**
 * Moves an encounter `PATCH /encounters/{id}/status`. The API validates the move
 * through the workflow engine, so a stale workspace that offers an edge the
 * server no longer allows gets 409 INVALID_WORKFLOW_TRANSITION, surfaced
 * in-place rather than as a generic failure.
 */
export function useTransitionEncounter(): UseMutationResult<
  EncounterRow,
  QueryError,
  TransitionEncounterInput
> {
  const queryClient = useQueryClient();
  return useMutation<EncounterRow, QueryError, TransitionEncounterInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/encounters/{id}/status', {
          params: { path: { id: input.id } },
          body: { status: input.status },
        }),
      );
      const parsed = extractEncounterRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.encounter;
    },
    onSuccess: (_encounter, variables) => {
      queryClient.invalidateQueries({ queryKey: ['encounters', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['encounters', 'list'] });
    },
  });
}

// --- clinical notes (F4) --------------------------------------------------

/**
 * Note list `GET /clinical-notes?{filters}`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO (GAP-020), so this rides
 * the raw-fetch path in `src/lib/data/clinical-notes.ts`.
 */
export function useClinicalNotes(
  query: NoteQuery = {},
): UseQueryResult<Fetched<NotePage>, QueryError> {
  return useQuery<Fetched<NotePage>, QueryError>({
    queryKey: [
      'clinical-notes',
      'list',
      query.patientId ?? null,
      query.encounterId ?? null,
      query.status ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchClinicalNotes(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<NotePage>;
      } catch (call) {
        throw toQueryError(call as ClinicalNotesCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Note template list `GET /clinical-notes/templates` (same GAP-020 drift).
 * Templates seed a new note's section headings, so the author writes to a
 * structure the department recognises instead of a blank page.
 */
export function useNoteTemplates(
  query: NoteTemplateQuery = {},
): UseQueryResult<Fetched<NoteTemplatePage>, QueryError> {
  return useQuery<Fetched<NoteTemplatePage>, QueryError>({
    queryKey: ['clinical-notes', 'templates', query.departmentId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchNoteTemplates(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<NoteTemplatePage>;
      } catch (call) {
        throw toQueryError(call as ClinicalNotesCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single note `GET /clinical-notes/{id}` with its full version history. The
 * export types the 200 as the bare entity, but the service answers `{ note }`,
 * so the unwrapped body is validated structurally.
 */
export function useClinicalNote(id: string): UseQueryResult<Fetched<NoteRow>, QueryError> {
  return useQuery<Fetched<NoteRow>, QueryError>({
    queryKey: ['clinical-notes', id],
    queryFn: () =>
      fetchPatientEnvelope<NoteRow>(
        api.GET('/clinical-notes/{id}', { params: { path: { id } } }),
        (body) => {
          const parsed = extractNoteRecord(body);
          return parsed.ok ? { ok: true as const, data: parsed.note } : { ok: false as const };
        },
      ),
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface CreateNoteInput {
  encounterId: string;
  title?: string;
  sections?: NoteSections;
  templateId?: string;
}

/**
 * Creates a DRAFT note `POST /clinical-notes`. The service answers `{ note }`
 * while the export types the bare entity, so the unwrapped body is validated
 * structurally. The encounter must be OPEN or IN_PROGRESS; a completed one
 * answers 409 INVALID_WORKFLOW_TRANSITION, which the panel treats as locked.
 */
export function useCreateNote(): UseMutationResult<NoteRow, QueryError, CreateNoteInput> {
  const queryClient = useQueryClient();
  return useMutation<NoteRow, QueryError, CreateNoteInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/clinical-notes', {
          body: {
            encounterId: input.encounterId,
            title: input.title,
            sections: input.sections,
            templateId: input.templateId,
          },
        }),
      );
      const parsed = extractNoteRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.note;
    },
    onSuccess: (_note) => {
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', 'list'] });
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', 'templates'] });
    },
  });
}

export interface UpdateNoteInput {
  id: string;
  title?: string;
  sections?: NoteSections;
}

/** Edits a DRAFT note in place `PATCH /clinical-notes/{id}`. */
export function useUpdateNote(): UseMutationResult<NoteRow, QueryError, UpdateNoteInput> {
  const queryClient = useQueryClient();
  return useMutation<NoteRow, QueryError, UpdateNoteInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/clinical-notes/{id}', {
          params: { path: { id: input.id } },
          body: { title: input.title, sections: input.sections },
        }),
      );
      const parsed = extractNoteRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 200, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.note;
    },
    onSuccess: (_note, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', 'list'] });
    },
  });
}

export interface FinalizeNoteInput {
  id: string;
}

/** Finalizes a DRAFT note `POST /clinical-notes/{id}/finalize` (writes the ORIGINAL version). */
export function useFinalizeNote(): UseMutationResult<NoteRow, QueryError, FinalizeNoteInput> {
  const queryClient = useQueryClient();
  return useMutation<NoteRow, QueryError, FinalizeNoteInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/clinical-notes/{id}/finalize', {
          params: { path: { id: input.id } },
          body: {},
        }),
      );
      const parsed = extractNoteRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.note;
    },
    onSuccess: (_note, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', 'list'] });
    },
  });
}

export interface AmendNoteInput {
  id: string;
  title?: string;
  sections: NoteSections;
  reason: string;
}

/**
 * Amends a FINAL note `POST /clinical-notes/{id}/amend`. The reason is
 * mandatory; the service appends a superseding version and never edits the
 * finalized snapshot in place.
 */
export function useAmendNote(): UseMutationResult<NoteRow, QueryError, AmendNoteInput> {
  const queryClient = useQueryClient();
  return useMutation<NoteRow, QueryError, AmendNoteInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/clinical-notes/{id}/amend', {
          params: { path: { id: input.id } },
body: { title: input.title, sections: input.sections, reason: input.reason },
      }),
      );
      const parsed = extractNoteRecord(fetched.data);
      if (!parsed.ok) {
        throw { code: 'INTERNAL_ERROR', status: 201, resolved: resolveApiError('INTERNAL_ERROR') } satisfies QueryError;
      }
      return parsed.note;
    },
    onSuccess: (_note, variables) => {
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['clinical-notes', 'list'] });
    },
  });
}

// --- prescriptions (F4) ---------------------------------------------------

/**
 * Prescription list `GET /prescriptions?{filters}`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO (GAP-020), so this rides
 * the raw-fetch path in `src/lib/data/prescriptions.ts`.
 */
export function usePrescriptions(
  query: { patientId?: string; branchId?: string; providerId?: string; status?: PrescriptionStatus } = {},
): UseQueryResult<Fetched<{ items: readonly PrescriptionRow[]; total: number }>, QueryError> {
  return useQuery<Fetched<{ items: readonly PrescriptionRow[]; total: number }>, QueryError>({
    queryKey: [
      'prescriptions',
      'list',
      query.patientId ?? null,
      query.branchId ?? null,
      query.providerId ?? null,
      query.status ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPrescriptions(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<{
          items: readonly PrescriptionRow[];
          total: number;
        }>;
      } catch (call) {
        throw toQueryError(call as PrescriptionsCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

export interface PrescriptionLineInput {
  medicationId: string;
  quantity: number;
  dosage?: string;
  frequency?: string;
  durationDays?: number;
  instructions?: string;
}

export interface CreatePrescriptionInput {
  patientId: string;
  notes?: string;
  items: PrescriptionLineInput[];
}

/**
 * Creates a DRAFT prescription `POST /prescriptions`. The service answers
 * `{ prescription }` while the export types the bare entity, so the unwrapped
 * body is validated structurally.
 */
export function useCreatePrescription(): UseMutationResult<
  PrescriptionRow,
  QueryError,
  CreatePrescriptionInput
> {
  const queryClient = useQueryClient();
  return useMutation<PrescriptionRow, QueryError, CreatePrescriptionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/prescriptions', {
          body: {
            patientId: input.patientId,
            notes: input.notes,
            items: input.items.map((item) => ({
              medicationId: item.medicationId,
              quantity: item.quantity,
              dosage: item.dosage,
              frequency: item.frequency,
              durationDays: item.durationDays,
              instructions: item.instructions,
            })),
          },
        }),
      );
      const parsed = extractPrescriptionRecord(fetched.data);
      if (!parsed.ok) {
        throw {
          code: 'INTERNAL_ERROR',
          status: 201,
          resolved: resolveApiError('INTERNAL_ERROR'),
        } satisfies QueryError;
      }
      return parsed.prescription;
    },
    onSuccess: (_prescription) => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions', 'list'] });
    },
  });
}

export interface PrescriptionActionInput {
  id: string;
  action: 'issue' | 'cancel';
  cancelReason?: string;
}

/**
 * Issues (DRAFT → ISSUED) or cancels a prescription
 * `POST /prescriptions/{id}/action`. Dispensing is a pharmacy step and is not
 * offered to the doctor. A stale action answers 409
 * INVALID_WORKFLOW_TRANSITION, surfaced in place.
 */
export function usePrescriptionAction(): UseMutationResult<
  PrescriptionRow,
  QueryError,
  PrescriptionActionInput
> {
  const queryClient = useQueryClient();
  return useMutation<PrescriptionRow, QueryError, PrescriptionActionInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/prescriptions/{id}/action', {
          params: { path: { id: input.id } },
          body: {
            action: input.action,
            cancelReason: input.action === 'cancel' ? input.cancelReason : undefined,
          },
        }),
      );
      const parsed = extractPrescriptionRecord(fetched.data);
      if (!parsed.ok) {
        throw {
          code: 'INTERNAL_ERROR',
          status: 201,
          resolved: resolveApiError('INTERNAL_ERROR'),
        } satisfies QueryError;
      }
      return parsed.prescription;
    },
    onSuccess: (_prescription, variables) => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['prescriptions', 'list'] });
    },
  });
}

// --- medication catalog (F4) -----------------------------------------------

/**
 * Medication catalog `GET /medications?{filters}` (same GAP-020 drift as the
 * prescription list). The composer picks medications from here.
 */
export function useMedications(
  query: MedicationQuery = {},
): UseQueryResult<Fetched<{ items: readonly MedicationRow[]; total: number }>, QueryError> {
  return useQuery<Fetched<{ items: readonly MedicationRow[]; total: number }>, QueryError>({
    queryKey: [
      'medications',
      'list',
      query.category ?? null,
      query.isActive ?? null,
      query.search ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchMedications(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<{
          items: readonly MedicationRow[];
          total: number;
        }>;
      } catch (call) {
        throw toQueryError(call as MedicationsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Resolves a medication display name from `GET /medications/{id}`.
 *
 * Prescription lines carry only `medicationId` (GAP-018-style), so cards name
 * each line with this lookup, cached by React Query and deduped by id.
 */
export function useMedicationName(id: string): UseQueryResult<Fetched<string>, QueryError> {
  return useQuery<Fetched<string>, QueryError>({
    queryKey: ['medications', id, 'name'],
    queryFn: () =>
      fetchPatientEnvelope<string>(api.GET('/medications/{id}', { params: { path: { id } } }), (body) => {
        const parsed = extractMedicationRecord(body);
        if (!parsed.ok) return { ok: false as const };
        return { ok: true as const, data: parsed.medication.name };
      }),
    enabled: id.length > 0,
    staleTime: 5 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

// --- laboratory results (F4) -----------------------------------------------

/**
 * Lab order list `GET /lab/orders?{filters}` for the results view. The list is a
 * thin projection — no results, no test names — so result-bearing orders are
 * fetched by id with `useLabOrder`. The export leaves the query unmodelled and
 * mis-types the 200 (GAP-020), so this rides the raw-fetch path.
 */
export function useLabOrders(
  query: LabOrderQuery = {},
): UseQueryResult<Fetched<LabOrderPage>, QueryError> {
  return useQuery<Fetched<LabOrderPage>, QueryError>({
    queryKey: ['lab-orders', 'list', query.patientId ?? null, query.branchId ?? null, query.status ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchLabOrders(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<LabOrderPage>;
      } catch (call) {
        throw toQueryError(call as LaboratoryCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Full lab order `GET /lab/orders/{id}` — the one read that carries test names,
 * results and critical flags. The service answers `{ order }` while the export
 * types the bare entity, so the unwrapped body is validated structurally.
 */
export function useLabOrder(id: string): UseQueryResult<Fetched<LabOrderDetail>, QueryError> {
  return useQuery<Fetched<LabOrderDetail>, QueryError>({
    queryKey: ['lab-orders', id],
    queryFn: () =>
      fetchPatientEnvelope<LabOrderDetail>(api.GET('/lab/orders/{id}', { params: { path: { id } } }), (body) => {
        const parsed = extractLabOrderRecord(body);
        if (!parsed.ok) return { ok: false as const };
        return { ok: true as const, data: parsed.order };
      }),
    enabled: id.length > 0,
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Lab test catalog `GET /lab/tests?{filters}` — the source of the field metadata
 * (analyte name, unit, reference range) that a result omits. Shared and cached,
 * so every result card names its fields from one fetch.
 */
export function useLabTests(
  query: LabTestsQuery = {},
): UseQueryResult<Fetched<LabTestPage>, QueryError> {
  return useQuery<Fetched<LabTestPage>, QueryError>({
    queryKey: ['lab-tests', 'list', query.active ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchLabTests(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<LabTestPage>;
      } catch (call) {
        throw toQueryError(call as LaboratoryCallError);
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

// --- laboratory worklist actions (F5) --------------------------------------

/** A record body that fails structural validation is an internal contract break. */
function labWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

export interface CreateLabOrderInput {
  patientId: string;
  branchId: string;
  encounterId?: string;
  priority?: LabOrderPriority;
  clinicalNotes?: string;
  testIds: readonly string[];
}

/**
 * Places a laboratory order (`POST /lab/orders`) for the encounter's patient.
 * The export types the 201 body as the bare entity while the service answers
 * `{ order }`, so the unwrapped body is validated structurally (GAP-020). The
 * list and detail reads are invalidated so the doctor's results panel and the
 * laboratory worklist both pick the new order up.
 */
export function useCreateLabOrder(): UseMutationResult<
  LabOrderDetail,
  QueryError,
  CreateLabOrderInput
> {
  const queryClient = useQueryClient();
  return useMutation<LabOrderDetail, QueryError, CreateLabOrderInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/lab/orders', {
          body: {
            patientId: input.patientId,
            branchId: input.branchId,
            encounterId: input.encounterId,
            priority: input.priority,
            clinicalNotes: input.clinicalNotes,
            testIds: [...input.testIds],
          },
        }),
      );
      const parsed = extractLabOrderRecord(fetched.data);
      if (!parsed.ok) throw labWriteError();
      return parsed.order;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    },
  });
}

export interface LabOrderTransitionInput {
  id: string;
  action: LabOrderTransition;
  /** `reject` and `cancel` capture a reason; every other move takes none. */
  reason?: string;
}

export interface EnterLabResultsInput {
  id: string;
  comments?: string;
  results: readonly { testFieldId: string; value: string }[];
}

export interface AmendLabResultInput {
  id: string;
  value: string;
  reason: string;
}

export interface AcknowledgeCriticalInput {
  id: string;
  note?: string;
}

/**
 * Advances an order along the sample/verification pipeline
 * (`POST /lab/orders/{id}/{collect|receive|process|reject|cancel|verify|release}`).
 *
 * The transition set is the server's (`LAB_ORDER_ACTIONS_BY_STATUS`), and the
 * export types the 201 body as the bare entity while the service answers
 * `{ order }` — so the unwrapped body is validated structurally (GAP-020). A
 * move the server refuses (stale status, unacknowledged criticals) rejects with
 * the mapped code in place, never a thrown string.
 */
export function useLabOrderTransition(): UseMutationResult<
  LabOrderDetail,
  QueryError,
  LabOrderTransitionInput
> {
  const queryClient = useQueryClient();
  return useMutation<LabOrderDetail, QueryError, LabOrderTransitionInput>({
    mutationFn: async (input) => {
      const params = { path: { id: input.id } };
      const call =
        input.action === 'collect'
          ? api.POST('/lab/orders/{id}/collect', { params })
          : input.action === 'receive'
            ? api.POST('/lab/orders/{id}/receive', { params })
            : input.action === 'process'
              ? api.POST('/lab/orders/{id}/process', { params })
              : input.action === 'reject'
                ? api.POST('/lab/orders/{id}/reject', {
                    params,
                    body: { reason: input.reason ?? '' },
                  })
                : input.action === 'cancel'
                  ? api.POST('/lab/orders/{id}/cancel', {
                      params,
                      body: { reason: input.reason ?? '' },
                    })
                  : input.action === 'verify'
                    ? api.POST('/lab/orders/{id}/verify', { params })
                    : api.POST('/lab/orders/{id}/release', { params });
      const fetched = await unwrap<unknown>(call);
      const parsed = extractLabOrderRecord(fetched.data);
      if (!parsed.ok) throw labWriteError();
      return parsed.order;
    },
    onSuccess: (_order, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['lab-orders', 'list'] });
    },
  });
}

/**
 * Enters the first set of results for a PROCESSING order
 * (`POST /lab/orders/{id}/results`). The server classifies each value against
 * the field's configured thresholds and raises a critical notification where one
 * applies; the caller submits values verbatim and never decides abnormality.
 */
export function useEnterLabResults(): UseMutationResult<
  LabOrderDetail,
  QueryError,
  EnterLabResultsInput
> {
  const queryClient = useQueryClient();
  return useMutation<LabOrderDetail, QueryError, EnterLabResultsInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/lab/orders/{id}/results', {
          params: { path: { id: input.id } },
          body: {
            comments: input.comments,
            results: input.results.map((result) => ({
              testFieldId: result.testFieldId,
              value: result.value,
            })),
          },
        }),
      );
      const parsed = extractLabOrderRecord(fetched.data);
      if (!parsed.ok) throw labWriteError();
      return parsed.order;
    },
    onSuccess: (_order, variables) => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['lab-orders', 'list'] });
    },
  });
}

/**
 * Amends one result (`PATCH /lab/results/{id}`). Pre-release this fixes the
 * single revision; post-release it appends a new one. The reason is stored on
 * the version either way, which is why it is required rather than optional.
 */
export function useAmendLabResult(): UseMutationResult<
  LabResultRow,
  QueryError,
  AmendLabResultInput
> {
  const queryClient = useQueryClient();
  return useMutation<LabResultRow, QueryError, AmendLabResultInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/lab/results/{id}', {
          params: { path: { id: input.id } },
          body: { value: input.value, reason: input.reason },
        }),
      );
      const body = fetched.data as { result?: unknown } | null;
      const result = readLabResult(body?.result);
      if (!result) throw labWriteError(200);
      return result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    },
  });
}

/**
 * Acknowledges a critical result (`POST /lab/critical/{id}/acknowledge`).
 * Idempotent server-side, so the button is safe to re-submit; release stays
 * blocked until every critical on the order carries an acknowledgement.
 */
export function useAcknowledgeCritical(): UseMutationResult<
  CriticalResultRow,
  QueryError,
  AcknowledgeCriticalInput
> {
  const queryClient = useQueryClient();
  return useMutation<CriticalResultRow, QueryError, AcknowledgeCriticalInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/lab/critical/{id}/acknowledge', {
          params: { path: { id: input.id } },
          body: { note: input.note },
        }),
      );
      const body = fetched.data as { criticalResult?: unknown } | null;
      const critical = readCriticalResult(body?.criticalResult);
      if (!critical) throw labWriteError(201);
      return critical;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['lab-orders'] });
    },
  });
}

// --- radiology results (F4) ------------------------------------------------

/**
 * Radiology order list `GET /radiology/orders?{filters}`. Unlike the lab list,
 * each row serializes its imaging report, so this list alone backs the imaging
 * results section. Same GAP-020 drift, so it rides the raw-fetch path.
 */
export function useRadiologyOrders(
  query: RadiologyOrderQuery = {},
): UseQueryResult<Fetched<RadiologyOrderPage>, QueryError> {
  return useQuery<Fetched<RadiologyOrderPage>, QueryError>({
    queryKey: [
      'radiology-orders',
      'list',
      query.patientId ?? null,
      query.branchId ?? null,
      query.status ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchRadiologyOrders(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<RadiologyOrderPage>;
      } catch (call) {
        throw toQueryError(call as RadiologyCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

// --- radiology worklist actions (F5) ---------------------------------------

/** A record body that fails structural validation is an internal contract break. */
function radiologyWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

export interface CreateRadiologyOrderInput {
  patientId: string;
  branchId: string;
  encounterId?: string;
  modality: ImagingModality;
  region?: string;
  clinicalNotes?: string;
}

/**
 * Places an imaging order (`POST /radiology/orders`) for the encounter's
 * patient. The export types the 201 body as the bare entity while the service
 * answers `{ order }`, so the unwrapped body is validated structurally
 * (GAP-020). The list and detail reads are invalidated so the doctor's results
 * panel and the radiology worklist both pick the new order up.
 */
export function useCreateRadiologyOrder(): UseMutationResult<
  RadiologyOrderRow,
  QueryError,
  CreateRadiologyOrderInput
> {
  const queryClient = useQueryClient();
  return useMutation<RadiologyOrderRow, QueryError, CreateRadiologyOrderInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/radiology/orders', {
          body: {
            patientId: input.patientId,
            branchId: input.branchId,
            encounterId: input.encounterId,
            modality: input.modality,
            region: input.region,
            clinicalNotes: input.clinicalNotes,
          },
        }),
      );
      const parsed = extractRadiologyOrderRecord(fetched.data);
      if (!parsed.ok) throw radiologyWriteError();
      return parsed.order;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['radiology-orders'] });
    },
  });
}

export interface RadiologyOrderTransitionInput {
  id: string;
  action: RadiologyOrderTransition;
  /** `cancel` captures a reason; every other move takes none. */
  reason?: string;
}

export interface SubmitImagingReportInput {
  id: string;
  findings: string;
  summary?: string;
  impression?: string;
}

/**
 * Full radiology order `GET /radiology/orders/{id}` — the workspace read. The
 * service answers `{ order }` while the export types the bare entity, so the
 * unwrapped body is validated structurally (GAP-020).
 */
export function useRadiologyOrder(
  id: string,
): UseQueryResult<Fetched<RadiologyOrderRow>, QueryError> {
  return useQuery<Fetched<RadiologyOrderRow>, QueryError>({
    queryKey: ['radiology-orders', id],
    queryFn: () =>
      fetchPatientEnvelope<RadiologyOrderRow>(
        api.GET('/radiology/orders/{id}', { params: { path: { id } } }),
        (body) => {
          const parsed = extractRadiologyOrderRecord(body);
          if (!parsed.ok) return { ok: false as const };
          return { ok: true as const, data: parsed.order };
        },
      ),
    enabled: id.length > 0,
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Advances an order along the imaging pipeline
 * (`POST /radiology/orders/{id}/{schedule|perform|verify|release|cancel}`).
 *
 * The transition set is the server's (`RADIOLOGY_ORDER_ACTIONS_BY_STATUS`), and
 * the export types the 201 body as the bare entity while the service answers
 * `{ order }` — so the unwrapped body is validated structurally (GAP-020). A move
 * the server refuses (stale status) rejects with the mapped code in place, never
 * a thrown string.
 */
export function useRadiologyOrderTransition(): UseMutationResult<
  RadiologyOrderRow,
  QueryError,
  RadiologyOrderTransitionInput
> {
  const queryClient = useQueryClient();
  return useMutation<RadiologyOrderRow, QueryError, RadiologyOrderTransitionInput>({
    mutationFn: async (input) => {
      const params = { path: { id: input.id } };
      const call =
        input.action === 'schedule'
          ? api.POST('/radiology/orders/{id}/schedule', { params })
          : input.action === 'perform'
            ? api.POST('/radiology/orders/{id}/perform', { params })
            : input.action === 'verify'
              ? api.POST('/radiology/orders/{id}/verify', { params })
              : input.action === 'release'
                ? api.POST('/radiology/orders/{id}/release', { params })
                : api.POST('/radiology/orders/{id}/cancel', {
                    params,
                    body: { reason: input.reason ?? '' },
                  });
      const fetched = await unwrap<unknown>(call);
      const parsed = extractRadiologyOrderRecord(fetched.data);
      if (!parsed.ok) throw radiologyWriteError();
      return parsed.order;
    },
    onSuccess: (_order, variables) => {
      queryClient.invalidateQueries({ queryKey: ['radiology-orders', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['radiology-orders', 'list'] });
    },
  });
}

/**
 * Writes the imaging report (`POST /radiology/orders/{id}/report`) for an order
 * in PERFORMED. `findings` is required; `summary` and `impression` are optional.
 * The move is one-way to REPORTED; verification and release follow.
 */
export function useSubmitImagingReport(): UseMutationResult<
  RadiologyOrderRow,
  QueryError,
  SubmitImagingReportInput
> {
  const queryClient = useQueryClient();
  return useMutation<RadiologyOrderRow, QueryError, SubmitImagingReportInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/radiology/orders/{id}/report', {
          params: { path: { id: input.id } },
          body: {
            findings: input.findings,
            summary: input.summary,
            impression: input.impression,
          },
        }),
      );
      const parsed = extractRadiologyOrderRecord(fetched.data);
      if (!parsed.ok) throw radiologyWriteError();
      return parsed.order;
    },
    onSuccess: (_order, variables) => {
      queryClient.invalidateQueries({ queryKey: ['radiology-orders', variables.id] });
      queryClient.invalidateQueries({ queryKey: ['radiology-orders', 'list'] });
    },
  });
}

// --- pharmacy inventory (F6) -----------------------------------------------

/**
 * Current stock on hand per medication/branch `GET /pharmacy/stock/on-hand`.
 * The export leaves the query unmodelled and mis-types the 200 as the request
 * DTO (GAP-020), so this rides the raw-fetch path in `src/lib/data/inventory.ts`.
 */
export function useStockOnHand(
  query: { branchId?: string } = {},
): UseQueryResult<Fetched<readonly StockOnHandRow[]>, QueryError> {
  return useQuery<Fetched<readonly StockOnHandRow[]>, QueryError>({
    queryKey: ['inventory', 'on-hand', query.branchId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const rows = await fetchStockOnHand(query, signal);
        return { data: rows, response: new Response(null, { status: 200 }) } satisfies Fetched<
          readonly StockOnHandRow[]
        >;
      } catch (call) {
        throw toQueryError(call as InventoryCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** A dispense body that fails structural validation is an internal contract break. */
function inventoryWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Dispenses a prescription `POST /pharmacy/stock/dispense`. The service answers
 * a bare `{ prescriptionStatus, dispensedLines }` while the export fastens the
 * `InventoryResponseDto` to the 201 (GAP-020), so the unwrapped body is
 * validated structurally. Both the prescription list and the on-hand read are
 * invalidated — the prescription moves to DISPENSED/PARTIALLY_DISPENSED and the
 * branch's stock is decremented FEFO.
 */
export function useDispensePrescription(): UseMutationResult<
  DispenseResult,
  QueryError,
  DispenseInput
> {
  const queryClient = useQueryClient();
  return useMutation<DispenseResult, QueryError, DispenseInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/pharmacy/stock/dispense', {
          body: {
            prescriptionId: input.prescriptionId,
            branchId: input.branchId,
            lines: input.lines.map((line) => ({
              medicationId: line.medicationId,
              quantity: line.quantity,
            })),
          },
        }),
      );
      const parsed = readDispenseResult(fetched.data);
      if (!parsed.ok) throw inventoryWriteError();
      return parsed.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['prescriptions'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'on-hand'] });
    },
  });
}

/**
 * Stock-risk advisories `GET /pharmacy/stock/alerts`. The export leaves the query
 * unmodelled and mis-types the 200 as the request DTO while the service answers
 * `{ alerts: [...] }` (GAP-020), so this rides the raw-fetch path.
 */
export function useStockAlerts(
  query: { branchId?: string } = {},
): UseQueryResult<Fetched<readonly StockAlertRow[]>, QueryError> {
  return useQuery<Fetched<readonly StockAlertRow[]>, QueryError>({
    queryKey: ['inventory', 'alerts', query.branchId ?? null],
    queryFn: async ({ signal }) => {
      try {
        const alerts = await fetchStockAlerts(query, signal);
        return { data: alerts, response: new Response(null, { status: 200 }) } satisfies Fetched<
          readonly StockAlertRow[]
        >;
      } catch (call) {
        throw toQueryError(call as InventoryCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Receives stock into a branch `POST /pharmacy/stock/receive`: creates or tops up
 * a batch and writes a RECEIVED ledger entry per line. The service answers a bare
 * `{ batches: [...] }` while the export types the 201 as `InventoryResponseDto`
 * (GAP-020), so the unwrapped body is validated through `readReceiveResult`. The
 * on-hand and alerts reads are invalidated because both are derived from the
 * ledger this write grows.
 */
export function useReceiveStock(): UseMutationResult<
  readonly ReceivedBatch[],
  QueryError,
  ReceiveStockInput
> {
  const queryClient = useQueryClient();
  return useMutation<readonly ReceivedBatch[], QueryError, ReceiveStockInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/pharmacy/stock/receive', {
          body: {
            branchId: input.branchId,
            lines: input.lines.map((line) => ({
              medicationId: line.medicationId,
              quantity: line.quantity,
              batchNumber: line.batchNumber,
              ...(line.expiryDate ? { expiryDate: line.expiryDate } : {}),
              ...(line.unitCost !== undefined ? { unitCost: line.unitCost } : {}),
            })),
          },
        }),
      );
      const parsed = readReceiveResult(fetched.data);
      if (!parsed.ok) throw inventoryWriteError();
      return parsed.batches;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'on-hand'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'alerts'] });
    },
  });
}

/**
 * Records wastage `POST /pharmacy/stock/write-off`: FEFO-allocates each line
 * across the branch's batches and writes a WASTAGE ledger entry per allocation.
 * The export declares no response type for the 201, but the service answers a
 * bare `{ writeOffId, branchId, quantity }`, validated through
 * `readWriteOffResult`. The on-hand and alerts reads are invalidated because the
 * write shrinks the ledger both are derived from.
 */
export function useWriteOffStock(): UseMutationResult<
  WriteOffResult,
  QueryError,
  WriteOffInput
> {
  const queryClient = useQueryClient();
  return useMutation<WriteOffResult, QueryError, WriteOffInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/pharmacy/stock/write-off', {
          body: {
            branchId: input.branchId,
            reason: input.reason,
            lines: input.lines.map((line) => ({
              medicationId: line.medicationId,
              quantity: line.quantity,
            })),
          },
        }),
      );
      const parsed = readWriteOffResult(fetched.data);
      if (!parsed.ok) throw inventoryWriteError();
      return parsed.result;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['inventory', 'on-hand'] });
      queryClient.invalidateQueries({ queryKey: ['inventory', 'alerts'] });
    },
  });
}

// --- administration (F9: users and roles) -----------------------------------

function adminWriteError(status = 201): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * User roster `GET /users?{filters}`. The export types the 200 as the request DTO
 * while the service answers a paginated envelope (GAP-020 family), so it rides
 * the raw-fetch path.
 */
export function useUsers(query: UserQuery = {}): UseQueryResult<Fetched<UserPage>, QueryError> {
  return useQuery<Fetched<UserPage>, QueryError>({
    queryKey: ['users', 'list', query.status ?? null, query.q ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchUsers(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<UserPage>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single user `GET /users/{id}`. The service answers `{ user }` while the export
 * types the bare entity (GAP-020), so the unwrapped body is validated.
 */
export function useUser(id: string): UseQueryResult<Fetched<UserRow>, QueryError> {
  return useQuery<Fetched<UserRow>, QueryError>({
    queryKey: ['users', id],
    queryFn: async ({ signal }) => {
      try {
        const user = await fetchUser(id, signal);
        return { data: user, response: new Response(null, { status: 200 }) } satisfies Fetched<UserRow>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/** Role roster `GET /roles?{filters}` (GAP-020: the 200 is the query DTO). */
export function useRoles(query: RoleQuery = {}): UseQueryResult<Fetched<RolePage>, QueryError> {
  return useQuery<Fetched<RolePage>, QueryError>({
    queryKey: ['roles', 'list', query.q ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchRoles(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<RolePage>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Role/permission catalog `GET /roles/permissions`, used to build the role
 * picker and (later) the custom-role editor.
 */
export function useRoleCatalog(): UseQueryResult<Fetched<RoleCatalog>, QueryError> {
  return useQuery<Fetched<RoleCatalog>, QueryError>({
    queryKey: ['roles', 'catalog'],
    queryFn: async ({ signal }) => {
      try {
        const catalog = await fetchRoleCatalog(signal);
        return { data: catalog, response: new Response(null, { status: 200 }) } satisfies Fetched<RoleCatalog>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    staleTime: 5 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Invites a user `POST /users` (201 `{ user, inviteToken? }`). `inviteToken` is
 * only present in dev/test; a real deployment delivers it out of band. The
 * caller's own branch is not inferred — none is sent unless one is given
 * (GAP-018).
 */
export function useInviteUser(): UseMutationResult<InvitedUser, QueryError, InviteUserInput> {
  const queryClient = useQueryClient();
  return useMutation<InvitedUser, QueryError, InviteUserInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/users', {
          body: {
            email: input.email,
            firstName: input.firstName,
            lastName: input.lastName,
            ...(input.otherNames ? { otherNames: input.otherNames } : {}),
            ...(input.phone ? { phone: input.phone } : {}),
            ...(input.roleIds && input.roleIds.length > 0 ? { roleIds: [...input.roleIds] } : {}),
            ...(input.branchIds && input.branchIds.length > 0
              ? { branchIds: [...input.branchIds] }
              : {}),
            ...(input.departmentIds && input.departmentIds.length > 0
              ? { departmentIds: [...input.departmentIds] }
              : {}),
            ...(input.staff
              ? {
                  staff: {
                    staffNumber: input.staff.staffNumber,
                    ...(input.staff.professionalTitle
                      ? { professionalTitle: input.staff.professionalTitle }
                      : {}),
                    ...(input.staff.specialization
                      ? { specialization: input.staff.specialization }
                      : {}),
                    employmentStatus: input.staff.employmentStatus ?? 'ACTIVE',
                    ...(input.staff.licenseNumber
                      ? { licenseNumber: input.staff.licenseNumber }
                      : {}),
                  },
                }
              : {}),
          },
        }),
      );
      const parsed = extractInvitedUser(fetched.data);
      if (!parsed.ok) throw adminWriteError();
      return parsed.invited;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Updates a user `PATCH /users/{id}` (200 `{ user }`). A status change that
 * strips access also revokes the user's sessions server-side.
 */
export function useUpdateUser(): UseMutationResult<UserRow, QueryError, UpdateUserInput> {
  const queryClient = useQueryClient();
  return useMutation<UserRow, QueryError, UpdateUserInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/users/{id}', {
          params: { path: { id: input.id } },
          body: {
            ...(input.firstName !== undefined ? { firstName: input.firstName } : {}),
            ...(input.lastName !== undefined ? { lastName: input.lastName } : {}),
            ...(input.otherNames !== undefined ? { otherNames: input.otherNames } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.status !== undefined ? { status: input.status } : {}),
          },
        }),
      );
      const parsed = extractUserRecord(fetched.data);
      if (!parsed.ok) throw adminWriteError(200);
      return parsed.user;
    },
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.setQueryData(['users', user.id], (previous: unknown) =>
        previous ? { ...(previous as object), data: user } : previous,
      );
    },
  });
}

/**
 * Replaces a user's role set `POST /users/{id}/roles` (200 `{ user }`). The
 * service rejects privilege escalation beyond the caller's own permissions.
 */
export function useSetUserRoles(): UseMutationResult<UserRow, QueryError, SetUserRolesInput> {
  const queryClient = useQueryClient();
  return useMutation<UserRow, QueryError, SetUserRolesInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/users/{id}/roles', {
          params: { path: { id: input.id } },
          body: { roleIds: [...input.roleIds] },
        }),
      );
      const parsed = extractUserRecord(fetched.data);
      if (!parsed.ok) throw adminWriteError(200);
      return parsed.user;
    },
    onSuccess: (user) => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
      queryClient.setQueryData(['users', user.id], (previous: unknown) =>
        previous ? { ...(previous as object), data: user } : previous,
      );
    },
  });
}

/**
 * Revokes every session of a user `POST /users/{id}/sessions/revoke` (200
 * `{ revoked }`). Returns the number of sessions ended.
 */
export function useRevokeUserSessions(): UseMutationResult<
  { revoked: number },
  QueryError,
  { id: string }
> {
  const queryClient = useQueryClient();
  return useMutation<{ revoked: number }, QueryError, { id: string }>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/users/{id}/sessions/revoke', {
          params: { path: { id: input.id } },
        }),
      );
      const parsed = extractRevoked(fetched.data);
      if (!parsed.ok) throw adminWriteError(200);
      return { revoked: parsed.revoked };
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: ['users', input.id] });
    },
  });
}

/**
 * Deactivates a user `DELETE /users/{id}` (204, soft delete; sessions revoked).
 * A 204 carries no envelope, so the void unwrap acknowledges it.
 */
export function useDeactivateUser(): UseMutationResult<void, QueryError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, QueryError, { id: string }>({
    mutationFn: (input) =>
      unwrapVoid(api.DELETE('/users/{id}', { params: { path: { id: input.id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['users'] });
    },
  });
}

/**
 * Single role `GET /roles/{id}`. The service answers `{ role }` while the export
 * types the bare entity (GAP-020), so the unwrapped body is validated.
 */
export function useRole(id: string): UseQueryResult<Fetched<RoleRow>, QueryError> {
  return useQuery<Fetched<RoleRow>, QueryError>({
    queryKey: ['roles', id],
    queryFn: async ({ signal }) => {
      try {
        const role = await fetchRole(id, signal);
        return { data: role, response: new Response(null, { status: 200 }) } satisfies Fetched<RoleRow>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Creates a custom role `POST /roles` (201 `{ role }`). The service refuses a role
 * that would grant permissions beyond the caller's own (403 `PERMISSION_DENIED`)
 * and a duplicate key or name (409 `CONFLICT`).
 */
export function useCreateRole(): UseMutationResult<RoleRow, QueryError, CreateRoleInput> {
  const queryClient = useQueryClient();
  return useMutation<RoleRow, QueryError, CreateRoleInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/roles', {
          body: {
            name: input.name,
            key: input.key,
            ...(input.description ? { description: input.description } : {}),
            permissions: [...input.permissions],
          },
        }),
      );
      const parsed = extractRoleRecord(fetched.data);
      if (!parsed.ok) throw adminWriteError();
      return parsed.role;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

/**
 * Updates a role `PATCH /roles/{id}` (200 `{ role }`). A change that exceeds the
 * caller's permissions, or edits a system role without authority, is a 403
 * `PERMISSION_DENIED`; a name clash is a 409 `CONFLICT`.
 */
export function useUpdateRole(): UseMutationResult<RoleRow, QueryError, UpdateRoleInput> {
  const queryClient = useQueryClient();
  return useMutation<RoleRow, QueryError, UpdateRoleInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/roles/{id}', {
          params: { path: { id: input.id } },
          body: {
            ...(input.name !== undefined ? { name: input.name } : {}),
            ...(input.description !== undefined ? { description: input.description } : {}),
            ...(input.permissions !== undefined ? { permissions: [...input.permissions] } : {}),
          },
        }),
      );
      const parsed = extractRoleRecord(fetched.data);
      if (!parsed.ok) throw adminWriteError(200);
      return parsed.role;
    },
    onSuccess: (_result, input) => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
      queryClient.invalidateQueries({ queryKey: ['roles', input.id] });
    },
  });
}

/**
 * Deletes a role `DELETE /roles/{id}` (204). The service refuses a role still
 * assigned to users (409 `CONFLICT`) and a system role without authority (403),
 * so a 204 is acknowledged with the void unwrap.
 */
export function useDeleteRole(): UseMutationResult<void, QueryError, { id: string }> {
  const queryClient = useQueryClient();
  return useMutation<void, QueryError, { id: string }>({
    mutationFn: (input) =>
      unwrapVoid(api.DELETE('/roles/{id}', { params: { path: { id: input.id } } })),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['roles'] });
    },
  });
}

// --- administration (F9: the staff directory) -------------------------------

function staffWriteError(status = 200): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Staff roster `GET /staff?{filters}`. The export types the 200 as the request
 * DTO while the service answers a paginated envelope (GAP-020 family), so it
 * rides the raw-fetch path. Search (`q`) covers staff number, title,
 * specialization and the user's name/email; there is no status filter server
 * side.
 */
export function useStaff(query: StaffQuery = {}): UseQueryResult<Fetched<StaffPage>, QueryError> {
  return useQuery<Fetched<StaffPage>, QueryError>({
    queryKey: ['staff', 'list', query.q ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchStaff(query, signal);
        return { data: page, response: new Response(null, { status: 200 }) } satisfies Fetched<StaffPage>;
      } catch (call) {
        throw toQueryError(call as StaffCallError);
      }
    },
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Single staff profile `GET /staff/{id}`. The service answers `{ staff }` while
 * the export types the bare entity (GAP-020), so the unwrapped body is validated.
 */
export function useStaffMember(id: string): UseQueryResult<Fetched<StaffRow>, QueryError> {
  return useQuery<Fetched<StaffRow>, QueryError>({
    queryKey: ['staff', id],
    queryFn: async ({ signal }) => {
      try {
        const staff = await fetchStaffMember(id, signal);
        return { data: staff, response: new Response(null, { status: 200 }) } satisfies Fetched<StaffRow>;
      } catch (call) {
        throw toQueryError(call as StaffCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 15_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Updates a staff profile `PATCH /staff/{id}` (200 `{ staff }`). Only the
 * professional fields move; identity lives on the user and assignments on their
 * own endpoint.
 */
export function useUpdateStaff(): UseMutationResult<StaffRow, QueryError, UpdateStaffInput> {
  const queryClient = useQueryClient();
  return useMutation<StaffRow, QueryError, UpdateStaffInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/staff/{id}', {
          params: { path: { id: input.id } },
          body: {
            ...(input.professionalTitle !== undefined
              ? { professionalTitle: input.professionalTitle }
              : {}),
            ...(input.specialization !== undefined
              ? { specialization: input.specialization }
              : {}),
            ...(input.employmentStatus !== undefined
              ? { employmentStatus: input.employmentStatus }
              : {}),
            ...(input.licenseNumber !== undefined ? { licenseNumber: input.licenseNumber } : {}),
          },
        }),
      );
      const parsed = extractStaffRecord(fetched.data);
      if (!parsed.ok) throw staffWriteError();
      return parsed.staff;
    },
    onSuccess: (staff) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.setQueryData(['staff', staff.id], (previous: unknown) =>
        previous ? { ...(previous as object), data: staff } : previous,
      );
    },
  });
}

/**
 * Replaces a staff member's branch/department assignments
 * `POST /staff/{id}/assignments` (200 `{ staff }`). The service verifies every id
 * exists and refuses the whole set otherwise, so the editor posts the full
 * selection rather than a diff.
 */
export function useSetStaffAssignments(): UseMutationResult<
  StaffRow,
  QueryError,
  SetStaffAssignmentsInput
> {
  const queryClient = useQueryClient();
  return useMutation<StaffRow, QueryError, SetStaffAssignmentsInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/staff/{id}/assignments', {
          params: { path: { id: input.id } },
          body: {
            branchIds: [...input.branchIds],
            departmentIds: [...input.departmentIds],
          },
        }),
      );
      const parsed = extractStaffRecord(fetched.data);
      if (!parsed.ok) throw staffWriteError();
      return parsed.staff;
    },
    onSuccess: (staff) => {
      queryClient.invalidateQueries({ queryKey: ['staff'] });
      queryClient.setQueryData(['staff', staff.id], (previous: unknown) =>
        previous ? { ...(previous as object), data: staff } : previous,
      );
    },
  });
}

/**
 * Branch options `GET /branches`, for the assignment editor. The export types the
 * 200 as a page even though the service unwraps it into `data: [...]` (GAP-020
 * family), so the rows are read structurally. Branches do not change during a
 * session, so the list is cached for a while.
 */
export function useBranchOptions(): UseQueryResult<Fetched<readonly BranchOption[]>, QueryError> {
  return useQuery<Fetched<readonly BranchOption[]>, QueryError>({
    queryKey: ['branches', 'list'],
    queryFn: async ({ signal }) => {
      try {
        const branches = await fetchBranchOptions(signal);
        return {
          data: branches,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<readonly BranchOption[]>;
      } catch (call) {
        throw toQueryError(call as StaffCallError);
      }
    },
    staleTime: 10 * 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

// --- administration (F9: the organization profile) --------------------------

/**
 * Organization profile `GET /organizations/me`. The service answers
 * `{ organization }` while the export types the bare entity (GAP-020), so the
 * unwrapped body is validated. There is exactly one organization, so the read is
 * cached rather than re-fetched on every navigation.
 */
export function useOrganization(): UseQueryResult<Fetched<OrganizationRow>, QueryError> {
  return useQuery<Fetched<OrganizationRow>, QueryError>({
    queryKey: ['organization'],
    queryFn: async ({ signal }) => {
      try {
        const organization = await fetchOrganization(signal);
        return {
          data: organization,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<OrganizationRow>;
      } catch (call) {
        throw toQueryError(call as AdminCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Updates the organization profile `PATCH /organizations/me` (200
 * `{ organization }`). The DTO refines to at least one field; a change whose email
 * collides with an existing account is a 409 `CONFLICT`.
 */
export function useUpdateOrganization(): UseMutationResult<
  OrganizationRow,
  QueryError,
  UpdateOrganizationInput
> {
  const queryClient = useQueryClient();
  return useMutation<OrganizationRow, QueryError, UpdateOrganizationInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.PATCH('/organizations/me', {
          body: {
            ...(input.legalName !== undefined ? { legalName: input.legalName } : {}),
            ...(input.tradingName !== undefined ? { tradingName: input.tradingName } : {}),
            ...(input.registrationNumber !== undefined
              ? { registrationNumber: input.registrationNumber }
              : {}),
            ...(input.kraPin !== undefined ? { kraPin: input.kraPin } : {}),
            ...(input.phone !== undefined ? { phone: input.phone } : {}),
            ...(input.email !== undefined ? { email: input.email } : {}),
            ...(input.website !== undefined ? { website: input.website } : {}),
            ...(input.logoUrl !== undefined ? { logoUrl: input.logoUrl } : {}),
            ...(input.address !== undefined ? { address: input.address } : {}),
            ...(input.county !== undefined ? { county: input.county } : {}),
            ...(input.town !== undefined ? { town: input.town } : {}),
          },
        }),
      );
      const parsed = extractOrganizationRecord(fetched.data);
      if (!parsed.ok) throw adminWriteError(200);
      return parsed.organization;
    },
    onSuccess: (organization) => {
      queryClient.setQueryData(['organization'], (previous: unknown) =>
        previous ? { ...(previous as object), data: organization } : previous,
      );
    },
  });
}

// --- reports (F10: the report-export desk) ----------------------------------

function reportsWriteError(status = 202): QueryError {
  return { code: 'INTERNAL_ERROR', status, resolved: resolveApiError('INTERNAL_ERROR') };
}

/**
 * Report-export history `GET /reports/exports?{filters}`. The export types the
 * body as `unknown`, so it rides the raw-fetch path. The list endpoint names the
 * page size `pageSize`, not `limit`.
 */
export function useReportExports(
  query: ReportQuery = {},
): UseQueryResult<Fetched<ReportPage>, QueryError> {
  return useQuery<Fetched<ReportPage>, QueryError>({
    queryKey: ['reports', 'exports', query.reportType ?? null, query.page ?? 1],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchReportExports(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<ReportPage>;
      } catch (call) {
        throw toQueryError(call as ReportsCallError);
      }
    },
    staleTime: 5_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * One report export `GET /reports/exports/{id}`. Polls while the row is still
 * PENDING so a request settles without the operator refreshing: generation is
 * asynchronous and the artifact only appears once the consumer has rendered it.
 */
export function useReportExport(id: string): UseQueryResult<Fetched<ReportExportRow>, QueryError> {
  return useQuery<Fetched<ReportExportRow>, QueryError>({
    queryKey: ['reports', 'exports', id],
    queryFn: async ({ signal }) => {
      try {
        const report = await fetchReportExport(id, signal);
        return {
          data: report,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<ReportExportRow>;
      } catch (call) {
        throw toQueryError(call as ReportsCallError);
      }
    },
    enabled: id.length > 0,
    staleTime: 0,
    refetchInterval: (query) =>
      query.state.data?.data.status === 'PENDING' ? 4_000 : false,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Requests a report export `POST /reports/export` (202). The service queues the
 * render and answers a PENDING row; the caller polls the detail read until it is
 * READY. The write is not retried on a structural mismatch.
 */
export function useRequestReportExport(): UseMutationResult<
  ReportExportRow,
  QueryError,
  RequestReportInput
> {
  const queryClient = useQueryClient();
  return useMutation<ReportExportRow, QueryError, RequestReportInput>({
    mutationFn: async (input) => {
      const fetched = await unwrap<unknown>(
        api.POST('/reports/export', {
          body: {
            reportType: input.reportType,
            format: input.format,
            ...(input.from ? { from: input.from } : {}),
            ...(input.to ? { to: input.to } : {}),
            ...(input.branchId ? { branchId: input.branchId } : {}),
            ...(input.departmentId ? { departmentId: input.departmentId } : {}),
          },
        }),
      );
      const parsed = extractReportRecord(fetched.data);
      if (!parsed.ok) throw reportsWriteError();
      return parsed.report;
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['reports', 'exports'] });
    },
  });
}

// --- analytics (F10: operational metrics) -----------------------------------

/**
 * Operational metrics `GET /analytics/metrics?{window}`. The export types the
 * body as `unknown` (a large nested object), so it rides the raw-fetch path and
 * the series/summary are validated structurally in `src/lib/data/analytics.ts`.
 * The query key carries the whole window so each selection is cached separately.
 */
export function useAnalyticsMetrics(
  query: AnalyticsMetricsQuery = {},
): UseQueryResult<Fetched<AnalyticsMetrics>, QueryError> {
  return useQuery<Fetched<AnalyticsMetrics>, QueryError>({
    queryKey: [
      'analytics',
      'metrics',
      query.from ?? null,
      query.to ?? null,
      query.granularity ?? null,
      query.branchId ?? null,
      query.departmentId ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const metrics = await fetchAnalyticsMetrics(query, signal);
        return {
          data: metrics,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AnalyticsMetrics>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Journey bottleneck ranking `GET /analytics/bottleneck?{window}`. The payload is
 * validated structurally in `src/lib/data/analytics.ts`; stages are linked to
 * stage keys the API's interpretation text explains.
 */
export function useAnalyticsBottleneck(
  query: AnalyticsMetricsQuery = {},
): UseQueryResult<Fetched<AnalyticsBottleneck>, QueryError> {
  return useQuery<Fetched<AnalyticsBottleneck>, QueryError>({
    queryKey: [
      'analytics',
      'bottleneck',
      query.from ?? null,
      query.to ?? null,
      query.branchId ?? null,
      query.departmentId ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const bottleneck = await fetchAnalyticsBottleneck(query, signal);
        return {
          data: bottleneck,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AnalyticsBottleneck>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Capacity planning `GET /analytics/capacity?{window}`. Peak hours/days, load per
 * department, provider utilization, bed occupancy and the embedded appointment
 * demand forecast are validated structurally in `src/lib/data/analytics.ts`.
 */
export function useAnalyticsCapacity(
  query: AnalyticsMetricsQuery = {},
): UseQueryResult<Fetched<AnalyticsCapacity>, QueryError> {
  return useQuery<Fetched<AnalyticsCapacity>, QueryError>({
    queryKey: [
      'analytics',
      'capacity',
      query.from ?? null,
      query.to ?? null,
      query.branchId ?? null,
      query.departmentId ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const capacity = await fetchAnalyticsCapacity(query, signal);
        return {
          data: capacity,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AnalyticsCapacity>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * One forecast series `GET /analytics/forecasts/{series}?{window,horizon}`. The
 * service answers an unknown series with a labelled forecast whose notes say so,
 * so the page renders it rather than treating it as an error.
 */
export function useAnalyticsForecast(
  series: string,
  query: AnalyticsForecastQuery = {},
): UseQueryResult<Fetched<ForecastResult>, QueryError> {
  return useQuery<Fetched<ForecastResult>, QueryError>({
    queryKey: [
      'analytics',
      'forecasts',
      series,
      query.from ?? null,
      query.to ?? null,
      query.branchId ?? null,
      query.departmentId ?? null,
      query.horizon ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const forecast = await fetchAnalyticsForecast(series, query, signal);
        return {
          data: forecast,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<ForecastResult>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Patient-experience composite `GET /analytics/patient-experience?{window}`. The
 * component scores and the weights behind them are both surfaced; the composite is
 * a labelled estimate, not a clinical measure.
 */
export function useAnalyticsPatientExperience(
  query: AnalyticsMetricsQuery = {},
): UseQueryResult<Fetched<AnalyticsPatientExperience>, QueryError> {
  return useQuery<Fetched<AnalyticsPatientExperience>, QueryError>({
    queryKey: [
      'analytics',
      'patient-experience',
      query.from ?? null,
      query.to ?? null,
      query.branchId ?? null,
      query.departmentId ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const experience = await fetchAnalyticsPatientExperience(query, signal);
        return {
          data: experience,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AnalyticsPatientExperience>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * Staff analytics `GET /analytics/staff?{window}`. Raw measurements with a
 * caveat; the service forbids using them for individual employment decisions, and
 * the interpretation sentence is surfaced verbatim for that reason.
 */
export function useAnalyticsStaff(
  query: AnalyticsMetricsQuery = {},
): UseQueryResult<Fetched<AnalyticsStaff>, QueryError> {
  return useQuery<Fetched<AnalyticsStaff>, QueryError>({
    queryKey: [
      'analytics',
      'staff',
      query.from ?? null,
      query.to ?? null,
      query.branchId ?? null,
    ],
    queryFn: async ({ signal }) => {
      try {
        const staff = await fetchAnalyticsStaff(query, signal);
        return {
          data: staff,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<AnalyticsStaff>;
      } catch (call) {
        throw toQueryError(call as AnalyticsCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

// --- patient portal (F11) ---------------------------------------------------

/**
 * The caller's own patient record `GET /portal/me`. The export types the body as
 * unknown, so it rides the raw-fetch path and is validated in
 * `src/lib/data/portal.ts`. Self-scoped by the API — there is deliberately no id
 * argument, because a client that names the record it wants is one step from an
 * IDOR.
 */
export function usePortalMe(): UseQueryResult<Fetched<PortalPatient>, QueryError> {
  return useQuery<Fetched<PortalPatient>, QueryError>({
    queryKey: ['portal', 'me'],
    queryFn: async ({ signal }) => {
      try {
        const patient = await fetchPortalMe(signal);
        return {
          data: patient,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<PortalPatient>;
      } catch (call) {
        throw toQueryError(call as PortalCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * The caller's own appointments `GET /portal/me/appointments` (newest first).
 * The list type in the export is the request DTO, so the page rides the raw-fetch
 * path and is validated in `src/lib/data/portal.ts` (GAP-020 family). Like every
 * portal read it is self-scoped — no patient id is sent.
 */
export function usePortalAppointments(
  query: PortalAppointmentQuery = {},
): UseQueryResult<Fetched<PortalAppointmentPage>, QueryError> {
  return useQuery<Fetched<PortalAppointmentPage>, QueryError>({
    queryKey: ['portal', 'appointments', query.page ?? 1, query.limit ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPortalAppointments(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<PortalAppointmentPage>;
      } catch (call) {
        throw toQueryError(call as PortalCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}

/**
 * The caller's own released lab results `GET /portal/me/lab-results` (newest
 * first). Self-scoped and release-gated server-side: a result that has not been
 * released never appears. Raw-fetch + structural validation (GAP-020 family).
 */
export function usePortalLabResults(
  query: PortalLabResultQuery = {},
): UseQueryResult<Fetched<PortalLabResultPage>, QueryError> {
  return useQuery<Fetched<PortalLabResultPage>, QueryError>({
    queryKey: ['portal', 'lab-results', query.page ?? 1, query.limit ?? null],
    queryFn: async ({ signal }) => {
      try {
        const page = await fetchPortalLabResults(query, signal);
        return {
          data: page,
          response: new Response(null, { status: 200 }),
        } satisfies Fetched<PortalLabResultPage>;
      } catch (call) {
        throw toQueryError(call as PortalCallError);
      }
    },
    staleTime: 60_000,
    retry: (count, error) => count < 2 && (error.resolved?.retryable ?? false),
  });
}
