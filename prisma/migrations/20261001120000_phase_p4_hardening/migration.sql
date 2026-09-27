-- Phase P4 hardening (ADR-043: escalation reconciliation + retention).
-- Retention sweeps stamp `retainedAt` so PII anonymization is idempotent, and
-- add a `RETENTION` read model event to the append-only history.

ALTER TABLE "emergency_requests" ADD COLUMN "retainedAt" TIMESTAMP(3);

CREATE INDEX "emergency_requests_status_retainedAt_idx"
  ON "emergency_requests"("status", "retainedAt");

ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'RETENTION';