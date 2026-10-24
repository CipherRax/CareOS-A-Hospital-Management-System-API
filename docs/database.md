# careOS — Database

Schema, tenancy primitives, number generation, append-only history, and
migration inventory. Grounded in `prisma/schema.prisma` and the migrations.

---

## 1. Overview

- **ORM:** Prisma (PostgreSQL). All primary keys are UUIDv7 generated in
  application code via `newId()`; Prisma has no defaults. Sequential DB ids are
  never exposed as business identifiers.
- **Schema file:** `prisma/schema.prisma` (~126 enums, ~80 models).
- **Migrations:** `prisma/migrations/` (26 migrations up to
  `20261008120000_admin_job_inspection`).
- **IDs:** time-ordered UUIDv7 for natural ordering in indexes and cursors.

## 2. Model groups

| Group | Key models | Notes |
| --- | --- | --- |
| Platform / infra | `Organization`, `OutboxEvent`, `ProcessedEvent`, `AuditLog`, `IdempotencyRecord`, `Counter`, `ChangeLog`, `SyncCursor` | Org-scoped or platform-wide primitives used by every other feature. |
| Identity & access | `User`, `Role`, `UserRole`, `Session`, `RefreshToken`, `Branch`, `Department`, `UserBranch`, `UserDepartment`, `StaffProfile`, `MfaCredential`, `MfaRecoveryCode`, `BreakGlassGrant` | RBAC, sessions, MFA, break-glass. |
| Patients | `Patient`, `Guardian`, `PatientGuardian`, `PatientConsent`, `Allergy`, `MedicalHistoryEntry`, `PatientAccessLog`, `PatientTimelineEntry` | Demographics + consent + access history. |
| Scheduling & flow | `OrganizationSetting`, `UserPreference`, `ProviderSchedule`, `ScheduleOverride`, `Appointment`, `WaitlistEntry`, `Visit`, `QueueEntry`, `VitalRecord`, `DisplayDevice` | Booking, walk-ins, queue, display pairing. |
| Clinical | `Encounter`, `ClinicalNote`, `ClinicalNoteVersion`, `ClinicalNoteTemplate`, `Diagnosis`, `CodingSystem`, `CodeConcept`, `FollowUp`, `Referral`, `Task`, `Workflow`, `WorkflowTransition` | Notes are versioned; tasks/workflows encode clinical processes. |
| Inventory & pharmacy | `Medication`, `Supplier`, `StockBatch`, `InventoryLedgerEntry`, `PurchaseOrder`, `PurchaseOrderItem`, `StockTransfer`, `StockTransferItem`, `StockCount`, `StockCountItem`, `Prescription`, `PrescriptionItem` | FEFO enforced in service logic; ledger is append-only via trigger. |
| Laboratory & radiology | `LabTestCategory`, `LabTest`, `LabTestField`, `LabOrder`, `LabOrderItem`, `LabSample`, `LabResult`, `RadiologyOrder`, `RadiologyStudy`, `RadiologyReport` | Orders -> samples/results or studies/reports. |
| Inpatient & emergency | `Bed`, `Ward`, `Admission`, `BedAssignment`, `Transfer`, `Discharge`, `EmergencyVisit`, `TriageAssessment`, `EmergencyRequest`, `EmergencyRequestEvent`, `EmergencyResource`, `EmergencyResourceAssignment` | Beds, admissions, ER intake. |
| Billing & finance | `BillableItem`, `Invoice`, `InvoiceItem`, `Payment`, `InsurancePayer`, `PatientInsurancePolicy`, `InsuranceClaim`, `ChartOfAccounts`, `JournalEntry`, `JournalLine`, `FinanceTransaction`, `Budget`, `Expense`, `Asset`, `AssetMaintenance` | Invoicing, insurance, double-entry scaffolding with balance guard. |
| Communication & ops | `Notification`, `NotificationTemplate`, `MessageThread`, `Message`, `Feedback`, `Complaint`, `Incident`, `PublicNotice`, `PublicListing`, `PublicVerification`, `OnboardingInquiry` | Messaging, feedback, compliance-adjacent ops. |
| Privacy/export | `DataSubjectRequest`, `DataExport` | GDPR/DSR and bulk export tracking. |
| Sync | `ChangeLog`, `SyncCursor` | Outbox-derived sync feed with permission metadata. |

## 3. Tenant scoping primitives

### Tenant-owned model set
`TENANT_MODELS` in `src/database/prisma.service.ts` enumerates every model that
must be org-scoped. The Prisma extension injects `organizationId` into
`create`/`where` for those models and throws `TENANT_REQUIRED` if no org is in
scope. Models **not** in that set (shared reference tables) are not
intercepted.

### Tenant context
`TenantContext` (CLS) carries `organizationId`, `userId`, `sessionId`, `roles`,
`permissions`, `patientId`, `branchIds`, and `isPlatformJob`. `TenantGuard` sets
it on each request after revalidating the session.

### Unscoped access
`prisma.unscoped` / the unscoped client bypasses the tenant filter. It is used
only for bootstrap, login lookup, token refresh validation, platform jobs, and
migration/seed paths where the org is established by other means. Misusing it
is a tenancy bug.

## 4. Row-level security (RLS)

- **Enabled** on all tenant tables (migrations add `ALTER TABLE ... ENABLE ROW
  LEVEL SECURITY` as models land).
- **Policies**: in `init`, six tables get explicit policies; subsequent
  migrations add policies when enabling RLS on new tenant tables. All follow
  the same shape (org isolation).
- **No FORCE:** the `init` migration states "policies evaluate NULL and deny.
  The schema owner bypasses RLS (no FORCE)". 
- **Schema owner bypass:** the default `docker-compose.yml` connects as
  `postgres` user `careos` (owner). `FORCE ROW LEVEL SECURITY` is not used, so
  a connection as the schema owner **does not** apply RLS. In that
  configuration, **RLS is not the enforcement mechanism** — the application
  tenant extension is the enforcement mechanism. The policies exist for defense
  in depth and for cases where a non-owner role connects.

## 5. Number series (counters)

Business numbers never come from DB serials; they come from the `counters`
table with atomic allocation.

### Counter model
```prisma
model Counter {
  id             String @id
  organizationId String
  key            String
  value          BigInt @default(0)
  updatedAt      DateTime @updatedAt

  organization Organization @relation(fields: [organizationId], references: [id], onDelete: Restrict)

  @@unique([organizationId, key])
  @@map("counters")
}
```

### Allocation pattern
Every number series uses:
```sql
INSERT INTO "counters" ("id", "organizationId", "key", "value", "updatedAt")
VALUES ($1, $2, $3, 1, NOW())
ON CONFLICT ("organizationId", "key") DO UPDATE
  SET "value" = "counters"."value" + 1, "updatedAt" = NOW()
RETURNING "value"
```
This serializes at the row level via the unique index and runs inside the
request's transaction (with tenant RLS scope). `value` is the next sequence
number (never reset).

### Prefixes and helpers

| Domain | Counter key(s) | Prefix/format | Helper |
| --- | --- | --- | --- |
| Patients | `patient_number` | `PAT-YYYY-NNNNNN` (year from UTC; stable prefix over org lifetime) | `src/modules/patients/domain/patient-number.ts` |
| Billing/invoices/payments | varies by series | `INV-YYYY-NNNNNN`, `RCT-YYYY-NNNNNN`, `CLM-YYYY-NNNNNN`, `JRN-YYYY-NNNNNN` | `src/modules/billing/domain/billing-number.ts` |
| Laboratory | `lab_order_number`, `lab_sample_number` | `LAB-ORD-YYYY-NNNNNN`, `LAB-SMP-YYYY-NNNNNN` | `src/modules/laboratory/domain/lab-number.ts` |
| Radiology | per series as defined | `RAD-ORD-...`, `RAD-ACC-...` (see helper) | `src/modules/radiology/domain/radiology-number.ts` |
| Inpatient | admission/discharge/transfer as used | `ADM-YYYY-NNNNNN` (e.g. admission) | `src/modules/inpatient/domain/inpatient-number.ts` |
| Emergency | per series | `ER-...` | `src/modules/emergency/domain/emergency-number.ts` |
| Operations | as needed | `OPS-...` | `src/modules/operations/domain/operations-number.ts` |

Formatting pads the sequence to 6 digits. The year is the UTC year at
formatting time; because the sequence never resets, numbers remain globally
unique within the org even across year boundaries.

## 6. Append-only and integrity guards

Triggers enforce immutability and invariants:

| Table/trigger | Type | Purpose |
| --- | --- | --- |
| `audit_logs` (`audit_logs_append_only` / `audit_logs_guard`) | Append-only | `UPDATE`/`DELETE` raise an exception; only `INSERT` allowed. |
| `inventory_ledger_entries` (`inventory_ledger_entries_guard`) | Append-only | Inventory movements cannot be edited/deleted. |
| `emergency_request_events` (`emergency_request_events_guard`) | Append-only | ER event log is immutable. |
| `finance_transactions` (`finance_transactions_balance_guard` / `enforce_balanced_journal`) | Balance guard | Journal entries must balance (see migration). |

These are DB-enforced so even if application code has a bug, the history
cannot be rewritten.

## 7. Outbox, processed events, and idempotency

### OutboxEvent
```prisma
model OutboxEvent {
  id             String       @id
  organizationId String
  type           String
  version        Int          @default(1)
  status         OutboxStatus @default(PENDING)
  aggregateType  String
  aggregateId    String
  occurredAt     DateTime     @default(now())
  actorId        String?
  correlationId  String?
  payload        Json         // minimal: IDs only, never PHI
  attemptCount   Int          @default(0)
  lastError      String?
  nextAttemptAt  DateTime?
  publishedAt    DateTime?
  deadAt         DateTime?
  ...
}
```
`OutboxStatus` enum: `PENDING`, `PUBLISHED`, `FAILED`, `DEAD`, `DISCARDED`
(added by `20261008120000_admin_job_inspection`). Payloads contain IDs only
(ADR discipline) — no PHI.

### ProcessedEvent
Idempotency for consumers: `@@unique([organizationId, consumer, eventId])`. When a
consumer marks an event processed, it inserts here; duplicates are rejected.

### IdempotencyRecord
HTTP/idempotency keys stored per org for safe retries.

## 8. Change log and sync

`ChangeLog` has a monotonic `seq` (bigint, autoincrement, unique) — the sync
cursor is this value (collation-proof). Each row stores `resourceType`,
`resourceId`, `operation`, `version`, `branchId`, `requiredPermission`,
`actorId`, and pins to `outboxEventId`. `SyncCursor` tracks per-client
progress.

## 9. Data export tracking

`DataExport` tracks privacy exports (`DataExportStatus` enum) and the
export service enforces a **50 MiB** cap on artifacts written/read in the
export path (see `src/modules/privacy/data-export.service.ts`).

## 10. Migrations inventory

| Migration | Phase/patch | Scope |
| --- | --- | --- |
| `20260921132930_init` | Init | Core infra, enums, RLS on infra tables, audit triggers, org/user/role/session scaffolding. |
| `20260921171109_phase1_identity_access` | Phase 1 | Identity/access expansions. |
| `20260921175613_phase1_breakglass_pending` | Phase 1 | Break-glass. |
| `20260922101216_phase2_documents` | Phase 2 | Documents. |
| `20260922113304_phase2_patients` | Phase 2 | Patients + RLS on patient tables. |
| `20260923071517_phase3_scheduling` | Phase 3 | Scheduling/queue. |
| `20260923120000_phase4_clinical` | Phase 4 | Clinical core. |
| `20260924120000_phase5_inventory_pharmacy` | Phase 5 | Inventory/pharmacy + ledger trigger. |
| `20260925090000_phase6_billing` | Phase 6 | Billing. |
| `20260926090000_phase7_laboratory` | Phase 7 | Laboratory. |
| `20260927090000_phase8_inpatient_emergency` | Phase 8 | Inpatient/emergency. |
| `20260928100000_phase10_communication` | Phase 10 | Communication. |
| `20260928120000_phase11_financial` | Phase 11 | Finance + balanced-journal guard. |
| `20260928140000_phase12_operations` | Phase 12 | Operations. |
| `20260929120000_phase13_analytics` | Phase 13 | Analytics scaffolding. |
| `20260930090000_phase_p1_bootstrap` | P1 | Bootstrap/public directory. |
| `20260930100000_phase_p2_public_directory` | P2 | Public directory. |
| `20260930120000_phase_p3_emergency_intake` | P3 | Emergency intake + event guard. |
| `20261001120000_phase_p4_hardening` | P4 | Hardening. |
| `20261002120000_phase_p5_scheduler` | P5 | Scheduler. |
| `20261002140000_phase_p6_notification_delivery` | P6 | Notification delivery. |
| `20261003100000_phase_p8_document_security` | P8 | Document security. |
| `20261004120000_phase_p11_async_report_exports` | P11 | Async report exports. |
| `20261005120000_phase_p13_patient_portal_auth` | P13 | Patient portal auth (link Patient.userId). |
| `20261006090000_patch_emergency_contract_closure` | Patch | Emergency contract closure. |
| `20261007090000_patch_sync_privacy` | Patch | Sync/privacy patches. |
| `20261008120000_admin_job_inspection` | Patch | Add `DISCARDED` to `OutboxStatus`. |

## 11. Seed

`prisma/seed.ts` is **demo-only**. It creates deterministic demo orgs, roles,
users, branches/departments, and sample data for local development/e2e.
Production must not seed unless `SEED_ALLOWED=true` is set explicitly. Never
point it at real data.

## 12. Reading map

| Topic | Where |
| --- | --- |
| Tenant extension | `src/database/prisma.service.ts`, `src/database/tenant-context.ts` |
| RLS + migrations | `prisma/migrations/*`, `prisma/schema.prisma` |
| Number series | `src/modules/*/domain/*-number.ts` |
| Triggers/guards | Migrations (grep `CREATE TRIGGER`/`CREATE FUNCTION`) |
| Outbox | `src/modules/outbox/`, `src/jobs/processors/outbox-drain.processor.ts` |
| Change log/sync | `src/modules/sync/` |
| Audit | `src/database/audit.service.ts` |
