# careOS — Decision Records

Accepted architecture/engineering decisions, newest first. Each entry records
context, the decision, and its consequences.

## ADR-046 — A coding-reference import notifies the reference owners; it reconciles nothing, because it cannot break anything

**Status:** accepted (Patch P7)

**Context:** `Reference.CodingSystemImported` was published and dropped. The
dispatcher acknowledges an event with no subscriber
(`consumer-outbox-dispatcher.ts` returns `true` when `consumers.length === 0`),
so importing a clinical coding reference — the thing every coded diagnosis and
procedure line is validated against — produced no observable effect on anyone
who selects codes from it. The roadmap tracked it as a missing consumer.

The obvious "make it meaningful" instinct is a reconciliation pass: find
diagnoses whose `codeConceptId` now points at a deactivated or missing concept
and flag them. Reading the import path before designing that killed the idea.
`CodingService.importConcepts` upserts exactly the concepts in the payload and
its `update` branch sets `isActive: true` and nothing else. It never sets
`isActive: false`, never deletes, and never touches a concept outside the
payload. `Diagnosis` also snapshots `code` and `description` at authoring time
rather than reading them through the relation, and the relation itself is
`onDelete: SetNull`. So an import **cannot** orphan an existing
`Diagnosis.codeConceptId`, cannot silently rewrite recorded text, and cannot
make a code disappear. There is no integrity damage at this point to detect.

**Decision:**
- **Notify the reference owners; reconcile nothing.** `CodingReferenceConsumer`
  (`coding-reference`) fans a PHI-neutral "the reference set changed" notice out
  to the distinct active users whose roles include `coding.manage` — the people
  who own the reference, not every clinician — carrying the inserted/total
  counts. That is the only true consequence of an import today, so it is the
  only thing the consumer claims to do.
- **The audience is resolved from real `Role`/`UserRole` rows**, not from the
  import's actor. Notifying the actor would be a receipt for an action they just
  took; the set that *selects* codes is the one whose world moved.
- **A deterministic notification id per (event, recipient)** so a replay between
  the notification write and the `ProcessedEvent` write collapses into
  `createForUser`'s upsert instead of double-notifying.
- **A future deactivation endpoint is a different decision.** If a concept is
  ever deactivated rather than overwritten, that *would* orphan codes and would
  need a real reconciliation pass. `docs/limitations.md` records that it does
  not exist yet, so the gap is visible before someone relies on it.

**Consequences:** importing a coding reference is no longer invisible, and the
cost is one notification row per reference owner. The consumer is idempotent
under replay and does no PHI-bearing work: the template is allowlisted to
`codingSystemId`/`inserted`/`total` and passes the existing neutral-body check.
The "diagnoses referencing removed codes" problem is *not* solved — it is
correctly not a problem yet, and the deactivation path is named as the thing
that would create it.

## ADR-045 — Off-system notification delivery: opt-out before send, real addresses, and a retry ladder

**Status:** accepted (Patch P6)

**Context:** the notification seam was four structural no-ops. `SmtpProvider`,
`SmsProvider` and `PushProvider` logged a line and returned `{ delivered: true }`,
so nothing left the host, nothing could fail, and the "delivery" was
unfalsifiable. Worse, the path around them was wrong in three ways that only a
real adapter would have exposed. (1) `NotificationPreference` rows were written
by `PUT /notifications/preferences` and listed by `GET /notifications/preferences`,
but **never read at send time** — a recipient who opted out of a channel still
got it. (2) `to` was `recipientUserId ?? recipientPatientId`, a bare id no mail
relay or SMS gateway can act on. (3) `NotificationDeliveryService.send` made one
inline attempt from the outbox consumer, and any failure was a terminal `FAILED`
after a single try — no retry, no backoff, and a provider outage lost the message.
The provider map was also built inline in the feature module behind the repo's
only string DI token.

**Decision:**
- **Opt-out is decided at send, before anything leaves the system.** The delivery
  service reads the recipient's `NotificationPreference` rows for
  `(channel, templateKey)` and suppresses to the new terminal `SUPPRESSED`
  status with `errorCode = RECIPIENT_OPTED_OUT`. Resolution is opt-out by
  default, and the template's own category beats a `*` catch-all row, so a
  blanket opt-out can be re-enabled for one template. `SUPPRESSED` is
  deliberately a separate status from `FAILED`: a deliberate non-send is not a
  delivery failure, must not be counted as one, and must never be retried.
  A channel with no address on file is suppressed the same way
  (`RECIPIENT_ADDRESS_MISSING`) — a missing phone will still be missing on the
  fourth attempt.
- **Real addresses.** `EMAIL` resolves `User.email`/`Patient.email` and `SMS`
  resolves `.phone`; `IN_APP` and `PUSH` address by recipient id (the row *is*
  the in-app delivery, and a push provider resolves its own device token).
- **A real adapter, selected by env.** `NOTIFICATION_WEBHOOK_URL` switches
  `EMAIL`/`SMS`/`PUSH` from the stub to `WebhookNotificationProvider`, which
  POSTs the rendered notification as JSON with `x-careos-signature`
  (HMAC-SHA256 over the exact bytes sent) and `x-careos-idempotency-key`. One
  adapter serves all three channels because the receiving system — mail relay,
  SMS gateway, push service — is what holds the channel credentials; the
  platform never needs per-provider secrets to prove the path is real. A 2xx is
  the only success signal and its id (header or small JSON body) is persisted as
  `providerRef`. Wiring moved to `NotificationsIntegrationModule` behind a
  `Symbol` token, matching the M-PESA seam.
- **Retry ladder, driven by the P5 scheduler.** A transient failure (transport,
  timeout, 5xx) leaves the row `PENDING` with `nextAttemptAt` pushed out by
  `NOTIFICATION_DELIVERY_RETRY_BASE_MS * 2 ** attempt`, and the new
  `notification-delivery` duty (15 s, batch 100) claims rows on
  `status = 'PENDING' AND nextAttemptAt <= now` (riding a new
  `(status, nextAttemptAt)` index). Only `NOTIFICATION_DELIVERY_MAX_ATTEMPTS`
  (5) or a permanent cause — a 4xx, no provider configured, no recipient —
  produces `FAILED`. Error codes stay a small stable set so dashboards can
  group them without leaking provider internals; that includes keeping
  `PROVIDER_NOT_CONFIGURED` (terminal) distinct from `PROVIDER_UNAVAILABLE`
  (retryable), a collision the e2e suite caught.
- **Fan-out is opt-in per deployment.** The consumer still always produces
  `IN_APP`, and adds the channels in `NOTIFICATION_OFFSITE_CHANNELS` (default
  empty) with a per-channel notification id. Default stays in-app only because
  a send that leaves the system cannot be unsent and a recipient cannot consent
  to a channel they never asked to join.

**Consequences:** a recipient's opt-out is now enforced where it matters, a
provider outage retries instead of dropping the message, and a real receiver can
be pointed at the platform without changing code. The cost is honest: delivery is
at-least-once (a retry after a timeout may re-send an already-accepted payload,
which is what the idempotency key is for), the sweep is a select-then-attempt
with no locked claim — deliberately not locking across a network call, so two
overlapping ticks can double-send a row — and the webhook adapter is a transport,
not a mail client: a real deployment still needs a receiving relay, and SMS/PUSH
addressing stays the receiver's job. Notification bodies remain PHI-neutral by
construction (ADR-034), which is what makes sending them off-system acceptable
at all. Nothing is registered under `NODE_ENV=test`, so e2e drives the duty
directly — against a real in-process webhook receiver, not a mock.

## ADR-044 — Time-based duties are BullMQ repeatable jobs with idempotent, batched sweeps

**Status:** accepted (Patch P5)

**Context:** the platform had no timer. Outbox delivery ran on a bare
`setInterval` inside `src/worker.ts` (5 s, batch 100) — invisible, untested, and
only in the worker process; maintenance reminders were materialised only when an
operator called `POST /maintenance/reminders/queue`; `IdempotencyRecord` rows
accumulated forever (an `IN_PROGRESS` row orphaned by a crashed request answered
`409 IDEMPOTENCY_IN_PROGRESS` *permanently*, because nothing expired it); and
`ReportExport` rows were only expired lazily on read. Three options were
available: another bare `setInterval` loop, `@nestjs/schedule` + cron strings (a
new dependency), or the BullMQ repeatable-job primitive already in use for
emergency escalation (ADR-043) and already a dependency.

**Decision:** repeatable jobs on a dedicated `scheduler` queue, one per duty —
`outbox-drain` (5 s), `maintenance-reminders` (15 min), `idempotency-sweep`
(1 h), `report-expiry` (5 min). `SchedulerWorker` registers them in
`onApplicationBootstrap` with a stable, colon-free `jobId` per duty, so every
API/worker process requests the same repeatable and BullMQ dedupes it into one
schedule while distributing ticks. Intervals are env-driven
(`OUTBOX_DRAIN_INTERVAL_MS`, `MAINTENANCE_REMINDER_INTERVAL_MS`,
`IDEMPOTENCY_SWEEP_INTERVAL_MS`, `REPORT_EXPIRY_INTERVAL_MS`), and
`SCHEDULER_ENABLED=false` registers nothing.

Two decisions inside that:
- **The worker owns *when*; `SchedulerService` owns *what*.** Every duty is a
  plain idempotent method (`drainOutbox`, `sweepIdempotencyRecords`,
  `expireReportExports`, `queueMaintenanceReminders`) with no BullMQ knowledge,
  so an operator script or a test can drive the same code path without Redis
  (the e2e suite does exactly that). The BullMQ root connection/prefix moved to
  a single `BullQueuesModule` — previously every queue-owning module called
  `forRootAsync` itself, and since root options are global the last module to
  boot silently won the prefix.
- **Sweeps select-then-write in bounded pages and are safe to re-run.** Nothing
  does an unbounded delete/update, and every write re-asserts its guard
  (`status: 'READY'` on the export flip), so a concurrent pass, an operator, or
  a lost race yields a count of 0 rather than a corruption. The reminder sweep
  rotates organizations with a per-process UUIDv7 cursor — with a plain
  `take: N`, an org list longer than `SCHEDULER_ORG_BATCH` would starve every org
  past the first page forever.

**Consequences:** the four duties now happen on a timer with no HTTP call, and
the orphaned-in-progress 409 is gone. The cost is honest: ticks are
at-least-once and best-effort (a worker down means no delivery during that
window, though the backlog drains when it returns), there is no leader election
or per-tenant quota, and the reminder rotation is per-process, so a fleet can
revisit some orgs sooner than others — all acceptable because every duty is
idempotent. Cross-tenant sweeps deliberately use `prisma.unscoped()` and
re-enter the tenant layer per org:
`MaintenanceService.queueReminders({ organizationId, actorId: null })` opens a
properly tenant-scoped, RLS-tied transaction and records that nobody queued the
reminder (`queuedById` is null). Nothing is registered under `NODE_ENV=test`, so
e2e stays deterministic. Cron-pattern schedules (`repeat: { pattern }`) were
rejected as unnecessary: all four cadences are plain intervals, and env-driven
periods are easier to tune per deployment.

## ADR-043 — Anonymous emergency intake is sweeper-backed: lost-job reconciliation, payload dedupe, and PII retention

**Status:** accepted (Patch P4)

**Context:** three release-gap behaviours in the §6.15 anonymous intake flow
needed a home. (1) Escalation levels are delayed BullMQ jobs; if Redis loses a
job between scheduling and fire time, an unacknowledged request silently stops
escalating — with no outbox row to replay. (2) The global HTTP idempotency
interceptor only guards tenant-scoped routes, so an anonymous double-tap of
`POST /public/emergency/requests` could mint two incidents. (3) The P3 schema
kept caller PII encrypted-but-indefinitely, with no SLA after closure.

**Decision:**
- **Reconciliation sweep.** The escalation processor becomes one unified worker
  (`EmergencyIntakeWorker`) that also registers a repeatable `maintenance` job
  (BullMQ `repeat: { every: EMERGENCY_SWEEP_INTERVAL_MS }`, default 60 s,
  scheduled only outside `NODE_ENV=test` so e2e stays deterministic).
  `reconcileEscalations` (unscoped scan of open RECEIVED/ESCALATED requests,
  take 100, plus the enabled `autoEscalate` policies) re-runs
  `attemptEscalation` for any request whose next level is overdue, which is
  exactly-once via the existing guarded `updateMany` even against a still-live
  job.
- **Payload dedupe.** `submitPublic` keeps a normalized `callerPhoneIndex` and,
  before minting a token, looks for an open (RECEIVED/ESCALATED) request from
  that phone at the same branch inside `EMERGENCY_DEDUPE_SECONDS` (default 120
  s); a hit returns `{ request: { id, referenceNumber, duplicate: true } }` and
  no second token.
- **Retention hook.** `applyRetention` anonymizes CLOSED/CANCELLED requests
  past `EMERGENCY_RETENTION_DAYS` (default 90; 0 disables) one per tenant tx:
  guarded `updateMany` stamps `retainedAt`, retires the tracking token to a
  `retired:<id>` sentinel that can never collide with a SHA-256 hash, nulls the
  caller PII columns, writes a `RETENTION` event (actor `SYSTEM`) + audit row,
  emits `Emergency.RequestRetained`, and publishes to the requests topic. The
  reference number and append-only event history survive for audit; PII does
  not.
- **Concurrent escalation was reopened for later levels.** The P3 guard only
  advanced from `status: RECEIVED`, but level 1 sets the read-model to
  `ESCALATED`; it now accepts `RECEIVED | ESCALATED` (the `escalationLevel ===
  level-1` predicate keeps every level exactly once).

**Consequences:** lost SLA jobs are re-promoted within one sweep interval rather
than lost outright (still best-effort, not instantaneous); the anonymous surface
has a payload-level guard the HTTP interceptor cannot provide; PII has a
snowballing retention lifecycle without deleting the incident audit trail.
Processes are single-writer guarded but the repeatable job is registered per
instance — BullMQ dedupes by `jobId`, and the guarded writes keep a multi-instance
fleet safe. Timing-safe token comparison was explicitly rejected: tracking
lookup is a single hash-index equality, so a constant-time compare would be dead
code.

## ADR-042 — `/auth/me` and `X-Branch-Id` share one permission resolver and can never widen access

**Status:** accepted (Patch P1)

**Context:** frontends need one authoritative post-login bootstrap, and the
patch brief requires that the permission set returned by `GET /auth/me` be
computed by the *same function* the permission guard uses, otherwise the UI and
the server can drift (UI shows a button the server rejects, or worse).

**Decision:** `AuthService.me()` resolves roles from `UserRole` rows and computes
the effective permission set with the existing `permissionUnion(roles)` from
`src/common/auth/rbac.ts` — the exact function `TenantGuard` already uses to
re-resolve permissions per request (never from the JWT). A unit test asserts the
two code paths cannot diverge. `X-Branch-Id` is validated in the tenant/request
layer against the caller's `UserBranch` rows and only *selects* a branch the
user already holds; it is stored in `TenantScope.branchId` and the default is
the user's default branch. An invalid or non-allowed branch id yields
`TENANT_ACCESS_DENIED`. The header never adds a branch to the user's set, so
access cannot be widened.

**Consequences:** one source of truth for "what can this principal do"; the
branch selector is a preference, not an authorization grant. `/auth/me` returns
permissions for UI gating only — every request is still authorized server-side
by `PermissionsGuard`.

## ADR-041 — Emergency-request PII is encrypted at rest with AES-256-GCM

**Status:** accepted (Patch P3)

**Context:** emergency requests carry caller phone, description, and a reported
location. The brief requires field-level encryption at rest and "IDs only" in
outbox/job payloads.

**Decision:** reuse the existing `FieldEncryption` (`src/common/security/crypto.ts`,
AES-256-GCM, nonce-collision guard) — already proven for TOTP secrets — to
encrypt `callerPhone`, `description`, and `location.landmarkText` on
`EmergencyRequest`. Plaintext never leaves the service boundary: the public
tracking endpoint returns status labels and facility name/phone only; outbox and
worker payloads carry the request `id`/`trackingToken` digest alone.

**Consequences:** DB dumps and backups do not expose caller text; search/
duplicate-phone matching must operate over a *searchable derivative* (a separate
normalized, non-encrypted phone-index column derived from the plaintext at
write time is considered acceptable and documented), because GCM AES is not
searchable. The encryption key comes from env (`FIELD_ENCRYPTION_KEY`), shared
with the MFA secret material.

## ADR-040 — Emergency escalation is append-only events plus idempotent delayed jobs

**Status:** accepted (Patch P3)

**Context:** an unacknowledged emergency request must escalate one level at a
time (SLA-bound, then caller SMS), and the same request may race two workers or
a late acknowledgement. Escalation must fire *exactly once per level* and must
be cancelled by a staff acknowledgement.

**Decision:** `EmergencyRequestEvent` is the append-only history; status is
derived from it (ADR-042-style read model stays a convenience). On submit, the
transaction writes the request + `EmergencyRequestReceived` outbox event only.
Escalation is driven by BullMQ delayed jobs (the worker exists in the repo;
ADR-024/028 patterns apply): each level's job carries `requestId + level` and
is **conditionally idempotent** — it re-reads the request, and if
`acknowledgedAt` or a higher `escalationLevel` is already present it no-ops,
otherwise it advances one level and schedules the next. An acknowledgement marks
`acknowledgedAt` in the same transaction as the `EmergencyRequestAcknowledged`
event, which the escalation worker honors as the cancel signal. A dedupe index on
`(requestId, level)` prevents double-firing even if the same job is delivered
twice.

**Consequences:** escalation is at-least-once with idempotent-on-apply (replays
cannot double-advance); the caller-facing "not yet acknowledged — call the
facility/national numbers" message only ever fires from the final-level job, and
only `RESPONDING` (staff-set) implies help is coming.

## ADR-039 — Geo queries over PostGIS `geography`, with a haversine fallback

**Status:** accepted (Patch P2)

**Context:** "find care near me" needs point-distance ordering, radius
filtering, and timezone-aware `openNow`. The deployment may not always have
PostGIS available (existing Compose/e2e images are plain Postgres).

**Decision:** `PublicFacilityListing` stores canonical `locationLat` /
`locationLng` as `Double` (Prisma-managed, the source of truth). PostGIS is
supported as an enhancement: the migration runs `CREATE EXTENSION IF NOT EXISTS
postgis` inside a `DO` block and, when available, adds a generated
`geography(Point,4326)` column plus a GiST index managed **outside** the Prisma
schema (all geo access goes through `$queryRaw` in a `GeoRepository`). The
repository probes PostGIS once (cached) and dispatches to either
`ST_DWithin`/`ST_Distance` or a plain-SQL bounding-box + haversine fallback that
needs nothing but the two doubles. Distances are straight-line and approximate;
never presented as travel time. Runtime provider split also lets the e2e keep
plain Postgres while unit-testing both paths.

**Consequences:** one canonical lat/lng model; PostGIS images are the
recommended deployment (Compose + e2e switch to `postgis/postgis:*-*`), and the
system still functions on vanilla Postgres with slightly larger result sets
(bbox pre-filter keeps it bounded). The `geography` column is manual SQL, so a
future `prisma migrate diff` ignores it by design; the ADR records why it is not
in `schema.prisma`.

## ADR-038 — The public directory is a sanitized projection read through a read-only role

**Status:** accepted (Patch P2)

**Context:** public facility search is cross-tenant by nature. It must never
leak tenant data, even a field at a time, and its data is opt-in per branch.

**Decision:** the public read path never touches tenant tables. An outbox
consumer (`PublicListingChanged`, ADR-028 pattern) projects a sanitized,
org-independent `PublicFacilityListing` row per *published* branch —
whitelisted public-safe fields only (name, slug, address, county, town,
location, phones, hours, services, insurance, accessibility, `open24h`,
`emergency24h`, `ambulanceAvailable`, `emergencyIntakeEnabled`,
`acceptsOnlineBooking`). A dedicated Postgres role (`careos_public`) is granted
`SELECT` on the public projection/reference tables and *nothing else*; the
public module connects with that role. An integration test runs a cross-db query
proving the role cannot read tenant tables. Listing status is
`DRAFT → PUBLISHED → SUSPENDED` (opt-in by `public_listing.manage`; platform
`SUPER_ADMIN` may suspend), and `verificationStatus`
(`UNVERIFIED | DETAILS_CONFIRMED`, `lastConfirmedAt`) is explicitly "platform
staff confirmed the contact details and location" — never accreditation or
certification. This is the exception to the tenant-scoped Prisma extension, and
it is constructed (separate role + separate client + whitelisted projection)
rather than carved out of the tenant client.

**Consequences:** even a bug in the tenant path cannot surface a tenant table
row through the public API because the read role lacks permission; listing rows
are inert copies (a tenant delete must re-run the projection). Imported
non-careOS facilities (`ImportedFacility`,
`partner: false`, sourced/licence/`importedAt` recorded) share the same
whitelist shape, flagged so clients know requests/booking are unavailable.

## ADR-037 — Daily rollups are recompute-on-event, with per-day scopes rolled into the org-wide cell

**Status:** accepted (Phase 13)

**Context:** the analytics brief (§7.1) needs days-aggregated counters per org
for metrics, bottleneck/capacity, forecasts, patient experience and dashboards.
Two anti-patterns had to be avoided: (a) recomputing every counter by scanning
the whole window on each read (the pre-rollup modules already do that for TAT
and ED summaries and it does not scale), and (b) incrementing counters from
events, which drifts when events are **replayed** (any outbox consumer can
re-deliver a row, and `processed_event` dedupe is per-consumer, so a crash
between dispatch and ack naturally repeats work).

**Decision:** `DailyRollup` rows are **full recomputes per org-day**, not
delta increments. The `rollup-touch` outbox consumer subscribes to 40+ domain
events and, for each decoded day touched by the payload, calls
`recomputeDay(org, day)`, which re-reads every source table for that
org+day under RLS and upserts the day's counters by the unique
`(organizationId, date, branchId, departmentId)` key. Replays are therefore
idempotent by construction. Cells are keyed by `(branchId, departmentId)` —
branch+department scopes get their own row and org-wide-only events
(payments, refunds, claims, diagnoses, tasks) live in the `('', '')` cell.
After the scoped upserts, recomputeDay rolls **every** cell's counters into the
org-wide `('', '')` cell ("rollup-of-rollups"), so un-scoped reads
(`branchId: ''`) see the whole org while per-branch reads stay scoped and the
org-wide-only events are counted exactly once. Manual catch-up exists via
`POST /analytics/rollups/rebuild` (business-day window, max 30 days).

**Consequences:** reads (`/analytics/metrics`, dashboards, patient-experience)
are trivial aggregations over ≤ 31 `DailyRollup` rows, not window scans; a
replayed or out-of-order event cannot corrupt a day because the recompute is a
full read of committed state. The cost is per-event recomputes (an org-day that
sees many events recomputes many times) and a bounded window for historical
repairs — both acceptable at Phase 11 scale and documented in
`docs/limitations.md`. The initial e2e caught a real design gap: the org-wide
cell was receiving only org-wide-only events, so un-scoped reads came back
empty; the rollup-of-rollups loop (and the e2e seeding real branch activity)
fixed it.

## ADR-036 — Operations post to the ledger as two events: accrual then payment

**Status:** accepted (Phase 12)

**Context:** an expense approval creates a liability the same way invoicing
does; the subsequent payment settles it. Both are exactly-once auto-posted by
the ADR-035 consumer, so each state transition must carry a distinct
`referenceType`/`referenceId` pair against the shared unique index.

**Decision:** `Operations.ExpenseApproved` posts `DR 5000 Expenses / CR 2100
Accounts payable` dated `approvedAt`; `Operations.ExpensePaid` posts
`DR 2100 / CR 1000 Cash` dated `paidAt`. Approval and payment are therefore two
independent idempotent journals rather than one two-phase document, and a
CLOSED period fails each leg independently into a `LedgerPostingException`.
Analytics that measure supplier spend/belances aggregate over `status =
APPROVED` (the state that created the obligation) and use the separate
`paymentStatus` column to split outstanding vs paid — a status probe must never
include the payment-only value `PAID`.

**Consequences:** the books mirror the obligation/payment split exactly and
replay safety is identical to billing. The concise spelling of the expense
status enum (`DRAFT|SUBMITTED|APPROVED|REJECTED|CANCELLED`, payment tracked on
`paymentStatus`) means a naive `in: ['APPROVED','PAID']` filter throws at the
Prisma layer; the e2e run caught this at the supplier-spend endpoint.

## ADR-035 — Auto-posting stays honest: period locks write exceptions, not poison

**Status:** accepted (Phase 11)

**Context:** billing events (`InvoiceIssued`, `PaymentCompleted`, …) drive
double-entry journals through an outbox consumer. When a journal's date falls
in a CLOSED/LOCKED financial period, the consumer cannot book it. If it throws,
the outbox row retries with exponential backoff and poisons the same row for
every sibling consumer (timeline, notifications) — the exact failure ADR-034
eliminated for the notifier.

**Decision:** the ledger consumer never throws on a locked period. It records
an auditable `LedgerPostingException` row (`eventId`, `eventType`,
`referenceType`/`referenceId` preferring the payment aggregate, `reason`) and
returns normally so the row is acked once. Booked journals own the DB level
too: `finance_transaction_lines` enforces single-side lines and a trigger
guards debits vs credits, and auto-posted journals carry a unique
`(organizationId, referenceType, referenceId)` so replays are no-ops even if a
`ProcessedEvent` row is lost. Manual journals use null references and can never
collide.

**Consequences:** reconciliation is a companion to the books, not a mutation:
M-PESA matches are resolved by audited resolution stamps (VERIFIED, CORRECTED,
PAID_OUT_OF_BAND, DUPLICATE_REFUNDED, WRITTEN_OFF, ESCALATED) that never alter
ledger rows, so the books and the exception trail are the single source of
truth and the period lock is a hard, observable boundary.

## ADR-034 — Neutral-body guard masks entity ids before PHI matching

**Status:** accepted (Phase 10)

**Context:** notification copy must never contain contact or credential data.
`ensureNeutralBody` flagged rendered content by scanning for email/phone/
national-ID/password patterns. `uuidv7` ids take the form
`tttttttt-vvvv-7yyy-nnnn-rrrrrrrrrrrr`; nothing forces a digit run boundary
inside the hex groups, so an id suffix frequently contains 8+ consecutive
digits (e.g. `…ec268312027d`), tripping the 8–16 digit phone pattern. Rendered
built-in templates substitute the full id into the body, so a completely
neutral, PHI-free notification sporadically failed the gate, the outbox
consumer threw, the row retried with exponential backoff and never delivered —
a poison message that only reproduced when an unlucky id happened to be
generated (hence flaky across e2e runs).

**Decision:** `ensureNeutralBody` first replaces uuid-formatted references
(`\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b`) with an
`id` placeholder before running the PHI detectors. Entity references are not
PHI; a phone number cannot be encoded as a bare v7 uuid, so the mask does not
weaken real signal. All other patterns are unchanged and their order is
preserved.

**Consequences:** entity-id references render and deliver reliably; real
phones/emails/IDs/passwords are still detected (unit tests cover filtered-and-
still-detected cases). Any future non-uuid id scheme with a digit run could
theoretically trip the phone pattern again, so a new id format should revisit
this mask.

## ADR-033 — One outbox composition root beats multi-provider fan-out

**Status:** accepted (Phase 10)

**Context:** the outbox dispatcher's consumer set (`OUTBOX_CONSUMERS`) had to
span the core projections (timeline, pharmacy tasks, born in `DatabaseModule`)
and the feature consumers (notifications). Wiring each module to register via
`provide: OUTBOX_CONSUMERS, multi: true` looked clean but turned out to be
order- and scope-dependent: when the modules lived at different global-module
depths, Nest's multi-provider merge silently produced an array containing only
one module's contribution, so the dispatcher had an empty consumer list for
most event types. Rows were acked (`PUBLISHED`) with `processed_events` empty
and notifications never created — deterministic when the registration order
changed, invisible in isolated spec runs, and a `no-database-to-modules`
dependency-rule violation if `DatabaseModule` simply imported feature modules.

**Decision:** a `@Global` `OutboxModule` (`src/modules/outbox/outbox.module.ts`)
is the single composition root. It imports `DatabaseModule` + `NotificationsModule`,
and its `OutboxPublisherService` provisions `OUTBOX_CONSUMERS` via one
`useFactory` that injects `TimelineProjectionConsumer`,
`PharmacyTaskConsumer` and `NotificationConsumer` directly, yielding an
explicit, always-complete array `[timeline, pharmacyTasks, notifications]`. It
also provides `ConsumerOutboxDispatcher` and `OUTBOX_DISPATCHER` and exports
`OutboxPublisherService`. The database and notifications modules keep their own
consumers as providers (and export them) but register no multi-providers.

**Consequences:** the consumer set is deterministic in every spec order;
`AppModule` imports `OutboxModule` once and all downstream modules resolve the
shared publisher. The section keeps dependency rules intact (no
database→modules edge). The trade-off is a single point that must be updated
when a new consumer joins — documented in the module header.

## ADR-032 — One bed, one patient: row lock + partial unique index backstop

**Status:** accepted (Phase 9, the brief's Phase 8)

**Context:** an admission must never double-book a bed. The application checks
bed state before assigning, but a naive check-then-write is racy: two
concurrent admits against the same AVAILABLE bed can both read "AVAILABLE".
Optimistic locking on the bed's `version` alone only rejects at write time and
still needs a sentinel; and the health record demands a database-level
guarantee, not just a happy-path service check.

**Decision:** assignment is guarded at two layers inside the same interactive
transaction. First, `lockBedForAssignment` (`inpatient.service.ts`) issues
`SELECT … FOR UPDATE` on the bed row within the admission/transfer
transaction, so concurrent callers serialize on the row and re-read the
committed state; an `AVAILABLE`-only gate plus an "no active assignment" check
reject everything that is not assignable (`BED_UNAVAILABLE`, 409). Second, the
migration adds a partial unique index
`bed_assignments_active_bed_uidx ON bed_assignments (bedId) WHERE
"releasedAt" IS NULL` as a hard DB backstop — any path that would create a
second open assignment violates the index and the transaction maps the `P2002`
to `BED_UNAVAILABLE`. The parallel service check also catches
`ADMISSION_ALREADY_ACTIVE` (one open admission per patient) before the lock.

**Consequences:** the one-bed-one-patient rule holds even under a missed check
or a future code path. The FOR UPDATE lock additionally makes
transfer-vs-admit collisions safe (the target bed is row-locked before the old
assignment is released, so there is no AVAILABLE gap to race). The cost is a
raw-SQL lock statement that bypasses the tenant-aware Prisma extension, so it
uses explicit quoted `"organizationId"`/`"bedId"` columns (same pattern as the
inventory `lockBatchRows`, ADR-notes in limitations).

## ADR-031 — Radiology rides workflow seams, not a PACS client

**Status:** accepted (Phase 8, the brief's Phase 6)

**Context:** radiology orders need a lifecycle (order → schedule → perform →
submit → verify → release) but the real modality/PACS/DICOM surface is out of
scope for this phase; hard-coding a PACS client would couple the domain to an
external system that does not exist yet.

**Decision:** the radiology domain only knows two tokens — `IMAGING_PROVIDER`
and `PACS_GATEWAY` (`src/integrations/imaging/imaging.module.ts`). They are
backed by no-op implementations (`NoopImagingProvider` / `NoopPacsGateway`)
registered as the defaults, so `radiology.service.ts` calls them purely as a
seam: a real provider/gateway can be swapped in later without touching the
workflow, numbering, or report code. `ImagingReport` stores metadata (contents,
perform/verify/release stamps) only — no imaging bytes.

**Consequences:** the domain is decoupled from imaging infrastructure by
construction; the only cost is a harmless no-op call per action. Orders,
numbers (`RAD-YYYY-NNNNNN`), the performed/reported/verified/released graph,
and role gates are all real and e2e-tested.

## ADR-030 — Lab results are versioned; verify/release gates publication

**Status:** accepted (Phase 8, the brief's Phase 6)

**Context:** lab results carry clinical weight: an edited result in place
breaks audit, an unverified result released is a safety hazard, and a critical
value that nobody acknowledged disappears in the stream.

**Decision:** `LabResult` rows are immutable-appended: `enterResults` writes
`versionNumber` 1 (ORIGINAL), and any pre-release amendment appends a
superseding version (`+1`, `amendedById`/`amendedAt`/`amendmentReason`
required) — never an in-place edit. The result DTO surfaces the current
version per test item. Publication is gated by two workflow transitions
(`verify` then `release`) on the workflow engine; `settings.laboratory.
requireDifferentVerifier` (default false) forces a distinct verifier actor
when enabled. A result computed as `isCritical` blocks release until
`acknowledgeCriticalResult` records an acknowledgement in
`LabResultCriticality` (409 `LAB_RESULT_NOT_ACKNOWLEDGED` otherwise);
acknowledgement is idempotent. Normal vs critical is derived from the
org-configured reference/critical ranges on `LabTestField`, and non-numeric
fields never auto-flag.

**Consequences:** every result state is attributable and replay-safe (nothing
is deleted or overwritten); release is the last transition, so post-release
amendment requires `reopen` → re-enter → re-verify → re-release, which
keyboards the whole audit chain rather than silently mutating history.
Critical values get an explicit, idempotent ack trail.

## ADR-029 — Money is `Decimal(12, 2)`, surfaced as string; not integer cents

**Status:** accepted (Phase 6 inventory & pharmacy; Phase 7 billing)

**Context:** purchase-order line items carry monetary amounts (unit cost). Two
representations were possible: integer minor units (cents) or a fixed-precision
decimal.

**Decision:** all money columns are `Decimal? @db.Decimal(12, 2)` in the
schema (e.g. `purchase_order_items.unitCost`). Prisma maps these to
`Prisma.Decimal`, which serializes to a JSON string (e.g. `"12.50"`), so the
client never touches floating-point cents. Two-fractional-digit arithmetic is
exact at the DB layer. Billing serializers normalize with `money() →
toFixed(2)` so zero balances surface as `"0.00"` (never `"0"`) — one stable
wire format for every money field.

**Consequences:** response DTO schemas are documentation-only — the transform
interceptor wraps responses but does NOT validate them, so a `z.number()` on an
`unitCost` DTO is never applied to the serialized string (avoid writing numeric
coercions that would contradict `Prisma.Decimal` on the wire). Invoices/sums
must not rely on JS float arithmetic; keep totals as `Prisma.Decimal`
accumulation. No integer-cents ADR or conversion is needed for later phases.

## ADR-028 — Patient timeline projected from outbox consumers (real consumer)

**Status:** accepted (Phase 4 clinical, extended through Phase 7 billing)

**Context:** Phase 2 wrote `PatientTimelineEntry` rows inline from the patients
module. Phase 4 modules emit domain events (encounters, notes, diagnoses,
follow-ups, referrals, tasks), and the timeline should be built FROM events so
it stays correct as clinical modules evolve.

**Decision:** a real `OutboxConsumer` ("timeline-projection",
`src/events/consumers/timeline.consumer.ts`) subscribes to 26 event types
(12 clinical + 8 billing + 6 laboratory/radiology) and
maps each to a `PatientTimelineEntry` row pinned to its source event via the
unique `(organizationId, sourceEventId)`, so a replay upserts instead of
duplicating. Delivery is deduped per (org, consumer, eventId) through
`ProcessedEvent` rows. Consumers are registered under the `OUTBOX_CONSUMERS`
multi-token (`src/events/outbox-consumer`) and run on the raw unscoped client,
setting `organizationId` explicitly (never through the request scope). Event
payloads carry ids only (encounterId, patientId, etc.), never PHI.

**Consequences:** the timeline is event-truthful and replay-safe by
construction (idempotent). Inline `patient.*` entries (registration, merge,
guardians, consents, allergies, medical history) are written by the patients
module in the owning transaction and carry no `sourceEventId` — the timeline is
therefore a deliberate mix of inline patient rows and event-projected clinical
rows (the e2e asserts both exist and that event rows always carry a
`sourceEventId`).

## ADR-027 — Outbox publisher dispatches outside the claim transaction

**Status:** accepted (Phase 4 clinical fix)

**Context:** the first e2e acceptance run published a batch and Prisma aborted
with "Transaction already closed: … 5000 ms … expired transaction" — the
publisher held ONE interactive transaction across the whole claim+dispatch+mark
loop, so any batch over a few events blew the 5 s interactive-transaction
budget while waiting on consumer side-effects.

**Decision:** `publishReadyEvents` claims rows with `FOR UPDATE SKIP LOCKED`
inside a short transaction, then dispatches each row OUTSIDE any transaction,
and marks each row's status (PUBLISHED / DEAD / attempt+backoff) inside its own
short transaction. Safety relies on consumer idempotency (ADR-028): an
overlapping claim is replayed safely, never double-applied.

**Consequences:** no DB transaction is held open across remote side-effects;
large batches progress bounded by work, not by a transaction budget. The
hand-rolled per-row bookkeeping is slightly more verbose than the previous
single-transaction form but is what makes batch publishing correct.

## ADR-026 — Workflow engine: mandatory core edges + additive org custom edges

**Status:** accepted (Phase 4 clinical)

**Context:** clinical entities are state machines (encounters, notes,
diagnoses, follow-ups, referrals, tasks), and orgs need local adaptations (e.g.
a shortcut `OPEN → COMPLETED`) without being able to weaken safety guarantees
(reopening a completed encounter).

**Decision:** the mandatory edge set lives in code
(`SYSTEM_TRANSITIONS`, `src/modules/workflows/domain/workflow-core.ts`); org
custom edges are stored rows (`workflow_transitions`, `workflows.manage` gates
`POST /workflows/:entityType/transitions`) and are strictly ADDITIVE — the
effective set is the union and never shrinks (`effectiveEdges`/`addableEdges`).
Every transition service funnels through `WorkflowsService.assertAllowed`, and
module-level guards enforce invariants the engine must not override:
`assertEncounterTransition` hard-locks COMPLETED, `assertNoteStatus`,
`assertReferralAction`, `assertTaskAction`, and follow-up/diagnosis guards
reject `from === to` so the engine's no-op for identical statuses can never
mask a no-op client call.

**Consequences:** org customization is bounded; a misconfigured workflow can
widen a flow but never unlock a terminal state or anonymize a transition. The
system↔custom split keeps the mandatory core auditable in code.

## ADR-025 — Clinical notes are immutable after finalize; amendments supersede

**Status:** accepted (Phase 4 clinical)

**Context:** notes carry clinical-legal weight; a FINAL note edited in place is
indistinguishable from the original and breaks audit.

**Decision:** `finalize` writes version ORIGINAL (`versionNumber` 1); `amend`
(reason required, `clinical_notes.update`) appends a superseding AMENDMENT
version. `ClinicalNoteVersion` is unique on `(organizationId, noteId,
versionNumber)`, nothing is deleted, and direct edits of a FINAL note are
rejected (`assertNoteStatus`). DRAFT notes stay editable in place.

**Consequences:** version history is recoverable and attributable; the newest
superseding version is the effective clinical record. Sections are validated
against the fixed 8-key set (`NOTE_SECTION_KEYS`) on both create and update.

## ADR-024 — Tenant extension rewrites upsert args correctly (found-and-fixed)

**Status:** accepted (Phase 4 clinical fix)

**Context:** Phase 1's tenancy extension (`injectTenant`,
`src/database/prisma.service.ts`) handled `upsert` by injecting `organizationId`
into a `data` key. Prisma's `upsert` takes `create`/`update`, NOT `data`, so the
first tenant-model upsert (idempotent `CodeConcept` import) failed at runtime
with `Unknown argument "data". Did you mean "update"?` — e2e surfaced it as an
INTERNAL_ERROR 500.

**Decision:** the `upsert` branch now injects `organizationId` into both
`create` and `update` payloads (the update rewrite keeps RLS/extension scoping
on the existing row). No app code relied on the old (broken) shape.

**Consequences:** upserts now exercise the same tenant guarantees as every other
write; the coding-system concept importer works. An explicit regression path:
`test/e2e/phase4-clinical.e2e-spec.ts` imports two concepts and asserts
inserted counts.

## ADR-023 — Device tokens are ingest-scoped bearer credentials, not JWTs

**Status:** accepted (Phase 3 scheduling)

**Context:** waiting-room display devices are unattended and shared; a device
must be able to read its own queue stream/board and nothing else. JWT issuance
for every device would require a key-exchange and rotation ceremony on
hardware we do not control.

**Decision:** pairing (`POST /display/devices/pair`) exchanges a single-use
`pairingCode` (returned once at `POST /display/devices` registration, hashed at
rest) for an opaque bearer token `<organizationId>.<32B base64url>`. Only the
SHA-256 digest is stored; `DeviceAuthGuard` resolves the session and stamps a
narrow scope (`queue.display`) plus the org id, and the `deviceId` param must
match the token's session. No JWT, no audience/issuer dance.

**Consequences:** a device token grants exactly one permission — reading the
waiting-room queue for its org/device — so a leaked token is low-value and
short-lived; rotation and revocation are explicit endpoints maintained by
`DisplayService`. Pairing is intentionally org-agnostic (the device has no org
yet), with attempts throttled per client IP.

## ADR-022 — Realtime via Redis pub/sub; SSE as fire-and-forget views

**Status:** accepted (Phase 3 scheduling)

**Context:** staff and waiting-room displays need near-real-time queue
updates. Polling every display burns queries; durable per-client event
replay and delivery guarantees are not in scope for this phase.

**Decision:** domain transitions publish a small PHI-free envelope
(`{version:1,event,aggregateId,payload:{ticketNumber,departmentId,status}}`)
to a Redis keyed channel via `REDIS_CLIENT` (tokenized in
`src/database/redis.tokens.ts` to break the realtime↔redis import cycle).
Staff (`GET /realtime/queue`) and device (`GET /display/devices/:id/stream`)
SSE endpoints subscribe per connection, buffer frames, send `: ping`
heartbeats and an `event: connected` frame. Publish is best-effort
fire-and-forget; the database remains the source of truth and the device
`board` is a snapshot for resilience.

**Consequences:** zero long-running persistence, trivial tenant isolation
(channel keyed by org+department+device; device streams are additionally
filtered to the session's scope by `forScopes`). The trade-off is no replay:
an event is lost if the subscriber is not connected in that instant — accepted
and documented in `docs/limitations.md`.

## ADR-021 — Slot serialization with an advisory lock; capacity, not rows

**Status:** accepted (Phase 3 scheduling)

**Context:** `POST /appointments` must be safe under concurrency: two requests
for the last slot must yield exactly one 201 and one 409. Counting rows in
separate transactions is a race; no unique index can express "count >=
capacity" at the DB layer.

**Decision:** a booking takes a Postgres advisory lock keyed on the
(org, provider, branch, department, startsAt) tuple inside a transaction, then
checks capacity as a computed count of occupying rows
(BOOKED/CONFIRMED/CHECKED_IN/IN_PROGRESS; RESCHEDULED and CANCELLED no longer
occupy) and their summed attendee count. `serializeDay` reads the same window
inside a transaction so its slot endpoints line up with in-flight bookings.
Appointments carry a monotonically increasing `version` for optimistic
concurrency on reschedule.

**Consequences:** double-booking is a serialized read-then-write with a
deterministic winner and loser (a shelf full of `UP_` advisory-lock keys, but
cheap and leak-free inside the tx). Capacity semantics are explicit, so
rescheduling/cancelling frees capacity immediately. e2e asserts the exact
one-201-one-409 outcome.

## ADR-020 — Waitlist offers are explicit state, not auto-booking

**Status:** accepted (Phase 3 scheduling)

**Context:** when a slot frees (cancellation/no-show), the highest-priority
waiter should be given it, but auto-booking a human move is presumptuous and
offers expire.

**Decision:** a slot freed in the in-window future marks the top
`WaitlistEntry` as `OFFERED` with `offerExpiresAt` (15 min), the concrete
`offeredStartAt`, and the slot's provider id persisted on the row so accepting
reads the slot, not the department's doctor roster. `acceptWaitlistOffer`
transitions it to `BOOKED` and creates the appointment; a stale OFFERED entry
is skipped in favor of the next candidate. No recordings of manual end-point
mutation exist. The provider is validated through `createBooking` (404 if
unresolvable) rather than a non-null assertion.

**Consequences:** offering is a visible state a coordinator can act on, and
the accepted appointment carries the exact booked timestamp. Persisting
`providerId` on the offer removed a real bug where the accepting path
resolved a null provider (500) when the department had no doctor assigned.

## ADR-019 — Patient duplicates scored, not blocked; merges are reversible

**Status:** accepted (Phase 2)

**Context:** registering a patient twice is a clinical-safety hazard, but a
hard block or auto-delete is wrong — matches can be false positives and a typed
copy may be intentionally "already in the system."

**Decision:** registration computes a pure similarity score
(`src/modules/patients/domain/duplicate-score.ts`: phone +40, email +40, bigram
name ≤ +40, exact DOB +20, sex +10; threshold 70). Above threshold the API
returns 409 `POSSIBLE_DUPLICATE` with candidate ids; the caller either resolves
by confirming the duplicate (`confirmDuplicate: true` + reason, recorded on the
row) or adjusts. Merging (`POST /patients/:id/merge`) never deletes the source
patient — it is marked `MERGED` with a `mergedIntoPatientId` pointer so a merge
is reversible, and its guardians/consents/allergies/medical-history are
transferred (with skip-and-delete on collisions) inside one transaction with
outbox events + timelines on both records.

**Consequences:** duplicates are surfaced to a human, never silently merged or
dropped; candidates carry ids only (minimal PHI); merges are auditable and
reversible rather than destructive.

## ADR-018 — S3-compatible storage via presigned URLs; s3rver in e2e

**Status:** accepted (Phase 3)

**Context:** documents must be uploaded/downloaded without proxying file bytes
through the API, and must be testable in a gauntlet including real SigV4
signing without a cloud dependency.

**Decision:** clients upload via presigned PUT and download via presigned GET
(`@aws-sdk/s3-request-presigner`, `src/common/storage/object-storage.service.ts`);
the API stores only metadata (`Document` rows, `storageKey = orgId/documentId`)
and never the bytes. `presignPut` signs the content-type so the client's upload
cannot be replayed against a wrong media type. In e2e, `S3rver` runs in-process
inside the jest globalSetup (ephemeral port, bucket `careos`, credentials
`S3RVER`/`S3RVER`) and its address is written to the generated env file, so
tests exercise real presigned traffic against a real S3-compatible server.

**Consequences:** the API stays small (no byte proxying) and storage is
swappable (MinIO, AWS S3, GCS via S3 endpoint). File presence/size are
verified via HEAD in `complete`. Storage misconfiguration surfaces as
`S3_UNAVAILABLE` (503) rather than crashing; the service is `@Optional` so
suites that never touch S3 do not require one.

## ADR-017 — Real JWT auth replaces the test-principal seam as default

**Status:** accepted (Phase 1)

**Context:** Phase 0 authorized through a test-only principal; Phase 1 must
authenticate real users.

**Decision:** `JwtAuthGuard` short-circuits when `IS_PUBLIC_KEY` metadata is set
(`@Public()`) or a principal already exists in the CLS scope (test seam /
platform scope), otherwise it verifies the bearer access token (issuer,
audience, secret, `purpose: 'access'`) and stamps
organizationId/userId/sessionId/roles into the scope. Missing/invalid
credentials yield 401 `UNAUTHORIZED` (`Invalid or missing credentials.` /
`Invalid or expired session.`) before any permission check.

**Consequences:** the app-boot "deny by default" acceptance was updated —
unauthenticated protected routes now return 401 (real auth) instead of 403
(the Phase 0 empty-scope behavior). Permissions are re-resolved per request by
`TenantGuard`, never trusted from the token (see ADR-016).

## ADR-016 — Token roles are hints; permissions re-resolved per request

**Status:** accepted (Phase 1)

**Context:** access tokens are JWT-encoded once at login/refresh; role grants
can change while a token is still valid.

**Decision:** the access token carries only shape/permissions hints (`roles`),
used to establish the session scope. `TenantGuard` loads the caller's current
roles/permissions from the DB for every request, so revoking/updating a role
takes effect immediately even with an unexpired access token.

**Consequences:** privilege checks always reflect the latest grants; DB role
lookup adds a query per authenticated request (acceptable, cached by the
tenant client).

## ADR-015 — Refresh rotation with family revocation on reuse

**Status:** accepted (Phase 1)

**Context:** long-lived refresh tokens are the highest-value replay target; a
stolen token reused after rotation must revoke the whole session.

**Decision:** every refresh issues a new access+refresh pair and records the
refresh token hash against the parent rotation family. If the presented
refresh token does not match the last rotated one (reuse), the entire family is
revoked (all sessions' refresh hashes + the access session), forcing
reauthentication. `src/common/auth/refresh-rotation.ts` is unit-tested for
the rotate/rotate-after-reuse/foreign-family paths.

**Consequences:** a rotated token is usable exactly once; replay is detected
and quarantines the family. Logout revokes the presenting family.

## ADR-014 — TOTP MFA with append-only recovery codes

**Status:** accepted (Phase 1)

**Context:** healthcare data warrants a second factor; lockouts must still be
recoverable offline.

**Decision:** TOTP (RFC 6238, 30s window with ±1 drift tolerance) is enrolled
via `mfa/setup` → `mfa/confirm` (returns the 10 recovery codes exactly once).
Recovery codes are stored as sha-256 digests, single-use (atomic claim) — the
status endpoint reports the remaining count (hashed, non-reversible).

**Consequences:** a lost authenticator is recoverable via the printed codes;
each code can redeem a challenge once. The secret is encrypted at rest
(`encryption.encrypt`).

## ADR-013 — `@ApiEndpoint` owns the HTTP contract (status + auth metadata)

**Status:** accepted (Phase 1)

**Context:** routes declared `statusCode` for Swagger only; Fastify's POST
default (201) leaked into real responses, and `public` never set the
`IS_PUBLIC_KEY` metadata, so login was guarded.

**Decision:** `@ApiEndpoint` now applies `@HttpCode(options.statusCode ??
200)` so the real response status matches the documented one, and applies
`@Public()` when `options.public === true` so `JwtAuthGuard` skips
authentication and (with `authenticatedOnly` false) the deny-by-default
permission check is skipped for genuinely public routes.

**Consequences:** response codes are now declarative and honored at runtime
(e.g. logout 204, invite 201, login 200); protected-by-default still holds for
everything else (ADR-016 / deny-by-default). e2e asserts the real codes.

## ADR-012 — org-scoped login; global email uniqueness dropped

**Status:** accepted (Phase 1)

**Context:** an email identify a person, but the same email can exist across
independent organizations; forcing global uniqueness breaks multi-tenancy.

**Decision:** `User` is unique on `(organizationId, email)`; login takes the
organizationId (or resolves it from a scoped hint) so credentials never cross
tenant boundaries.

**Consequences:** two orgs may each have `admin@...`; the login request must
carry the org (or a default), and cross-org credential guessing is confined to
one org per login attempt.

## ADR-011 — Monotonic UUIDv7 prefix (rand_a counter)

**Status:** accepted (Phase 0 fix)

**Context:** PKs are UUIDv7 minted in application code. With a random
62-bit suffix, two ids produced within the same millisecond share the 48-bit
timestamp prefix and the random bits decide their order, so
lexicographic ordering (and thus index locality / insertion order) was not
guaranteed — a `localeCompare` unit test failed intermittently.

**Decision:** keep a per-process 12-bit `rand_a` counter
(`src/common/lib/uuidv7.ts`). If `Date.now()` equals the previous mint, the
counter increments; on counter wrap the next millisecond is used. The counter
is written into bytes 6–7, keeping ids lexicographically ordered within the
process.

**Consequences:** ids are monotonic per process; the random portion no longer
decides same-millisecond order. Cross-process/clock-skew ordering is still
best-effort (same as any wallclock UUIDv7).

## ADR-010 — Jest configs as CommonJS, SWC-inlined helpers

**Status:** accepted (Phase 0 fix)

**Context:** jest was failing to parse the TypeScript config without ts-node,
and `@swc/helpers` could not be installed because the npm registry was
unreachable during setup.

**Decision:** write all jest configs as `.js` CommonJS (`jest.config.js`,
`jest.config.unit.js`, `jest.config.e2e.js`) and set `.swcrc`
`externalHelpers: false` so SWC inlines helpers. The base config pins
`testMatch` to `test/unit` so `npm test` never picks up infra-dependent e2e
specs.

**Consequences:** no ts-node dependency; `npm test` is deterministic (unit
only). SWC output is slightly larger (inlined helpers).

## ADR-009 — Idempotency key = (organizationId, scopeKey, idempotencyKey)

**Status:** accepted

**Context:** replay-safe writes require a unique key per logical request, and
the key must be scoped per tenant and per resource class.

**Decision:** `IdempotencyRecord` is unique on
`(organizationId, scopeKey, idempotencyKey)`; a live duplicate (not yet saved)
returns 409, a replay of a finished request returns the stored response.

**Consequences:** B-tree index locality is per-org; Prisma generates the
compound unique name `organizationId_scopeKey_idempotencyKey`, which
`findUnique` must use explicitly. The replay payload persisted the route's real
`reply.statusCode` from P4 (previously a pinned `200`), so a replay reproduces
the original status and body (ADR-043).

## ADR-008 — Append-only audit log enforced in the database

**Status:** accepted

**Context:** audit rows must be immutable even if application code regresses.

**Decision:** `audit_logs` is written by the application in the same
interactive transaction as domain writes, and a DB trigger
(`BEFORE UPDATE/DELETE`) rejects mutations, keyed to the row's organization.

**Consequences:** audit rows cannot be torn down in test cleanup; e2e asserts
by delta and relies on container disposal.

## ADR-007 — Outbox: same-transaction write + dispatcher seam

**Status:** accepted

**Context:** async side effects must be reliable and never fire unless the
domain write commits.

**Decision:** `outbox_events` rows are inserted inside the same interactive
transaction as the domain write, via `OutboxPublisher`. Delivery is decoupled:
a dispatcher pointer service (`src/database/outbox-publisher.service.ts`)
advances per outbox row; the per-event dispatcher is a named stub
(`src/jobs/outbox/noop-outbox-dispatcher.ts`) replaced in a later phase.

**Consequences:** at-least-once base is in place; real consumers (workers,
S3) are still to be built.

## ADR-006 — Interactive transactions have no `$extends`; use `tenantFor`

**Status:** accepted

**Context:** a probe confirmed the interactive-transaction callback receives
an un-extended Prisma instance (`$extends` is absent), while extension query
hooks DO run for statements issued inside the transaction when the
transaction is started on the extended client.

**Decision:** tenant enforcement relies on extension hooks applied to every
statement, and interactive transactions are started via
`PrismaService.tenantFor(organizationId).$transaction(fn)` so the hooks cover
transaction contents. The intermediate `extendTransactionClient` wrapper was
removed.

**Consequences:** `tx.ts` sets `app.current_org` via `SELECT set_config(...)`
inside the transaction (Postgres rejects `$1` params in `SET`), so RLS
participation is per-transaction. See `docs/limitations.md` for the pool caveat.

## ADR-005 — Primary enforcement = Prisma extension; RLS = defense-in-depth

**Status:** accepted

**Context:** per-tenant filtering at the query layer is the workhorse; row-level
security is an independent guarantee that a mistake in application code cannot
bypass.

**Decision:** the Prisma client extension (`createTenantClient` /
`buildTenantExtension`, `src/database/prisma.service.ts`) injects
`organizationId` into every tenant-model query; the `Organization` model itself
denies `create`/`upsert` through the tenant client and pins `where.id` to the
current org. RLS policies on PostgreSQL additionally restrict reads/writes to
`app.current_org` set inside interactive transactions. `unscoped()` exists for
platform/worker code that must bypass the tenant context.

**Consequences:** two independent mechanisms must both fail for a cross-org
leak to reach the client. The pool caveat (multiple logical connections per
transaction) means RLS is a backstop, not the primary control.

## ADR-004 — Shared schema, row tenancy

**Status:** accepted

**Context:** the brief expects a single Postgres with per-tenant data; schema
per tenant is operationally heavy at this stage.

**Decision:** all tenant data lives in `public` schema tables with an
`organization_id` key; the tenant client always scopes by it.

**Consequences:** tenant fan-out is cheap and queries stay indexable; correct
scoping is therefore critical, which motivates ADR-005.

## ADR-003 — App-generated primary keys (UUIDv7)

**Status:** accepted

**Context:** ids are created in application code so clients/workers can rely on
them without a database round-trip and without exposing autoincrement
cardinality.

**Decision:** `newId()` returns UUIDv7 ordered by time (see ADR-011 for the
monotonicity fix).

**Consequences:** no DB default; Prisma never assigns ids; reproducible test
ids.

## ADR-002 — Application code is the single writer; DB level is conservative

**Status:** accepted

**Context:** phase 0 must not over-engineer the database, but must not leave a
single point of trust either.

**Decision:** RLS and the audit trigger are the only conditional database
logic; all business rules live in application code exercised by tests.

**Consequences:** simpler migration surface; correctness asserted by e2e
suites that talk to real Postgres.

## ADR-001 — Tenancy, permissions, and RBAC via CLS + guard

**Status:** accepted

**Context:** identity and tenancy per-request must reach interceptors/service
code without threading parameters everywhere.

**Decision:** `nestjs-cls` (ClsModule) carries the per-request scope
(`ClsStore`, `tenant-context.ts`). An interceptor seeds the request id;
`TestPrincipalMiddleware` (test-only, active only when the e2e app enables it)
claims org/user/permissions from headers so the same guard and extension used
in production authorize requests. With no principal scope the tenant extension
denies — deny by default.

**Consequences:** services stay tenant-agnostic and the tenant context is never
derived from request bodies. The test-principal seam stands in for real auth
until Phase 1.