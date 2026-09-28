-- Phase P6 notification delivery adapters (ADR-045).
--
-- The notification consumer used to hand every row straight to a structural
-- no-op provider once, inline: a failure was terminal after a single attempt, a
-- recipient's opt-out was never read at send time, and `to` was a raw user id
-- rather than an address. This migration gives the delivery path the state it
-- needs to be honest and retryable:
--
--  * SUPPRESSED — a terminal status for "we deliberately did not send" (opted
--    out, or no address on file). Distinct from FAILED so a suppression is never
--    counted as a provider failure or retried.
--  * nextAttemptAt — PENDING rows are due at this instant; a failed attempt
--    pushes it out along the backoff ladder. The new notification-delivery
--    sweep claims `status = 'PENDING' AND nextAttemptAt <= now()`.
--  * providerRef — the provider-side id from a confirmed send, for delivery
--    correlation.
--
-- The (status, nextAttemptAt) index keeps that sweep a bounded index scan.

ALTER TYPE "NotificationStatus" ADD VALUE 'SUPPRESSED';

ALTER TABLE "notifications" ADD COLUMN "providerRef" TEXT;

ALTER TABLE "notifications" ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

-- The schema declares nextAttemptAt as `@default(now())`, so the column needs
-- the matching database default or `prisma migrate dev` reports drift against
-- the migration history. Set before the backfill so the column is fully formed.
ALTER TABLE "notifications" ALTER COLUMN "nextAttemptAt" SET DEFAULT CURRENT_TIMESTAMP;

-- Backfill before the NOT NULL constraint: historical PENDING rows were never
-- delivered (the old path had no retry), so they are due immediately — the
-- sweep gets one delivery pass over them instead of stranding them.
UPDATE "notifications" SET "nextAttemptAt" = "createdAt" WHERE "nextAttemptAt" IS NULL;

ALTER TABLE "notifications" ALTER COLUMN "nextAttemptAt" SET NOT NULL;

CREATE INDEX "notifications_status_nextAttemptAt_idx"
  ON "notifications"("status", "nextAttemptAt");
