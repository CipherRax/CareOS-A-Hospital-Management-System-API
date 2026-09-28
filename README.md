# careOS

**Auditable, multi-tenant healthcare operations API.**

careOS is a REST API for running a hospital: patients and records, scheduling
and patient flow, clinical encounters, inventory and pharmacy, billing and
insurance, laboratory and radiology, inpatient and emergency care,
communication, financials (double-entry ledger + M-PESA), operations, and
analytics & reporting — all behind one tenant isolation model and one
transactional outbox.

Built with NestJS on Fastify over PostgreSQL. Every phase ships with unit + e2e
coverage and a green quality gate.

---

## Capabilities

| Area | What it does |
| --- | --- |
| **Identity & access** | Real JWT/session auth, TOTP MFA + recovery codes, refresh rotation with family revocation, RBAC with subset-based grants, invites, break-glass emergency access |
| **Patients** | Org-scoped numbering, duplicate detection, guardians/consents/allergies/history, permission-filtered timelines, reversible merges |
| **Scheduling & flow** | Provider schedules, capacity-aware booking with optimistic concurrency, waitlist offers, walk-in queue, append-only vitals, waiting-room displays, live SSE board |
| **Clinical** | Workflow-driven encounters, versioned (append-only) clinical notes, coded diagnoses + problem list, follow-ups/referrals/tasks, event-projected patient timelines |
| **Inventory & pharmacy** | Medication catalog, purchase orders, FEFO batch stock under row locking, branch transfers, counts vs. append-only ledger, stock advisories, partial-dispense prescriptions |
| **Billing & insurance** | Price list, invoices with derived settlement (incl. taxes/discounts/refunds), payments with exactly-once guards, insurance payers/policies/claims |
| **Laboratory & radiology** | Lab-test catalog with configurable ranges, order/sample/results lifecycle with critical-value acknowledgement, radiology orders with imaging seams |
| **Inpatient & emergency** | Wards/rooms/beds with one-bed-one-patient enforcement, admissions/transfers/discharges, full emergency-department workflow, and a **public anonymous emergency intake** (submit/track/cancel, staff inbox, SLA escalation, reference numbers) |
| **Communication** | In-app notifications from outbox events, HIPAA-conscious messaging + telemedicine consent flows, quality (feedback/complaints/incidents), patient portal |
| **Financials** | Double-entry ledger with app-level period locks and a DB balance guard, auto-posting from domain events, M-PESA STK push with secret-gated callbacks + reconciliation |
| **Operations** | Expenses with segregation of duties, assets, maintenance, stock write-offs + wastage analytics |
| **Analytics & reporting** | Daily rollups (recompute-on-event), metrics, bottleneck/capacity analysis, labelled forecasts, patient-experience composite, staff analytics, role dashboards, JSON/CSV/PDF report exports, revenue-leakage reconciliation |

---

## Architecture highlights

- **Shared-schema multi-tenancy.** One database, row-level tenancy. A Prisma
  client extension injects `organizationId` into every query; PostgreSQL RLS is
  the defense-in-depth backstop (ADR-004/005/006).
- **Transactional outbox.** Every async side-effect is written in the same
  transaction as the domain write; real consumers project patient timelines,
  pharmacy tasks, notifications, ledger postings, and analytics rollups — all
  idempotent under replay (ADR-007/027/028/037).
- **Central workflow engine.** Mandatory core transitions per entity can only be
  widened by org-custom edges — operators unlock states, never unlock locked
  ones (ADR-026).
- **Appender-only audit.** `audit_logs` and the inventory ledger reject
  `UPDATE`/`DELETE` at the database layer (ADR-008).
- **Money as decimal, surfaced as strings.** `Decimal(12, 2)` end to end,
  rendered with `toFixed(2)` — no floating-point drift anywhere (ADR-029).
- **Idempotency by design.** Idempotency-key interceptors, unique keys on
  journeys, and `FOR UPDATE` locks make replays safe (ADR-009, ADR-032).
- **Public emergency intake (ADR-040/041/043).** Anonymous help requests ride a
  PUBLISHED-only directory projection; caller PII is AES-256-GCM at rest with a
  normalized (non-encrypting) duplicate-phone index, SLA escalation is exactly-once
  via guarded delayed BullMQ jobs, and a repeatable maintenance sweep re-promotes
  lost escalation jobs and applies PII retention after `EMERGENCY_RETENTION_DAYS`.
- **A real timer.** One BullMQ repeatable job per time-based duty — outbox
  delivery, maintenance reminders, idempotency reclamation, export expiry,
  notification delivery — with env-driven cadences and a kill-switch. Every duty
  is an idempotent, batched sweep that can also be driven without Redis
  (ADR-044).
- **Decision records** (ADR-001…046) and an honest **limitations** catalog live
  in `docs/`. A **CI workflow** (`.github/workflows/ci.yml`) runs the full gate
  (lint, typecheck, boundaries, unit, build) plus containerized e2e on every push
  to `main`.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 22+ (Dockerfile), Node 26 for local dev |
| Framework | NestJS 11 · Fastify 5 |
| ORM | Prisma |
| Database | PostgreSQL 16 (RLS, triggers, partial unique indexes) |
| Cache / pub-sub | Redis 7 |
| Object storage | S3-compatible (MinIO; presigned upload/download) |
| Validation | Zod |
| Auth | JWT + Argon2 + TOTP |
| Tests | Jest + SWC · Testcontainers (Postgres/Redis) |

## Repository layout

```
src/
  common/        shared layers: envelope, errors, auth, guards, pagination, storage, lib
  config/        Zod-validated environment
  database/      Prisma service, tenant extension, outbox publisher, audit
  modules/       47 domain modules (see capabilities)
  events/        outbox consumer framework + event catalog
  integrations/  provider seams (mpesa, notifications, imaging, pdf)
  jobs/          worker bootstrap
test/
  unit/          pure-domain unit suites
  e2e/           API suites that boot the app against fresh containers
prisma/          schema (single source of truth) + migrations
docs/            PROGRESS.md, decisions.md (ADR), limitations.md
```

## Getting started

Prerequisites: **Docker**, **Node.js ≥ 22**, npm (or pnpm/yarn).

```bash
# 1. Infrastructure (Postgres, Redis, MinIO)
docker compose up -d

# 2. Environment — copy and adjust values
cp .env.example .env

# 3. Install + generate client + migrate
npm install
npx prisma generate
npm run db:migrate:deploy

# 4. Run the API (dev, watch mode)
npm run dev
```

Optionally load the **demo dataset** (2 orgs, users, roles, an intake-enabled
Nairobi branch with escalation contacts + national numbers, and a PUBLISHED
public listing) so the anonymous emergency flow works immediately:

```bash
npm run db:seed
```

Open <http://localhost:3000/api/v1> (Swagger docs are enabled by default when
`ENABLE_SWAGGER=true`). Health endpoints live at the root: `/health`,
`/health/live`, `/health/ready`.

### Background worker

The worker runs the BullMQ processors plus the time-based scheduler (outbox
delivery, maintenance reminders, idempotency reclamation, export expiry,
notification delivery):

```bash
npm run worker          # production build
npm run worker:dev      # watch mode
```

> Ticks are at-least-once and best-effort: with no worker process running,
> nothing is delivered or swept until one returns. Cadences are env-driven
> (`OUTBOX_DRAIN_INTERVAL_MS`, `MAINTENANCE_REMINDER_INTERVAL_MS`,
> `IDEMPOTENCY_SWEEP_INTERVAL_MS`, `REPORT_EXPIRY_INTERVAL_MS`,
> `NOTIFICATION_DELIVERY_INTERVAL_MS`) and `SCHEDULER_ENABLED=false` registers no
> duty at all. See `docs/limitations.md`.

## Configuration

All configuration is validated by Zod at boot; the app refuses to start on
invalid or incomplete settings. Key variables (see `.env.example` for all):

- `DATABASE_URL` / `DATABASE_DIRECT_URL` — PostgreSQL
- `REDIS_*` — Redis for realtime + outbox (+ `BULL_PREFIX` for BullMQ)
- `S3_*` — MinIO/S3 object storage
- `JWT_*`, `MFA_*`, `INVITE_*` — auth tokens
- `EMERGENCY_*` — public emergency intake: `EMERGENCY_RETENTION_DAYS` (PII
  retention window, 0 disables), `EMERGENCY_DEDUPE_SECONDS` (duplicate-submit
  window), `EMERGENCY_SWEEP_INTERVAL_MS` (maintenance sweep cadence)
- `SCHEDULER_ENABLED`, `OUTBOX_DRAIN_INTERVAL_MS`,
  `IDEMPOTENCY_SWEEP_INTERVAL_MS`, `REPORT_EXPIRY_INTERVAL_MS`,
  `MAINTENANCE_REMINDER_INTERVAL_MS`, `NOTIFICATION_DELIVERY_INTERVAL_MS` —
  scheduler cadences (ADR-044)
- `NOTIFICATION_OFFSITE_CHANNELS` — channels (`EMAIL`,`SMS`,`PUSH`) the
  notification consumer fans out to on top of `IN_APP`; empty (default) means
  nothing leaves the host
- `NOTIFICATION_WEBHOOK_URL` / `NOTIFICATION_WEBHOOK_SECRET` — off-system
  notification adapter: a signed JSON POST per delivery, with the notification
  id as an idempotency key. Unset keeps the structural stub (ADR-045)
- `CORS_ORIGINS`, `LOG_LEVEL`, `API_PREFIX`, `PORT`

## Quality gate

Every phase must pass the full gate before `main` is touched:

```bash
npm run check     # lint + typecheck + boundaries
npm test          # unit
npm run build
npm run test:e2e
```

| Check | Command |
| --- | --- |
| Lint | `npm run lint` |
| Typecheck | `npm run typecheck` |
| Module boundaries | `npm run boundaries` |
| Unit tests | `npm test` (491 tests · 64 suites) |
| Build | `npm run build` |
| E2E (Testcontainers) | `npm run test:e2e` (234 tests · 20 suites) |

E2E spins up fresh Postgres + Redis via Testcontainers, applies migrations
idempotently, and exercises the API end to end — including real RLS isolation,
concurrency, and role-separation checks. Reuse external infra with
`E2E_DATABASE_URL` / `E2E_REDIS_*` for fast iteration.

## Documentation

- **`PROGRESS.md`** — phase-by-phase delivery record against the product brief.
- **`docs/decisions.md`** — accepted architecture/engineering decision records
  (ADR-001…046, newest first).
- **`docs/limitations.md`** — honest catalog of stubs, deferrals, and caveats.
- **`docs/roadmap.md`** — tracked backlog of deferred production items.
- **`docs/diagrams/`** — architecture/sequence diagrams (Mermaid).
- **Swagger** — interactive API docs (dev default) under `/api/v1`.

## Status

All brief phases (0–13) are delivered, and the backend patch (P1 session &
display devices, P2 public directory, P3 public emergency intake, P4 hardening,
P5 time-based scheduler, P6 notification delivery) is on `main`. Deferred
production items (live M-PESA adapter, PDF tooling, async report generation,
provider directory, patient-portal auth) are tracked in
**`docs/roadmap.md`**, with the full caveat catalog in `docs/limitations.md`.

## License

Proprietary. See the repository owner for usage terms.