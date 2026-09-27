-- Phase P2 (public facility directory, brief §6.14; ADR-038/039):
-- * PublicFacilityListing -- CROSS-TENANT sanitized projection of published
--   branch/directory listings for anonymous consumers. NOT covered by the
--   tenant extension; sourceOrganizationId/sourceBranchId are inert pointers.
-- * ImportedFacility -- ingested rows from the facility-directory CSV feed
--   (partner:false stand-ins until a facility is confirmed into a listing).
-- * OnboardingInquiry -- public suggestions/listings corrections. Contact
--   details are submitter reachability only; no coordinates are stored.

-- CreateEnum
CREATE TYPE "PublicListingStatus" AS ENUM ('DRAFT', 'PUBLISHED', 'SUSPENDED');

-- CreateEnum
CREATE TYPE "PublicVerificationStatus" AS ENUM ('UNVERIFIED', 'DETAILS_CONFIRMED');

-- CreateEnum
CREATE TYPE "OnboardingInquiryKind" AS ENUM ('FACILITY_SUGGESTION', 'LISTING_CORRECTION', 'ONBOARDING_REQUEST');

-- CreateEnum
CREATE TYPE "OnboardingInquiryStatus" AS ENUM ('PENDING', 'REVIEWED');

-- CreateTable
CREATE TABLE "public_facility_listings" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "summary" TEXT,
    "description" TEXT,
    "address" TEXT,
    "county" TEXT,
    "town" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "timezone" TEXT NOT NULL DEFAULT 'Africa/Nairobi',
    "hours" JSONB,
    "departments" JSONB,
    "insurance" TEXT[],
    "accessibility" TEXT[],
    "services" JSONB,
    "feeNote" JSONB,
    "open24h" BOOLEAN NOT NULL DEFAULT false,
    "emergency24h" BOOLEAN NOT NULL DEFAULT false,
    "ambulanceAvailable" BOOLEAN NOT NULL DEFAULT false,
    "emergencyIntakeEnabled" BOOLEAN NOT NULL DEFAULT false,
    "acceptsOnlineBooking" BOOLEAN NOT NULL DEFAULT false,
    "emergencyIntakeIndex" INTEGER,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "status" "PublicListingStatus" NOT NULL DEFAULT 'DRAFT',
    "verificationStatus" "PublicVerificationStatus" NOT NULL DEFAULT 'UNVERIFIED',
    "lastConfirmedAt" TIMESTAMP(3),
    "partner" BOOLEAN NOT NULL DEFAULT true,
    "sourceOrganizationId" TEXT,
    "sourceBranchId" TEXT,
    "importedSourceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "public_facility_listings_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imported_facilities" (
    "id" TEXT NOT NULL,
    "sourceId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "address" TEXT,
    "county" TEXT,
    "town" TEXT,
    "phone" TEXT,
    "email" TEXT,
    "website" TEXT,
    "hours" JSONB,
    "locationLat" DOUBLE PRECISION,
    "locationLng" DOUBLE PRECISION,
    "provider" TEXT NOT NULL DEFAULT 'csv',
    "licence" TEXT,
    "partner" BOOLEAN NOT NULL DEFAULT false,
    "raw" JSONB,
    "importedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imported_facilities_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "onboarding_inquiries" (
    "id" TEXT NOT NULL,
    "kind" "OnboardingInquiryKind" NOT NULL DEFAULT 'FACILITY_SUGGESTION',
    "status" "OnboardingInquiryStatus" NOT NULL DEFAULT 'PENDING',
    "facilityName" TEXT,
    "address" TEXT,
    "county" TEXT,
    "town" TEXT,
    "contactName" TEXT,
    "contactEmail" TEXT,
    "contactPhone" TEXT,
    "notes" TEXT,
    "reviewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "onboarding_inquiries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "public_facility_listings_slug_key" ON "public_facility_listings"("slug");
CREATE INDEX "public_facility_listings_status_locationLat_locationLng_idx" ON "public_facility_listings"("status", "locationLat", "locationLng");
CREATE INDEX "public_facility_listings_status_county_idx" ON "public_facility_listings"("status", "county");
CREATE INDEX "public_facility_listings_status_town_idx" ON "public_facility_listings"("status", "town");
CREATE INDEX "public_facility_listings_sourceOrganizationId_sourceBranchId_idx" ON "public_facility_listings"("sourceOrganizationId", "sourceBranchId");

-- CreateIndex
CREATE UNIQUE INDEX "imported_facilities_sourceId_key" ON "imported_facilities"("sourceId");
CREATE INDEX "imported_facilities_county_town_idx" ON "imported_facilities"("county", "town");
CREATE INDEX "imported_facilities_partner_idx" ON "imported_facilities"("partner");

-- CreateIndex
CREATE INDEX "onboarding_inquiries_status_createdAt_idx" ON "onboarding_inquiries"("status", "createdAt");