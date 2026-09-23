-- CreateEnum
CREATE TYPE "PatientStatus" AS ENUM ('ACTIVE', 'MERGED', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "Sex" AS ENUM ('MALE', 'FEMALE', 'OTHER');

-- CreateEnum
CREATE TYPE "GuardianRelationship" AS ENUM ('PARENT', 'SPOUSE', 'SIBLING', 'RELATIVE', 'LEGAL_GUARDIAN', 'OTHER');

-- CreateEnum
CREATE TYPE "ConsentType" AS ENUM ('DATA_PROCESSING', 'COMMUNICATIONS', 'TELEMEDICINE', 'DATA_SHARING');

-- CreateEnum
CREATE TYPE "ConsentStatus" AS ENUM ('GRANTED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AllergySeverity" AS ENUM ('MILD', 'MODERATE', 'SEVERE', 'LIFE_THREATENING');

-- CreateEnum
CREATE TYPE "AllergyStatus" AS ENUM ('ACTIVE', 'RESOLVED', 'AMENDED');

-- CreateEnum
CREATE TYPE "MedicalHistoryCategory" AS ENUM ('PAST_MEDICAL', 'SURGICAL', 'FAMILY', 'SOCIAL', 'PREVIOUS_CONDITIONS');

-- CreateEnum
CREATE TYPE "PatientAccessAction" AS ENUM ('READ', 'EXPORT');

-- CreateTable
CREATE TABLE "patients" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientNumber" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "otherNames" TEXT,
    "dateOfBirth" TIMESTAMP(3),
    "sex" "Sex",
    "phone" TEXT,
    "email" TEXT,
    "address" TEXT,
    "county" TEXT,
    "town" TEXT,
    "photoUrl" TEXT,
    "duplicateConfirmedAt" TIMESTAMP(3),
    "duplicateConfirmedBy" TEXT,
    "duplicateConfirmReason" TEXT,
    "status" "PatientStatus" NOT NULL DEFAULT 'ACTIVE',
    "mergedIntoPatientId" TEXT,
    "mergedAt" TIMESTAMP(3),
    "mergedReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patients_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "guardians" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "firstName" TEXT NOT NULL,
    "lastName" TEXT NOT NULL,
    "phone" TEXT,
    "email" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_guardians" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "guardianId" TEXT NOT NULL,
    "relationship" "GuardianRelationship" NOT NULL,
    "isPrimary" BOOLEAN NOT NULL DEFAULT false,
    "isEmergencyContact" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_guardians_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_consents" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" "ConsentType" NOT NULL,
    "status" "ConsentStatus" NOT NULL DEFAULT 'GRANTED',
    "grantedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMP(3),
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "allergies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "substance" TEXT NOT NULL,
    "reaction" TEXT,
    "severity" "AllergySeverity" NOT NULL,
    "status" "AllergyStatus" NOT NULL DEFAULT 'ACTIVE',
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "correctedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "allergies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "medical_history_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "category" "MedicalHistoryCategory" NOT NULL,
    "description" TEXT NOT NULL,
    "onsetDate" TIMESTAMP(3),
    "notes" TEXT,
    "recordedByUserId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "medical_history_entries_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_access_logs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "userId" TEXT,
    "action" "PatientAccessAction" NOT NULL DEFAULT 'READ',
    "section" TEXT NOT NULL,
    "reason" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "requestId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_access_logs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_timeline_entries" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "requiredPermission" TEXT NOT NULL,
    "actorId" TEXT,
    "payload" JSONB,
    "occurredAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "patient_timeline_entries_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "patients_organizationId_lastName_firstName_dateOfBirth_idx" ON "patients"("organizationId", "lastName", "firstName", "dateOfBirth");

-- CreateIndex
CREATE INDEX "patients_organizationId_phone_idx" ON "patients"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "patients_organizationId_email_idx" ON "patients"("organizationId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "patients_organizationId_patientNumber_key" ON "patients"("organizationId", "patientNumber");

-- CreateIndex
CREATE INDEX "guardians_organizationId_lastName_idx" ON "guardians"("organizationId", "lastName");

-- CreateIndex
CREATE UNIQUE INDEX "guardians_organizationId_phone_key" ON "guardians"("organizationId", "phone");

-- CreateIndex
CREATE INDEX "patient_guardians_organizationId_patientId_idx" ON "patient_guardians"("organizationId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_guardians_organizationId_patientId_guardianId_key" ON "patient_guardians"("organizationId", "patientId", "guardianId");

-- CreateIndex
CREATE INDEX "patient_consents_organizationId_patientId_idx" ON "patient_consents"("organizationId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_consents_organizationId_patientId_type_key" ON "patient_consents"("organizationId", "patientId", "type");

-- CreateIndex
CREATE INDEX "allergies_organizationId_patientId_idx" ON "allergies"("organizationId", "patientId");

-- CreateIndex
CREATE INDEX "medical_history_entries_organizationId_patientId_createdAt_idx" ON "medical_history_entries"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "patient_access_logs_organizationId_patientId_createdAt_idx" ON "patient_access_logs"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "patient_timeline_entries_organizationId_patientId_occurredA_idx" ON "patient_timeline_entries"("organizationId", "patientId", "occurredAt");

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patients" ADD CONSTRAINT "patients_mergedIntoPatientId_fkey" FOREIGN KEY ("mergedIntoPatientId") REFERENCES "patients"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "guardians" ADD CONSTRAINT "guardians_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_guardians" ADD CONSTRAINT "patient_guardians_guardianId_fkey" FOREIGN KEY ("guardianId") REFERENCES "guardians"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_consents" ADD CONSTRAINT "patient_consents_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "allergies" ADD CONSTRAINT "allergies_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_history_entries" ADD CONSTRAINT "medical_history_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "medical_history_entries" ADD CONSTRAINT "medical_history_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_logs" ADD CONSTRAINT "patient_access_logs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_access_logs" ADD CONSTRAINT "patient_access_logs_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_timeline_entries" ADD CONSTRAINT "patient_timeline_entries_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_timeline_entries" ADD CONSTRAINT "patient_timeline_entries_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Row-Level Security (defense in depth; mirrors init migration) --------------
ALTER TABLE "patients" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "guardians" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_guardians" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_consents" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "allergies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "medical_history_entries" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_access_logs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_timeline_entries" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_patients ON "patients"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_guardians ON "guardians"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_patient_guardians ON "patient_guardians"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_patient_consents ON "patient_consents"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_allergies ON "allergies"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_medical_history ON "medical_history_entries"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_patient_access_logs ON "patient_access_logs"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_patient_timeline ON "patient_timeline_entries"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "patients", "guardians", "patient_guardians",
  "patient_consents", "allergies", "medical_history_entries", "patient_access_logs",
  "patient_timeline_entries" TO careos_app;
