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
| `npm test`   | 22/22 unit |
| `build`      | pass   |
| `test:e2e`   | 15/15 (3 suites, fresh Testcontainers infra) |

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

## Phase 1 — Next

JWT/session auth replacing the test-principal seam; user management and
permission assignment; S3 object storage with signed URLs; scheduled outbox
dispatcher worker; metrics/OTel optional wiring; Swagger hardening.

## Notes

- Testcontainers uses `postgres:17-alpine` by default because `postgres:16-alpine`
  is not available in the local Docker Hub cache; Compose targets 16. Override
  with `E2E_POSTGRES_IMAGE`/`E2E_REDIS_IMAGE`. See `docs/limitations.md`.
- Jest configs are CommonJS `.js` files (no ts-node in the toolchain); SWC only
  (`@swc/jest`), helpers inline via `.swcrc -> externalHelpers: false`.