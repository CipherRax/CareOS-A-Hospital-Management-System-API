# careOS — Progress

Auditable multi-tenant healthcare operations API. This file tracks phase-level
status against the product brief. Per-phase rules: no skipped or commented-out
tests, stubs are named and listed in `docs/limitations.md`, and each phase ends
with a green gate.

## Gate

```bash
npm run lint && npm run typecheck && npm run boundaries && npm test && npm run build
npm run test:unit   # same as npm test (base config is pinned to test/unit)
npm run test:e2e    # containerized infra (Postgres + Redis via Testcontainers)
```

Status: **GREEN.**

| Check        | Result |
| ------------ | ------ |
| `lint`       | pass   |
| `typecheck`  | pass   |
| `boundaries` | pass   |
| `npm test`   | 69/69 unit |
| `build`      | pass   |
| `test:e2e`   | 55/55 (6 suites, fresh Testcontainers infra) |

## Phase 0 — Foundations (COMPLETE)

Done:

- NestJS 11 + Fastify 5 app (`src/main.ts`), config validated with Zod
  (`src/config`, `ENV` provider, `.env.example`).
- Standard response envelope + typed error codes (`src/common/errors`,
  `src/common/filters/app-exception.filter.ts`,
  `src/common/interceptors/transform.interceptor.ts`).
- Public health endpoints at the root (`/health`, `/health/live`, `/health/ready`)
  checking Postgres + Redis (`src/modules/health`).
- Shared-schema multi-tenant core: row tenancy via a Prisma client extension that
  injects `organizationId` from `ClsService` context (`src/database/prisma.service.ts`,
  `tenant-context.ts`), and defense-in-depth PostgreSQL RLS using
  `app.current_org` set inside interactive transactions (`src/database/tx.ts`).
- Permissions catalog + guard wired to test principal `/organizations/me`
  (`src/common/auth`, `src/common/guards`, `src/modules/organizations`).
- Outbox for async tasks: `outbox_events` + dispatcher pointer service
  (`src/database/outbox-publisher.service.ts`) writing events in the same
  interactive transaction as the domain write; append-only `audit_logs` with a
  DB trigger blocking UPDATE/DELETE (`src/database/audit.service.ts`).
- Demo seam proving the whole pipeline: `POST /api/v1/_demo/outbox` emits
  `CareOS.Probe` under the caller's org (`src/modules/demo`).
- UUIDv7 PKs generated in app code with a monotonic per-millisecond counter
  (`src/common/lib/uuidv7.ts`).
- Idempotency interceptor keyed on `(organizationId, scopeKey, idempotencyKey)`
  (`src/common/interceptors/idempotency.interceptor.ts`), storing the response
  so a replay returns the original result and a live duplicate returns 409.
- Docker Compose (Postgres 16, Redis 7, MinIO, adminer) + multi-stage Dockerfile
  with Node 22 runtime + prisma migrate bootstrap (`docker-compose.yml`,
  `Dockerfile`).
- E2E harness: Testcontainers global setup starts Postgres+Redis, applies
  migrations idempotently, and writes connection info to `test/.e2e.env.json`
  (`test/support/testcontainers.ts`). Supports reusing external services via
  `E2E_DATABASE_URL`/`E2E_REDIS_*` for fast iteration.
- E2E suites (all green):
  - `app-boot` — Phase 0 acceptance: envelope, health, deny-by-default route
    walk with an empty tenant scope.
  - `tenant-pipeline` — demo event → outbox → idempotent audit record, single
    transaction, replay returns cached response.
  - `rls` — real DB statements confirm cross-org access is blocked and
    `audit_logs` rows are append-only.
  - `identity` — Phase 1 acceptance covered below (11 tests).

## Phase 1 — Identity & access (COMPLETE)

Real JWT/session auth replacing the Phase 0 test-principal seam, plus user,
role, staff, branch, department, and break-glass management — all tenant-scoped
through the existing Prisma extension + RLS backstop.

Done:

- **Real authentication.** `src/modules/auth` — login (org-scoped email +
  password, argon2 password hashes, per-account brute-force lockout with 423
  after the threshold, constant-timing burns for unknown/invited users),
  access + refresh token rotation with refresh-reuse family revocation
  (`src/common/auth/refresh-rotation.ts`), logout revoking the family,
  password request/reset, and TOTP MFA (enrol, challenge on login, verify,
  recovery codes — 10 issued once, single-use, hash-stored).
- **Guards.** `JwtAuthGuard` (`src/common/guards/jwt-auth.guard.ts`) verifies
  bearer access tokens and stamps identity into the CLS scope; `TenantGuard`
  (`src/common/guards/tenant.guard.ts`) enforces org context; `PermissionsGuard`
  enforces deny-by-default permissions. `@Public()` / `authenticatedOnly` /
  `@ApiEndpoint` contract decorators in `src/common/decorators`.
- **RBAC.** `src/common/auth/rbac.ts` — subset-based role grants
  (`canGrantRole` blocks privilege escalation), system roles guarded;
  `role-matrix.ts` maps catalog roles to permissions; permissions catalog
  extended (`src/common/auth/permissions.catalog.ts`).
- **User management.** `src/modules/users` — invite (with staff profile,
  branches, departments, roles) returning a single-use invite token for
  dev/test, accept-invite activating the account, role assignment, session
  revocation; privilege-escalation-safe role grants.
- **Tenant modules.** `src/modules/roles`, `staff`, `branches`, `departments`,
  `break-glass` (request/approve/expire flow) — all permission-gated and
  tenant-scoped.
- **Schema (migrations `20260921171109_phase1_identity_access`,
  `20260921175613_phase1_breakglass_pending`):** user, session, refresh token,
  mfa credential/recovery code, invite, role, user_role, staff profile,
  branch, department, break-glass request/grant models; user audit fields;
  invite hashing + TOTP metadata on `User`.
- **Acceptance.** `test/e2e/identity.e2e-spec.ts` — 11 real-auth tests
  (login + protected routes, generic credentials failure + timing burn, 423
  lockout, invite → accept → login, MFA enable → challenge → TOTP, recovery
  code accepted once, refresh rotation + family burn, self-service logout).
  Unit coverage for password hashing, TOTP, RBAC, and refresh rotation.

## Phase 2 — Patients (COMPLETE)

Tenant-scoped patient records with org-scoped patient numbers, duplicate
detection on registration, guardians, consents, allergies, medical history,
permission-aware master records and activity timelines, patient access logs,
patient-portal ownership, and reversible merge.

Done:

- **Patient model + numbering.** `Patient` (`prisma/schema.prisma`) with
  `patientNumber` unique per org (`PAT-YYYY-NNNNNN`), `version` for optimistic
  concurrency, duplicate flags, and a self-relation (`mergedIntoPatientId`) for
  reversal-safe merges. Numbers come from an atomic per-org counter
  (`INSERT ... ON CONFLICT` on `(organizationId, key)` in
  `src/modules/patients/domain/patient-number.ts`), never from table ids.
- **Duplicate detection.** Pure scoring in
  `src/modules/patients/domain/duplicate-score.ts` (normalized phone +40, email
  +40, bigram name similarity up to +40, DOB +20, sex +10; threshold 70).
  `POST /patients` returns 409 `POSSIBLE_DUPLICATE` with candidate ids unless
  the creator passes `confirmDuplicate: true` + `duplicateConfirmReason` (then
  recorded as `duplicateConfirmedAt/By/Reason`).
- **Patients module.** `src/modules/patients` — register, paginated searchable
  list (status + free-text across number/name/phone/email), get (demographics,
  contact exposure gated by `patients.update` or self-scope), update (409
  `VERSION_CONFLICT` on stale `version`), confirm-not-duplicate, merge, master
  record (sections: guardians/consents/allergies/medical-history), permission
  filtered timeline, access-log, and CRUD for guardians (reuse by phone),
  consents (one row per type, grant/withdraw), allergies (record / resolve /
  amend — the superseded row stays `AMENDED`, never deleted), and append-only
  medical history.
- **Merge.** `POST /patients/:id/merge` — source marked `MERGED` with a pointer
  to the survivor (reversible by design, not deleted); guardians/consents
  re-pointed (skip+delete when the survivor already has the same), allergies +
  medical history transferred wholesale. Timeline entries on both records.
- **Patient access logs.** `PatientAccessLog` rows written on single-record
  reads (get, master, timeline, access-log, sub-resource lists) capturing
  identifiers + request metadata only — never PHI; writes fail-open so logging
  can never break a read.
- **Patient portal ownership.** `TenantScope.patientId` carried through the
  request scope (test seam `x-careos-test-patient-id`); a self-scoped principal
  may only reach its own record (`PATIENT_ACCESS_DENIED` otherwise), its list is
  pinned to its own id, and its contact data is always unmasked.
- **Timeline.** `PatientTimelineEntry` rows carry `requiredPermission`; reads
  filter by the caller's effective permissions so an entry requiring a
  permission the caller lacks is invisible.
- **Permissions + roles.** `patients.merge` added to the catalog and to
  `ALL` / `HOSPITAL_ADMIN` / `RECORDS_OFFICER`; `RECORDS_OFFICER` also gained
  `patients.create`. New events `PatientRegistered`, `PatientUpdated`,
  `PatientDuplicateConfirmed`, `PatientMerged`, `PatientGuardianAdded/Removed`,
  `PatientConsentChanged`, `PatientAllergyRecorded`, `PatientMedicalHistoryAdded`.
- **Migration `20260922113304_phase2_patients`** enables RLS and adds
  `tenant_isolation` policies + `GRANT`s for the 8 new patient tables (the
  documents migration omitted this; patients is the safer baseline). Verified
  against scratch Postgres, applied by `prisma migrate deploy` in e2e.
- **Acceptance.** `test/e2e/patients.e2e-spec.ts` — 22 tests covering
  permission gating, numbering + sequence, duplicate 409 + confirm, search,
  cross-tenant 404, contact masking, access logging, patient-portal ownership,
  optimistic concurrency, guardians, consents, allergies (incl. amend + reopen
  refusal), medical history, merge + transfer, self-merge refusal, master
  record, timeline filtering, and access-log listing. Unit coverage for
  duplicate scoring and number format/counter.

## Phase 3 — Object storage & documents (COMPLETE)

S3-compatible object storage with a presigned-URL upload/download flow and a
tenant-scoped document metadata API, plus the outbox `Storage.DocumentUploaded`
event for downstream processing.

Done:

- **Object storage client.** `src/common/storage/object-storage.service.ts` — an
  `@Optional` S3 client built from `S3_*` env; `presignPut` (signs Content-Type)
  returns a presigned PUT URL for direct client upload, `presignGet` returns a
  presigned GET URL with attachment disposition, `head` checks existence, and
  `remove` deletes the object. Unconfigured/unreachable storage throws
  `ErrorCodes.S3_UNAVAILABLE`.
- **Document model.** `Document` (`prisma/schema.prisma`) — tenant-scoped rows
  keyed `(organizationId, storageKey)` where `storageKey = orgId/documentId`,
  `DocumentStatus` lifecycle `PENDING_UPLOAD → UPLOADED → DELETED`, optional
  `sizeBytes`/`checksumSha256`/`metadata`. Migration
  `20260922101216_phase2_documents` (historical name; shipped before the
  patients phase) verified against scratch Postgres.
- **Documents module.** `src/modules/documents` — `POST /documents` initiate
  (returns `{document, upload:{method,url,expiresIn}}`), `POST /:id/complete`
  (verifies the object exists and matches size, flips to `UPLOADED`, emits the
  outbox event), `GET /` paginated list (hides `DELETED` by default),
  `GET /:id`, `GET /:id/download` (presigned GET), `DELETE /:id` (removes the
  object, soft-deletes the row). All routes permission-gated
  (`documents.read/create/manage`).
- **Permissions.** `PERMISSION_GROUPS.documents` added to the catalog and each
  role in `role-matrix.ts` (authors/editors `read+create+manage`, most roles
  `read`, users `read`).
- **Config.** `S3_SIGNED_URL_TTL_SECONDS` (default 900) added to the env schema
  and `.env.example`.
- **Acceptance.** `test/e2e/documents.e2e-spec.ts` — 7 tests: initiate
  permission denial, full lifecycle (initiate → presigned PUT → complete →
  metadata → download round-trip → outbox event), cross-tenant isolation,
  complete-without-upload failure, paginated list hiding deleted rows, delete
  + 404 after, and delete-permission denial. s3rver runs in-process inside the
  globalSetup so e2e exercises real SigV4 traffic without Docker.

## Phase 4 — Next

## Notes

- Testcontainers uses `postgres:17-alpine` by default because `postgres:16-alpine`
  is not available in the local Docker Hub cache; Compose targets 16. Override
  with `E2E_POSTGRES_IMAGE`/`E2E_REDIS_IMAGE`. See `docs/limitations.md`.
- Jest configs are CommonJS `.js` files (no ts-node in the toolchain); SWC only
  (`@swc/jest`), helpers inline via `.swcrc -> externalHelpers: false`.
- Phase order follows the build brief (patients is Phase 2). The object-storage
  work was committed earlier under the label "Phase 2" and is documented here as
  Phase 3; git history is unchanged.