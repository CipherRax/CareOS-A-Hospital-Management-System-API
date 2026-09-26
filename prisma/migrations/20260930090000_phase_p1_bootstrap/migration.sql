-- Phase P1 (session bootstrap + display devices):
-- * Organization.featureFlags -- product UI toggles surfaced via /auth/me
--   (never an authorization grant, ADR-042).
-- * User passwordChangeRequired / mfaEnrolmentRequired -- security-staging
--   flags surfaced by /auth/me for UI banners (never consulted by guards).
-- * UserPreference -- per-user UI preferences (locale, density, default
--   branch). defaultBranchId is only honoured while the user still holds that
--   branch (ADR-042).

-- AlterTable
ALTER TABLE "Organization" ADD COLUMN "featureFlags" JSONB;

-- AlterTable
ALTER TABLE "users" ADD COLUMN "mfaEnrolmentRequired" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "users" ADD COLUMN "passwordChangeRequired" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "user_preferences" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "locale" TEXT,
    "density" TEXT,
    "defaultBranchId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "user_preferences_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "user_preferences_userId_key" ON "user_preferences"("userId");
CREATE INDEX "user_preferences_organizationId_idx" ON "user_preferences"("organizationId");

-- AddForeignKey
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "user_preferences" ADD CONSTRAINT "user_preferences_defaultBranchId_fkey" FOREIGN KEY ("defaultBranchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;