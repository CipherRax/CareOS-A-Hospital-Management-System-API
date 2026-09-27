-- Phase P3 (public emergency intake, brief §6.15; ADR-040/041):
-- * EmergencyRequest (+ EmergencyRequestEvent append-only history) -- TENANT
--   rows for caller help requests against a published directory branch. Caller
--   PII (name, phone, description, landmark) is AES-256-GCM encrypted at rest
--   (ADR-041); callerPhoneIndex is the plaintext normalized search derivative.
-- * EmergencyIntakePolicy -- per-branch acceptance + SLA/escalation
--   configuration (ADR-040), mirrored onto the public projection at publish.
-- * EmergencyContact -- ordered staff escalation chain per branch.
-- * EmergencyNumber + PublicNotice -- CROSS-TENANT reference rows read on the
--   anonymous public emergency path. NOT covered by the tenant extension.

-- CreateEnum
CREATE TYPE "EmergencyRequestStatus" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "EmergencyRequestEventType" AS ENUM ('RECEIVED', 'ACKNOWLEDGED', 'RESPONDING', 'ESCALATED', 'CLOSED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PublicNoticeSeverity" AS ENUM ('INFO', 'WARNING', 'CRITICAL');

-- CreateTable
CREATE TABLE "emergency_intake_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "autoEscalate" BOOLEAN NOT NULL DEFAULT true,
    "requireDescription" BOOLEAN NOT NULL DEFAULT false,
    "allowAnonymousCaller" BOOLEAN NOT NULL DEFAULT false,
    "levelSeconds" JSONB NOT NULL,
    "emergencyPhone" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_intake_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_contacts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "role" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 0,

    CONSTRAINT "emergency_contacts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "referenceNumber" TEXT NOT NULL,
    "trackingTokenHash" TEXT NOT NULL,
    "status" "EmergencyRequestStatus" NOT NULL DEFAULT 'RECEIVED',
    "escalationLevel" INTEGER NOT NULL DEFAULT 0,
    "callerNameEnc" TEXT,
    "callerPhoneEnc" TEXT,
    "callerPhoneIndex" TEXT,
    "descriptionEnc" TEXT,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "landmarkEnc" TEXT,
    "staffNoteEnc" TEXT,
    "source" TEXT NOT NULL DEFAULT 'PUBLIC',
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "respondedById" TEXT,
    "respondedAt" TIMESTAMP(3),
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_request_events" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestId" TEXT NOT NULL,
    "type" "EmergencyRequestEventType" NOT NULL,
    "level" INTEGER,
    "actor" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "emergency_request_events_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_numbers" (
    "id" TEXT NOT NULL,
    "country" TEXT NOT NULL DEFAULT 'KE',
    "purpose" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "hours" TEXT,
    "public" BOOLEAN NOT NULL DEFAULT true,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_numbers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "public_notices" (
    "id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "severity" "PublicNoticeSeverity" NOT NULL DEFAULT 'INFO',
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endsAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_notices_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "emergency_intake_policies_organizationId_branchId_key" ON "emergency_intake_policies"("organizationId", "branchId");

-- CreateIndex
CREATE INDEX "emergency_intake_policies_organizationId_branchId_enabled_idx" ON "emergency_intake_policies"("organizationId", "branchId", "enabled");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_contacts_organizationId_branchId_order_key" ON "emergency_contacts"("organizationId", "branchId", "order");

-- CreateIndex
CREATE INDEX "emergency_contacts_organizationId_branchId_active_idx" ON "emergency_contacts"("organizationId", "branchId", "active");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_requests_trackingTokenHash_key" ON "emergency_requests"("trackingTokenHash");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_requests_organizationId_referenceNumber_key" ON "emergency_requests"("organizationId", "referenceNumber");

-- CreateIndex
CREATE INDEX "emergency_requests_organizationId_status_createdAt_idx" ON "emergency_requests"("organizationId", "status", "createdAt");

-- CreateIndex
CREATE INDEX "emergency_requests_organizationId_branchId_createdAt_idx" ON "emergency_requests"("organizationId", "branchId", "createdAt");

-- CreateIndex
CREATE INDEX "emergency_request_events_requestId_occurredAt_idx" ON "emergency_request_events"("requestId", "occurredAt");

-- CreateIndex
CREATE INDEX "emergency_request_events_organizationId_type_occurredAt_idx" ON "emergency_request_events"("organizationId", "type", "occurredAt");

-- CreateIndex
CREATE INDEX "emergency_numbers_country_purpose_public_idx" ON "emergency_numbers"("country", "purpose", "public");

-- CreateIndex
CREATE INDEX "public_notices_active_startsAt_endsAt_idx" ON "public_notices"("active", "startsAt", "endsAt");

-- AddForeignKey
ALTER TABLE "emergency_intake_policies" ADD CONSTRAINT "emergency_intake_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_intake_policies" ADD CONSTRAINT "emergency_intake_policies_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_contacts" ADD CONSTRAINT "emergency_contacts_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_requests" ADD CONSTRAINT "emergency_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_request_events" ADD CONSTRAINT "emergency_request_events_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_request_events" ADD CONSTRAINT "emergency_request_events_requestId_fkey" FOREIGN KEY ("requestId") REFERENCES "emergency_requests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
-- Append-only request history (ADR-040): the escalation worker may always
-- re-write level timestamps, but the event stream itself rejects UPDATE/DELETE
-- exactly like audit_logs (ADR-008 pattern).
CREATE OR REPLACE FUNCTION emergency_request_events_guard() RETURNS trigger
AS $$
BEGIN
  RAISE EXCEPTION 'emergency_request_events are append-only; UPDATE/DELETE are prohibited (row %)',
    OLD.id USING ERRCODE = '55000';
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER emergency_request_events_append_only
  BEFORE UPDATE OR DELETE ON "emergency_request_events"
  FOR EACH ROW EXECUTE FUNCTION emergency_request_events_guard();
