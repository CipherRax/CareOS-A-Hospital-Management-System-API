# careOS — Roadmap / Backlog

Deferred production items and known stubs, mirrored from the session todo list
and `docs/limitations.md`. Anything marked `[stub]` there is named in code and
explicitly not implemented yet. Ordered by priority — this is what remains
after the brief's phases 0–13 shipped.

## Backend patch — in flight (Public directory, emergency requests, session bootstrap, display devices, scheduler, notification delivery, coding-import consumer)

Tracked in `PROGRESS.md` (see "Patch" section) and the ADR set 038–046.

- [x] **P1 — Session & devices.** Expand `GET /auth/me` (org + feature flags,
  branches, session, break-glass, security staging, patient link, prefs),
  `PATCH /auth/me/preferences`, `X-Branch-Id` validation in `TenantScope`,
  re-pair/rescan surface for `DisplayDevice`, `/auth/me`↔guard parity test,
  device-token-scope test, aliased `/display/queue` if needed.
- [x] **P2 — Public directory.** PostGIS + fallback (ADR-039),
  `PublicFacilityListing`/`ImportedFacility`/`OnboardingInquiry` projections +
  `PublicListingChanged` consumer + cache (read-only `careos_public` role
  deferred to operator provisioning, ADR-038), listing settings/publish/
  suspend/confirm, nearby/search/profile/config/suggest, CSV
  `FacilityDirectoryProvider` + importer, `GeocodingProvider` seam, throttles,
  onboarding inquiries.
- [x] **P3 — Emergency intake.** Reference numbers (verify-before-production),
  intake policy + contacts (≥1 contact + escalation chain required), request +
  append-only events, public submit (idempotent) + tracking/cancel/update,
  staff inbox + SSE + actions, neutral notifications, BullMQ escalation
  (ADR-040), field encryption (ADR-041), ED-arrival link.
- [x] **P4 — Hardening & release.** Abuse controls (throttle ttl-unit fix,
  anonymous idempotency pass-through, submit dedupe), retention hooks +
  escalation reconciliation sweep (ADR-043), DEMO seed, full tests,
  docs/diagrams, README, CI workflow.
- [x] **P5 — Time-based scheduler.** One BullMQ repeatable job per duty on a
  `scheduler` queue (ADR-044): `outbox-drain` (replaces the `setInterval` in
  `worker.ts`), `maintenance-reminders` (per-org, rotating cursor), and
  `idempotency-sweep` / `report-expiry` (bounded, idempotent, guarded writes).
  Env-driven intervals, `SCHEDULER_ENABLED` kill-switch, duties kept free of
  BullMQ so they can be driven without Redis. What is *not* done: leader
  election/distributed locking, per-tenant quotas, and cron-pattern schedules
  (all documented in `docs/limitations.md`).
- [x] **P6 — Notification delivery.** `EMAIL`/`SMS`/`PUSH` become real sends
  behind an env-selected, HMAC-signed webhook adapter (ADR-045), with opt-out
  enforced at send time into a terminal `SUPPRESSED` status, real addresses
  resolved off the recipient record, a retry ladder (`nextAttemptAt` +
  backoff) driven by a new `notification-delivery` duty on the P5 scheduler,
  and `providerRef` recorded from the receiver. Fan-out off-system is opt-in per
  deployment   (`NOTIFICATION_OFFSITE_CHANNELS`, default empty). What is *not*
  done: SMTP/SMPP clients and a real mail/SMS/push provider (the adapter is a
  transport a relay sits behind), push device tokens, and exactly-once delivery.
- [x] **P7 — Coding-import consumer.** `Reference.CodingSystemImported` was
  published and dropped by the dispatcher (it acks an event with no subscriber).
  `coding-reference` now fans a PHI-neutral "reference set changed" notice out to
  the distinct active users whose roles hold `coding.manage`, with the
  inserted/total counts and a deterministic per-(event, recipient) id so replays
  cannot double-notify (ADR-046). It reconciles nothing on purpose: the import
  path only ever sets `isActive: true` and never deletes, and `Diagnosis`
  snapshots `code`/`description` at authoring time, so an import cannot orphan a
  `codeConceptId`. What is *not* done: a concept **deactivation** endpoint —
  once one exists, coded diagnoses can reference an inactive concept and a real
  reconciliation pass is required. `Storage.DocumentUploaded` stays unconsumed
  until the document content-security work lands (P8, ADR-047).

## High priority

- [ ] **Report export retry and backoff.** A generation failure is recorded as
  `FAILED` rather than re-raised, so a transient storage outage needs a
  deliberate new export request (ADR-049). A requeue with backoff, bounded
  attempts, and a "retry this export" affordance would let the outbox absorb
  short outages without an operator.
- [ ] **Cursor-based report builders.** Generation streams the artifact, but the
  report *rows* are still materialised in memory. The P10 caps are what keep
  that bounded today; an uncapped report needs builders that yield rows rather
  than return arrays.
- [ ] **Live M-PESA Daraja adapter.** Wire the real Safaricom adapter
  (`src/integrations/mpesa`): Daraja BEARER auth, STK push/query, callback
  `CallbackMetadata` parsing, STK status-query. Needs live consumer
  key/secret + `MPESA_*` env vars; then remove `MOCK`. Reconciliation then
  classifies against real provider statements.

## Medium priority

- [x] **PDF production rendering.** `src/jobs/pdf` renders paginated documents
  with embedded Unicode fonts, real tables, bar/line charts, and PNG/JPEG
  images, used by both `/document-jobs/pdf` and report exports. Font coverage
  is verified against the embedded font's own cmap, so a character the font
  cannot draw fails loudly instead of being dropped. Charts disclose any points
  they omit. Image input is not exposed over HTTP: it is available to
  server-built documents, and the request-facing endpoints stay bounded
  (≤12 columns, ≤300 rows, ≤200 lines).
- [x] **Async + streamed report exports.** `POST /reports/export` returns `202`
  with a `PENDING` row and a `Reports.ExportRequested` consumer generates it
  off the request path (payload is `{ exportId }` only). The artifact is stored
  in S3 under a tenant-scoped key and downloaded as a stream through the
  authorized API — not a presigned GET, which would be an unaudited bearer
  capability over patient data. Generation streams into a multipart upload
  rather than building the artifact in memory (P11, ADR-049).
- [x] **Consumers for `Storage.DocumentUploaded`.** `document-scan` subscribes to
  the event, reads the object under a byte cap, and records a verdict (P8,
  ADR-047). It runs off the request path in the outbox dispatcher, so a slow or
  unavailable engine cannot fail an upload. `Reference.CodingSystemImported` is
  done (P7, ADR-046).
- [x] **Content security on documents.** A document is not downloadable until
  its bytes carry a verdict: `CLEAN`/`FLAGGED` serve, `PENDING`/`ERROR`/
  `INFECTED`/`REJECTED` refuse (409 while unknown, 422 when refused). The
  scanner seam has an in-process heuristic by default — executable magic
  numbers, declared-type magic bytes, EICAR, and high-sensitivity pattern
  flagging — plus optional ClamAV over `INSTREAM`, chained heuristic-first so an
  AV outage cannot downgrade a known rejection. `scanDetail` records a rule name
  only, never matched bytes. What is *not* done: real malware detection without
  a ClamAV host configured, whole-file coverage above the byte cap
  (`scanTruncated` records this rather than hiding it), and auto-retry of an
  `ERROR` verdict — an operator re-scans via `POST /documents/:id/rescan`.
- [x] **Emergency intake-request metrics.** `snapshots.emergencyRequests`
  reports the anonymous public flow: acknowledgement and escalation counts and
  rates, and dispatch latency split into receive→dispatch and
  acknowledge→dispatch, each as p50/p90/max rather than a mean. Alongside the
  windowed block, point-in-time counters report what is outstanding *now*
  (open, unacknowledged, awaiting dispatch, unacknowledged past the branch's
  configured first escalation level). What is *not* done: no rollup, so the read
  is query-time over `EmergencyRequest`; percentiles are coarse on small windows
  (nearest-rank, so p90 misses a lone outlier and `max` is published for that);
  and there is no alerting or paging on a late acknowledgement — the metric is
  pull-only, and wiring it to the notification system is a separate decision.
- [x] **Provider directory + onboarding.** `GET /providers` is a provider-only
  view (clinician role or a published template) filterable by branch,
  department, specialization and free text, with a bookable flag and a
  PHI-safe reason; `GET /providers/:id` adds weekly availability and upcoming
  appointments; `POST /providers` onboards identity, staff profile, roles,
  assignments and an optional availability template in one transaction, and
  `PATCH /providers/:id` maintains the clinical profile and booking
  eligibility. There is deliberately no `Provider` model — a provider is a
  `users` row (ADR-050) — so onboarding starts the account `INVITED` and
  activation is what makes it bookable.

  The point of the patch is the gate, not the CRUD. All four booking paths
  (appointments, encounters, telemedicine start, schedule templates and slot
  discovery) previously checked only that a `providerId` existed in the
  organization, so a suspended, terminated or opted-out clinician stayed
  bookable and kept publishing availability. They now share one predicate:
  `ACTIVE`, and — where a staff profile exists — not terminated and not
  opted out. A missing profile is still allowed, because plenty of legitimate
  providers here carry only a user row. Roles stay a *filter*, never a gate:
  this codebase books nurses, pharmacists and clinical officers, and a role
  gate would refuse legitimate work while missing the real hazard.

  Refusals are `409 PROVIDER_NOT_BOOKABLE` with the reason, and non-bookable
  providers stay visible in the directory — an empty slot list reads as "try
  another date", which is how a terminated clinician keeps getting booked.
  Existing appointments are deliberately left intact. Onboarding emails no
  invite token: it follows the user invite flow, so activation and token
  delivery remain one mechanism rather than two. Open: the invite token is
  minted and hashed but delivery is not yet surfaced here, and the directory
  is read-only to non-managers.

- [ ] **Patient-portal real JWT auth.** Self-scoped patients currently ride the
  test-principal header seam (`x-careos-test-patient-id`); replace with real
  patient-facing JWT/session auth.

## Low priority

- [ ] **Break-glass approver surface.** Request/expire flow exists; build a
  pull-based approver/audit surface beyond the request queue.
- [ ] **DB-trigger append-only integrity for `patient_access_logs`** (currently
  app-written, fail-open).
- [ ] **Expose the purchase-order cancel endpoint** (`PLACED → CANCELLED`);
  the workflow edge and service action exist but no route invokes them.
- [ ] **OTel/metrics telemetry serving** (`METRICS_ENABLED` / `OTEL_*` wiring).
- [ ] **Emergency access flow** — `TenantScope.emergency` marker is defined but
  nothing sets it.
- [ ] **Inventory hardening.** `reorderLevel`/`reorderPoint` schema columns +
  supplier/medication reorder defaults; a counted-freeze for stock counts.
- [ ] **Remove demo module + `CareOS.Probe`** before production (useful as a
  smoke tester in the meantime).

## Not engineering backlog (process)

- [ ] Refresh `PROGRESS.md` gate counts + roadmap checkboxes as items land.

See `docs/limitations.md` for the full caveat catalog and `PROGRESS.md` for the
phase-by-phase delivery record.