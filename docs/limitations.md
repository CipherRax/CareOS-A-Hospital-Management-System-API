# careOS — Known Limitations & Stubs

Honest accounting of what is stubbed, deferred, or knowingly imperfect. Items
marked **[stub]** are intentionally not implemented yet; everything else is
working code with a caveat.

## Explicit stubs (named in code)

- **Outbox delivery has no scheduler yet.** `[stub]` Outbox rows are written
  reliably in the same transaction as domain writes (ADR-007), and the
  dispatcher pointer now drives REAL consumers (the timeline projection,
  ADR-028). Delivery must be triggered — the worker bootstrap exists
  (`worker.ts`, `npm run worker`) but there is no BullMQ queue or cron yet, so
  in e2e `publishReadyEvents` is called synchronously to prove the pipeline.
  Failed deliveries retry with exponential backoff and go DEAD after
  `MAX_OUTBOX_ATTEMPTS` (8).
- **`Storage.DocumentUploaded` and `Reference.CodingSystemImported` events have
  no consumer yet.** `[stub]` The timeline consumer subscribes to
  `Clinical.*` types only; documents/coding-reference rows wait for their
  downstream processors (later phase).
- **Emergency access flow** — `TenantScope.emergency` exists as a marker but
  nothing sets it (by design; a later phase).
- **Metrics/OTel** — `METRICS_ENABLED`/`OTEL_*` envs exist but telemetry
  serving/wiring is not implemented.
- **Seeder** — `SEED_ALLOWED=false` by default; `prisma/seed.ts` seeds only
  when allowed.
- **Role management UI/API surface** — catalog role definitions
  (`role-matrix.ts`) cover the identity/access catalog; module-specific
  permissions are added as their modules land.
- **Break-glass approval** — the request/expire flow is implemented; a
  pull-based approver surface beyond the request queue is a later-phase item.

- **Patient access logs are written by the application, not a DB trigger.**
  Rows are created fail-open (a logging failure never breaks a read) and store
  identifiers + request metadata only, never PHI; the same guarantees that the
  RLS trigger gives `audit_logs` are not applied to `patient_access_logs`
  (append-only integrity is a later concern).
- **Duplicate scoring is a heuristic, not a clinical match.** The 70-point
  threshold and weights in `duplicate-score.ts` are tuned for the brief's
  fields; it trades false negatives/positives by design and always defers to a
  human (409 + candidates, id-confirm). Non-name aliases (nicknames,
  misspellings) are not matched.
- **Patient portal auth keeps the Phase 1 role surface.** A self-scoped
  patient uses the same test-principal header seam as staff (`x-careos-test-patient-id`);
  real patient-facing JWT auth is a later phase.

## Known caveats in shipped code

- **RLS is a backstop, not the primary control.** `app.current_org` is set via
  `SELECT set_config(...)` inside interactive transactions. Because Prisma may
  open multiple logical connections per transaction, the setting is not
  guaranteed on every connection; the Prisma client extension is the primary
  tenant boundary. Do not rely on RLS alone (ADR-005/ADR-006).
- **Document bytes are not virus-scanned / not PII-analyzed.** `complete`
  verifies presence and size against the initiate declaration but not file
  content. Any content validation must run on the `Storage.DocumentUploaded`
  outbox event (not yet consumed).
- **Presigned reads are bearer-free.** A valid presigned GET URL is usable by
  anyone holding it until it expires (`S3_SIGNED_URL_TTL_SECONDS`); the API
  enforces `documents.read` to obtain it, but object-level auth is a later
  concern.
- **UUIDv7 ordering is per-process only.** The monotonic counter (ADR-011)
  guarantees ordering within a process; across processes (or the same wall
  clock from worker instances) ordering is best-effort.
- **`CareOS.Probe` is a demo event** used by `POST /api/v1/_demo/outbox`. It is
  also emitted by the demo module — remove the demo controller/module before
  production. It is useful as a smoke tester in the meantime.
- **Testcontainers uses `postgres:17-alpine` while Docker Compose uses
  `postgres:16-alpine`.** The 16 image is not available in the local
  Docker Hub cache; e2e infra can be pinned via `E2E_POSTGRES_IMAGE` /
  `E2E_REDIS_IMAGE`. Both run the same migration (no version-specific SQL in
  phase 0).
- **prisma migrate is the DB truth.** The project uses `prisma migrate
  deploy/dev`; `db push` exists only as a script and is not part of the gate.
- **Idempotency records expire** (`expiresAt` index) but no sweeper worker
  cleans them yet; they are inert after expiry.
- **Audit rows cannot be deleted** (append-only trigger, ADR-008). This is
  intentional; retention/rotation is a later-phase concern that must go through
  a privileged path.
- **`OPTIONS`/wildcard routes:** Fastify adds a `*` OPTIONS route for CORS; the
  app-boot route-walk parser skips it deliberately.
- **Invite tokens are returned inline when `NODE_ENV !== 'production'`** so e2e
  can accept an invite end-to-end. In production only the hashed digest is
  stored and the raw token goes out-of-band. Same for MFA recovery codes
  (returned once at confirm).
- **`@HttpCode(options.statusCode ?? 200)` (ADR-013):** routes that did not
  declare a status now return 200 instead of Fastify's POST default 201;
  statuses are declarative and asserted by e2e.
- **Jest e2e open-handle note:** suites exit cleanly; a `--forceExit` was only
  used while debugging an unrelated hang and is not part of the scripts.
- **Boundary check** (`npm run boundaries`) treats `src/common` and
  `src/database` as shared layers; `src/modules` may not reach across module
  boundaries except via shared layers.

- **Realtime is fire-and-forget, not durable (ADR-022).** Queue events are
  published to Redis as best-effort; an SSE client that connects between a
  publish and its subscribe misses that event with no replay (the database and
  the board snapshot remain the truth). Redis unavailability causes silent
  drops rather than retries. The e2e asserts release/scope, not durability.
- **Waitlist offer expiry is lazy.** A stale OFFERED entry only rolls over to
  the next candidate when an accept attempt (or the next offer) encounters it;
  there is no background sweeper flipping entries to EXPIRED at
  `offerExpiresAt`. The 15-min expiry is enforced on acceptance, not by a job.
- **Pairing throttle keys on client IP.** `X-Forwarded-For` (trusted) is used
  with socket fallback; without a trusted reverse proxy the header can be
  spoofed. Attempts are also bounded by the shared dev/test throttle so an
  untrusted environment can still be exercised.
- **Waiting-room abandonment rate is approximate.** `abandonmentRate` counts
  NO_SHOW+ABANDONED over finished visits; it reflects the waiting-room flow and
  the denominator excludes visits still sitting in CALLED/IN_SERVICE at query
  time, so early queries understate the rate.
- **Device tokens are opaque and low-scope, but long-lived until revoked.**
  Rotation/revocation endpoints exist; there is no idle-timeout sweeper, so an
  abandoned device session stays valid until explicitly revoked.
- **`OUTBOX_CONSUMERS` uses a factory, not `multi: true`.** NestJS multi
  providers do not compose with `useExisting` (the injected value is the single
  provider, not an array), so the consumer token is registered through a
  `useFactory` in `src/database/database.module.ts` (ADR-028).
- **The timeline mixes inline and event-sourced rows.** `patient.*` entries
  (registration, merge, guardians, consents, allergies, medical history) are
  written by the patients module in the owning transaction and have no
  `sourceEventId`; `Clinical.*` entries are projected from outbox events and
  always pin one. Replay safety applies to the event-sourced subset.
- **Workflow edges are validated as a widening union, never replacing core.**
  Organisations may only ADD edges (`workflows.manage`); there is intentionally
  no endpoint to delete or re-create a core edge (ADR-026), so a mis-keyed
  custom edge can only be corrected offline.
- **Purchase-order cancel is not exposed as an endpoint.** A PO can transition
  PLACED → RECEIVED / CANCELLED via the service, but no controller route invokes
  the cancel action, so a placed PO cannot yet be cancelled from the API (the
  workflow edge exists for a later phase).
- **Reorder levels are advisory, not schema columns.** `StockBatch` has no
  `reorderLevel`/`reorderPoint` columns; LOW_STOCK alerts are computed from
  serialized usage (`reorderDays` heuristic) rather than a static threshold.
  Supplier/medication reorder defaults are a later phase.
- **Stock counts only open per branch without a freeze.** `POST
  /stock/counts` opens a count snapshot of current on-hand for the branch; it
  does not block concurrent dispensing (a later phase may add a counted-freeze
  or difference reconciliation). Count application writes the ledger as an
  ADJUSTMENT leg.
- **Inventory ledger is append-only via a DB trigger, like `audit_logs`.**
  `inventory_ledger_entries` rows reject UPDATE/DELETE (same `IF NOT EXISTS`
  trigger pattern as Phase 0's append-only audit log), so correction is by
  offsetting entry, not mutation.
- **Idempotency replays return 200.** The interceptor stores `responseStatus:
  200` in `complete()`, so a replayed request answers 200 even when the first
  run returned 201 (ADR-009). `/_demo/outbox` and the dispense e2e assert this.
- **`lockBatchRows` uses raw SQL that is NOT tenant-transformed.** The FOR
  UPDATE batch-row lock uses explicit quoted `"organizationId"`/`"branchId"`
  columns in the WHERE clause (raw statements bypass the Prisma extension);
  the branch that owns the rows is the one written into the lock call from the
  request context.
- **Billing payments land directly in `COMPLETED`.** There is no `PENDING` /
  `AUTHORIZED` leg and no payment gateway; `PENDING` is reserved for a future
  gateway adapter. Cash/card/mobile/insurance are recorded as already-settled.
- **Invoice `OVERDUE` is derived, not materialized.** `balanceDue` is exact
  (`Decimal(12,2)` accumulated, surfaced as `toFixed(2)` strings); overdue
  status is a query-time filter (balanceDue > 0 and dueAt < now()), not a
  stored state on the workflow graph. Refunding a payment re-settles via the
  `PAID → PARTIALLY_PAID/ISSUED` edges, so `REFUNDED` invoices cannot be
  re-opened.
- **Insurance claims can only be sized down, not up.** A claim is created from
  the invoice's current balance, and `approvedAmount` is capped at the claim
  amount; partial approvals cannot later be raised above the approved amount.
- **Lab TAT aggregation is query-time, not a materialized rollup.** `GET
  /lab/tat` computes min/avg/max/p95 from completed orders in memory
  (releasedAt − orderedAt); on large histories it scans the window rather than
  reading pre-aggregated counters. A rollup (e.g. a per-day/hour histogram) is
  a later phase.
- **A rejected lab sample is terminal; recollection is a new order.** There is
  no "reopen" of a rejected sample — recollection creates a fresh order whose
  sample references the rejected one via `recollectsFromOrderId` (the rejected
  sample's order id). Operators must re-order explicitly rather than resume.
- **Radiology is a metadata-only seam (ADR-031).** `IMAGING_PROVIDER` /
  `PACS_GATEWAY` default to no-op implementations; there is no DICOM/PACS
  integration, no imaging bytes, and report contents live only in
  `ImagingReport`. The tokens exist so a real integration can be swapped in
  without changing the domain.
- **Critical-value flagging is catalog-driven, not clinical.** `isCritical`
  (and `isAbnormal`) derive solely from the org-configured numeric
  reference/critical ranges on `LabTestField`; borderline clinical judgement,
  inter-lab standardization, or organ-specific interpretable ranges are not
  modeled. Non-numeric fields never auto-flag.
- **Bed assignment depends on the partial unique index at insert time.**
  `bed_assignments_active_bed_uidx` (ADR-032) prevents a second ACTIVE
  assignment per bed in the database, but nothing enforces it via a DB trigger
  on the old row when the app releases outside a transaction; the application
  always releases the old assignment inside the same transaction it opens the
  new one, so the window never exists in practice.
- **`ward` has no optimistic lock.** `PATCH /wards/:id` updates by id without a
  `version` column, so two concurrent ward edits last-write-wins (beds are
  version-guarded). Ward metadata is low-churn; a `version` column is a later
  concern.
- **ED summary is query-time analytics, not a rollup.** `GET /emergency/summary`
  scans today's visits in memory for arrivals/active/avg minutes and
  by-priority/by-disposition tallies; on a busy department this is a full-day
  scan rather than pre-aggregated counters. A materialized per-hour rollup is a
  later phase.
- **Emergency dispositions are single-fire by workflow, and discharge notes are
  free-text only.** A referred/discharged/admitted visit rejects all further
  actions (`EMERGENCY_VISIT_CLOSED`); there is no reopen. `discharge`/`refer`
  persist `referralNotes`/disposition but the brief's "discharge summary
  document" is not generated as a `Document` — the inpatient discharge record
  holds summary/instructions/medications as JSON fields instead.
- **Admission numbers and ED numbers share the `counters` table.** `ADM-` and
  `ER-` sequences are separate org-scoped keys, but they ride the same physical
  `(organizationId, key)` `counters` rows as lab/billing numbers, so all go
  through the same atomic `ON CONFLICT UPDATE` primitive.

## Operational notes

- `test/.e2e.env.json` is **generated** by globalSetup and will hold real
  connection strings; it is gitignored. Reusing external Postgres/Redis for
  tests is fine but will destroy schema state via `migrate deploy` idempotency
  only — tests do not clean the schema between runs.
- Node 26 is used locally; the Dockerfile targets Node 22 per the brief.
- Docker Hub access was flaky during setup (npm registry unreachable too);
  `@swc/helpers` is intentionally not installed (helpers inlined, ADR-010).