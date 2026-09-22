# careOS — Known Limitations & Stubs

Honest accounting of what is stubbed, deferred, or knowingly imperfect. Items
marked **[stub]** are intentionally not implemented yet; everything else is
working code with a caveat.

## Explicit stubs (named in code)

- **Outbox dispatcher — `src/jobs/outbox/noop-outbox-dispatcher.ts`** `[stub]`
  Outbox rows are written reliably in the same transaction as domain writes
  (ADR-007), but nothing consumes them yet. The dispatcher pointer advancing
  logic lives in `src/database/outbox-publisher.service.ts`; the per-event
  handler is a no-op placeholder. A later phase will add a worker-based
  dispatcher (`worker.ts` bootstrap exists in `npm run worker`).
- **Emergency access flow** — `TenantScope.emergency` exists as a marker but
  nothing sets it (by design; a later phase).
- **Outbox consumers beyond the probe** — `Storage.DocumentUploaded` rows are
  written by the documents module, but the no-op dispatcher (above) still means
  no worker reacts to them yet (later phase).
- **Metrics/OTel** — `METRICS_ENABLED`/`OTEL_*` envs exist but telemetry
  serving/wiring is not implemented.
- **Seeder** — `SEED_ALLOWED=false` by default; `prisma/seed.ts` seeds only
  when allowed.
- **Role management UI/API surface** — catalog role definitions
  (`role-matrix.ts`) cover the identity/access catalog; module-specific
  permissions are added as their modules land.
- **Break-glass approval** — the request/expire flow is implemented; a
  pull-based approver surface beyond the request queue is a later-phase item.

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

## Operational notes

- `test/.e2e.env.json` is **generated** by globalSetup and will hold real
  connection strings; it is gitignored. Reusing external Postgres/Redis for
  tests is fine but will destroy schema state via `migrate deploy` idempotency
  only — tests do not clean the schema between runs.
- Node 26 is used locally; the Dockerfile targets Node 22 per the brief.
- Docker Hub access was flaky during setup (npm registry unreachable too);
  `@swc/helpers` is intentionally not installed (helpers inlined, ADR-010).