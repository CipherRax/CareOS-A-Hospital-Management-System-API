# careOS — Known Limitations & Stubs

Honest accounting of what is stubbed, deferred, or knowingly imperfect. Items
marked **[stub]** are intentionally not implemented yet; everything else is
working code with a caveat.

## Explicit stubs (named in code)

- **Outbox dispatcher — `src/jobs/outbox/noop-outbox-dispatcher.ts`** `[stub]`
  Outbox rows are written reliably in the same transaction as domain writes
  (ADR-007), but nothing consumes them yet. The dispatcher pointer advancing
  logic lives in `src/database/outbox-publisher.service.ts`; the per-event
  handler is a no-op placeholder. Phase 1 will add a BullMQ-based worker
  (`worker.ts` bootstrap exists in `npm run worker`).
- **JWT/session auth (Phase 1)** `[stub]` — access is authorized through the
  real permissions guard, but the principal is provided only by the test seam
  `TestPrincipalMiddleware` (`test/support/test-app.ts`). Production
  authentication is not implemented.
- **Emergency access flow** — `TenantScope.emergency` exists as a marker but
  nothing sets it (by design; Phase 1+).
- **S3 object storage** — the S3 client dependency is installed and env-config
  wired, but no object service uses it yet.
- **Metrics/OTel** — `METRICS_ENABLED`/`OTEL_*` envs exist but telemetry
  serving/wiring is not implemented.
- **Seeder** — `SEED_ALLOWED=false` by default; `prisma/seed.ts` is present but
  there is no seeded data flow in phase 0.

## Known caveats in shipped code

- **RLS is a backstop, not the primary control.** `app.current_org` is set via
  `SELECT set_config(...)` inside interactive transactions. Because Prisma may
  open multiple logical connections per transaction, the setting is not
  guaranteed on every connection; the Prisma client extension is the primary
  tenant boundary. Do not rely on RLS alone (ADR-005/ADR-006).
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
- **Jest e2e open-handle note:** suites exit cleanly; a `--forceExit` was only
  used while debugging an unrelated hang and is not part of the scripts.
- **Boundary check** (`npm run boundaries`) treats `src/common` and
  `src/database` as shared layers; `src/modules` may not reach across module
  boundaries except via shared layers.

## Operational notes

- `test/.e2e.env.json` is **generated** by globalSetup and will hold real
  connection strings; it is gitignored. Reusing external Postgres/Redis for
  tests is fine but will destroy schema state via `migrate deploy` idempotency
  only — tests do not clean the schema between runs.
- Node 26 is used locally; the Dockerfile targets Node 22 per the brief.
- Docker Hub access was flaky during setup (npm registry unreachable too);
  `@swc/helpers` is intentionally not installed (helpers inlined, ADR-010).