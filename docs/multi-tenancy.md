# careOS — Multi-Tenancy

How tenancy is enforced, where the boundaries are, and what the current RLS
reality is. Authentication is in `docs/authentication.md`, authorization in
`docs/authorization.md`.

---

## 1. Model

careOS is **organization-scoped** (multi-tenant by `Organization`). Every
tenant-owned record carries `organizationId` (or is reachable through one).
Tenant isolation is enforced at three layers: application (tenant extension),
guard chain (session/org validation), and database (RLS policies, not
currently force-enforced by the schema owner).

## 2. Organization identity

`Organization` is the tenant root. On login, the caller must supply
`organizationId` (see `docs/authentication.md`). The session is bound to that
organization; `TenantGuard` rejects if the token's org does not match the
session's org (`TENANT_ACCESS_DENIED`).

## 3. Tenant context and the extension

### Context
`TenantContext` (CLS) holds `organizationId`, `userId`, `sessionId`, `roles`,
`permissions`, `patientId`, `branchIds`, and `isPlatformJob`. It is set by
`TenantGuard` for requests, or set explicitly for platform jobs/migrations.

### Prisma tenant extension
`PrismaService` creates a client extended with tenant logic. `TENANT_MODELS`
(`src/database/prisma.service.ts`) lists every model that is org-scoped:

- Infra: `Organization`, `OutboxEvent`, `ProcessedEvent`, `AuditLog`,
  `IdempotencyRecord`, `Counter`
- Identity: `Branch`, `Department`, `User`, `StaffProfile`, `UserBranch`,
  `UserDepartment`, `Session`, `RefreshToken`, `Role`, `UserRole`,
  `MfaCredential`, `MfaRecoveryCode`, `BreakGlassGrant`
- Patients/scheduling/clinical/inventory/billing/lab/radiology/inpatient/emergency/
  communication/privacy/sync, etc. (the full list is in the code)

For models in `TENANT_MODELS`, the extension:
1. Injects `organizationId` into `where` clauses (and related filters) when
   missing.
2. Injects `organizationId` into `create`/`createMany` data when missing.
3. Throws `TENANT_REQUIRED` if `organizationId` is not present in context and
   cannot be inferred.
4. Provides `tenantFor(orgId)` and `unscoped` (which bypasses the filter) for
   controlled use.

This is the **primary enforcement mechanism** in normal operation.

## 4. Row-level security reality

### What exists
Migrations enable RLS on all tenant tables and create policies (e.g.
`org_isolation` on `Organization`, `tenant_isolation_*` on infra tables, and
org-isolation policies on every tenant table as added). The `init` migration
explicitly states: "policies evaluate NULL and deny. The schema owner bypasses
RLS (no FORCE)".

### What this means
- **Not forced:** `FORCE ROW LEVEL SECURITY` is not used. 
- **Owner bypass:** PostgreSQL superusers/schema owners bypass RLS by default.
- **Default deployment connects as owner:** `docker-compose.yml` sets
  `POSTGRES_USER: careos` and the app/worker connect with
  `DATABASE_URL` pointing to that user. In that configuration, **RLS policies
  are not enforced by the database**.
- **Defense in depth:** policies exist for scenarios where a non-owner role
  connects (restricted app role, read replicas with different roles, etc.).
  They are correct policies; they just aren't active under the current owner
  connection.

Do not rely on RLS alone in the current default setup — rely on the tenant
extension and the guard chain. Any change to the DB role must account for
this.

## 5. Branch scope

Branches are org-scoped (`Branch`). Users can be assigned to branches via
`UserBranch`. `TenantGuard` applies branch context (see
`applyBranchContext` in the guard). Many modules filter by branch (scheduling,
queue, display devices, inventory locations where applicable). Branch scope is
an additional filter on top of org scope, not a replacement.

## 6. Patient self-scope (portal)

Patient portal access is org-scoped and also **patient-scoped**. See
`docs/authentication.md` §9 and `src/common/auth/patient-scope.ts`.

- `Patient.userId` links a `Patient` to a `User` (unique). One login -> at most
  one patient record.
- `resolvePatientScope(link, roleKeys)` returns `patientId` only if **both**
  `link` exists and `PATIENT` role is present. Either alone -> `null` (no
  accidental privilege escalation).
- `TenantScope.patientId` is consumed by portal projections and
  `patients.assertPatientOwnership`. Services must not trust arbitrary
  `patientId` from request bodies for portal callers; they must use the scoped
  value or assert ownership explicitly.

## 7. Platform jobs and cross-org access

Background processors (BullMQ workers) run in the same `AppModule` as the API.
There is **no automatic worker-only gate**; `SCHEDULER_ENABLED=false` is the
operator kill-switch. Platform jobs:
- Must call `prisma.tenantFor(orgId)` or otherwise set `TenantContext` with
  the target organization.
- May use `prisma.unscoped` only when there is no org context at all (e.g.
  bootstrapping a job that discovers orgs). Discovery must still lead to
  per-org processing.
- Must never leak data across orgs.

The outbox drain is a scheduler duty (`outbox-drain`, BullMQ repeatable) that
processes outbox events per org as they appear; each dispatch is org-scoped.

## 8. Error codes

| Code | When |
| --- | --- |
| `TENANT_REQUIRED` | Tenant extension cannot determine `organizationId`. |
| `TENANT_ACCESS_DENIED` | Token org does not match session org, or cross-org access attempted. |

## 9. Reading map

| Topic | Where |
| --- | --- |
| Tenant models set | `src/database/prisma.service.ts` |
| Tenant context | `src/database/tenant-context.ts` |
| Guard enforcement | `src/common/guards/tenant.guard.ts` |
| Patient scope rule | `src/common/auth/patient-scope.ts` |
| RLS migrations | `prisma/migrations/20260921132930_init/migration.sql` (and later `ALTER TABLE ... ENABLE ROW LEVEL SECURITY`) |
| Docker roles | `docker-compose.yml` |
