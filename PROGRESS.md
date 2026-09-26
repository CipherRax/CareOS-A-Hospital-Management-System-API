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
| `npm test`   | 371/371 unit (52 suites) |
| `build`      | pass   |
| `test:e2e`   | 185/185 (16 suites, fresh Testcontainers infra) |

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
  dispense), idempotency-key replay (200 cached response, no double-dispense).
  The idempotency-replay status (200) and the raw-SQL `lockBatchRows` caveat
  are documented in `docs/limitations.md`. Unit suites added for
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
  (PAID → ISSUED edge). Idempotency-key replays return the cached 200.
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
  See `docs/limitations.md` — there is no scheduler, the scan is push-triggered.
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
- The e2e suite reaches 185 tests across 16 suites (identity, patients,
  documents, rls, tenant-pipeline, app-boot, phase-3 scheduling, the phase-4
  clinical spec, the phase-5 inventory/pharmacy spec, the phase-6 billing
  spec, the phase-7 laboratory/radiology spec, the phase-8
  inpatient/emergency spec, the phase-10 communication spec, the phase-11
  financial/ledger/M-PESA spec, the phase-12 operations spec, and the phase-13
  analytics/reports spec; file names keep the old labels to avoid churn while
  the sections here track the brief's phases).