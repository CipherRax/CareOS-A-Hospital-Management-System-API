-- Offline-first sync (brief §10) and privacy records (brief §8).
--
-- Two features land here, both org-scoped tenant tables under the existing RLS
-- policy:
--
--  * change_log — the cursor feed clients pull from. `id` is a UUIDv7 (minted
--    in application code) and `seq` is a monotonic bigint sequence; the client
--    cursor is `seq`, because a bigint comparison is collation-proof whereas
--    comparing UUIDv7 ids as text depends on the database collation.
--    `sourceEventId` pins each row to the outbox event that produced it and is
--    unique per org, so a consumer replay upserts rather than duplicates.
--
--  * retention_policies / legal_holds / data_exports — the privacy surface.
--    A legal hold makes a patient's graph ineligible for any automated
--    deletion/anonymization; a retention policy is org reference data; a data
--    export is an asynchronous, audited job whose artifact lives in object
--    storage.
--
-- No backfill: an empty change log simply means "client is already current at
-- the empty cursor", and no org has a retention policy or hold yet.

-- CreateEnum
CREATE TYPE "ChangeOperation" AS ENUM ('UPSERT', 'DELETE');
CREATE TYPE "RetentionAction" AS ENUM ('ARCHIVE', 'ANONYMIZE', 'REVIEW');
CREATE TYPE "DataExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "change_log" (
    "id" TEXT NOT NULL,
    "seq" BIGSERIAL NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resourceType" TEXT NOT NULL,
    "resourceId" TEXT NOT NULL,
    "operation" "ChangeOperation" NOT NULL DEFAULT 'UPSERT',
    "version" INTEGER NOT NULL DEFAULT 1,
    "branchId" TEXT,
    "requiredPermission" TEXT NOT NULL,
    "actorId" TEXT,
    "sourceEventId" TEXT,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "change_log_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "retention_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "category" TEXT NOT NULL,
    "retentionDays" INTEGER NOT NULL,
    "action" "RetentionAction" NOT NULL DEFAULT 'REVIEW',
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "retention_policies_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "legal_holds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "placedById" TEXT,
    "placedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedAt" TIMESTAMP(3),
    "releasedById" TEXT,
    "releaseReason" TEXT,

    CONSTRAINT "legal_holds_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "data_exports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT,
    "requestedById" TEXT,
    "status" "DataExportStatus" NOT NULL DEFAULT 'PENDING',
    "format" TEXT NOT NULL DEFAULT 'JSON',
    "storageKey" TEXT,
    "contentType" TEXT,
    "sizeBytes" INTEGER,
    "failureReason" TEXT,
    "expiresAt" TIMESTAMP(3),
    "completedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "data_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "change_log_seq_key" ON "change_log"("seq");
CREATE UNIQUE INDEX "change_log_organizationId_sourceEventId_key" ON "change_log"("organizationId", "sourceEventId");
CREATE INDEX "change_log_organizationId_seq_idx" ON "change_log"("organizationId", "seq");
CREATE INDEX "change_log_organizationId_resourceType_seq_idx" ON "change_log"("organizationId", "resourceType", "seq");

CREATE UNIQUE INDEX "retention_policies_organizationId_category_key" ON "retention_policies"("organizationId", "category");

CREATE INDEX "legal_holds_organizationId_patientId_idx" ON "legal_holds"("organizationId", "patientId");
CREATE INDEX "legal_holds_organizationId_releasedAt_idx" ON "legal_holds"("organizationId", "releasedAt");

CREATE INDEX "data_exports_organizationId_status_createdAt_idx" ON "data_exports"("organizationId", "status", "createdAt");
CREATE INDEX "data_exports_organizationId_patientId_createdAt_idx" ON "data_exports"("organizationId", "patientId", "createdAt");

-- AddForeignKey
ALTER TABLE "change_log" ADD CONSTRAINT "change_log_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "retention_policies" ADD CONSTRAINT "retention_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "legal_holds" ADD CONSTRAINT "legal_holds_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "data_exports" ADD CONSTRAINT "data_exports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS), same pattern as prior phases.
ALTER TABLE "change_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "retention_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "legal_holds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "data_exports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_change_log ON "change_log"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_retention_policies ON "retention_policies"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_legal_holds ON "legal_holds"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_data_exports ON "data_exports"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "change_log", "retention_policies",
  "legal_holds", "data_exports" TO careos_app;
