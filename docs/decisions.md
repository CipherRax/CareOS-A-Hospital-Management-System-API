# careOS — Decision Records

Accepted architecture/engineering decisions, newest first. Each entry records
context, the decision, and its consequences.

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