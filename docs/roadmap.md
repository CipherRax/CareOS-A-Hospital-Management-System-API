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
  until the document content-security work lands.

## High priority

- [ ] **Live M-PESA Daraja adapter.** Wire the real Safaricom adapter
  (`src/integrations/mpesa`): Daraja BEARER auth, STK push/query, callback
  `CallbackMetadata` parsing, STK status-query. Needs live consumer
  key/secret + `MPESA_*` env vars; then remove `MOCK`. Reconciliation then
  classifies against real provider statements.

## Medium priority

- [ ] **PDF production rendering.** Replace the minimal `renderTextPdf` / no-op
  `PdfRenderer` with a renderer that supports charts, images, and Unicode for
  both `/document-jobs/pdf` and report exports.
- [ ] **Async + streamed report exports.** Move export out of the request path
  (kick task object + outbox event, poll/status) and stream large payloads
  instead of building the whole artifact in memory.
- [ ] **Consumers for `Storage.DocumentUploaded`.** No downstream processor yet;
  the roadmap pairs it with document content security (virus/PHI scan), which
  subscribes to the event. `Reference.CodingSystemImported` is done (P7,
  ADR-046) — see the P7 section above.
- [ ] **Content security on documents.** Virus/PHI scan at `complete` (or on the
  `Storage.DocumentUploaded` event).
- [ ] **Emergency intake-request metrics.** Acknowledgement, escalation, and
  dispatch-latency metrics arrive with the public emergency-intake flow; the
  analytics snapshot currently covers arrivals/triage only.
- [ ] **Provider directory + onboarding.** `Provider`/`ProviderSchedule` back
  tenant scheduling data but there is no provider-facing directory or onboarding
  surface yet.
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