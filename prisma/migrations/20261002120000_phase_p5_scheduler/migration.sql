-- Phase P5 scheduler (ADR-044: one time-based worker for outbox drain + sweeps).
-- The export-expiry sweep scans `status = 'READY' AND expiresAt <= now()`, so the
-- (status, expiresAt) index is what keeps that a bounded index scan. The
-- idempotency-record sweep already rides the existing `idempotency_records_expiresAt_idx`.

CREATE INDEX "report_exports_status_expiresAt_idx"
  ON "report_exports"("status", "expiresAt");
