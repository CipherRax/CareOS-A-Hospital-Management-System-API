# careOS — Known Limitations & Stubs

Honest accounting of what is stubbed, deferred, or knowingly imperfect. Items
marked **[stub]** are intentionally not implemented yet; everything else is
working code with a caveat.

## Explicit stubs (named in code)

- **Outbox delivery is scheduled (ADR-044), not transactional.** Outbox rows are
  written reliably in the same transaction as domain writes (ADR-007) and the
  dispatcher pointer drives REAL consumers (the timeline projection, ADR-028),
  but *delivery* is a separate act: a repeatable BullMQ `outbox-drain` job claims
  ready rows every `OUTBOX_DRAIN_INTERVAL_MS` (5 s default) and dispatches them
  outside any transaction. Consequences: a committed event is not visible to
  consumers for up to one interval (or longer if no worker process runs), and
  backoff/DEAD handling still applies (`MAX_OUTBOX_ATTEMPTS` 8, exponential).
  Under `NODE_ENV=test` the job is not registered, so e2e calls
  `publishReadyEvents` synchronously to keep specs deterministic.
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
- **Off-system notification delivery is a transport, not a mail/SMS/push
  client.** `NOTIFICATION_WEBHOOK_URL` turns `EMAIL`/`SMS`/`PUSH` from the
  structural stub into a real, HMAC-signed JSON POST with an idempotency key,
  and opt-outs are now enforced at send time (`SUPPRESSED`, never retried) —
  but the platform does not speak SMTP or SMPP: a deployment must point the URL
  at a mail relay, SMS gateway or push service that holds the channel
  credentials and does the actual sending. With the variable unset nothing
  leaves the host, and `NOTIFICATION_OFFSITE_CHANNELS` stays empty by default,
  so the consumer produces in-app rows only. Delivery is at-least-once, and
  PUSH is addressed by recipient id (the receiver resolves the device token)
  rather than by a stored push token.
- **PDF rendering is a stub.** `[stub]` `POST /document-jobs/pdf` validates
  permissions, merges the document map and audits `pdf.rendered`, but the
  `PdfRenderer` provider returns a placeholder payload — no real PDF bytes are
  produced. `health.os` still returns wall-clock time: healthcheck versioning is
  explicitly not implemented.
- **Provider directory is not built yet.** `[stub]` `Provider`, `ProviderSchedule`
  and integration tokens back tenant-scoped scheduling data used by Phase 4 and
  Phase 10 e2e, but there is no provider-facing onboarding/directory surface
  yet — that lands in a later phase.
- **The M-PESA Daraja adapter is a structural stub.** `[stub]` The
  `MpesaStkProvider` seam (`src/integrations/mpesa`) has a fully functional in-
  process mock (STK push, callback webhook recording, statement listing) that
  exercises the real API surface in tests/dev, and a `DarajaMpesaProvider` with
  the exact signing/endpoint payloads (BEARER token, `/mpesa/stkpush/v1/…`,
  `/mpesa/stkpushquery/v1/…`, callback `CallbackMetadata` parsing) — but the
  Daraja implementation records intent and is not a live Safaricom call. Real
  production wiring needs live credentials (consumer key/secret), the
  `MPESA_*` env vars, and removal of `MOCK`. Reconciliation correctness comes
  from the provider statement: with the live adapter unimplemented,
  reconciliation classifies against recorded mock entries only.
- **Maintenance reminders are queued on a cadence, but not delivered.**
  `POST /maintenance/reminders/queue` and the scheduler's
  `maintenance-reminders` duty (`MAINTENANCE_REMINDER_INTERVAL_MS`, 15 min
  default) share one idempotent scan of PLANNED/IN_PROGRESS records inside a 72h
  forward / 24h past window (unique `organizationId+maintenanceId`), so a
  scheduled pass and a manual one can never double-create. What is still stubbed
  is the *last mile*: `markReminderSent` only flips a status column, so a
  "sent" reminder records an attempt, not a confirmed hand-off — and the
  off-system adapter only reaches a receiver once `NOTIFICATION_WEBHOOK_URL`
  points at a real relay (ADR-045).
- **The scheduler is a BullMQ timer, not a distributed cron (ADR-044).** One
  repeatable job per duty, registered by every process and deduped by a stable
  `jobId`, so a fleet schedules each duty once and the queue hands ticks to one
  consumer. Caveats that follow from that choice: a tick is *at-least-once* and
  best-effort — a worker down for a while means no drain/reminders/expiry/
  delivery during that window (nothing is missed permanently: the next tick
  picks up the backlog), there is no distributed lock or leader election, and a
  repeatable job's interval is not a per-tenant quota. Each duty is idempotent
  and batched (`SCHEDULER_SWEEP_BATCH`, and `NOTIFICATION_DELIVERY_BATCH` for
  the delivery duty, which holds a network call per row), so a big backlog
  drains over several ticks rather than one long pass; the reminder sweep
  rotates organizations with a per-process UUIDv7 cursor, so a multi-process
  fleet may revisit some orgs sooner than others (harmless, the scan is
  idempotent). The notification-delivery duty is the one pass that does not
  re-assert a guard on write — it claims `PENDING` rows without locking and
  then calls the provider, so two overlapping ticks can both attempt a row
  (at-least-once, deduped receiver-side by the idempotency key; see ADR-045).
  `SCHEDULER_ENABLED=false` registers no duty at all — the operator kill-switch
  for a worker-less deploy. Report exports are expired by the `report-expiry`
  duty now, but generation is still synchronous and relies on the same
  read-side `expiresAt` check.
- **Report exports are synchronous and stored, not streamed.** `[stub]` An
  export is built inside the request (in-memory serialize) and persisted as a
  `ReportExport` row — there is no outbox/kick task object, no async
  callback, and no chunked streaming of very large reports. The PDF produced by
  `renderTextPdf` is a dependency-free minimal PDF (text + line layout, no
  charts/images/Unicode fonts). PDF artifacts are real bytes with
  `application/pdf` (unlike the Phase 10 `PdfRenderer` stub) but are purpose-
  built for text tables.
- **`DailyRollup` recomputes are full per-day reads, so multi-day churn is
  expensive.** Each touched event recomputes the whole org-day across every
  scope (source-table scans per recompute). A single day receiving thousands of
  events recomputes thousands of times in-flight. This is bounded and accepted
  at Phase 11 scale, but any later seller is a coarser event → recompute bucked
  per (org, day) dedupe in the consumer or a background materializer.
- **Emergency intake metrics are partial (per brief §11).** `metrics.snapshots.emergencyIntake`
  aggregates arrivals/triage minutes/untriaged-now/per-branch/per-hour from
  `EmergencyVisit` timestamps. The brief's intake-request metrics
  (acknowledgement, escalation, dispatch latency) shipped with P3 but are
  **not wired to the analytics snapshot** — the report exports read
  `EmergencyVisit` only, and the fields note this on the payload. Snapshotting
  intake-request latencies remains a roadmap item.
- **P3/P4 emergency escalation is best-effort with a reconcile safety net and no
  SMS/voice bridge (brief §6.15).** Each level is a delayed BullMQ job deduped by
  `jobId = <requestId>-<level>`; a guarded `updateMany` makes each level exactly
  once. If Redis loses a job between scheduling and fire time, the P4
  `maintenance` sweep's `reconcileEscalations` re-promotes an overdue open
  request on the next tick (default 60 s), so the SLA is recovered but not
  instantaneous. The final escalation level is a "call the numbers" state
  (`CALL_NOW`) — there is no SMS/voice bridge out to the contact chain, and
  duplicate-phone matching only falls back to the plaintext `callerPhoneIndex`
  derivative (ADR-041), nothing fuzzy. Staff notes are a single latest encrypted
  value without an author or timestamp column on the request (the event history
  carries the `note` event). Anonymous submit requires a resolvable facility
  location or an explicit caller location; a publish re-enable
  (SUSPENDED→PUBLISHED) does not resubmit background jobs already scheduled
  under the previous policy.
- **P4 retention anonymization is snowballing but not distributed (ADR-043).**
  `applyRetention` (P4) stamps `retainedAt`, retires the tracking token and
  nulls caller PII for CLOSED/CANCELLED requests past `EMERGENCY_RETENTION_DAYS`
  on a guarded, per-tenant tx; the reference number, append-only event history,
  and outbox/audit rows are NOT rewritten (by design — the request stays
  traceable for audit without caller PII). The sweep is an in-process tick, not a
  TTL/partitioned storage strategy, and emergency numbers / notices are never
  purged.
- **`patient-experience` composite needs populated cohorts to be meaningful, and
  an all-unknown weights set yields `null`.** Components with zero samples are
  dropped from the weighted average (never computed as 0), so early histories
  report a composite over whichever components exist; a total effective weight
  of zero returns `composite: null` rather than a fabricated number.
- **Forecasts are lightweight statistical models, not ML.** `moving-average`
  and `seasonal-naive` are deterministic, labelled as `above/within/below-
  average` by `classification.ts`, and `error` on feeds too short for their
  window is surfaced with a message instead of a number — there is no
  train/eval cycle, covariance, or holiday adjustment. Unknown forecast series
  names return a normal ForecastResult with an explanatory note.
- **Reconciliation is a deterministic rule pass, not a fuzzy matcher.** The
  three finding types (encounter-without-invoice, overpaid-invoice,
  claim-payment-mismatch) are exact predicates over the window; there is no
  similarity scoring, de-dup confidence, or ML-assisted triage. Suggestion
  strings are static templates. Runs persist findings once per `reconciliationRunId`.
- **Page-result responses unwrap to `{ data: items, meta }`.** The global
  transform interceptor turns any `PageResult` into `data` = items array + a
  `meta` object; list clients must read `body.data` (an array) and
  `body.meta.totalPages` — there is no `body.total` and no nested
  `body.data.items`. The metrics/bottleneck/dashboard payloads are plain
  objects and read via `body.data` as a single object.

- **The geocoding provider is a no-op stub (P2).** `[stub]` `NoopGeocodingProvider`
  (`GEOCODING_PROVIDER` in `src/modules/directory/providers`) reports
  `supported: false` and returns zero results; `GET /public/geocode` answers
  honestly with `{ supported: false, provider: 'noop', results: [] }`. No
  coordinates are ever autofilled for suggested/corrected listings from a map.
- **The facility CSV feed is disabled unless `PUBLIC_FACILITY_SOURCE_CSV_URL`
  is set (P2).** `[stub]` `RemoteCsvFacilityDirectoryProvider` (RFC-4180-ish
  parser; skips malformed rows) only runs when the optional env var is
  configured; otherwise `POST /admin/listings/import/run` throws
  `DIRECTORY_SOURCE_UNAVAILABLE` (503). The 15s fetch timeout and the URL
  trust/rate limits are operator concerns.

## Known caveats in shipped code

- **`/auth/me` `patient` is always null (P1).** Staff↔patient links are not
  modelled yet (no `Patient.userId`); the field is a reserved surface that will
  resolve once the patient-portal JWT link lands. The parity guarantee (me↔guard
  permissions) is unaffected.
- **`/auth/me` `session.idleTimeoutSeconds` / `lockAfterMinutes` are fixed,
  config-derived values (P1).** There is no per-session idle timer or
  lock-after-window column; session lifetime is enforced by the access-token TTL
  + refresh rotation. The advertised numbers are `JWT_ACCESS_TTL` and
  `SESSION_ABS_TTL_SECONDS/60` and are meant to be honest UI hints, not new
  enforcement points.
- **`X-Branch-Id` is advisory context, never a grant (ADR-042).** It selects a
  branch the caller already holds; un-assigned ids → 403. It does not widen
  access and does not (yet) filter every downstream query — features consume
  `TenantScope.branchId` explicitly.
- **The public directory has no separate `careos_public` read-only role (P2,
  ADR-038).** The patch enforces the public boundary in application code
  (`prisma.unscoped()` projections + whitelisted serializer + skip of tenant
  middleware), so `PublicFacilityListing`/`ImportedFacility`/
  `OnboardingInquiry` are reachable READ-ONLY for anonymous callers; the
  dedicated Postgres role is a documented operator step, not provisioned here.
- **Public directory search is exact/`CONTAINS` (P2, ADR-039).** Matches are
  intentional-exact (no fuzzy/hard-corrected spelling); search results are not
  distance-ranked and can list facilities far apart when several share a town.
  `distanceKm` is authored only on `/nearby` results.
- **Public directory wait estimates are always null (P2).** `serializePublicListing`
  does not fabricate busyness; `waitEstimateMinutes` will resolve in P4 when
  ED-inbox telemetry feeds the projection.
- **Directory cache is a 60s snapshot with coarse invalidation (P2).** Reads are
  cached on `directory:v{rev}:{base}:{hash}`; any admin listing action bumps
  `directory:rev` and the cache consumer idempotently re-bumps on
  `Directory.PublicListingChanged`. A change can therefore be stale for up to
  60s on the public side. The revision counter is Redis-only — a Redis flush
  resets it (safe: returns to direct reads), and it is not the source of truth
  for the rows themselves.
- **Display `GET /display/queue` and `POST /admin/display-devices*` alias the
  existing `POST /display/devices*` surface (P1).** Both route families call
  the same `DisplayService`; there is one implementation, not two.
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
- **REJECTED expenses are terminal by design.** The e2e asserts that approve/
  pay/cancel/submit all 409 after a rejection; re-submitting a corrected DRAFT
  copy is the intended flow (a new expense reuses the same reference). No
  REJECTED → DRAFT reactivation exists.
- **Wastage valuation uses the batch cost recorded at receipt.** Write-offs
  carry the batch `purchaseCost` into the `WASTAGE` ledger row; batches
  received without a unit cost evaluate to 0 in the wastage report.
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
- **Idempotency replays reproduce the recorded status (P4).** The interceptor
  stores `responseStatus` from the route's real `reply.statusCode` in
  `complete()` (the earlier hard-coded `200` was replaced in P4), so a replayed
  request answers with the same status as the first run (e.g. 201) rather than a
  pinned 200 (ADR-009/ADR-043). The dispatch e2e asserts this (a 201 first call
  replays as 201) and `/_demo/outbox` replays echo their own status. Replay
  protection is bounded by `IDEMPOTENCY_WINDOW_SECONDS` (1 h): the P5
  `idempotency-sweep` duty reclaims records past `expiresAt`, after which the
  same key executes the request again (and an `IN_PROGRESS` row orphaned by a
  crashed request stops answering 409 forever).
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