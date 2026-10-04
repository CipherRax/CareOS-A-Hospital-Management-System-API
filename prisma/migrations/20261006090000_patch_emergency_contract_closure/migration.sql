-- Patch closure for the brief §6.14 / §6.15 contracts.
--
-- 1. Emergency request contract: caller-stated category, consent capture,
--    tracking-token expiry, idempotency key, callback/flag/merge bookkeeping,
--    the full status set, and the staff action event types.
-- 2. Intake enable guard inputs: policy SLA/ambulance/area/copy, contacts that
--    can resolve to a staff user and be marked on-call.
-- 3. Directory: spoken languages, and a PostGIS geography point with a GiST
--    index so proximity search is index-assisted instead of a full scan.
-- 4. A read-only `careos_public` role with SELECT-only access to the public
--    projection tables (deny-by-default for everything else).
--
-- All of it is additive and idempotent where Postgres allows.

-- ---------------------------------------------------------------------------
-- 1. Enums
-- ---------------------------------------------------------------------------

ALTER TYPE "EmergencyRequestStatus" ADD VALUE IF NOT EXISTS 'CONTACTED';
ALTER TYPE "EmergencyRequestStatus" ADD VALUE IF NOT EXISTS 'REDIRECTED';
ALTER TYPE "EmergencyRequestStatus" ADD VALUE IF NOT EXISTS 'UNREACHABLE';
ALTER TYPE "EmergencyRequestStatus" ADD VALUE IF NOT EXISTS 'DUPLICATE';
ALTER TYPE "EmergencyRequestStatus" ADD VALUE IF NOT EXISTS 'NOT_ACTIONABLE';

ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'NOTE';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'CALLBACK';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'STATUS_CHANGED';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'CALLER_UPDATED';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'MERGED';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'LINKED_ARRIVAL';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'DUPLICATE';
ALTER TYPE "EmergencyRequestEventType" ADD VALUE IF NOT EXISTS 'FLAGGED';

DO $$ BEGIN
  CREATE TYPE "EmergencyCallerCategory" AS ENUM (
    'NOT_SURE', 'BREATHING_DIFFICULTY', 'SEVERE_INJURY', 'UNCONSCIOUS',
    'CHEST_PAIN', 'HEAVY_BLEEDING', 'OTHER'
  );
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmergencyPreferredContact" AS ENUM ('PHONE', 'SMS');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  CREATE TYPE "EmergencyLocationSource" AS ENUM ('NONE', 'DEVICE_GPS', 'MANUAL');
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 2. Intake policy + contact guard inputs
-- ---------------------------------------------------------------------------

ALTER TABLE "emergency_intake_policies"
  ADD COLUMN IF NOT EXISTS "ackSlaSeconds" INTEGER,
  ADD COLUMN IF NOT EXISTS "ambulanceAvailable" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "serviceArea" TEXT,
  ADD COLUMN IF NOT EXISTS "autoReplyTemplate" TEXT;

-- A contact can be a phone line, a staff user, or both. Phone becomes
-- nullable so a contact may point at a User as the source of truth.
ALTER TABLE "emergency_contacts" ALTER COLUMN "phone" DROP NOT NULL;
ALTER TABLE "emergency_contacts" ADD COLUMN IF NOT EXISTS "userId" TEXT;
ALTER TABLE "emergency_contacts" ADD COLUMN IF NOT EXISTS "onCall" BOOLEAN NOT NULL DEFAULT true;

DO $$ BEGIN
  ALTER TABLE "emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_contact_channel_chk"
    CHECK (phone IS NOT NULL OR "userId" IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "emergency_contacts_org_branch_active_oncall_idx"
  ON "emergency_contacts"("organizationId", "branchId", "active", "onCall");

DO $$ BEGIN
  ALTER TABLE "emergency_contacts"
    ADD CONSTRAINT "emergency_contacts_user_fk"
    FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- ---------------------------------------------------------------------------
-- 3. Emergency request columns
-- ---------------------------------------------------------------------------

ALTER TABLE "emergency_requests"
  ADD COLUMN IF NOT EXISTS "trackingTokenExpiresAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "clientRequestId" TEXT,
  ADD COLUMN IF NOT EXISTS "locationAccuracyM" DOUBLE PRECISION,
  ADD COLUMN IF NOT EXISTS "locationSource" "EmergencyLocationSource" NOT NULL DEFAULT 'NONE',
  ADD COLUMN IF NOT EXISTS "callerCategory" "EmergencyCallerCategory" NOT NULL DEFAULT 'NOT_SURE',
  ADD COLUMN IF NOT EXISTS "forSelf" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "peopleCount" INTEGER NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "preferredContact" "EmergencyPreferredContact" NOT NULL DEFAULT 'PHONE',
  ADD COLUMN IF NOT EXISTS "locale" TEXT,
  ADD COLUMN IF NOT EXISTS "consentVersion" TEXT,
  ADD COLUMN IF NOT EXISTS "consentAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "flagged" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "flagReason" TEXT,
  ADD COLUMN IF NOT EXISTS "statusReason" TEXT,
  ADD COLUMN IF NOT EXISTS "firstCallbackAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "mergedCount" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS "mergedIntoId" TEXT;

-- peopleCount is a count of people at the scene, never a clinical weight.
ALTER TABLE "emergency_requests"
  DROP CONSTRAINT IF EXISTS "emergency_requests_people_count_chk";
ALTER TABLE "emergency_requests"
  ADD CONSTRAINT "emergency_requests_people_count_chk"
  CHECK ("peopleCount" >= 1 AND "peopleCount" <= 100);

-- Merges point at the canonical request; self-referential and SET NULL so
-- anonymizing the target never cascades.
DO $$ BEGIN
  ALTER TABLE "emergency_requests"
    ADD CONSTRAINT "emergency_requests_merged_into_fk"
    FOREIGN KEY ("mergedIntoId") REFERENCES "emergency_requests"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Idempotency key is unique per org. NULLs are not equal in Postgres, so
-- requests submitted without a clientRequestId stay unconstrained.
CREATE UNIQUE INDEX IF NOT EXISTS "emergency_requests_org_client_request_key"
  ON "emergency_requests"("organizationId", "clientRequestId");

CREATE INDEX IF NOT EXISTS "emergency_requests_org_branch_status_idx"
  ON "emergency_requests"("organizationId", "branchId", "status");

-- Duplicate detection: same phone + same branch inside the recent window.
CREATE INDEX IF NOT EXISTS "emergency_requests_org_branch_phone_idx"
  ON "emergency_requests"("organizationId", "branchId", "callerPhoneIndex", "createdAt" DESC);

-- ---------------------------------------------------------------------------
-- 4. ED arrival link
-- ---------------------------------------------------------------------------

ALTER TABLE "emergency_visits" ADD COLUMN IF NOT EXISTS "emergencyRequestId" TEXT;

DO $$ BEGIN
  ALTER TABLE "emergency_visits"
    ADD CONSTRAINT "emergency_visits_emergency_request_fk"
    FOREIGN KEY ("emergencyRequestId") REFERENCES "emergency_requests"("id") ON DELETE SET NULL;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

CREATE INDEX IF NOT EXISTS "emergency_visits_org_emergency_request_idx"
  ON "emergency_visits"("organizationId", "emergencyRequestId");

-- ---------------------------------------------------------------------------
-- 5. Emergency number verification flag
-- ---------------------------------------------------------------------------

ALTER TABLE "emergency_numbers"
  ADD COLUMN IF NOT EXISTS "verified" BOOLEAN NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS "note" TEXT,
  -- Brief §6.15 names channel/active/verifiedAt. `active` retires a number
  -- from the caller surface without deleting its audit trail.
  ADD COLUMN IF NOT EXISTS "channel" TEXT NOT NULL DEFAULT 'VOICE',
  ADD COLUMN IF NOT EXISTS "active" BOOLEAN NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "emergency_numbers_country_purpose_active_idx"
  ON "emergency_numbers"("country", "purpose", "active");

-- ---------------------------------------------------------------------------
-- 5b. On-call windows (brief §6.15)
-- ---------------------------------------------------------------------------

-- Per-shift availability so escalation does not depend on someone remembering to
-- flip a boolean at handover. JSONB array of {day,start,end} in facility-local
-- time; NULL or empty means always on call.
ALTER TABLE "emergency_contacts"
  ADD COLUMN IF NOT EXISTS "onCallWindows" JSONB;

-- Brief §6.14: published notices carry reviewer provenance. Deliberately ships
-- with no rows; the default notice is generated in application code, not seeded
-- into this table, so no unreviewed operator copy can reach a caller.
ALTER TABLE "public_notices"
  ADD COLUMN IF NOT EXISTS "reviewedBy" TEXT,
  ADD COLUMN IF NOT EXISTS "reviewedAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 6. Directory: languages + PostGIS geography point
-- ---------------------------------------------------------------------------

ALTER TABLE "public_facility_listings" ADD COLUMN IF NOT EXISTS "languages" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- PostGIS is optional. When the extension is available we add a real
-- `geography(Point,4326)` column with a GiST index so ST_DWithin is
-- index-assisted; the application probes for the column and falls back to a
-- haversine scan when it is absent (ADR-039).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_available_extensions WHERE name = 'postgis') THEN
    BEGIN
      CREATE EXTENSION IF NOT EXISTS postgis;
    EXCEPTION WHEN insufficient_privilege OR undefined_file THEN
      RAISE NOTICE 'postgis present but not installable by this role; skipping geography column';
    END;
  END IF;

  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'postgis') THEN
    BEGIN
      ALTER TABLE "public_facility_listings"
        ADD COLUMN IF NOT EXISTS "location" geography(Point,4326);
      UPDATE "public_facility_listings"
      SET "location" = ST_SetSRID(ST_MakePoint("locationLng", "locationLat"), 4326)::geography
      WHERE "locationLat" IS NOT NULL AND "locationLng" IS NOT NULL;
      CREATE INDEX IF NOT EXISTS "public_facility_listings_location_gist_idx"
        ON "public_facility_listings" USING GIST ("location");
    EXCEPTION WHEN insufficient_privilege OR undefined_function THEN
      RAISE NOTICE 'postgis usable but geography column could not be created; app will use the haversine fallback';
    END;
  END IF;
END
$$;

-- ---------------------------------------------------------------------------
-- 7. Read-only public projection role
-- ---------------------------------------------------------------------------
--
-- Deny-by-default: the role can SELECT only the cross-tenant public projection
-- tables and reference data. It has no INSERT/UPDATE/DELETE anywhere and no
-- access to tenant tables (which hold PHI). Provisioned with a placeholder
-- password — operators must rotate it before use.
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'careos_public') THEN
    CREATE ROLE careos_public WITH LOGIN PASSWORD '__CHANGE_ME__';
  END IF;
END
$$;

GRANT USAGE ON SCHEMA public TO careos_public;
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM careos_public;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM careos_public;

-- Public projections + reference data only. NOTE: RLS-enabled tables (see
-- init migration) additionally require app.current_org, which this role never
-- sets — that is intentional: these tables are cross-tenant by design and are
-- NOT row-level-scoped.
GRANT SELECT ON
  "public_facility_listings",
  "emergency_numbers",
  "public_notices"
TO careos_public;

-- Deny by default for any future public projection table until it is granted
-- explicitly here, rather than relying on a blanket default privilege.
ALTER DEFAULT PRIVILEGES IN SCHEMA public REVOKE ALL ON TABLES FROM careos_public;
-- ---------------------------------------------------------------------------
-- 7. Display token rotation overlap (brief §5.16)
-- ---------------------------------------------------------------------------

-- Rotation is not instantaneous for the device: a screen redeploying during the
-- handover would otherwise present a token the new build has already discarded.
-- The outgoing digest is retained for a bounded window and checked alongside the
-- current one by DeviceAuthGuard. Only one generation is retained, and both are
-- cleared on revoke/re-pair.
ALTER TABLE "display_devices"
  ADD COLUMN IF NOT EXISTS "previousTokenHash" TEXT,
  ADD COLUMN IF NOT EXISTS "previousTokenExpiresAt" TIMESTAMP(3);

-- ---------------------------------------------------------------------------
-- 8. Retention for every finished disposition (ADR-055)
-- ---------------------------------------------------------------------------

-- The sweep previously matched only CLOSED/CANCELLED via closedAt/cancelledAt.
-- UNREACHABLE / REDIRECTED / NOT_ACTIONABLE never wrote a terminal timestamp and
-- DUPLICATE wrote closedAt while carrying a non-matching status, so all four
-- kept encrypted caller PII indefinitely. `dispositionAt` is deliberately separate
-- from `closedAt`: those states are finished for the facility but are not
-- "closed", and `closedAt` is reported as such to staff.
ALTER TABLE "emergency_requests"
  ADD COLUMN IF NOT EXISTS "dispositionAt" TIMESTAMP(3);

-- Backfill so rows written before this column existed are reaped on schedule
-- rather than being stranded forever. DUPLICATE rows already carry closedAt;
-- the other three fall back to their last write time.
UPDATE "emergency_requests"
SET "dispositionAt" = COALESCE("closedAt", "cancelledAt", "updatedAt")
WHERE "dispositionAt" IS NULL
  AND "retainedAt" IS NULL
  AND "status" IN ('CLOSED', 'CANCELLED', 'UNREACHABLE', 'REDIRECTED', 'NOT_ACTIONABLE', 'DUPLICATE');

CREATE INDEX IF NOT EXISTS "emergency_requests_disposition_retention_idx"
  ON "emergency_requests"("dispositionAt")
  WHERE "retainedAt" IS NULL;

-- ---------------------------------------------------------------------------
-- 9. Stale display device alerting (brief §5.16)
-- ---------------------------------------------------------------------------

-- A paired screen that stops checking in is almost always offline, and a
-- waiting-room board that silently stops updating is worse than one that says
-- it is stale. `staleNotifiedAt` records that an operator has already been told,
-- so the sweep alerts once per outage instead of on every tick.
ALTER TABLE "display_devices"
  ADD COLUMN IF NOT EXISTS "staleNotifiedAt" TIMESTAMP(3);

CREATE INDEX IF NOT EXISTS "display_devices_stale_sweep_idx"
  ON "display_devices"("lastSeenAt")
  WHERE "status" = 'ACTIVE' AND "staleNotifiedAt" IS NULL;
