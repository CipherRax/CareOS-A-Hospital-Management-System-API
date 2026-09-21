-- CreateEnum
CREATE TYPE "OrgStatus" AS ENUM ('ACTIVE', 'SUSPENDED', 'CLOSED');

-- CreateEnum
CREATE TYPE "OutboxStatus" AS ENUM ('PENDING', 'PUBLISHED', 'FAILED', 'DEAD');

-- CreateEnum
CREATE TYPE "IdempotencyStatus" AS ENUM ('IN_PROGRESS', 'COMPLETED', 'REJECTED');

-- CreateTable
CREATE TABLE "Organization" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "OrgStatus" NOT NULL DEFAULT 'ACTIVE',
    "currency" TEXT NOT NULL DEFAULT 'KES',
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "country" TEXT NOT NULL DEFAULT 'KE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Organization_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "outbox_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "OutboxStatus" NOT NULL DEFAULT 'PENDING',
    "aggregateType" TEXT NOT NULL,
    "aggregateId" TEXT NOT NULL,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actorId" TEXT,
    "correlationId" TEXT,
    "payload" JSONB NOT NULL,
    "attemptCount" INTEGER NOT NULL DEFAULT 0,
    "lastError" TEXT,
    "nextAttemptAt" TIMESTAMP(3),
    "publishedAt" TIMESTAMP(3),
    "deadAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "outbox_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "processed_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "consumer" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "consumedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "processed_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "userId" TEXT,
    "action" TEXT NOT NULL,
    "resource" TEXT NOT NULL,
    "resourceId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "reason" TEXT,
    "previousState" JSONB,
    "newState" JSONB,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "idempotency_records" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "scopeKey" TEXT NOT NULL,
    "idempotencyKey" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "status" "IdempotencyStatus" NOT NULL DEFAULT 'IN_PROGRESS',
    "responseStatus" INTEGER,
    "responseBody" JSONB,
    "requestBody" JSONB,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "idempotency_records_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "counters" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "value" BIGINT NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "counters_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "outbox_events_status_nextAttemptAt_idx" ON "outbox_events"("status", "nextAttemptAt");

-- CreateIndex
CREATE INDEX "outbox_events_organizationId_status_idx" ON "outbox_events"("organizationId", "status");

-- CreateIndex
CREATE INDEX "outbox_events_organizationId_type_idx" ON "outbox_events"("organizationId", "type");

-- CreateIndex

-- CreateIndex
CREATE INDEX "processed_events_organizationId_consumedAt_idx" ON "processed_events"("organizationId", "consumedAt");

-- CreateIndex
CREATE UNIQUE INDEX "processed_events_organizationId_consumer_eventId_key" ON "processed_events"("organizationId", "consumer", "eventId");

-- CreateIndex

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_resource_resourceId_createdAt_idx" ON "audit_logs"("organizationId", "resource", "resourceId", "createdAt");

-- CreateIndex

-- CreateIndex
CREATE INDEX "audit_logs_organizationId_createdAt_idx" ON "audit_logs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "idempotency_records_expiresAt_idx" ON "idempotency_records"("expiresAt");

-- CreateIndex

-- CreateIndex
CREATE UNIQUE INDEX "idempotency_records_organizationId_scopeKey_idempotencyKey_key" ON "idempotency_records"("organizationId", "scopeKey", "idempotencyKey");

-- CreateIndex

-- CreateIndex
CREATE UNIQUE INDEX "counters_organizationId_key_key" ON "counters"("organizationId", "key");

-- AddForeignKey
ALTER TABLE "outbox_events" ADD CONSTRAINT "outbox_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "processed_events" ADD CONSTRAINT "processed_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "audit_logs" ADD CONSTRAINT "audit_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "idempotency_records" ADD CONSTRAINT "idempotency_records_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "counters" ADD CONSTRAINT "counters_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ============================================================================
-- Custom (non-Prisma) infrastructure
-- ============================================================================

-- Append-only audit trail. Prisma exposes no update/delete path on AuditLog, so
-- enforce it at the database level as well.
CREATE OR REPLACE FUNCTION audit_logs_guard() RETURNS trigger
AS $$
BEGIN
  RAISE EXCEPTION 'audit_logs are append-only; UPDATE/DELETE are prohibited (row %)',
    OLD.id USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER audit_logs_append_only
  BEFORE UPDATE OR DELETE ON "audit_logs"
  FOR EACH ROW EXECUTE FUNCTION audit_logs_guard();

-- Row-Level Security ----------------------------------------------------------
-- Defense-in-depth: the application enforces tenancy via a Prisma client
-- extension; RLS backs it up for transactional scopes, which set the GUC
-- `app.current_org` to the active organization id. When the GUC is unset the
-- policies evaluate NULL and deny. The schema owner bypasses RLS (no FORCE),
-- so the application's primary tenant enforcement remains the client
-- extension; RLS is validated by a dedicated integration test that connects as
-- the `careos_app` role.
ALTER TABLE "Organization" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "outbox_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "processed_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "audit_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "idempotency_records" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "counters" ENABLE ROW LEVEL SECURITY;

CREATE POLICY org_isolation ON "Organization"
  FOR ALL
  USING ("id" = current_setting('app.current_org', true))
  WITH CHECK ("id" = current_setting('app.current_org', true));

CREATE POLICY tenant_isolation_outbox ON "outbox_events"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

CREATE POLICY tenant_isolation_processed ON "processed_events"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

CREATE POLICY tenant_isolation_audit ON "audit_logs"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

CREATE POLICY tenant_isolation_idempotency ON "idempotency_records"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

CREATE POLICY tenant_isolation_counters ON "counters"
  FOR ALL
  USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

-- Restricted application role. Connection string below is for the RLS test;
-- change the password in your environment. Do NOT use this role for general
-- app traffic in the same pooled connection model.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careos_app') THEN
    CREATE ROLE careos_app WITH LOGIN PASSWORD '__CHANGE_ME__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO careos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON "Organization", "outbox_events", "processed_events",
  "audit_logs", "idempotency_records", "counters" TO careos_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO careos_app;
ALTER DEFAULT PRIVILEGES IN SCHEMA public
  GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO careos_app;
