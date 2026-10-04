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

Status: **GREEN** (static + unit + build). E2E unverified this pass — Docker is
unavailable in this environment, so `test:e2e` and the un-applied migration
below have not been exercised.

| Check        | Result |
| ------------ | ------ |
| `lint`       | pass   |
| `typecheck`  | pass   |
| `boundaries` | pass (401 modules, 1,967 deps) |
| `npm test`   | 916/916 unit (87 suites) |
| `build`      | pass   |
| `test:e2e`   | **not run** — Docker unavailable |

### Unverified this pass

- `prisma/migrations/20261006090000_patch_emergency_contract_closure/` has not
  been applied. It now also carries `emergency_numbers.channel/active/verifiedAt`,
  `public_notices.reviewedBy/reviewedAt`, `emergency_contacts.onCallWindows`,
  `display_devices.previousTokenHash/previousTokenExpiresAt`,
  `display_devices.staleNotifiedAt`, and `emergency_requests.dispositionAt`. All
  are additive and `IF NOT EXISTS`, but
  PostGIS, the enum/check constraints, the ADR-055 `dispositionAt` backfill, and
  the `careos_public` grants still need a real Postgres run.
- The new `DeviceAuthGuard` overlap path and the SSE `reply.raw.end()` teardown
  are unit-tested only; the latter in particular needs a live Redis subscriber
  to prove a revoked stream actually closes.
- The ADR-055 retention widening (`applyRetention` now covers all six finished
  dispositions via `dispositionAt`) is unit-tested against the query, but has
  never run against a live sweep. The migration backfill for pre-existing
  non-closed rows is an inference (`COALESCE(closedAt, cancelledAt, updatedAt)`)
  and has not been exercised on real data.

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

## Phase 4 — Scheduling & patient flow (COMPLETE; the brief's Phase 3)

Provider schedules and bookable slots, appointments with optimistic
concurrency, a waitlist with offers, walk-in queue + visits, append-only
vitals, queue metrics, realtime SSE (Redis pub/sub), waiting-room display
devices with pairing, and a live queue board.

Done:

- **Schedules module.** `src/modules/schedules` — weekly/recurring availability
  templates (`Schedules`) and per-day overrides (`ScheduleOverrides`), with slot
  serialization in a defined window. Slots are derived from
  available-from/until minus booked appointments and breaks; today's slots are
  clamped to the future. Serialization happens inside a transaction so an
  in-flight booking cannot cross a boundary unmoved.
- **Appointments.** `src/modules/appointments` — `POST /appointments` books a
  slot under an advisory per-slot lock; occupancy is capacity-aware
  (BOOKED/CONFIRMED/CHECKED_IN/IN_PROGRESS), and RESCHEDULED/CANCELLED rows
  free capacity. A concurrent double-booking yields exactly one 201 and one 409
  `APPOINTMENT_CONFLICT` (the e2e acceptance). Rows carry a conflicting-slot
  `version` for optimistic concurrency; `POST /:id/reschedule` (requires
  `version`, else 400) supersedes the old row (`superseded.status =
  RESCHEDULED`, `rescheduledFromId` pointer). `GET /appointments` lists with a
  `page` meta and appointment-status filtering. A doctor assigned to a
  department backs the booking; missing provider or patient surfaces 404 via
  `assertPatientAndProvider`.
- **Waitlist + offers.** `joinWaitlist` creates a `WaitlistEntry`
  (WAITING/PENDING). When a slot frees (booking CANCELLED/NO_SHOW or an
  in-window opening), `offerNextWaitlist` marks the top-priority entry OFFERED
  and persists `offerStartAt/offerExpiresAt/offeredStartAt/providerId`;
  `acceptWaitlistOffer` turns the offer into a booking and the entry into
  BOOKED, and refuses manual end-point mutations (patch not implemented).
  Offers expire after 15 min; a stale OFFERED entry falls through to the next
  candidate. **Found-and-fixed product bug:** the OFFERED update did not persist
  `providerId` and `acceptWaitlistOffer` used a non-null assertion that resolved
  null when no doctor was assigned — it now persists the slot's provider and
  throws a proper 404 when none resolves.
- **Queue / walk-in / visits.** `src/modules/queue` — `POST /queue/walk-in`
  registers (or re-activates a WAITING `Visit`) and issues an org+department
  ticket number like `W-010`, `O-011`. `POST /queue/:ticket/transition`
  enforces the flow map WAITING→CALLED/NO_SHOW/ABANDONED/CANCELLED/TRANSFERRED,
  CALLED→IN_SERVICE/WAITING/NO_SHOW/CANCELLED/TRANSFERRED,
  IN_SERVICE→COMPLETED/CANCELLED/TRANSFERRED (illegal edges 409
  `INVALID_WORKFLOW_TRANSITION`; active visits cannot be re-walked in — 409
  `VISIT_ALREADY_ACTIVE`). Series restarts daily. `GET /queue/metrics` computes
  `avgCallWaitMinutes` (entered→service), `avgServiceMinutes`
  (service→completed), `currentlyWaiting`, `abandonmentRate` (NO_SHOW+ABANDONED
  over finished).
- **Vitals.** `src/modules/vitals` — append-only triage records
  (`VitalRecord`) with BMI (+`bmiCategory`), `source`/`notes`, one active
  record per visit; `correct` marks the prior row `CORRECTED` with a
  `correctionOfId` pointer, misrecorded rows are never deleted.
- **Realtime.** `src/modules/realtime` + `src/database/redis.tokens.ts` — a
  single `REDIS_CLIENT` token breaks the realtime↔redis circular import.
  `QueueStatusChanged`-style events publish a small envelope
  `{version:1,event,aggregateId,payload:{ticketNumber,departmentId,status}}`
  (PHI-free) to a keyed channel; staff `GET /realtime/queue?departmentId=…` and
  device `GET /display/devices/:id/stream?departmentId=…` SSE subscribe with a
  per-connection buffer (`: ping` heartbeats, `event: connected` frame).
- **Display devices + board.** `src/modules/display` — `POST /display/devices`
  registers a device with a display name under the caller's org and returns a
  one-time `pairingCode`; `POST /display/devices/pair` exchanges the code
  (single-use, hashed at rest) for a device token. Paring throttle: 7 invalid
  attempts → 401, the 8th → 429, keyed by client IP. Pairing is org-agnostic by
  design (the device is not yet in any org); the token embeds the org id.
  Device tokens are opaque bearer credentials (`<orgId>.<base64url>`), only the
  digest is stored, and `DeviceAuthGuard` scopes them to a narrow set
  (`queue.display` only — a device token cannot read patient data). `GET
  /display/devices/:id/board` returns the department snapshot (`nowServing`,
  `called`, `nextUp`, `waitingCount`) for the display.
- **Schema + RLS (migration `20260923071517_phase3_scheduling`):**
  schedules/overrides/appointment/waitlist_entry/visit/queue_state/
  vital_record/device_registration/device_session tables with
  `tenant_isolation` policies + `GRANT`s, verified against scratch Postgres and
  applied via `prisma migrate deploy` in e2e.
- **Permissions + events.** Catalog additions: `schedules.read/manage`,
  `appointments.read/create/update/reschedule`, `queue.read/walk-in/transition`,
  `vitals.read/record/correct`, `waitlist.read/join/manage-offers`,
  `realtime.queue`, `queue.display` (device scope). Roles updated in
  `role-matrix.ts`. Events `AppointmentBooked`, `WaitlistOfferCreated`,
  `WaitlistOfferExpired`, `VisitStatusChanged`, `VitalRecorded`,
  `DisplayDevicePaired`, `DisplaySessionRevoked`.
- **Acceptance.** `test/e2e/phase3-scheduling.e2e-spec.ts` — 21 tests: slot
  serialization + guard, double-booking (exactly one 201 / one 409, loser sees
  the winner), optimistic `version`, reschedule (supersede + freed capacity),
  waitlist join/offer/accept after a cancel, booking without
  `appointments.create` → 403, walk-in tickets + transition legal/illegal
  edges, cross-tenant 404, queue metrics (incl. revisit not contaminating the
  metrics department — a dedicated `Stats` department is used), SSE
  tenant-scoped + department-scoped publish on transition, vitals record/correct
  append-only, display pairing/device-token scope (`queue.display`),
  `X-Forwarded-For` pairing throttle. Unit suites for slots, booking,
  waitlist/offers, queue flow + ticket, vitals, and display pairing
  (18 suites / 123 unit tests total).

## Phase 5 — Clinical core (COMPLETE; the brief's Phase 4)

Encounters with a workflow-gated lifecycle, versioned (append-only) clinical
notes with templates, coded diagnoses backed by org coding systems plus a
problem list, follow-ups / referrals / tasks, a central workflow engine, and a
patient timeline projected from outbox events.

Done:

- **Workflow engine.** `src/modules/workflows` — `domain/workflow-core.ts`
  holds the built-in mandatory edge set per entity (`SYSTEM_TRANSITIONS`).
  Orgs ADD custom edges via `POST /workflows/:entityType/transitions`
  (evaluated on `workflow.manage`), but core edges can never be removed and the
  effective set is the always-widening union (`effectiveEdges` / `addableEdges`).
  Every transition service funnels through `WorkflowsService.assertAllowed`, so
  a misconfigured workflow can widen a flow but never unlock a locked state.
  `GET /workflows/:entityType` (workflows.read) returns system/custom/effective
  edges + the addable set. `Workflow`/`WorkflowTransition` rows are tenant-owned
  (RLS-enabled).
- **Encounters.** `src/modules/encounters` — OPEN → IN_PROGRESS → COMPLETED.
  `assertEncounterTransition` is the module-level safety rail: COMPLETED is a
  hard lock no custom edge can reopen, and same-status transitions are rejected.
  `PATCH /encounters/:id/status` emits `Clinical.EncounterStarted/Completed`,
  bumps `version` for optimistic concurrency, and writes audit rows. Clinical
  entries (notes/diagnoses/follow-ups/referrals) require an OPEN or IN_PROGRESS
  encounter (`assertEncounterOpen`, `assertEncounterActive`).
- **Clinical notes.** `src/modules/clinical-notes` — versioned append-only
  notes (`ClinicalNote` + `ClinicalNoteVersion`, unique
  `(organizationId, noteId, versionNumber)`). DRAFT remains editable; `finalize`
  writes the ORIGINAL version; `amend` (reason required) appends a superseding
  AMENDMENT — FINAL notes are never edited in place (`assertNoteStatus`). Note
  sections are validated against the 8-key `NOTE_SECTION_KEYS` set; invalid keys
  are a 400. Reusable `ClinicalNoteTemplate` rows (create/list,
  `createdById`).
- **Coded diagnoses + problem list.** `src/modules/diagnoses` +
  `src/modules/coding` — org coding systems (`CodingSystem.key` unique per org,
  active-gated) with idempotent concept import (`CodeConcept` upsert on
  `(organizationId, systemId, code)`, returned inserted/updated counts) and
  free-text code search. Diagnoses record against an imported `CodeConcept` or
  as explicit free text (`codeConceptId` NULL); `GET /diagnoses/problems` lists
  the `ACTIVE` + `onProblemList` set; resolve / classification updates are
  `version`-bumped and emit `Clinical.DiagnosisRecorded/Updated/Resolved`.
- **Follow-ups / referrals / tasks.** `src/modules/follow-ups`, `referrals`,
  `tasks` — each a pure-domain flow (`*-flow.ts`) plus workflow assertion:
  follow-up transitions from SCHEDULED/REMINDED
  (`FollowUpCreated`/`FollowUpStatusChanged`), referral
  CREATED→SENT→ACCEPTED→COMPLETED (or REJECTED/CANCELLED; `accept` only from
  SENT — send is the mandatory gate), and task OPEN→IN_PROGRESS→DONE/CANCELLED.
- **Timeline projection from outbox events.** `src/events/consumers/
  timeline.consumer.ts` is a real `OutboxConsumer` ("timeline-projection")
  mapping 12 event types onto `PatientTimelineEntry` rows. Each entry is pinned
  to its source event via unique `(organizationId, sourceEventId)` so replays
  upsert instead of duplicating; `ProcessedEvent` rows (unique org+consumer+
  eventId) dedupe delivery. Consumers register under the `OUTBOX_CONSUMERS`
  multi-token (`src/events/outbox-consumer`) and run on the unscoped client
  with explicit `organizationId`. `src/database/outbox-publisher.service.ts`
  claims rows with `FOR UPDATE SKIP LOCKED`, dispatches, and records
  PUBLISHED/FAILED/DEAD. **Two product bugs found and fixed by the e2e
  acceptance:** (1) the tenant extension's `upsert` branch injected an invalid
  `data` argument — Prisma upserts take `create`/`update`, so `CodeConcept`
  imports blew up; fixed in `src/database/prisma.service.ts`. (2) the publisher
  ran its whole dispatch loop inside one interactive transaction, hitting
  Prisma's 5 s default timeout as soon as a batch exceeded a few events —
  restructured to claim in a short transaction, dispatch outside any
  transaction, and mark each row's status in its own short transaction (safe
  because consumers are idempotent).
- **Schema + RLS (migration `20260923120000_phase4_clinical`):**
  encounter, clinical_note, clinical_note_version, clinical_note_template,
  diagnosis, coding_system, code_concept, follow_up, referral, task, workflow,
  workflow_transition tables with `tenant_isolation` policies + `GRANT`s and the
  `processed_event` / timeline-unique indexes, verified against scratch Postgres
  and applied via `prisma migrate deploy` in e2e.
- **Permissions + events.** Catalog additions: `diagnosis.read/create/update`,
  `clinical_notes.manage`, `encounters.manage`, `coding.read/manage`.
  `role-matrix.ts` grants clinical roles (DOCTOR / CLINICAL_OFFICER /
  NURSE / RECORDS_OFFICER / MANAGER / HOSPITAL_ADMIN, etc.) `workflows.*`,
  `encounters.*`, `referrals.*`, `tasks.*`, `codings.*` and the clinical-groups
  per the matrix. New events: `Clinical.*` (encounter, note, diagnosis,
  follow-up, referral, task) and `Reference.CodingSystemImported`.
- **Acceptance.** `test/e2e/phase4-clinical.e2e-spec.ts` — 13 tests covering
  the encounter walk + terminal lock (no new clinical entries after COMPLETED),
  encounter list filtering, versioned note draft → finalize → amend with a 2-row
  history (direct FINAL edits rejected), invalid sections 400, coding-system
  import (inserted=2) → search → coded diagnosis → resolve → empty problem list,
  fabricated codes 404, follow-up / referral / task flows, workflow custom edges
  (OPEN→COMPLETED blocked before, allowed after; reopen stays locked), the
  event-built patient timeline idempotent under replay, and role separation
  (receptionist / accountant / nurse-shaped permission sets). Unit suites added
  for workflow-core, encounter-flow, note-versioning, coding-import,
  diagnosis-flow, and the follow-up/referral/task flows (24 suites / 160 unit
  tests total).

## Phase 6 — Inventory & pharmacy (COMPLETE; the brief's Phase 5)

Medication catalog with optimistic concurrency, suppliers, purchase orders and
receiving, batch-level stock with FEFO dispensing under concurrency, branch
transfers, stock counts, an append-only inventory ledger, restock/expiry alerts
projected from events, prescriptions with a partial-dispense workflow, and a
pharmacy task outbox consumer.

Done:

- **Medications.** `src/modules/medications` — CRUD with `version` optimistic
  concurrency (stale update → 409 `VERSION_CONFLICT`), optional `activeIngredient`
  / `strength` / `form` / `manufacturer`, status gating (DISCONTINUED
  medications reject dispensing and receiving).
- **Suppliers.** `src/modules/suppliers` — org-scoped supplier CRUD used by
  purchase orders.
- **Purchase orders.** `src/modules/purchase-orders` — full lifecycle
  DRAFT → PLACED → RECEIVED (or CANCELLED) validated through the workflow
  engine; illegal moves (received→placed, over-receive) are 409/400. Receiving
  creates batch stock and emits the inventory ledger. Money is
  `Decimal(12, 2)` and surfaces as strings (ADR-029).
- **Inventory.** `src/modules/inventory` — batch stock (`StockBatch`,
  status AVAILABLE/LOW/RESERVED/EXPIRED), FEFO allocation in a pure domain
  function (`allocateFefo`: expiry-asc, null-last; can split across batches;
  all-stock < requested → 409 `INSUFFICIENT_STOCK`, eligible-only shortfall →
  409 `MEDICATION_EXPIRED`). Dispensing and applied transfers take `FOR UPDATE`
  batch-row locks (`lockBatchRows`, raw SQL with explicit quoted camelCase
  columns) so a concurrent last-unit consumption yields exactly one 201 and one
  409 (e2e asserts). An append-only `InventoryLedgerEntry` (DB trigger blocks
  UPDATE/DELETE) records RECEIVED / DISPENSED / TRANSFER_OUT / TRANSFER_IN /
  ADJUSTMENT legs. Branch transfers are two-leg under the same-set lock; stock
  counts (`StockCount` OPEN → COUNTED → APPLIED) snapshot per-branch on-hand
  and application writes the ADJUSTMENT leg. `GET /stock/advisories` computes
  LOW_STOCK + EXPIRY_RISK alerts from serialized usage.
- **Prescriptions.** `src/modules/prescriptions` — provider-written →
  OPEN → PARTIALLY_DISPENSED → DISPENSED (or CANCELLED) with the dispatch flow
  enforcing FEFO per line; repeats on the same prescription are legal until
  DISPENSED. Integrating directly with dispensing (repeats consume from the
  same prescription id).
- **Pharmacy task consumer.** `src/events/consumers/pharmacy-tasks.consumer.ts`
  — a real `OutboxConsumer` ("pharmacy-tasks") listening to 7 pharmacy events
  and opening/driving a pharmacy `Task` per prescription (deterministic task id
  = prescriptionId, so replays are idempotent); `createdById` resolves the
  actor (or the prescription provider) because `task.createdById` is a strict
  FK to `user` and no system user exists.
- **Schema + RLS (migration `20260924120000_phase5_inventory_pharmacy`):**
  medication, supplier, purchase_order, purchase_order_item, stock_batch,
  inventory_ledger_entry, stock_transfer, stock_transfer_item, stock_count,
  stock_count_item, prescription, prescription_item tables with
  `tenant_isolation` policies + `GRANT`s and an append-only
  `inventory_ledger_entries` trigger, verified against scratch Postgres and
  applied via `prisma migrate deploy` in e2e.
- **Permissions + events.** Catalog additions: `medications.read/create/update`,
  `suppliers.*`, `inventory.*` (receive, dispense, transfer, counts),
  `purchase_orders.*`, `prescriptions.*`. `role-matrix.ts` grants unit roles
  (PHARMACIST, PHARMACY_TECH, INVENTORY_OFFICER, HOSPITAL_ADMIN) the inventory /
  pharmacy groups; `doctor` keeps `prescriptions.create/read` but NOT
  `pharmacy.dispense`. New events: `Pharmacy.*` (medication, receive, dispense,
  transfer, count, purchase-order, prescription).
- **Acceptance.** `test/e2e/phase5-inventory.e2e-spec.ts` — 16 tests: catalog
  CRUD + optimistic lock, suppliers, receiving (batch row, ledger leg),
  FEFO split dispense (near-expiry batch drained before the distant one),
  insufficient / expired 409s, concurrent last-unit dispense (one 201 / one 409),
  PO lifecycle + illegal moves + over-receive, branch transfer both ledger legs,
  stock count create→record→apply (on-hand reset + ADJUSTMENT leg), alerts,
  pharmacy task projection under replay, role separation (doctor cannot
  dispense), idempotency-key replay (reproduces the original 201 status, no
  double-dispense). The original-status replay and the raw-SQL `lockBatchRows`
  caveat are documented in `docs/limitations.md`. Unit suites added for
  fefo, stock-risk/ledger, and the prescription-flow / po-flow domains (27
  suites / 182 unit tests total).

## Phase 7 — Billing & invoicing (COMPLETE; the brief's Phase 7)

Price list, invoices, payments, and insurance claims with money kept as
`Decimal(12, 2)` and surfaced as strings (ADR-029, `toFixed(2)`). Invoices and
payments ride the workflow engine, and claim payouts post
`method: INSURANCE` payments that settle the underlying invoice.

Done:

- **Price list.** `src/modules/billing/` — org-scoped active/inactive
  `BillableItem` CRUD (`version` optimistic concurrency, stale update → 409),
  categories CONSULTATION / LAB / IMAGING / PROCEDURE / MEDICATION / OTHER,
  optional branch scoping, `insuranceEligible` flag. Prices snapshot onto
  `InvoiceItem` rows at create time (later repricing never rewrites history).
- **Invoices.** `src/modules/billing` — DRAFT → ISSUED → PARTIALLY_PAID → PAID
  (or CANCELLED only while unpaid) with derived-settle transitions on the
  workflow engine. Line totals / subtotal / tax (`taxRate` as percentage) /
  discount / total / balanceDue computed in a pure domain function
  (`billing-flow.ts`). Discount cap + per-line price math rejects
  over-discounting; a line must reference a price-list item or carry
  `description + unitPrice` (ad-hoc is legal). `INV-YYYY-NNNNNN` numbering via
  the `counters` table inside the same tx (idempotent on a unique
  invoice_number). Refund flows go through the same action controller
  (`PAID → REFUNDED` keeps the ledger, payments are marked REFUNDED and the
  balance reopens).
- **Payments.** `createPayment` under an atomic `updateMany { dueBalance >=
  amount }` guard (concurrent double-payment → one 201 + one 409), status
  recomputed via `settleInvoiceStatus`; `RCT-YYYY-NNNNNN` receipts. Overpayment
  is rejected (400); payment on DRAFT is rejected (409
  `INVALID_WORKFLOW_TRANSITION`); refunding a payment re-opens the invoice
  (PAID → ISSUED edge). Idempotency-key replays reproduce the stored status (201).
- **Insurance.** Payers (active flag), patient policies (FULL / PARTIAL with
  `coveragePercent`, patient-number + policy-number matching), and claims
  DRAFT → SUBMITTED → APPROVED / PARTIALLY_APPROVED / DENIED → PAID. Actions
  validate amount bounds (`approvedAmount` cannot exceed the claim), require a
  deny reason, and `pay` posts an `INSURANCE` payment for the approved amount,
  settling the invoice's remaining balance.
- **Schema + RLS (migration `20260925090000_phase6_billing`):** billable_item,
  invoice, invoice_item, payment, insurance_payer, patient_insurance_policy,
  insurance_claim tables with `tenant_isolation` policies + `GRANT`s, appended
  to the preceding 8 migrations and verified against a scratch Postgres and via
  `prisma migrate deploy` in e2e.
- **Permissions + events.** Catalog additions: `billing.manage` plus
  `billing.read/create/update`, `payments.create/read`, and a new `insurance`
  group (`insurance.manage/read`). `role-matrix.ts` grants RECEPTIONIST
  (billing create, payments, insurance.read), ACCOUNTANT (manage + insurance.
  manage), MANAGER (read), AUDITOR (read-only). New events:
  `Billing.InvoiceIssued/InvoiceCancelled/InvoiceRefunded`,
  `Billing.PaymentCompleted/PaymentRefunded`, and
  `Billing.ClaimSubmitted/ClaimDecided/ClaimPaid`, wired into the timeline
  consumer.
- **Acceptance.** `test/e2e/phase6-billing.e2e-spec.ts` — 14 tests: price-list
  CRUD + optimistic locking + string money, DRAFT invoice price-snapshots +
  INV numbering, discount/tax math + inactive/cross-branch rejection,
  partial-then-full settle with RCT receipts + move to PAID, payment refund
  reopening the balance, full invoice refund (payments → REFUNDED), cancel-only-
  while-unpaid, idempotent payment replay, payer/policy matching (including a
  patient-mismatch 400), the full insurance claim lifecycle posting an INSURANCE
  payout, partial approval + cash top-up, role separation (auditor read-only),
  and a cross-tenant isolation check (org B's invoice is 404 from org A).
  Unit suites added for `billing-flow` (invoice settle math, line totals,
  action guards) and `billing-number` (counter keys + formatting) — 29 suites /
  196 unit tests total.

## Phase 8 — Laboratory & radiology (COMPLETE; the brief's Phase 6)

Org-configurable lab-test catalog, order/sample/results lifecycle on the
workflow engine, and a radiology order + imaging-report flow behind seams
(`ImagingProvider` / `PacsGateway`) so modality/PACS integration can land later
without touching the domain.

Done:

- **Test catalog.** `src/modules/laboratory/` — org-scoped `LabTest` CRUD with
  `version` optimistic concurrency (stale update → 409) and categories
  (BLOOD / URINE / MICROBIOLOGY / HISTOPATHOLOGY / GENETICS / OTHER). Reference
  and critical ranges live on `LabTestField` (org-configurable), and flags are
  derived from those configured ranges only — non-numeric fields never
  auto-flag. `isActive` toggles; ordering a deactivated test is rejected.
- **Orders + samples.** `lab_order` ordered → collected → received → processing
  → result_ready → verified → released on the workflow engine, with a mirrored
  `LabSample` row (numbering `LAB-ORD-YYYY-NNNNNN` / `LAB-SMP-YYYY-NNNNNN` via
  the `counters` table). Rejection is terminal for the sample (`REJECTED`);
  recollection records `recollectsFromOrderId` pointing at the rejected
  sample's **order** (not the sample id). Sample status mirrors the order and
  lands `COMPLETED` once results are ready/verified/released.
- **Versioned results.** `enterResults` writes `versionNumber` ORIGINAL results
  (one per test field, unique per `(organizationId, orderId, testId)`,
  upsert-style on the field rows) with `isAbnormal` / `isCritical` computed
  against the current catalog ranges. Amending pre-release appends a
  superseding version (`versionNumber` + 1, `amendedById` / `amendedAt` /
  `amendmentReason` required) — nothing is mutated in place, and the DTO
  surfaces `results` grouped per test item. Verification stamps
  `verifiedById` / `verifiedAt`; the org setting
  `settings.laboratory.requireDifferentVerifier` (default false) forces a
  different actor when enabled. Critical results must pass through
  `acknowledgeCriticalResult` before release (409 `LAB_RESULT_NOT_ACKNOWLEDGED`
  otherwise); acknowledging twice is idempotent. The `criticalResults` array is
  surfaced on the serialized order.
- **Release + amendment after release.** `release` is the last transition;
  post-release amendments are rejected. `reopen` (released → result_ready)
  then re-enter + re-verify + re-release; reopened rows snapshot the flag
  computation at re-enter time (no history rewrite).
- **TAT aggregation.** `GET /lab/tat` returns min/avg/max + p95 turnaround
  across completed orders, filtered by `parseDateRange` + optional
  branch/priority/section, computed in-memory from the `releasedAt` −
  `orderedAt` window (a derived aggregate at query time, not a rollup column).
- **Radiology.** `src/modules/radiology/` — `radiology_order` ordered →
  scheduled → performed → reported → verified → released (+ cancelled only
  before performed) on the workflow engine; numbering `RAD-YYYY-NNNNNN`. An
  `ImagingReport` row is created at perform, `submitReport` writes contents +
  `performedById`, it must be verified before release, and release returns it
  on the serialized order. All imaging access goes through the
  `IMAGING_PROVIDER` / `PACS_GATEWAY` tokens backed by no-op implementations
  (`src/integrations/imaging/`) — the seam is swappable without touching the
  domain.
- **Schema + RLS (migration `20260926090000_phase7_laboratory`):**
  lab_test, lab_test_field, lab_test_category, lab_order, lab_order_item,
  lab_sample, lab_result, lab_result_criticality, lab_rejection,
  radiology_order, imaging_report tables, each with `tenant_isolation` policies
  + `GRANT`s, verified via `prisma migrate deploy` on a fresh DB in e2e.
- **Permissions + events.** Catalog additions: `lab.*` (read/order/collect/
  process/verify/release/acknowledge) and `radiology.*` (read/order/process/
  verify/release); role-matrix grants LAB_TECHNICIAN the full lab set (plus
  `radiology.order`), NURSE read + collect, RECORDS_OFFICER / MANAGER / AUDITOR
  read-only. Events:
  `Lab.OrderCreated/SampleCollected/SampleRejected/ResultEntered/ResultAmended/
  ResultVerified/ResultReleased/CriticalResultRaised/CriticalResultAcknowledged`
  and `Radiology.OrderCreated/Performed/ReportSubmitted/ReportReleased`, all
  wired into the timeline consumer. New error codes
  `LAB_RESULT_NOT_ACKNOWLEDGED` (and the existing
  `LAB_RESULT_NOT_VERIFIED`).
- **Acceptance.** `test/e2e/phase7-laboratory.e2e-spec.ts` — 12 tests: catalog
  CRUD + optimistic lock + range flagging, the full order lifecycle with sample
  mirroring, verify-then-release, critical acknowledgement (idempotent) +
  un-acknowledged release rejection, post-release reopen/re-enter/re-verify,
  rejection + recollection pointing at the rejected order, TAT aggregation,
  the radiology lifecycle (cancel window before performed), role separation
  (NURSE cannot process; RECORDS_OFFICER read-only), and cross-tenant
  isolation. Unit suites added for `lab-flow` (transition guards), `lab-number`
  (counter keys + formatting), and `radiology-flow` (action guards) — 32
  suites / 220 unit tests total, e2e 131 tests / 11 suites.

## Phase 9 — Inpatient & emergency (COMPLETE; the brief's Phase 8)

Implemented `src/modules/inpatient/` and `src/modules/emergency/` per brief
§6.9. Unit suites `inpatient-flow`, `inpatient-number`, `emergency-flow` (3
suites / 15 tests) and the e2e `phase8-inpatient` spec (9 tests) land green;
the whole gate passes (35 unit suites / 235 tests, 12 e2e suites / 140 tests).
Wire surface (migration `20260927090000_phase8_inpatient_emergency`): `ward`,
`room`, `bed`, `bed_assignment`, `admission`, `discharge`, `emergency_visit`
(plus a `beds`-scoped `counters` key) — each tenant-isolated with RLS; the
already-shipped `Workflow`/`Event` machinery is reused for admission discharges
and every ED disposition. Access: `wards.*`, `beds.*`, `inpatient.*` and
`emergency.*` groups; HOSPITAL_ADMIN (and above) gets `manage`, DOCTOR /
CLINICAL_OFFICER get the clinical set (inpatient create/transfer/discharge +
emergency register/triage), NURSE read + triage, RECORDS_OFFICER / MANAGER /
AUDITOR read-only.

- **Ward → room → bed hierarchy.** List endpoints nest `rooms`+`beds`;
  `PATCH /wards/:id` is a plain (non-optimistic, no `version` column) update;
  `PATCH /beds/:id/status` is version-guarded (409
  `OPTIMISTIC_LOCK_CONFLICT` on a stale `version`) and accepts only
  AVAILABLE/RESERVED/CLEANING/MAINTENANCE/BLOCKED — OCCUPIED is
  assignment-driven and rejected at the DTO edge (400). `GET /beds` filters by
  `wardId`/`branchId`/`status` with pagination.
- **Admissions with one-bed-one-patient (ADR-032).** `POST /admissions`
  validates an AVAILABLE bed inside an interactive transaction:
  `lockBedForAssignment` issues `SELECT … FOR UPDATE` on the bed row (concurrent
  admit/transfer for the same bed serializes and re-reads committed state), and
  the migration adds the partial unique index `bed_assignments_active_bed_uidx`
  on `(bedId) WHERE "releasedAt" IS NULL` as a hard DB backstop — the index
  violation surfaces as `BED_UNAVAILABLE` (409). The same patient cannot hold
  two active admissions (`ADMISSION_ALREADY_ACTIVE`). Admission numbers
  `ADM-YYYY-NNNNNN` via the org-scoped `counters`. A shared
  `createAdmissionInTx(ctx, …)` runs inside the **caller's** transaction so the
  emergency module commits an ED admit atomically with the inpatient admission
  (source `EMERGENCY`); the direct controller path defaults to
  `OUTPATIENT_CLINIC`.
- **Transfer + discharge.** Transfers close the active `BedAssignment`
  (`releasedById`/`releasedAt`/`reason`) — history is preserved — move the old
  bed to AVAILABLE, and row-lock/claim the target (same-bed transfer is
  400 `VALIDATION_ERROR`). Discharge writes a `Discharge` record (summary,
  instructions, medications/follow-up/document IDs as JSON,
  `hasOutstandingBilling`), steps the admission ADMITTED → DISCHARGED through
  the workflow engine, frees the bed to CLEANING and is single-fire
  (`INVALID_WORKFLOW_TRANSITION` on a second discharge).
- **Emergency department.** `POST /emergency/visits` registers an arrival
  (`ER-YYYY-NNNNNN`), then triage (priority + complaint → `chiefComplaint`),
  optional priority correction, assess (`assessment`), treat (`treatment`) and
  observe drive it to one of three terminal dispositions: admit (creates the
  inpatient admission in-tx and records `admittedAdmissionId`), refer
  (`referredTo` + `referralNotes`) or discharge. All transitions stamp their
  timestamps (`arrivedAt`/`triagedAt`/`assessedAt`/`treatmentStartedAt`/
  `observedAt`/`dispositionAt`); terminal visits reject every action with
  `EMERGENCY_VISIT_CLOSED` (409). `GET /emergency/summary` answers today's
  arrivals/active buckets, avg minutes to triage and disposition, plus
  by-priority/by-disposition tallies.
- **Events, roles, isolation.** New catalog events
  `Inpatient.AdmissionCreated/AdmissionTransferred/AdmissionDischarged/
  BedStatusChanged` and `Emergency.VisitRegistered/VisitTriaged/
  PriorityRecorded/VisitAssessed/VisitTreatmentStarted/VisitObserved/
  VisitAdmitted/VisitReferred/VisitDischarged`, all consumed by the timeline
  projection. Permissions land in `permissions.catalog.ts` + role-matrix.
  E2e asserts role separation (clerk 403 on triage; auditor read-only) and
  cross-tenant invisibility (another org's ward/bed/admission/visit return
  404/empty).
- **Acceptance.** `test/e2e/phase8-inpatient.e2e-spec.ts` — 9 tests: hierarchy
  + manual bed status rules; admission onto an AVAILABLE bed (OCCUPIED bed
  state, `ADM-` number, active-assignment invariant); `Promise.all` concurrent
  admits for the same bed → exactly `[201, 409]`; transfer history + bed states;
  single-fire discharge to CLEANING; the full ED workflow through an inpatient
  admission (source EMERGENCY on the linked admission) + terminal-visit
  rejection; refer/discharge + summary analytics; clerk 403; cross-tenant.

## Phase 10 — Communication & documents (COMPLETE; the brief's Phase 9)

- **Notifications.** `Notification` model (organization, recipient user,
  channel `IN_APP`, `templateKey`, subject/body copy, `status`, read-flag,
  `recipientPatientId`). Neutral-only templates: built-ins
  (`appointment.booked`, `task.assigned`, `lab.result.released`) carry only
  entity-id references; custom templates are created via
  `POST /notifications/templates` under `notifications.manage`, each render is
  gated by `ensureNeutralBody` which strips uuid-shaped references before
  scanning for emails/phones/national IDs/passwords
  (`NOTIFICATION_TEMPLATE_FORBIDDEN` 400 otherwise), and `renderTemplate`
  rejects any variable outside the template allowlist. `NotificationConsumer`
  turns `Scheduling.AppointmentBooked`, `Task.StatusChanged` and
  `Lab.ResultReleased` outbox events into in-app notifications for the actor.
  Delivery adapters (push/email/SMS/null) are structural no-ops — see
  `docs/limitations.md`. Read/unread listing + bulk `PATCH /notifications` +
  preference toggle round out the module (`notifications.read`).
- **Messaging & telemedicine.** Peer conversations (`Conversation`,
  `ConversationParticipant`, `Message`) with `messaging.*` permissions and an
  `isAllowedInConversation` access domain (participant/tenant checks); patients
  messaging is subject to `MESSAGING_RESTRICTED`/`PATIENT_MESSAGING_PERMITTED`
  org settings; `MessageSent` events feed the timeline. Telemedicine `Session`
  state machine SCHEDULED → STARTED → ENDED / CANCELLED with
  `TELEMEDICINE_CONSENT_REQUIRED` (409) blocking START until recorded consent
  and provider-actor enforcement; `Conference.ProviderCreated` event.
- **Quality.** `Feedback` (rating/submission, NEW → ACKNOWLEDGED → RESOLVED →
  CLOSED), `Complaint` (OPEN → ASSIGNED → INVESTIGATING → RESOLVED → CLOSED;
  close requires a resolution first) and `Incident` (OPEN → INVESTIGATING →
  ACTION_PLAN → RESOLVED → CLOSED) state machines, each with the corresponding
  `notifications/feedback/complaints/incidents` permission axes and timeline
  events (`Patient.FeedbackSubmitted`, `Quality.ComplaintOpened`, etc.).
- **Portal.** Patient-self subset of the API: `/portal/me`,
  `/portal/appointments` (upcoming + historical), `/portal/lab-results`,
  `/portal/feedback` — resolved through a `SelfScopeResolver` that forces the
  caller's own patient id and `portal.read` (floor-scoped) so a patient cannot
  read another tenant's data.
- **Document jobs.** `POST /document-jobs/pdf` is a dependency-free skeleton
  driven by `DocumentRenderer` + a no-op `PdfRenderer` provider — merges
  document map data and audits `pdf.rendered`/`document.accessed` events,
  returning the renderer output (200). See `docs/limitations.md`.
- **Outbox composition root.** The database↔modules boundary was flaky when
  built on Nest `multi: true` OUTBOX_CONSUMERS across global module scopes (the
  merged array silently dropped the database-registered consumers). A @Global
  `OutboxModule` now composes it as a single factory array
  `[timeline, pharmacyTasks, notifications]` plus the dispatcher and
  `OutboxPublisherService` (ADR-033). Notification delivery robustness fix:
  `ensureNeutralBody` masks uuid-formatted references before PHI pattern
  matching because `uuidv7` suffixes frequently contain 8+ digit runs that
  tripped the phone regex and poison-messaged the outbox (ADR-034).
- **Schema/RLS.** Back-relations/settings on existing tenants + ten new models
  regulated by the shared tenant `RLS` policy; migration verified with
  `migrate deploy` on `careos_fresh`.
- **Acceptance.** `test/e2e/phase10-communication.e2e-spec.ts` — 12 tests:
  booking a slot emits a neutral staff notification (no patient PHI, read +
  preferences lifecycle under `notifications.read`); conversation create/send/
  list + participant-tenant isolation; telemedicine consent gating + provider
  transition enforcement; feedback/complaint/incident state machines incl.
  close-before-resolve rejection; portal self-scope (other tenant's
  appointment/lab-result/feedback invisible, `portal.read` floor); document
  job render + audit events; cross-tenant isolation.

## Phase 11 — Financial ledger & M-PESA (COMPLETE; the brief's Phase 7)

- **Double-entry ledger (`/ledger`).** Chart of accounts is per-tenant,
  auto-seeded to the six default codes (1000 Cash, 1200 AR, 2100 Accounts
  payable, 3000 Equity, 4000 Revenue, 5000 Expenses) on first posting, exposed
  under `ledger.read`. Financial periods are `OPEN → CLOSED → LOCKED`
  (`POST /ledger/periods`, `/:id/close`, `/:id/lock`) with unique `code` and
  no-overlap enforcement. Manual journals (`POST /ledger/journal`) take
  single-side lines (debit XOR credit, DTO-enforced), assert balanced
  debits=credits (422 `UNBALANCED_JOURNAL`), resolve the covering OPEN period
  (409 `PERIOD_LOCKED` when the date lands in a closed/locked or overlapping
  set, ADR-035), and persist via the database BALANCE_GUARD trigger +
  single-side CHECK. `JRN-` numbering shares the billing sequence. Reversal is
  one-shot (`REVERSED`) and refused for auto-posted journals. Trial balance
  (`GET /ledger/trial-balance`) is sign-normalized per `normalBalance`, includes
  POSTED + REVERSED rows so cancellations net to zero, and reports debit/credit
  column totals that must be equal.
- **Auto-posting (outbox).** `LedgerPostingConsumer` turns `InvoiceIssued`,
  `InvoiceCancelled`, `PaymentCompleted`, `PaymentRefunded` into journals
  per the charted map (DR AR 1200 / CR Revenue 4000; DR Cash 1000 / CR AR 1200;
  …) with the idempotency guarantee of the unique
  `(organizationId, referenceType, referenceId)` index and reversed-event
  tolerance for same-ms outbox ordering. When the source date falls in a
  CLOSED/LOCKED period it writes an auditable `LedgerPostingException` and
  returns normally — it never poisons the outbox row for the sibling timeline/
  notification consumers (ADR-035).
- **M-PESA (`/mpesa`).** `POST /mpesa/stk-push` initiates a Daraja STK push via
  the `MpesaIntegrationModule` seam (mock in tests/dev, Daraja adapter is a
  structural placeholder — see `docs/limitations.md`): invoice must be
  ISSUED/PARTIALLY_PAID and the amount must not exceed `balanceDue`
  (409 `MPESA_PROVIDER_UNAVAILABLE` on provider failure). Requests are PENDING
  until the public webhook `POST /mpesa/callback` arrives, gated by the
  `x-careos-mpesa-callback-secret` header (401 otherwise). The callback is
  processed exactly-once (PENDING→SUCCEEDED guard): success at the requested
  amount books a CASH-method `MPESA` payment (invoice balance-decrement gte
  guard, receipt `RCT-`, emits `PaymentCompleted` + `Mpesa.PaymentConfirmed`);
  `ResultCode 0` with a different amount → `MISMATCHED` with **no** payment;
  any failure → `FAILED`. `POST /mpesa/requests/:id/status-query` polls the
  provider.
- **Reconciliation (`/mpesa/reconcile`).** `classifyPayment` matches the
  provider statement (`listProviderTransactions`, default 24h window) against
  booked MPESA payments (external-reference keyed), producing per-reference
  verdicts `MATCHED` / `UNMATCHED` / `DUPLICATE` / `AMOUNT_MISMATCH` /
  `REFERENCE_MISMATCH` (FAILED pushes are ignored — no money moved). Each run +
  matches persist, and `POST /mpesa/matches/:id/resolve` stamps an audited
  resolution (VERIFIED/CORRECTED/PAID_OUT_OF_BAND/DUPLICATE_REFUNDED/
  WRITTEN_OFF/ESCALATED) — a second resolution is 409
  `RECONCILIATION_ALREADY_RESOLVED`. Emissions drive the timeline.
- **Schema/RLS.** Seven new models (`ChartAccount`, `FinancialPeriod`,
  `FinanceTransaction`, `FinanceTransactionLine`, `LedgerPostingException`,
  `MpesaRequest`, `MpesaReconciliation*, MpesaProviderTransaction`,
  `PaymentMethod.MPESA`) all under the tenant `RLS` policy; migration
  `20260928120000_phase11_financial` verified with `migrate deploy` on a fresh
  DB and exercised against the single-side CHECK and the balance trigger.
- **Acceptance.** `test/e2e/phase11-financial.e2e-spec.ts` — 10 tests: org A
  auto-posting (issued + payment journals, idempotent re-drain) then the
  PERIOD_LOCKED exception path; org B manual journals (period open
  close/lock/overlap, balanced/both-sides validation, reversal, sign-normalized
  trial balance with equal column totals); STK initiate + secret-gated callbacks
  + exactly-once replay + invoice settlement; amount-mismatch callbacks that
  book nothing and show up UNMATCHED; failed-push reconciliation; single- and
  second-resolve semantics; permission separation. Unit coverage lives in
  `test/unit/ledger/` and `test/unit/mpesa/`.

## Phase 12 — Operations (COMPLETE; the brief's Phase 10)

- **Expenses (`/expenses`).** `POST` creates a DRAFT expense (branch +
  department/supplier optional, category/amount required) numbered
  `EXP-YYYY-NNNNNN` from the org-scoped `counters` row (same concurrency model
  as billing). Lifecycle is `DRAFT → SUBMITTED → APPROVED/REJECTED`, with
  payment tracked separately (`UNPAID → PAID`). Content edits are DRAFT-only
  with optimistic `version` (409 `VERSION_CONFLICT` on staleness); `submit` is
  creator-only; `approve`/`reject` must come from a different user (403
  `SEGREGATION_VIOLATION`); rejection requires a non-blank reason and is
  terminal (no approve/pay/cancel/submit); `pay` only on APPROVED + UNPAID
  (`EXPENSE_ALREADY_PAID` otherwise); `cancel` only on DRAFT/SUBMITTED
  (creator-only once SUBMITTED). Filters: status/paymentStatus/category/
  branch/supplier.
- **Operations ledger posting (ADR-036).** The outbox `LedgerPostingConsumer`
  maps `Operations.ExpenseApproved` → DR 5000 Expenses / CR 2100 Accounts
  payable (date = approvedAt) and `Operations.ExpensePaid` → DR 2100 / CR 1000
  Cash (date = paidAt), idempotent via the shared
  `(organizationId, referenceType, referenceId)` unique index. An approval into
  a CLOSED/LOCKED period writes a `LedgerPostingException` and still acks the
  outbox row — the consumer never throws (ADR-035). `_sum`-based supplier
  analytics filter on `status = APPROVED` only (payment state is a separate
  column) — the original `['APPROVED','PAID']` status probe would have thrown a
  Prisma enum error (caught by the e2e run).
- **Assets (`/assets`).** `assetTag` is normalized (trim + uppercase + hyphen
  collapsing) and org-unique (409 on duplicates). CRUD keeps lifecycle out of
  `PATCH` (retirement via `PATCH {status}` is 409 `ASSET_STATE_CONFLICT`);
  `POST /:id/retire` is a one-way ACTIVE/MAINTENANCE → RETIRED transition that
  cannot repeat. Maintenance flags flip via the plain update. Filters:
  status/category/branch/search.
- **Maintenance (`/maintenance`).** Records progress through
  `PLANNED → IN_PROGRESS → COMPLETED` (or cancelled), mirroring the asset
  status (`ACTIVE → MAINTENANCE → ACTIVE`) inside the same transaction. Only
  PLANNED jobs reschedule; completion records `downtimeHours` + `cost`;
  a completed job cannot restart (all 409 `MAINTENANCE_STATE_CONFLICT`).
- **Reminders (structural stub).** `POST /maintenance/reminders/queue` scans
  PLANNED records due within a 72h forward / 24h past window and inserts one
  `MaintenanceReminder` per record (unique org + record, so runs are
  idempotent: `{queued, skipped}`). `POST /reminders/:id/sent` marks delivery.
  Since P5 the same scan also runs on a cadence from the scheduler
  (`maintenance-reminders` duty, ADR-044); reminder *delivery* is still a stub
  — see `docs/limitations.md`.
- **Waste management.** `POST /pharmacy/stock/write-off` drains batches via
  the same row-locked FEFO used by dispensing, records `WASTAGE` ledger rows
  (negative quantity, batch `purchaseCost` carried through for valuation,
  reference `stock_write_off`), and emits `StockWriteOff`. The procurement
  wastage report (`/analytics/procurement/wastage`) aggregates `|quantity|` per
  medication with estimated value; `inventory.wastage` is granted to
  HOSPITAL_ADMIN and PHARMACIST.
- **Schema/RLS.** New tenant models `Expense`, `Asset`, `MaintenanceRecord`,
  `MaintenanceReminder` (plus the `Expense*`/`Asset*`/`Maintenance*`/
  `StockWriteOff` event catalog and permission groups) all under the existing
  RLS policy; numbering reuses the `counters` table. Migration is additive
  (`migrate deploy` idempotent).
- **Acceptance.** `test/e2e/phase12-operations.e2e-spec.ts` — 10 tests: expense
  lifecycle + EXP numbers + DRAFT-only edits; approval workflow + segregation +
  pay-once; REJECTED-terminality; ledger auto-posting (5000/2100 + 2100/1000
  legs asserted by account code) with idempotent re-drain and CLOSED-period
  `LedgerPostingException`s; asset tag uniqueness/search/retire-once; a full
  maintenance run with asset flips + downtime/cost; idempotent reminder
  queueing; write-off → wastage report (`12` units, `120.00` value) +
  INSUFFICIENT_STOCK; permission separation. Unit coverage: new
  `test/unit/operations/operations-flow.spec.ts` plus the expanded
  `test/unit/ledger/ledger-flow.spec.ts` for the two expense legs.

## Phase 13 — Analytics & reports (COMPLETE; the brief's Phase 11)

Implemented `src/modules/insights/` — daily rollups, metrics, bottleneck &
capacity, labelled forecasts, patient-experience composite, staff analytics,
role dashboards, report exports, and revenue-leakage reconciliation. Unit
suites `test/unit/insights/` (forecaster, rollup-cells, classification,
report-builder, patient-experience + window — 5 suites / 31 tests) and the e2e
`phase13-analytics` spec (13 tests) land green; the whole gate passes (52 unit
suites / 371 tests, 16 e2e suites / 185 tests).

- **Daily rollups (recompute-on-event, ADR-037).** `DailyRollup` rows are full
  per-org-day recomputes keyed `(organizationId, date, branchId, departmentId)`.
  The `rollup-touch` outbox consumer (`rollups.consumer.ts`) subscribes to 40+
  domain events and recomputes each decoded business-day for the payload —
  replays are idempotent because `recomputeDay` re-reads committed state and
  upserts by the unique key. Cells carry ~35 counters (visits, queue
  tickets/wait/served/no-show, appointments incl. reschedules, encounters,
  consultation minutes, diagnoses, tasks, prescriptions + units dispensed,
  stock lots, lab orders/releases/rejections + TAT, radiology orders/reports,
  admissions/discharges, emergency arrivals/triage + minutes, invoices,
  payments, refunds, claims paid/submitted, feedback ratings). Branch+dept
  cells keep their own rows; org-wide-only events (payments/claims/diagnoses/
  tasks) live in the `('','')` cell; recompute then **rolls every cell up into
  the org-wide cell** so un-scoped reads see the whole org. `POST
  /analytics/rollups/rebuild` repairs a 1–30 business-day window on demand.
- **Metrics (`/analytics/metrics`).** `summary` (patient/appointment volume,
  revenue etc.) + a 31-row `series` from the rollup projection (zero-filled
  missing days) + `snapshots` reading raw tables on demand: outstanding
  invoices (`balanceDue`), medication wastage value, stock turnover
  (`turnover` null when no on-hand), provider utilization, bed occupancy
  (active admissions in beds), claim aging by `submittedAt` buckets, and
  emergency intake (arrivals, avg minutes to triage, untriaged now, per-branch,
  per-hour).
- **Bottleneck & capacity.** `/analytics/bottleneck` walks raw visits +
  encounters + lab orders to rank stages (REGISTRATION_TO_TRIAGE,
  CONSULTATION, BILLING, DISCHARGE, LAB) by avg/min/max minutes with sample
  counts, `null` when a stage has no samples. `/analytics/capacity` reports
  provider slots booked/pending vs scheduled per provider per day, and
  department demand windows → recommended appointments/walk-in/day (mean +
  p95, bump when a plus-tolerance threshold passes).
- **Labelled forecasts (`/analytics/forecasts/:series`).** Pure-domain
  forecasters (`forecaster.ts`): moving-average and seasonal-naive, each
  returning `{ kind, horizon, points, ... }` where the mode is labelled
  (`'above-average' | 'within-average' | 'below-average'` via `classification.ts`)
  so the API never guesses meaning; unknown series names return a normal
  ForecastResult whose notes explain why. Supplies the admin dashboard's
  appointment-demand forecast (7-day horizon).
- **Patient experience (`/analytics/patient-experience`).** Weighted composite
  over configurable weights (`organizationSetting` `patientExperience.weights`,
  defaulted) from rollup counters: waitingTime (avg wait inverted, p95 via
  `resolveWindow`), reliability (non-cancelled/no-show bookings ratio),
  completion (visits completed / registered), and feedback score
  (rating 1–5 → 100-scale). Unknown weights trigger 400 `VALIDATION_ERROR` and
  zero total weight yields a null composite.
- **Staff analytics (`/analytics/staff`).** Per-provider slots, bookings,
  visits, completions, avg consultation, no-shows, and a utilization estimate,
  assembled from schedules/appointments + encounters + visits/queue rows.
- **Role dashboards (`/dashboards/:role`).** `ADMIN`/`MANAGER`/`CLINICAL`/
  `FINANCE`/`OPERATIONS` each produce a single payload of targeted widget values
  (patient/appointment volume, revenue, occupancy, utilization, outstanding
  balance, lab TAT, pharmacy expiring/empty-stock batches, pending lab orders,
  staff load, forecast; a `FINANCE`-only expenses total restricted to
  `status = APPROVED`). Unknown roles are a DTO 400. Widgets read raw tables
  for point-in-time truth + the rollup for the 7-day forecast.
- **Reports (`/reports`).** Five report types (PATIENT, APPOINTMENT,
  CLINICAL_OPERATIONS, LABORATORY, PHARMACY) export as JSON (summary + rows) /
  CSV / PDF (a real minimal PDF produced by `renderTextPdf`, not a stub —
  see `docs/limitations.md` for the no-streaming caveat). Each export stores an
  org-scoped `ReportExport` row (artifact bytes, `contentType`, `sizeBytes`,
  filename) with a **24h `expiresAt`**; a request for an expired export returns
  410 `RESOURCE_EXPIRED` (the row is lazily flipped to `EXPIRED`), while
  `/exports/:id` and `/exports/:id/download` return the record and artifact,
  both read-side TTL enforced.
- **Revenue-leakage reconciliation (`/reconciliation`).** `POST /reconciliation/run`
  runs a classification pass over the window — `ENCOUNTER_WITHOUT_INVOICE`
  (MEDIUM, suggests invoicing the encounter), `OVERPAID_INVOICE` (HIGH, overpay
  suggestion), `CLAIM_PAYMENT_MISMATCH` (HIGH, claim/ledger amount mismatch) —
  returning `findings` + per-type counts and persisting each finding as a
  `ReconciliationException` (once per run; runs carry `reconciliationRunId`
  links). `GET /reconciliation/exceptions` lists by type/severity/status with
  pagination; `PATCH /reconciliation/exceptions/:id` acknowledges or resolves
  (a second transition off RESOLVED is 409 `RECONCILIATION_ALREADY_RESOLVED`).
- **Schema/RLS.** Migration `20260929120000_phase13_analytics` adds
  `daily_rollup` (with the org-day-scope unique key), `reconciliation_run`,
  `reconciliation_exception`, `report_export` — each tenant-isolated via the
  shared RLS policy, verified with `migrate deploy` on a fresh DB in e2e.
  Permissions: `analytics.read`, `reports.read`, `reports.export`,
  `reconciliation.run/read/manage` added to the catalog + role matrix
  (HOSPITAL_ADMIN + MANAGER get the full set, AUDITOR + RECORDS_OFFICER
  read-only, DOCTOR/NURSE `analytics.read`).
- **Acceptance.** `test/e2e/phase13-analytics.e2e-spec.ts` — 13 tests: rebuild
  then metrics (summary + series + snapshots), analytics 403 without
  `analytics.read`, bottleneck stage averages, capacity
  recommended-appointments instability, labelled forecasts incl. an unknown
  series, the weighted patient-experience composite, staff utilization, all
  five dashboard roles, `reports/export` (JSON/CSV/PDF) + expiry + download +
  list (`meta.totalPages`, `data` unwrapped items) + get + 403, the
  reconciliation run findings + exception list/ack/resolve workflow. The e2e
  caught three real bugs on the way to green: (1) the org-wide rollup cell was
  empty because branch activity never rolled up into it (fixed in ADR-037);
  (2) `OrganizationSetting.data` must hold the nested weights object, not a
  JSON string; (3) page results unwrap to `{ data: items, meta }` so list
  assertions read `data`, matching the Phase 4/5/6 suites.

## Patch — Public directory, emergency requests, session bootstrap, display devices

A backend patch on top of Phases 0–13 adding four capabilities without
disturbing existing modules: `GET /auth/me` + `X-Branch-Id` branch context,
waiting-room display-device pairing (extending the Phase 4 display module), a
cross-tenant public facility directory with location-based search, and public
emergency help requests with a staff inbox, escalation, and caller tracking.

### P0 — Audit & plan (COMPLETE)

No behaviour change. Re-audited the repo against the patch §1–5 guardrails and
recorded the decisions that shape P1–P4:

- **Reused, not rebuilt** — verified these already exist and will be leveraged:
  identity chain `JwtAuthGuard → TenantGuard → PermissionsGuard` with
  `permissionUnion` re-resolution per request (`tenant.guard.ts`, `rbac.ts`);
  deny-by-default routing + `@Public()` + `@ApiEndpoint`; tenant-scoped Prisma
  extension + RLS backstop (`prisma.service.ts`, ADR-005/006) with `TxRunner`
  transactions; transactional outbox + idempotent consumers (timeline, pharmacy,
  notifications, ledger, rollups — ADR-007/027/028/037) and the
  `OutboxModule` composition root; the idempotency interceptor; Redis-backed
  throttler with named policies (`throttlers: default/short`, storage fails
  open); the display module (display device register/pair/revoke/rotate,
  `DeviceAuthGuard` + `queue.display`-only scope, PHI-free board + SSE);
  `EmergencyVisit` ED module; `OrganizationSetting` + per-module settings
  helpers; `FieldEncryption` (AES-256-GCM) already used for TOTP; the
  error-catalog + `ERROR_CODE_HTTP` map; permission catalog + role matrix.
- **Gaps to close in P1–P4** — `/auth/me` exists but is minimal (no org
  feature flags, branches, session, break-glass, security staging, patient
  link, preferences); no `X-Branch-Id` handling (`TenantScope` has no
  `branchId`); no user prefs model; no public directory, no PostGIS, no
  emergency-request model, no platform `SUPER_ADMIN` tooling surface; e2e
  Postgres image is non-PostGIS (plain `postgres:17-alpine`); throttler has no
  per-handler public policies; display device endpoints live at
  `POST /display/devices*` (the brief names `POST /admin/display-devices` +
  `GET /display/queue` — decide in P1 whether to alias); no public-route
  allowlist test; no `lat`/`lng`/phone log redaction beyond the default paths.
- **Decision records landed (ADR-038…042)** — see `docs/decisions.md`:
  public read path is a sanitized `PublicFacilityListing` projection read
  through a dedicated read-only DB role (ADR-038); PostGIS `geography` +
  haversine/bbox fallback with canonical lat/lng doubles (ADR-039);
  emergency escalation as append-only events + idempotent delayed BullMQ jobs
  (ADR-040); field-level AES-256-GCM for emergency PII (ADR-041); `/auth/me`
  shares `permissionUnion` with the guards and `X-Branch-Id` is validation
  within granted branches only, never a widening grant (ADR-042).

**Acceptance:** existing suite unchanged and green — the P0 gate is
`npm run lint && npm run typecheck && npm test && npm run build`.

### P1 — Session bootstrap & display devices (COMPLETE)

Implements brief §5.15 (session bootstrap) and §5.16 (display devices), on top
of the P0 decisions.

- **`GET /auth/me`** now returns the full bootstrap payload: profile +
  security-staging flags (`passwordChangeRequired`, `mfaEnrolmentRequired`),
  organization card + `featureFlags` (advisory, never a grant), `roleSummary`,
  `permissions` (re-resolved per request by `permissionUnion` — parity with the
  permission guard is asserted in the identity e2e), reserved `patient` link,
  active `breakGlass` grant, `session` (id, `mfaMethod`, `mfaVerifiedAt`,
  `securityStaging` weaker/stronger signal, config-derived
  `idleTimeoutSeconds`/`lockAfterMinutes`), `branch` (`current` / `allowed`),
  and `preferences`.
- **`PATCH /auth/me/preferences`** + new `UserPreference` model
  (`locale`, `density`, `defaultBranchId`). Preferences are settings, not
  grants (ADR-042): a default branch is only stored while the user holds it and
  only honoured while that holds. A non-assigned branch → 403
  `TENANT_ACCESS_DENIED`.
- **`X-Branch-Id`** validated in `TenantGuard` against the caller's
  `UserBranch` rows and stored in `TenantScope.branchId`; never a widening
  grant. Unassigned/unknown id → 403. `me()` picks the default branch from the
  preference when no header is present.
- **Display devices** (brief §5.16 contract paths): new `POST
  /admin/display-devices`, `POST /admin/display-devices/:id/rescan` (fresh
  pairing code, the current token dies at once — `Display.DeviceRepairInitiated`
  event), plus list/update/revoke/rotate aliases, and device-facing `GET
  /display/queue` (PHI-free board, device token). Registrations/revokes stay
  on the existing `POST /display/devices*` paths; both are thin aliases over the
  same `DisplayService`.
- **Tests:** identity e2e suite now asserts the /auth/me bootstrap shape and
  permission parity with the granted roles, preference persistence + branch
  validation, X-Branch-Id allow/deny, and the full display register → pair →
  queue → rescan → token-death lifecycle. E2E total: 16 suites / 189 tests
  (+4). Unit 52 suites / 371.
- **Schema:** new `user_preferences` table;
  `organization.featureFlags`, `user.passwordChangeRequired`,
  `user.mfaEnrolmentRequired` columns (migration
  `20260930090000_phase_p1_bootstrap`); `UserPreference` added to
  `TENANT_MODELS`.

**Open notes (see `docs/limitations.md`):** `/auth/me` `patient` is always null
(staff↔patient links are not modelled yet); `idleTimeoutSeconds`/
`lockAfterMinutes` are fixed, config-derived values for this release and are
honest about the access-token/refresh-TTL model that actually enforces
lifetime.

### P2 — Cross-tenant public facility directory (COMPLETE)

Implements brief §6.14 (location-based facility search, facility profiles,
provider listing management, remote facility onboarding) and the public
directory foundation for §6.15 (emergency requests reuse the same
PUBLISHED-only projection).

- **Public read path is cross-tenant and sanitized (ADR-038):**
  `PublicFacilityListing`, `ImportedFacility`, `OnboardingInquiry` are
  projection + intake tables outside `TENANT_MODELS`; tenant scope never
  applies. Reads go through `prisma.unscoped()` in `DirectoryService`/
  `GeoRepository` and expose only a whitelisted serialized shape
  (`serializePublicListing` — no `sourceOrganizationId`/`status`/internal
  fields leak to callers). A dedicated read-only `careos_public` DB role is
  the operator-side hardening for this patch (ADR-038 intent, not provisioned
  here — limitation).
- **Geolocation (ADR-039):** canonical `locationLat`/`locationLng` doubles +
  `GeoRepository` that probes PostGIS once (cached) and uses
  `ST_DWithin`-over-geography candidates with an exact haversine
  distance/rank computed in JS, falling back to bbox narrowing without
  PostGIS. Matches are INTENTIONAL-EXACT only; wait estimates stay null.
- **Public API (`/api/v1/public/...`, all `@Public()`, IP-rate-limited):**
  `GET /public/facilities/nearby` (lat/lng/radiusKm, ranked by
  `distanceKm`), `GET /public/facilities/search`, `GET
  /public/facilities/:slug` (404 `PUBLIC_LISTING_NOT_PUBLISHED` unless
  `PUBLISHED`), `GET /public/facilities/config`, `GET /public/geocode`
  (honest `{supported:false}` with the NoopGeocodingProvider seam), `POST
  /public/facilities/suggest` and `POST /public/onboarding-inquiries`
  (reviews store submitter contact, never coordinates).
- **Provider surfaces:** `GET/PUT /settings/listing` drafts per-branch
  listing settings (`public_listing.manage`); `POST /admin/listings/publish`
  turns them into a PUBLISHED projection (emits
  `Directory.PublicListingChanged`); `GET /admin/listings/mine`; platform
  `platform.facilities.manage` gets list + suspend/unsuspend/confirm/PATCH +
  `POST /admin/listings/import/run` + `POST /admin/listings/import/:sourceId`
  (RFC-4180-ish CSV feed via `FACILITY_DIRECTORY_PROVIDER`, throws
  `DIRECTORY_SOURCE_UNAVAILABLE` while `PUBLIC_FACILITY_SOURCE_CSV_URL` is
  unset).
- **Cache invalidation:** Rabbit–the encode is a revision timestamp; public
  keys are `directory:v{rev}:{base}:{hash}` with a 60s TTL; every publish/
  suspend/update/import `INCR`s `directory:rev` (outbox consumer
  `public-directory-cache` idempotently does the same on the published
  event; platform writes bump inline).
- **Permissions/errors/events:** `public_listing.manage` (HOSPITAL_ADMIN,
  MANAGER, ALL) + `platform.facilities.manage` (ALL); error codes
  `PUBLIC_LISTING_NOT_PUBLISHED` (404), `INVALID_COORDINATES` (422),
  `GEOCODING_UNAVAILABLE` (422), `DIRECTORY_SOURCE_UNAVAILABLE` (503);
  `EventTypes.PublicListingChanged = 'Directory.PublicListingChanged'`
  (version 1); optional `PUBLIC_FACILITY_SOURCE_CSV_URL` env.
- **Schema:** `public_facility_listings`, `imported_facilities`,
  `onboarding_inquiries` + enums (`PublicListingStatus`,
  `PublicVerificationStatus`, `OnboardingInquiryKind`,
  `OnboardingInquiryStatus`) in migration
  `20260930100000_phase_p2_public_directory`. Not in `TENANT_MODELS`.
- **Tests:** new unit spec for the CSV provider + directory domain (slug,
  haversine, settings parse, serializer); new `public-directory` e2e suite
  (publish→anonymous nearby/search/profile → suggest/geocode → suspend 404 →
  confirm/unsuspend, plus permission + deny-by-default checks). E2E total:
  17 suites / 203 (+14). Unit 53 suites / 388 (+17).

**Open notes (see `docs/limitations.md`):** no `careos_public` read-only role
provisioned by the patch (operator step documented in ADR-038);
`NoopGeocodingProvider` is a named stub (no coordinate autofill);
all-published search does not rank by distance; CSV feed disabled by default;
wait estimates are always null (no timeline/ED data in the projection).

### P3 — Public emergency intake (COMPLETE)

Implements brief §6.15 for anonymous help requests: an intake-enabled branch
takes a caller's request through reception → acknowledgment → response with a
multi-level autonomous SLA escalation (ADR-040) and PII encrypted at rest
(ADR-041). Reuses the P2 PUBLISHED projection as the anonymous read gate
(ADR-038) — the public path never touches tenant tables.

- **Public API (`/api/v1/public/emergency/*`, anonymous, IP-rate-limited):**
  `POST /public/emergency/requests` (submit; 404 `PUBLIC_LISTING_NOT_PUBLISHED`
  for unknown slug, 422 `FACILITY_NOT_ACCEPTING_REQUESTS` if the projection is
  disabled or the source pointers are missing, 422 `LOCATION_REQUIRED`/`INVALID_COORDINATES` for location),
  `POST /public/emergency/requests/track` (caller pulls status via the
  once-returned token; only the SHA-256 hash is stored), `POST
  /public/emergency/requests/cancel` (409 `EMERGENCY_CALL_NOW` once a responder
  is dispatched, per `callerAction`), `GET /public/emergency/numbers`
  (reference numbers, built-in KE/EU fallback when none are seeded), `GET
  /public/emergency/notice` (safe `INFO` default).
- **Staff inbox (`emergency_requests.read/manage`):** `GET /emergency/requests`
  (page + newest-first), `GET /emergency/requests/stream` (SSE on the
  `emergency-requests` topic, mirrors the display-device stream), `GET
  /emergency/requests/:id` (decrypted `RequestView` + typed event history),
  `POST /emergency/requests/:id/{acknowledge,respond,note,close}`.
- **Branch policy (`emergency_settings.manage`):** `GET/PUT
  /settings/emergency` (enabled, autoEscalate, per-level `levelSeconds` SLA,
  `emergencyPhone`), `GET/POST/PATCH/DELETE
  /settings/emergency/contacts` (ordered escalation chain).
- **Platform reference tables (`platform.facilities.manage`):**
  `GET/POST/PUT/DELETE /admin/emergency/numbers` and `/admin/emergency/notices`;
  both propagate to the anonymous surfaces.
- **Escalation (ADR-040):** BullMQ `emergency-escalation` queue, job name
  `escalate`, deduped `jobId: '<requestId>-<level>'` (job IDs cannot contain
  `:`). `attemptEscalation` uses a guarded `updateMany` (`where status:
  RECEIVED AND escalationLevel = level-1`) so each level fires exactly once;
  sub-second `levelSeconds` are treated as milliseconds (tests run at 150ms),
  `>=1` as seconds. Acknowledgement/respond/close/cancel stops escalation (the
  guarded update becomes a no-op); the final level is the "call the numbers"
  nudge. `callerAction`: `RESPONDED→HELP_ON_WAY`, terminal/ack→`WAIT`,
  `escalationLevel>0→CALL_NOW`, else `WAIT`.
- **Reference/token model:** `EMR-YYYY-NNNNNN` via the `counters` raw-SQL
  `INSERT … ON CONFLICT` pattern (`emergency_request_number`); tokens are
  32-char base64url, only SHA-256 persisted, returned exactly once.
- **Permissions/errors/events:** adds `emergency_requests.read|manage`
  (HOSPITAL_ADMIN, MANAGER, ALL) + `emergency_settings.manage` (HOSPITAL_ADMIN,
  MANAGER); error codes `FACILITY_NOT_ACCEPTING_REQUESTS` (422),
  `LOCATION_REQUIRED` (422), `INVALID_COORDINATES` (422),
  `EMERGENCY_CALL_NOW` (409) — the new `INVALID_COORDINATES` and
  `PUBLIC_LISTING_NOT_PUBLISHED` cases slot into the P2 set;
  `EventTypes.EmergencyRequest*` (`Received/Acknowledged/Responding/
  Escalated/Closed/Cancelled`, version 1).
- **Schema:** `emergency_intake_policies`, `emergency_contacts`,
  `emergency_requests`, `emergency_request_events` inside `TENANT_MODELS`;
  `emergency_numbers`, `public_notices` are cross-tenant reference tables;
  enums `EmergencyRequestStatus`/`EmergencyRequestEventType`/
  `EscalationActor`/`EmergencyNoticeSeverity`; append-only event trigger (in
  migration `20260930120000_phase_p3_emergency_intake`, which also adds the
  back-relations on `Organization`/`branches`).
- **Tests:** 2 unit suites (escalation domain incl. `callerAction`, submit
  guards + happy path incl. token-hash-only persistence and job scheduling)
  and a 14-test e2e suite (publish intake-enabled listing → anonymous submit →
  token never stored in clear → track/cancel → SLA escalation → ack stops it →
  respond drifts caller to `HELP_ON_WAY` and blocks cancel → inbox decrypt →
  disabled facility rejected → numbers/notice fallback + reference). E2E total:
  18 suites / 217 (+14). Unit 56 suites / 401 (+13).

**Open notes (see `docs/limitations.md`):** escalation is best-effort — delayed
BullMQ jobs are lost if Redis is down at fire time; a reconcile + retention
sweep now backstops this (P4). No SMS/voice bridge from escalation "call the
numbers" (action is the terminal nudge); single latest encrypted staff note
without author tracking; anonymous submit requires either a resolvable facility
location or an explicit caller location.

### P4 — Hardening & release (COMPLETE)

Closes the P0/P3 audit gaps flagged for release: rate-limit unit mismatch,
anonymous idempotency, lost-SLA-job reconciliation + PII retention hooks
(ADR-043), throttle buffer fixes, a runnable DEMO seed, and a CI workflow.

- **Rate-limit units fixed.** `@nestjs/throttler` hands `ttl`/`blockDuration`
  to the storage in **milliseconds**; `RedisThrottlerStorage` was treating them
  as seconds — `@Throttle({ ttl: 60_000 })` silently became a ~16.7h window and
  the root throttlers (`ttl: 60` / `ttl: 5`) were 60ms / 5ms (no real limit).
  The storage now floors ms → whole seconds (`toSeconds`, min 1 s) before the
  fixed-window bucket math and `EXPIRE`
  (`src/database/redis-throttler.storage.ts`); root throttlers in
  `database.module.ts` are explicit `{ ttl: 60_000, limit: 120 }` /
  `{ ttl: 5_000, limit: 30 }`. Fail-open behaviour is retained. Unit suite
  `test/unit/database/redis-throttler.storage.spec.ts`.
- **Anonymous idempotency no longer 500s.** The global idempotency interceptor
  (APP_INTERCEPTOR) called `tenantContext.requireOrg()` on every guarded route,
  so any anonymous `POST` carrying an `Idempotency-Key` died with a
  TenantRequiredError. It now reads `scope.organizationId` and passes through
  when there is no tenant scope (the public emergency submit is guarded at the
  payload layer by the dedupe window instead). Also persists the route's **real**
  `reply.statusCode` (e.g. 201), so replays reproduce the original status rather
  than a pinned 200 (`src/common/interceptors/idempotency.interceptor.ts`;
  unit suite `test/unit/security/idempotency.interceptor.spec.ts`).
- **Submit dedupe (ADR-043).** `submitPublic` collapses repeat submissions from
  the same normalized phone while an earlier request for that branch is still
  open and inside `EMERGENCY_DEDUPE_SECONDS` (default 120 s): the call returns
  the existing request with `duplicate: true` and no second token is minted.
  Guards the anonymous surface that the HTTP idempotency interceptor cannot
  reach.
- **Escalation chain reopened.** The P3 `attemptEscalation` guard only advanced
  from `status: RECEIVED`, but level 1 flips the read-model to `ESCALATED` — so
  levels ≥ 2 could never fire and the watchdog could not re-promote them. It now
  accepts `RECEIVED | ESCALATED` (the `escalationLevel === level-1` guard keeps
  every level exactly once). This also makes multi-level SLA escalation actually
  work beyond level 1.
- **Maintenance sweep (ADR-043).** The escalation worker (renamed
  `EmergencyIntakeWorker`) now also registers one repeatable `maintenance` job
  per process (`EMERGENCY_SWEEP_INTERVAL_MS`, default 60 s), scheduled only
  outside `NODE_ENV=test` so e2e stays deterministic. One maintenance tick runs:
  - `reconcileEscalations` — scan open RECEIVED/ESCALATED requests (take 100),
    reload enabled+autoEscalate policies, and re-`attemptEscalation` any request
    whose next level is overdue but whose delayed job never fired (Redis
    restart / eviction). The guarded `updateMany` makes it exactly-once even
    against a still-live job.
  - `applyRetention` — for CLOSED/CANCELLED requests older than
    `EMERGENCY_RETENTION_DAYS` (default 90; 0 disables), per request in a tenant
    tx: guarded `updateMany` stamps `retainedAt`, retires the tracking token to
    a deterministic `retired:<id>` sentinel that can never match a SHA-256 hash,
    nulls the caller PII columns (`callerNameEnc`/`callerPhoneEnc`/
    `callerPhoneIndex`/`descriptionEnc`/`landmarkEnc`/`staffNoteEnc`), writes a
    `RETENTION` event (actor `SYSTEM`) + audit row, emits
    `Emergency.RequestRetained`, and publishes to the requests topic. The
    reference number and append-only event history survive for audit.
- **Schema:** `EmergencyRequest.retainedAt` + `@@index([status, retainedAt])`;
  `EmergencyRequestEventType` gains `RETENTION` (migration
  `20261001120000_phase_p4_hardening`).
- **Demo seed.** `prisma/seed.ts` extends demo-org-nairobi / NB-HQ with a fully
  runnable anonymous surface: intake policy enabled (levels 5m/15m/30m, emergency
  phone), 3 ordered escalation contacts, the KE national numbers (999/112/997/
  115), an active public notice, directory listing settings
  (`emergencyIntakeEnabled` + coords) and a PUBLISHED
  `public_facility_listing` projection mirroring the publish() shape — so
  `npm run db:seed` alone makes the whole §6.15 flow exercisable.
- **CI (`github` workflow).** New `.github/workflows/ci.yml`: on push/PR to main
  it runs `npm ci` → `prisma generate` → lint → typecheck → boundaries → unit →
  build, then a Testcontainers e2e job (Docker on the runner).
- **Worker/module wiring.** BullMQ `forRootAsync` now sets `prefix:
  env.BULL_PREFIX` (was declared but unused); the queue is injected into the
  worker; the module registers `EmergencyIntakeWorker`.
- **Tests:** +17 unit (58 suites / 418) covering the throttle unit conversion,
  anonymous idempotency pass-through + scoped replay shape, submit dedupe, the
  reconcile re-promote (RECEIVED → 1 and stuck ESCALATED → level 2), retention
  anonymise/retire/race-skip/disabled, plus a multi-level escalation-chain
  assertion. E2E unchanged at 18 suites / 217.

**Open notes (see `docs/limitations.md`):** the retention sweep does not
distribute PII across shards or rewrite outbox/SSE history; timing-safe token
comparison was deliberately **not** added (tracking lookup is already a single
hash-index equality, so constant-time compare would be dead code); the
repeatable sweep is optimistic (single-writer guarded, but a fleet of app
instances each schedules the same repeatable job — BullMQ dedupes by jobId).

### P5 — Time-based scheduler (COMPLETE)

Lands the platform's first timer (ADR-044), retiring the roadmap's top backlog
item: outbox delivery on a repeatable job instead of a bare `setInterval`, plus
the three sweeps the platform had no timer for.

- **One scheduler queue, four duties.** `SchedulerWorker`
  (`src/modules/scheduler/scheduler.worker.ts`) registers a repeatable BullMQ
  job per duty in `onApplicationBootstrap` with a stable colon-free `jobId`, so
  every API/worker process requests the same repeatable and BullMQ dedupes it
  into one schedule while distributing ticks: `outbox-drain`
  (`OUTBOX_DRAIN_INTERVAL_MS`, 5 s), `maintenance-reminders` (15 min),
  `idempotency-sweep` (1 h), `report-expiry` (5 min). Intervals are env-driven;
  `SCHEDULER_ENABLED=false` registers nothing (worker-less deploy), and nothing
  is registered under `NODE_ENV=test` so e2e stays deterministic.
- **When vs. what.** `SchedulerService` holds the four duties as plain
  idempotent, batched methods with no BullMQ knowledge, so the e2e suite (or an
  operator script) drives the same code paths without Redis. Sweeps
  select-then-write in `SCHEDULER_SWEEP_BATCH`-sized pages and re-assert their
  guard on the write, so a lost race counts 0 instead of corrupting state.
- **Outbox delivery off `setInterval`.** `src/worker.ts` no longer polls: the
  `outbox-drain` duty calls the unchanged
  `OutboxPublisherService.publishReadyEvents(100)` (claim in a short
  `FOR UPDATE SKIP LOCKED` tx, dispatch outside it — ADR-027), and the worker
  bootstrap is now just the application context plus signal handling. A
  process that is not running the worker now simply does not deliver, instead of
  whichever process happened to boot doing it invisibly.
- **Maintenance reminders actually get materialised.** The scheduler drives
  `MaintenanceService.queueReminders({ organizationId, actorId: null })` per
  organization, rotating with a per-process UUIDv7 cursor (a plain `take` would
  starve every org past the first page). The scan itself is unchanged and
  still idempotent per record (unique `organizationId+maintenanceId`), so the
  HTTP route and the cron can never double-create. `queueReminders` grew an
  options argument so a background pass supplies its own organization and a null
  actor (`queuedById` is nullable) instead of requiring a CLS tenant scope; the
  transaction is explicitly scoped, so the RLS-tied tenant path is the same one
  the route uses.
- **Orphaned idempotency records stop being permanent 409s.** An
  `IN_PROGRESS` row left by a crashed/flushed request used to answer
  `409 IDEMPOTENCY_IN_PROGRESS` forever — the interceptor treats a live
  duplicate as a conflict, and nothing ever expired the row. The
  `idempotency-sweep` duty reclaims everything past `expiresAt`
  (`IDEMPOTENCY_WINDOW_SECONDS`, 1 h), bounding replay protection to the
  documented window and freeing the stored response bodies.
- **Report exports expire on a timer.** The `report-expiry` duty flips `READY`
  artifacts to `EXPIRED` at `expiresAt` (read-side already rejected them lazily;
  this keeps listings honest). Rides a new `(status, expiresAt)` index
  (migration `20261002120000_phase_p5_scheduler`); `PENDING`/`FAILED` are left
  for an operator, not an expiry.
- **One BullMQ root.** `BullModule.forRootAsync` (connection + `BULL_PREFIX`)
  moved to a single global `BullQueuesModule`; queue registration stays with the
  owning module. Previously each queue-owning module declared the root itself,
  and since root options are global the last module to boot silently won the
  prefix.
- **Tests:** +24 unit (61 suites / 442): scheduler duty registration (four
  colon-free repeatables, `NODE_ENV=test` and `SCHEDULER_ENABLED` gates, a
  failed registration not aborting the rest), job-name dispatch with an
  unknown-name no-op and retry-on-throw, all four sweeps (bounded pages, no-op
  paths, lost-race counts, org rotation/wrap, per-org failure isolation), and
  the `queueReminders` scope resolution (ambient vs. explicit org, plus a
  regression test for the `null`-actor `??` trap). E2E +5 (19 suites / 222) in
  a new `test/e2e/scheduler.e2e-spec.ts` driving the sweeps against real rows.

**Open notes (see `docs/limitations.md`):** ticks are at-least-once and
best-effort — a worker down means no drain/reminders/expiry during that window
(nothing is lost permanently; the backlog drains when it returns) — and there is
no leader election, distributed lock, or per-tenant quota; the reminder rotation
is per-process, so a fleet may revisit some orgs sooner than others (harmless, the
scan is idempotent); reminder *delivery* is still a stub — P6 added a real
off-system adapter, but `markReminderSent` only flips a column and the adapter
only reaches a human once a relay is configured behind it (ADR-045).

### P6 — Notification delivery (COMPLETE)

Turns the roadmap's next medium item into a real delivery path: the four
structural no-op providers become one env-selected, signed adapter, and the
policy around a send (opt-out, address, retry) is enforced where the message
actually leaves.

- **Opt-out enforced at send (ADR-045).** `NotificationPreference` rows were
  written and listed but never read at send time, so a recipient who opted out
  of a channel still received it. `NotificationDeliveryService.send` now reads
  the recipient's preferences for `(channel, templateKey)` *before* anything
  leaves the system and lands the row in a new terminal `SUPPRESSED` status with
  `RECIPIENT_OPTED_OUT` (opt-out by default; the template's own category beats a
  `*` catch-all, so a blanket opt-out can be re-enabled for one template).
  `SUPPRESSED` is deliberately not `FAILED`: a deliberate non-send is not a
  delivery failure, must not be counted as one, and must never be retried. A
  channel with no address on file is suppressed the same way
  (`RECIPIENT_ADDRESS_MISSING`) — a missing phone is still missing on the
  fourth attempt.
- **A real off-system adapter.** `NOTIFICATION_WEBHOOK_URL` switches
  `EMAIL`/`SMS`/`PUSH` from the stub to `WebhookNotificationProvider`, which
  POSTs the rendered notification as JSON with `x-careos-signature`
  (HMAC-SHA256 over the exact bytes sent) and `x-careos-idempotency-key`. One
  adapter serves all three channels because the relay — mail, SMS or push — is
  what holds the channel credentials. A 2xx is the only success signal, and the
  receiver's id (header or small JSON body) is persisted as the new
  `providerRef`. With the variable unset nothing leaves the host, so the
  structural stub is still available and still runs the full policy path.
  Wiring moved to `NotificationsIntegrationModule` behind a `Symbol` token,
  matching the M-PESA seam; the string token the notifications feature used was
  the only one in the repo.
- **Real addresses.** `to` was `recipientUserId ?? recipientPatientId`, a bare id
  no relay can act on. `EMAIL` resolves `User.email`/`Patient.email`, `SMS`
  resolves `.phone`, and `IN_APP`/`PUSH` address by recipient id (the row *is*
  the in-app delivery; a push provider resolves its own device token).
- **A retry ladder, driven by the P5 scheduler.** One inline attempt from the
  outbox consumer used to make any provider failure terminal after a single try,
  so an outage lost the message. A transient failure (transport, timeout, 5xx)
  now leaves the row `PENDING` with `nextAttemptAt` pushed out by
  `NOTIFICATION_DELIVERY_RETRY_BASE_MS * 2 ** attempt`, and a new
  `notification-delivery` duty (15 s, `NOTIFICATION_DELIVERY_BATCH` 100) claims
  `status = 'PENDING' AND nextAttemptAt <= now` on a new
  `(status, nextAttemptAt)` index. Only `NOTIFICATION_DELIVERY_MAX_ATTEMPTS` (5)
  or a permanent cause — a 4xx, no provider configured, no recipient — produces
  `FAILED`. Error codes are a small stable set that dashboards can group without
  leaking provider internals; that includes keeping `PROVIDER_NOT_CONFIGURED`
  (terminal) distinct from `PROVIDER_UNAVAILABLE` (retryable), a collision the
  e2e suite caught.
- **Fan-out is opt-in per deployment.** The consumer still always produces
  `IN_APP`; `NOTIFICATION_OFFSITE_CHANNELS` (default empty) adds more channels
  with per-channel notification ids. Default stays in-app only because a send
  that leaves the system cannot be unsent and a recipient cannot consent to a
  channel they never asked to join.
- **Schema:** migration `20261002140000_phase_p6_notification_delivery` adds the
  `SUPPRESSED` status, `nextAttemptAt` (backfilled from `createdAt` so rows the
  old path never delivered get one pass), `providerRef`, and the sweep index.
- **Tests:** +41 unit (63 suites / 483): the webhook adapter (signature over
  the raw body, idempotency header, 2xx/4xx/5xx/transport classification, no
  address or payload in logs), provider selection from env, opt-out resolution
  (default, exact-beats-wildcard, blanket), address resolution per channel, the
  retry ladder (exponential backoff, exhaustion, permanent 4xx, unconfirmed
  provider, no provider configured), the delivery duty (bounded claim, outcome
  classification, per-row isolation), and channel fan-out. E2E +10 (20 suites /
  232) in a new `test/e2e/notification-delivery.e2e-spec.ts` that points
  `NOTIFICATION_WEBHOOK_URL` at an in-process receiver started in the e2e global
  setup (like the s3rver S3 stub), so the acceptance tests drive the *real*
  signed POST and the real retry ladder: opt-out suppresses with zero receiver
  hits, a delivery lands with a verified HMAC and a persisted `ref`, a 503
  retries and then recovers, a 422 fails immediately, and the attempt budget
  terminates a row for good.

**Open notes (see `docs/limitations.md`):** delivery is at-least-once — the duty
claims without a locked claim on purpose (locking across a network call would
stall the queue behind one slow endpoint), so two overlapping ticks can both
attempt a row, which the idempotency key exists for; the adapter is a transport,
not an SMTP/SMPP client, so a real deployment still needs a relay; PUSH is
addressed by recipient id because no device token is stored; bodies remain
PHI-neutral by construction (ADR-034), which is what makes sending them
off-system acceptable at all.

## Phase P7 — Coding-import consumer (COMPLETE)

The first of the two "event with no downstream processor" gaps on the roadmap.
`Reference.CodingSystemImported` was published and dropped: the dispatcher acks
an event nobody subscribes to, so importing a clinical coding reference — the set
every coded diagnosis is validated against — had no observable effect on anyone
who selects codes from it.

- **It notifies the reference owners, and reconciles nothing — on purpose.**
  `CodingReferenceConsumer` (`coding-reference`) fans a PHI-neutral "reference
  set changed" notice out to the distinct *active* users whose roles include
  `coding.manage`, carrying the inserted/total counts. The audience is resolved
  from real `Role.permissions`/`UserRole` rows rather than the import's actor:
  a receipt for an action you just took is noise, whereas the people who select
  codes are the ones whose world moved. The obvious richer design — reconcile
  diagnoses whose code is now gone — was dropped after reading the import path:
  `CodingService.importConcepts` upserts only the payload's concepts and its
  `update` branch sets `isActive: true` and nothing else, so it never
  deactivates or deletes; `Diagnosis` snapshots `code`/`description` at
  authoring time; and the relation is `onDelete: SetNull`. An import therefore
  cannot orphan a `codeConceptId` or silently rewrite recorded text, so there
  is no integrity damage at this point to detect. ADR-046 records that the
  gap that *would* matter is a concept **deactivation** endpoint, which does not
  exist yet and would need a real pass.
- **Replay-safe ids.** One deterministic notification id per (event,
  recipient) — `notif-<eventId>-coding-<userId>` — so a crash between the
  notification write and the `ProcessedEvent` write replays into
  `createForUser`'s upsert instead of double-notifying. Counts are coerced to
  `0` rather than rendered `NaN` when a payload is odd, and an event with no
  resolvable `codingSystemId`, or an org with no `coding.manage` role, is a
  logged no-op instead of an exception that would retry a doomed row.
- **Tests:** +8 unit (`test/unit/coding/coding.consumer.spec.ts`) for fan-out,
  the role/active filter, replay-id stability, the aggregate-id fallback, the
  two no-op paths, and count coercion. E2E +2 in
  `test/e2e/phase4-clinical.e2e-spec.ts`, which grant `coding.manage` through
  real `Role`/`UserRole` rows (the e2e principal carries permissions as headers,
  so the consumer could not otherwise see an audience), import a reference,
  drain the outbox, and assert the notification arrives `SENT` and carries the
  system id but not the concept text — plus the negative case proving a
  `coding.read`-only role is not notified.
- **Deliberately still open:** `Storage.DocumentUploaded` has no consumer. Its
  roadmap item is paired with document content security, which subscribes to the
  event; building a throwaway consumer for it now would only be replaced.

## Phase P8 — Document content security (COMPLETE)

The second "event with no downstream processor" gap, and the one where the
missing consumer was a security hole rather than a missing convenience. P7
documented that `Storage.DocumentUploaded` had no subscriber; the reason it had
none is that subscribing to it means reading document bytes, and nothing in the
codebase had ever done that. `complete` verified only that the key existed and
matched the declared size, so a renamed executable, a real malware sample, or a
national ID in a plain-text record all uploaded and were then served to anyone
holding `documents.read`.

- **The download gate is the enforcement point, not the scanner.** A document is
  servable only on `CLEAN` or `FLAGGED`. `PENDING` and `ERROR` refuse with 409
  (the document exists and the caller may see it, but we do not know what is in
  it); `INFECTED` and `REJECTED` refuse with 422. The rejected alternative was
  scanning synchronously in `complete` and gating there, which turns an AV
  outage into a user-visible upload failure and couples upload latency to
  scanner latency. Because the gate sits on the read path, the scan can live in
  the outbox and a slow engine costs only delay.
- **`PENDING` is a real, unservable state**, and a newly completed document is
  not downloadable until the consumer rules on it. Serving `UPLOADED` rows and
  racing the scan would have made scanning advisory.
- **`FLAGGED` is deliberately downloadable.** A high-sensitivity pattern match
  is a signal for a human reviewer, not a verdict on the file. Silently
  withholding a clinical document because it contains an email address is a
  worse failure than showing it to a clinician already authorised to read it.
- **`DocumentScanConsumer` (`document-scan`) subscribes to the event** and runs
  in the outbox dispatcher, off the request path. It reads the object through a
  new `ObjectStorageService.stream`, which accumulates at most
  `DOCUMENT_SCAN_MAX_BYTES` (10 MiB default) so memory is a function of the cap
  rather than of an attacker-chosen upload size. The row records which engine
  ran, how many bytes it read, and whether it was truncated.
- **The default engine is a heuristic and is labelled one.** With no
  `DOCUMENT_SCAN_CLAMAV_HOST`, `HeuristicDocumentScanner` runs in-process: it
  refuses anything carrying an executable magic number *regardless of the
  declared type* (the renamed-payload case), checks declared-type magic bytes,
  catches EICAR, and flags high-sensitivity patterns. It is a real check — the
  default deployment genuinely refuses a `.pdf` that is a PE binary — but it is
  not antivirus, and `scanEngine: heuristic` keeps any report from implying
  otherwise. ClamAV is spoken over `INSTREAM` on a raw socket (no new
  dependency) and chained *after* the heuristic, so type confusion is enforced
  either way and an AV outage cannot downgrade a known rejection: the chain
  returns the first real finding, and surfaces `ERROR` when nothing definitive
  was found, because a failed scan must never be reported as a pass.
- **No content reaches durable state.** `scanDetail` holds a rule or signature
  *name*; matched bytes would put patient data in an audit-visible column. The
  e2e suite asserts the EICAR sample and the matched national ID are absent
  from the serialised row, and the consumer logs the verdict and rule name only.
  `scanFingerprint` is a 16-char digest of the inspected prefix — enough to
  correlate a re-scan, nothing more.
- **Historical rows are left `PENDING`, not backfilled to `CLEAN`.** Asserting
  an unexamined 2021 scan report was clean is the exact failure this phase
  exists to prevent. `POST /documents/:id/rescan` (documents.create) resets to
  `PENDING` and republishes the same event, so there is one scan path rather
  than two, and covers both legacy rows and an `ERROR` verdict. An `ERROR` is
  recorded rather than thrown: a re-raised throw would make the outbox duty
  retry the same broken engine on a loop.
- **Tests:** +22 unit (`test/unit/integrations/document-scanner.spec.ts`) for the
  heuristic's four judgements, the truncated case, fingerprint stability, the
  chain's finding-over-outage and outage-is-not-clean semantics, and ClamAV
  returning `ERROR` (not `CLEAN`) when unreachable or timed out. E2E +9 in
  `test/e2e/documents.e2e-spec.ts` — EICAR quarantined, PE-as-PDF refused,
  magic mismatch refused, national ID flagged *and still downloadable*, an
  oversized upload marked `scanTruncated`, re-scan re-gating then clearing, the
  permission and workflow guards, and a deleted document not being resurrected
  by a late scan. The pre-existing download lifecycle test was updated: it now
  asserts the 409 while `PENDING` and only downloads after the outbox drain.
- **Deliberately still open:** real malware detection needs a configured ClamAV;
  coverage above the byte cap is a prefix only; and there is no automatic retry
  of an `ERROR` verdict, by design. All three are in `docs/limitations.md`.

## Phase P9 — Emergency intake-request metrics (COMPLETE)

The analytics snapshot measured emergency department walk-ins (`EmergencyVisit`:
arrivedAt → triagedAt) and nothing about the anonymous public flow, which is a
different population with a different denominator. The roadmap had flagged the
missing acknowledgement, escalation, and dispatch-latency metrics as arriving
"with the public emergency-intake flow" — the flow landed in P3, the metrics
never did.

- **A new `snapshots.emergencyRequests` block, not a wider `emergencyIntake`.**
  Combining `EmergencyRequest` and `EmergencyVisit` counts would let a rate be
  divided by a denominator matching neither question. They sit side by side, and
  the `emergencyIntake` label now says so explicitly.
- **Percentiles, not means, and `max` beside them.** A mean is the wrong summary
  for emergency response: one request left unacknowledged for forty minutes
  moves a five-request average by eight minutes while being the entire reason
  the metric exists. Every latency is reported as `samples` + p50 + p90 + max.
  Nearest-rank rather than interpolated, so a percentile only ever names a
  latency that actually occurred — which also means a small window gives a
  coarse answer, documented in `docs/limitations.md` and pinned by a test rather
  than left to be discovered.
- **Dispatch latency is split into two legs.** `timeToDispatch` (receive →
  responder dispatched) and `ackToDispatch` (acknowledge → responder dispatched).
  A request acknowledged in four minutes and dispatched in six was held up by
  the phone, not the ambulance, and one combined number cannot tell an operator
  which. `samples` is published next to each distribution because a
  never-responded request contributes no sample and must not read as zero.
- **A point-in-time block the window cannot replace.** `unacknowledgedNow`,
  `awaitingDispatchNow`, `unacknowledgedPastSlaNow`, and `openNow` describe the
  present, not the period. A service with excellent historical latency and one
  request stuck unacknowledged tonight is still an emergency, and no windowed
  average can express that. The SLA comparison reads the branch's own configured
  first escalation level via `parseLevelSeconds` — the same function the
  escalation worker uses, so metric and behaviour cannot drift — and a branch
  with no policy is excluded from the past-SLA count rather than measured
  against an invented threshold.
- **An escalated-but-unacknowledged request counts as unacknowledged.** This is
  the most safety-critical row in the system and the easiest to hide: filing it
  under "escalated" would make it look accounted for. It is counted in
  `unacknowledgedNow` and, when it has aged past the branch's first level, in
  `unacknowledgedPastSlaNow`. Cancelled, closed, and P4-retained rows are
  excluded from every outstanding counter.
- **The window is keyed on `createdAt`.** A request received inside the window
  and answered outside it is still counted as received, which is the only
  reading under which a long-open request cannot vanish from the numbers.
- **Timestamps are validated, not trusted.** An inverted pair (clock skew, or a
  bad backfill) is dropped rather than folded in: one negative sample would drag
  a mean toward zero and make response time look *better* than reality, which is
  the dangerous direction to be wrong in. It is still counted in the funnel.
- **Tests:** +26 unit (`test/unit/insights/intake-metrics.spec.ts`) over the
  pure math — nearest-rank percentile behaviour including the two traps (p90
  missing a lone outlier at small n, p50 being the lower middle on even n),
  the empty-window null shape, the inverted-timestamp drop, the ack/dispatch leg
  split, deterministic branch and escalation breakdowns, and every outstanding
  branch including the SLA boundary and a branch with no policy. E2E +2 in
  `test/e2e/phase13-analytics.e2e-spec.ts`: eight seeded requests across every
  state proving the funnel, the 40-minute tail surviving as `max` where a mean
  would have hidden it, the point-in-time counters, and an intake-disabled tenant
  reporting nulls rather than zeros.
- **Deliberately still open:** no rollup (the read is query-time over
  `EmergencyRequest`), and no alerting — a late acknowledgement is visible in the
  API but does not page anyone. Wiring this to the notification system is a
  separate decision with its own noise-floor trade-off.

## Phase P10 — Production PDF rendering (COMPLETE)

Replaced the dependency-free `renderTextPdf` — text and lines only, no charts,
images, or Unicode — with a real renderer in `src/jobs/pdf`, used by both
`/document-jobs/pdf` and report exports.

Done:

- **Renderer** (`pdf-renderer.ts`, `pdf-document.ts`): A4 pages, running header
  with title/metadata, footers with page numbers and a confidentiality line,
  A4 break-correct pagination that repeats table headers, and sections for
  headings, key/value pairs, paragraphs, tables, bar and line charts, and
  images. Colour and weight are carried on document elements rather than in
  the renderer, so a caller can restyle without touching layout.
- **Unicode that fails loudly.** PDFKit silently drops characters the current
  font cannot encode. The renderer parses the cmap (formats 4 and 12) from the
  font it is about to embed, checks every string per style, and throws
  `MissingGlyphError` naming the offending code points and the element being
  drawn. A configured `PDF_FONT_*` path that cannot be read is a hard error
  rather than a silent substitution. Bundled DejaVu Sans covers Latin, Greek,
  Cyrillic and common symbols; CJK requires a configured face (ADR-048).
- **Charts** (`pdf-charts.ts`): bar and line geometry with padded, ordered axis
  bounds, a zero line that stays on the plot for all-positive and all-negative
  data, gridlines, and category labels. Non-finite values and points beyond an
  explicit `maxPoints` cap are dropped and *disclosed* in the document — a
  chart quietly showing 60 of 400 points is worse than no chart. A `barChart`
  with no cap is a programming error, not a default.
- **Images** (`pdf-images.ts`): PNG/JPEG validated by container magic, declared
  dimensions, and a 8 MiB / 6000 px cap *before* any decode, fitted without
  upscaling. SVG is rejected rather than approximated.
- **Real reports** (`domain/report-document.ts`): exports are now derived
  documents — the window in the header, scalar summary values as key/values,
  a numeric record such as a count-per-category breakdown as a bar chart, and
  a column set inferred from the data (numeric columns right-aligned, missing
  cells dashed, cancelled rows dimmed) with a 500-row default cap sitting beside
  its disclosure text. Removed `rowsToPdfLines`.
- **Bounded surface.** `/document-jobs/pdf` accepts text plus a table capped at
  12 columns / 300 rows / 200 lines. Charts and images are deliberately not
  accepted over HTTP — an unvalidated upload endpoint with no current caller —
  while server-built documents use them directly.
- **Tests:** +106 unit across `test/unit/jobs/` (renderer, charts, fonts,
  images) and `test/unit/insights/report-document.spec.ts`; +1 e2e asserting the
  table caps actually reject over-limit requests, and the two PDF e2e paths now
  assert a real document (`%PDF-` header, `%%EOF`, embedded `FontFile2`,
  `ToUnicode` CMap) instead of a byte count, via `test/support/pdf.ts`.

Fixed along the way, each found by a test rather than by inspection:

- **Flow text inherited a stray cursor and ran off the page.** PDFKit leaves
  `doc.x`/`doc.y` at an absolutely-placed call. A chart category label is
  centred on its point, and with one or two points the label box extends past
  the left margin, so the disclosure that followed began at `x = -124` and was
  clipped off the page. Flow text is now anchored to the margin and label boxes
  are clamped inside it. This would have silently clipped content in every
  report containing a chart.
- **`sizeBytes` was reporting the base64 length**, overstating every PDF by
  about a third, because the artifact is stored base64-encoded in a `String`
  column. It now reports the decoded file size. The storage format itself is
  left to P11, which moves this off the request path.
- **`test/e2e/documents.e2e-spec.ts` was on Jest's 5s default** while driving
  a real S3 server and spawning the scanner, so it timed out on legitimate work
  under a full parallel run. It now uses the same 120s as every other e2e spec.

**Deliberately still open:** generation is synchronous and the artifact is held
in memory, so a very large report is built entirely inside the request; PDF
artifacts are still base64 in a `String` column. That transport is P11. Image
and chart *input* remains server-side only.

## Notes

- Testcontainers uses `postgres:17-alpine` by default because `postgres:16-alpine`
  is not available in the local Docker Hub cache; Compose targets 16. Override
  with `E2E_POSTGRES_IMAGE`/`E2E_REDIS_IMAGE`. See `docs/limitations.md`.
- Jest configs are CommonJS `.js` files (no ts-node in the toolchain); SWC only
  (`@swc/jest`), helpers inline via `.swcrc -> externalHelpers: false`.
- Phase order follows the build brief (patients is Phase 2). The object-storage
  work was committed earlier under the label "Phase 2" and is documented here as
  Phase 3; scheduling (the brief's Phase 3) is documented here as Phase 4 to
  keep git history unchanged; git history is unchanged.
- The e2e suite reaches 232 tests across 20 suites (identity, patients,
  documents, rls, tenant-pipeline, app-boot, phase-3 scheduling, the phase-4
  clinical spec, the phase-5 inventory/pharmacy spec, the phase-6 billing
  spec, the phase-7 laboratory/radiology spec, the phase-8
  inpatient/emergency spec, the phase-10 communication spec, the phase-11
  financial/ledger/M-PESA spec, the phase-12 operations spec, the phase-13
  analytics/reports spec, the public-directory spec, and the emergency-intake
  spec, the scheduler spec, and the notification-delivery spec; file names keep
  the old labels to avoid churn while the sections here track the brief's
  phases).
- The e2e database is shared across suites and reused between runs, so any suite
  that asserts on a *global* sweep must first clear what it owns: the
  notification-delivery suite fails over stale `PENDING` rows at the start of
  each test, because the duty claims the oldest due rows across all tenants and
  a leftover backlog would starve the row under test.
## Phase P11 — Asynchronous, streamed report exports (COMPLETE)

Report export was synchronous and self-contained: `POST /reports/export` built
the report, rendered it, base64-encoded the bytes into `ReportExport.artifact`,
and returned `201` with the file inline. That tied the builders' row caps, the
renderer's memory, and the caller's HTTP timeout to a single request (ADR-049).

Done:

- **Export is a request, not a computation.** `POST /reports/export` writes a
  `PENDING` row and returns `202`. `ReportExportConsumer` handles
  `Reports.ExportRequested` (v1) off the request path and moves the row to
  `READY` with a key, size, summary and `completedAt`, or to `FAILED` with a
  PHI-free reason. The consumer is idempotent — a non-`PENDING` row is skipped,
  and the `READY` write is guarded on `status: 'PENDING'`, so duplicate
  delivery is harmless.
- **The event carries an id, not data.** The payload is `{ exportId }`; the
  resolved window, branch and format are read from the tenant-scoped row, so a
  report is always generated from what was recorded at request time and no
  patient data passes through the outbox.
- **The artifact lives in S3.** `ReportExport.artifactKey` replaces the base64
  `artifact` column, and keys are tenant-scoped
  (`reports/{orgId}/{exportId}.{ext}`) so a mixed-up key is visible in a bucket
  listing rather than quietly serving another hospital's data. A new
  `ObjectStorageService.put()` is served by a global `StorageModule`.
- **Download streams through the API.** `GET /reports/exports/:id/download`
  re-checks tenancy and `reports.read`, then pipes the object back in bounded
  chunks with the recorded `Content-Length`, `private, no-store` and an
  attachment filename. A presigned GET would have been a bearer capability over
  a table of patient data, untraceable to a principal and unrevocable per user;
  the row keeps only a key and the bytes never leave through a URL.
- **Generation streams too.** The renderer gained `renderPdfTo(spec, sink)` and
  writes into the upload instead of returning a buffer; JSON and CSV are emitted
  chunk by chunk (`streamRowsToJson`, `rowToCsvLine`) and are byte-identical to
  the buffered form, which is pinned by test. `putStream` uses an S3 multipart
  upload and aborts a partial part set on failure. Peak memory is a chunk
  rather than an artifact; the report *rows* stay in memory, bounded by the P10
  caps.
- **Failures are recorded, not retried forever.** A missing glyph is stored as
  hex code points (`U+4E2D`) and never as the character itself — one character
  of a patient's name is still patient data, and the row is read by operators.
  A storage outage is stored as its error code. The full error chain goes to
  the log, not the row.
- **Expiry deletes the object.** The `report-expiry` duty marks due rows
  `EXPIRED`, removes the artifact and clears the key; a read that finds an
  expired artifact drops the object early but leaves the status transition to
  the scheduler, so there is one writer for it.

Notes:

- `TENANT_REQUIRED` from a background consumer was a real bug found by the new
  e2e, not a hypothetical: the report builders read the tenant from ambient
  request state, which an outbox consumer does not have. `build` now takes an
  explicit tenant client, matching how `DocumentScanConsumer` uses `ctx.db`.
- The migration drops the `artifact` column, so any export that had not yet
  expired loses its bytes. They are regenerable and the window is 24h, but a
  deployment mid-window would lose them.
- Report export is now the one flow that hard-requires S3. Without it the
  request is still accepted and the export lands in `FAILED` with
  `S3_UNAVAILABLE`.

## Phase P12 — Provider directory + onboarding (COMPLETE)

There was no `Provider` model, so this was never a missing-CRUD patch. A
provider is a `users` row with a clinician role, and `ProviderSchedule.providerId`
points at `users.id` — which meant all four booking paths resolved a provider by
checking only that the id existed somewhere in the organization. A suspended,
terminated or opted-out clinician was fully bookable, and worse, the scheduling
surface would still publish their availability. The directory was the visible
symptom; the booking gate was the defect (ADR-050).

Done:

- **One definition of bookable.** `src/modules/providers/domain/provider-eligibility.ts`
  owns both forms the rule needs: `ineligibilityReason()` for in-memory checks
  and `bookableUserWhere()` for the Prisma fragment. They are adjacent in one
  file on purpose — the same rule expressed twice, in two languages, is how the
  hazard returns. Bookable means `ACTIVE`, and where a staff profile exists,
  not terminated and not opted out. A *missing* profile is allowed, because
  plenty of legitimate providers in this schema carry only a user row, and
  refusing them would break real bookings to fix a hazard the status check
  already covers.
- **All four booking paths now share it.** Appointment creation and
  auto-assignment, encounter creation, telemedicine session start, and schedule
  template publishing and slot discovery. The last one is the subtle fix: a
  receptionist browsing slots is a *read*, and an unbookable provider returning
  an empty array reads as "free, try another date" — which is how a terminated
  clinician keeps getting booked. It now refuses with a reason.
- **Roles are a filter, never a gate.** The provider role list is
  `DOCTOR`/`CLINICAL_OFFICER`/`NURSE`/`PHARMACIST`/`LAB_TECHNICIAN`/
  `RADIOLOGY_TECHNICIAN`, because this codebase books nurses, pharmacists and
  clinical officers. A role gate would refuse legitimate work while still
  missing the real hazard — an active user who cannot see patients.
- **The directory is a provider view, not a user list.** `GET /providers` lists
  users holding a clinician role *or* a published template, filterable by branch,
  department, specialization, role and free text, with a `bookable` flag and a
  PHI-safe reason. `bookableOnly` defaults to true; passing `false` shows
  non-bookable providers, still only providers. The same membership rule gates
  `GET /providers/:id` and `PATCH /providers/:id`, so a receptionist's detail
  view is a 404 rather than a directory of everyone.
- **Onboarding is one transaction.** `POST /providers` creates the user, staff
  profile, role assignments, branch and department links, an optional
  availability template, an audit row and a `Directory.ProviderOnboarded` (v1)
  event, or it creates nothing — a half-onboarded provider with a profile and no
  role is the exact failure mode this avoids. Availability windows must name a
  branch and department the provider was actually given, or the template would
  point somewhere they do not practise and no slot would be reachable.
  The account starts `INVITED` and activation is what makes it bookable, which
  is also why the duplicate-email conflict points at `PATCH /providers/:id`.
- **`providers.read` and `providers.manage` are separate.** Read is enough to
  browse the roster; onboarding and profile maintenance need manage. Neither
  grants booking, which still requires `appointments.create` — directory access
  must not imply the ability to assign work to someone.

Notes:

- The free-text search initially *overwrote* the provider-view filter instead of
  combining with it, because Prisma allows one `OR` per level and the query
  needed three. The three disjunctions are now ANDed as sibling groups.
- `dayOfWeek` on `ProviderSchedule` is a `WorkdayIndex` with **Monday = 0**, not
  `Date.getDay()`. The e2e fixture assumed Monday = 1 and found zero slots; the
  DTO comment now says so explicitly, because the mismatch is an
  off-by-three-days bug that only surfaces once someone is booked wrongly.
- Existing appointments are deliberately left intact when a provider becomes
  ineligible, and the refusal is a `409 PROVIDER_NOT_BOOKABLE` naming the
  reason rather than a name. Cancelling a patient's confirmed appointment is a
  clinical decision, not a cascade; it belongs in a reassignment sweep.
- `branchIds`/`departmentIds` are required with at least one entry. A provider
  assigned to neither can never be offered a slot — onboarded but unusable.
  The `.default([])` that used to sit there was rejected by its own `.min(1)`,
  so removing it is a clarity change, not a contract change.
- Onboarding mints and hashes an invite token but does not surface delivery;
  activation goes through the ordinary user invite flow. Recorded in
  `docs/limitations.md` rather than papered over with a second mechanism.

## Phase P13 — Patient-portal real authentication (COMPLETE)

The roadmap described this as replacing a test seam with real JWT auth, which
framed it as an authentication problem. It was not. The authorization had been
built and was already correct: `TenantScope.patientId` is read by eight services
— the portal projections, `patients.assertPatientOwnership`, queue status,
notifications' principal identity, conversation access, feedback, and the two
`assertStaffPrincipal` denials — and every one narrows to
`patientId === scope.patientId` or fails closed. What did not exist was any way
for that value to be non-null in production. The only writer of `patientId` in
the codebase was `TestPrincipalMiddleware`. The missing piece was a link
(ADR-051).

Done:

- **`patients.userId` links a record to a login.** Nullable, so no existing row
  changes and every patient behaves exactly as before until someone provisions
  access; `UNIQUE`, so one account can never resolve to two records and hand one
  person another's chart; `ON DELETE SET NULL`, so deleting a login does not
  delete a medical record. No backfill: a link is an assertion that a specific
  person owns a specific record, and no existing column records that — inferring
  candidates from a matching email or phone would hand portal access to whoever
  shared a contact detail.
- **A patient principal is an ordinary `User` holding the `PATIENT` role.** Not a
  parallel principal type, a second token purpose, a second signing secret or a
  second audience. `Session.userId` stays `NOT NULL`, so refresh rotation, reuse
  detection, brute-force limits, MFA and `/auth/invites/accept` are untouched and
  there is exactly one authentication mechanism to audit. Patient/staff
  separation is already carried by permissions: `portal.read` is granted to
  `PATIENT` and to no other role, which is why a staff token is refused on
  `/portal/*` and a patient token on every staff route.
- **`patientId` is derived per request, never claimed.** `TenantGuard` already
  loaded the session's user with `userRoles` in one query, so adding
  `patientAccount` to that include costs no extra round trip. A token claim would
  be a cached authorization decision, so revoking a patient's portal access would
  not take effect until the token expired — the same class of bug as trusting the
  `roles` claim, which is why roles and permissions are re-resolved from the
  database on every request at all. The e2e asserts this directly: removing the
  link invalidates an unexpired token on the very next request.
- **The link and the role are required together** (`resolvePatientScope`, a pure
  function so the rule is testable without a request, a session and a database).
  Either alone is a misconfiguration, and the conjunction means a staff user who
  is accidentally linked receives no patient scope: the failure mode is a dead
  feature rather than a privilege escalation.
- **Provisioning is a staff action.** `POST /patients/:id/portal-access` creates
  the user, assigns `PATIENT`, writes the link and issues an invite in one
  transaction, under `patients.manage` — the same records-steward authority that
  gates merging a record and confirming a duplicate. Letting a patient claim a
  record by asserting a phone number is an identity-verification problem this
  codebase has no answer for. The patient then signs in through the ordinary
  invite-accept and login flow; there is no second portal credential.
- **A merge clears the link.** Two records being merged are by definition
  suspected to be the same person, so a live login left on the source would point
  a real human at a `MERGED` duplicate — possibly at the wrong person entirely.
  The account is re-provisioned against the survivor deliberately.
- **`/auth/me` resolves the patient** it previously hardcoded to `null`, through
  the portal's public projection. `toPublicPatient` is now typed as a `Pick` of the
  nine columns it actually reads, so a caller cannot widen the projection by
  handing over a full row — the exact failure a "safe serializer" is meant to make
  impossible.
- **`PATIENT` gained `queue.read`, `messaging.read` and `messaging.send`.** The
  patient-aware code in `queue.service.status()` and `conversations.service` was
  **unreachable**: those routes need permissions the role did not hold, so a real
  patient principal was rejected by the guard before either ran, and the tests
  passed only because the seam can assert permissions independently of the role
  matrix. Both already narrow to `scope.patientId`, and a conversation
  additionally requires the caller be a participant, so this makes live code
  reachable rather than opening anything.

Notes:

- The escalation check used when assigning a role elsewhere,
  `canGrantRole` ("is this role's permissions a subset of the caller's?"), is
  deliberately **not** used for `PATIENT`. It is vacuous twice over: `portal.read`
  belongs to no other role, so no caller could ever satisfy it, and every
  permission the role does hold is narrowed to the caller's own record by the
  self-scope, so the resulting principal is never more powerful than the caller.
  Left in, it made the endpoint unreachable for every role in the system
  including the ones meant to use it — found by the e2e, not by reading.
- `PATIENT` gaining `messaging.send` means a patient can now start a
  conversation. `canAccessConversation` requires the caller be a participant
  *and*, under a patient scope, that the conversation belongs to their own record,
  so this cannot be used to reach a clinician's thread — but it is a genuine
  capability change and the e2e pins the ownership half of it.
- The new suite deliberately builds the app without `TestPrincipalModule` and
  authenticates every patient request for real, because the previous arrangement
  is precisely why the gap survived: the portal's own tests injected `patientId`,
  so all of them passed while no production path could set it.
- One full e2e run immediately after the migration was first applied failed six
  scheduler assertions (`failed === 0` across a global org sweep); two
  subsequent full runs were clean at 283/283. The scheduler's sweep is
  org- and record-based and shares nothing with this patch's changes, so this was
  read as first-run container warm-up rather than a regression — recorded here
  rather than quietly dropped.

## Phase 12 closure — contract parity for emergency, directory, and display

Continued after the Phase 12 audit. The audit had recorded several brief
requirements as "documented deviations"; this pass closes them rather than
writing them down.

Emergency (§6.15):

- `EmergencyNumber` gains the fields the brief names and the code lacked:
  `channel`, `active`, `verifiedAt`. `active: false` retires a number from the
  caller surface without deleting its audit trail, and is filtered in
  `listPublicNumbers`. Setting `verifiedAt` sets `verified` in the same write, so
  an operator can confirm a number with one field and the audit row still records
  when.
- `EmergencyContact` gains `onCallWindows` (`[{ day, start, end }]`,
  facility-local) plus `domain/on-call-window.ts`. See ADR-054: windows decide
  who gets paged and never gate whether a caller can submit — the naive reading
  of the requirement would refuse a 03:00 caller to a night-only roster.
- `PublicNotice` gains `reviewedBy`/`reviewedAt` (§6.14), stamped from the
  session rather than the body. Deactivating a notice preserves its provenance.
- Route aliases registered on the same controller, throttles, and 429 filter
  included: `/public/emergency-requests` alongside `/public/emergency` (ADR-052).

Public directory (§6.14):

- `GET /public/config` and `GET /public/locations/suggest?q=` added as first-class
  endpoints, alongside the existing `facilities/config` and `geocode`.

Display (§5.16):

- Pairing attempt window corrected from 15 to the brief's 10 minutes.
- Token rotation now implements the overlap window the brief asks for: the
  outgoing digest is retained for ten minutes and accepted by
  `DeviceAuthGuard`, which also checks expiry so an un-cleaned row cannot extend a
  token's life. Revoke and re-pair clear both digests (ADR-053).
- `serializeDevice` exposes `previousTokenValidUntil` (never a digest) so a
  rotation in progress is legible to an operator.

`/auth/me` (§5.15): every field the brief names is now present —
`featureFlags`, `roleDetails` (`{id,key,name}`), `user.roles` (same objects,
nested on the user), `branches`, `activeBranchId`, `patientLink`, `user.mfa`,
`security`, `session.lockAfterSeconds`/`expiresAt` — added alongside the existing
spellings, which are retained. `activeBranchId` is asserted equal to
`branch.current` (ADR-052).

One name could not be satisfied additively: the brief models break-glass as an
array, but the deployed API already had `breakGlass` as a single object|null, so
the two shapes cannot coexist under one key. Per ADR-052 the deployed field was
left alone and the array published as `breakGlassGrants`. An earlier pass wrote
that "every field the brief names is now present"; that overstated it — the brief
array is reachable under a different name until the old field is deprecated in a
later phase.

Bug found and fixed while verifying the above: all three SSE handlers
(`display`, `emergency-request`, `realtime`) cleared their heartbeat and quit
their Redis subscriber on revoke, but never called `reply.raw.end()`. The socket
stayed open, so each revocation leaked a connection and a revoked screen sat on a
blank board with no error. All three now end the response, guarded against a
double teardown, and the emergency and realtime handlers emit an `error` frame
before closing so a dead stream is not indistinguishable from a quiet one.

Tests: 886 unit across 85 suites (+187 from this pass). New suites:
`on-call-window.spec.ts`, `device-auth-guard.spec.ts`, `token-rotation.spec.ts`,
`disposition.spec.ts`, plus contract and reference-data cases added to
`auth-me.spec.ts`, `intake-readiness.spec.ts`, `emergency-intake.service.spec.ts`,
and `emergency-reference-admin.spec.ts`. Three real defects were caught by these
tests and fixed: `isValidOnCallWindow` dereferenced a `null` from an untrusted
JSON column, `EmergencyNumber` writes were spreading a DTO whose `userId` conflicts
with Prisma's relation typing, and the retention sweep's age test indexed its
mock's argument list instead of the write payload (a test bug, which had been
masking the real one below).

Privacy defect found and fixed (ADR-055): the retention sweep matched only
`CLOSED`/`CANCELLED` via `closedAt`/`cancelledAt`, so the four other finished
dispositions — `UNREACHABLE`, `REDIRECTED`, `NOT_ACTIONABLE`, `DUPLICATE` —
kept their encrypted caller name, phone, description, and landmark forever. All
four are terminal (`isTerminalStatus` blocks reopening) but none of the first
three ever wrote a timestamp the sweep could see. A dedicated `dispositionAt`
now records when the facility became done, write-once so re-triaging cannot
restart the clock, and `closedAt` stays a factual "staff closed this" stamp
rather than being overloaded for four states it does not describe. Migration
backfills pre-existing rows with
`COALESCE(closedAt, cancelledAt, updatedAt)`; the sweep prefers `dispositionAt`
and falls back to the old columns only where it is `NULL`, so nothing is
stranded. The existing reap already retires the tracking token, so a stale
token cannot resurrect a redacted request.

The pre-existing retention tests mocked `findMany` and were handed the
candidates they asserted against, so they never inspected the query that held
the bug — and passed against it. The new cases assert the sweep filter itself.

Second pass over the same list, closing three more gaps:

- **The emergency alias did not exist.** ADR-052 and this file both recorded
  `/public/emergency-requests` as delivered. It was not: a prefix array plus
  `@Post('requests')` registers `/public/emergency-requests/requests`, not the
  brief's flat path. Fixed with a dedicated alias controller
  (`PublicEmergencyRequestsController`) registering `POST
  /public/emergency-requests` and its `update`/`track`/`cancel` siblings against
  the same service, same throttles, and the same class-level 429 filter.
  `POST /display/pair` was missing entirely and now has
  `DisplayPairAliasController`. Both are marked `deprecated` in Swagger so the
  deployed spellings stay the ones a new integrator is steered to.
  `test/unit/routing/brief-routes.spec.ts` reads Nest's actual path metadata, so
  a route claimed in an ADR but absent from the router now fails a test. It was
  verified to fail when the prefix array is restored.
- **`user.roles` was missing.** The brief puts role objects on the user; only
  `roleDetails` (top-level) and `roleSummary` existed. `user.roles` is now the
  contract shape, asserted equal to `roleDetails`.
  `breakGlass` remains the one name that could not be satisfied additively — see
  the correction above.
- **Stale displays now alert (ADR-056).** They were derived as a flag in the
  admin list, which meant a waiting room could stare at a dead board with nothing
  saying so. `DisplayService.sweepStaleDevices` runs on the platform scheduler
  and pages the org's `display.devices.manage` holders. Claims `staleNotifiedAt`
  with a guarded update before notifying (once per outage), re-armed by heartbeat
  and re-pairing, cross-org with per-device failure isolation. Only device name,
  branch name, and elapsed minutes are interpolated — the board is patient-facing
  data.

Tests: 916 unit across 87 suites. New this pass: `brief-routes.spec.ts` (11
cases, route-table derived), `stale-alert.spec.ts` (16), plus display-stale
template cases and the scheduler duty. The scheduler's own test caught the new
duty by hardcoding the expected registration count, which is the behaviour you
want from that suite.

Still open, unchanged: `careos_public` has no integration test proving it cannot
read tenant tables, and outbound SMS/push for emergency escalation does not exist
(recorded in `docs/limitations.md`).
