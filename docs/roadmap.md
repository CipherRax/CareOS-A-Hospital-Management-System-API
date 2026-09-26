# careOS — Roadmap / Backlog

Deferred production items and known stubs, mirrored from the session todo list
and `docs/limitations.md`. Anything marked `[stub]` there is named in code and
explicitly not implemented yet. Ordered by priority — this is what remains
after the brief's phases 0–13 shipped.

## Backend patch — in flight (Public directory, emergency requests, session bootstrap, display devices)

Tracked in `PROGRESS.md` (see "Patch" section) and the ADR set 038–042.

- [ ] **P1 — Session & devices.** Expand `GET /auth/me` (org + feature flags,
  branches, session, break-glass, security staging, patient link, prefs),
  `PATCH /auth/me/preferences`, `X-Branch-Id` validation in `TenantScope`,
  re-pair/rescan surface for `DisplayDevice`, `/auth/me`↔guard parity test,
  device-token-scope test, aliased `/display/queue` if needed.
- [ ] **P2 — Public directory.** PostGIS + fallback (ADR-039),
  `PublicFacilityListing` projection + `PublicListingChanged` consumer + read-
  only `careos_public` role (ADR-038), listing settings/publish/suspend/
  confirm, nearby/search/profile/config/suggest, `FacilityDirectoryProvider` +
  importer (`partner: false`), `GeocodingProvider`, caching, throttles,
  onboarding inquiries.
- [ ] **P3 — Emergency intake.** Reference numbers (verify-before-production),
  intake policy + contacts (≥1 contact + escalation chain required), request +
  append-only events, public submit (idempotent) + tracking/cancel/update,
  staff inbox + SSE + actions, neutral notifications, BullMQ escalation
  (ADR-040), field encryption (ADR-041), ED-arrival link.
- [ ] **P4 — Hardening & release.** Abuse controls, retention hooks, DEMO seed,
  full tests, docs/diagrams, README, CI.

## High priority

- [ ] **Scheduler (outbox + reminders + sweeps).** Outbox delivery is
  push-triggered (the dispatcher advances on demand; e2e calls
  `publishReadyEvents` synchronously), maintenance reminders are demand-queued,
  and idempotency/export records are never swept. Land a time-based worker
  (BullMQ queues + cron) that: drains `outbox_events` on a timer, queues
  maintenance reminders, sweeps expired idempotency records, and flips
  `ReportExport` rows to `EXPIRED` at `expiresAt`.
- [ ] **Live M-PESA Daraja adapter.** Wire the real Safaricom adapter
  (`src/integrations/mpesa`): Daraja BEARER auth, STK push/query, callback
  `CallbackMetadata` parsing, STK status-query. Needs live consumer
  key/secret + `MPESA_*` env vars; then remove `MOCK`. Reconciliation then
  classifies against real provider statements.

## Medium priority

- [ ] **Notification delivery adapters.** Push/email/SMS providers
  (`src/integrations/notifications`) are structural no-ops; in-app rows are the
  only real channel today. Implement at least one off-system adapter +
  opt-out/preference enforcement on send.
- [ ] **PDF production rendering.** Replace the minimal `renderTextPdf` / no-op
  `PdfRenderer` with a renderer that supports charts, images, and Unicode for
  both `/document-jobs/pdf` and report exports.
- [ ] **Async + streamed report exports.** Move export out of the request path
  (kick task object + outbox event, poll/status) and stream large payloads
  instead of building the whole artifact in memory.
- [ ] **Consumers for `Storage.DocumentUploaded` and
  `Reference.CodingSystemImported`.** These events currently have no
  downstream processor.
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