# careOS — Decision Records

Accepted architecture/engineering decisions, newest first. Each entry records
context, the decision, and its consequences.

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
`findUnique` must use explicitly.

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