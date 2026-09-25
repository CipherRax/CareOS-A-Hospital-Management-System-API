-- CreateEnum
CREATE TYPE "BedStatus" AS ENUM ('AVAILABLE', 'OCCUPIED', 'RESERVED', 'CLEANING', 'MAINTENANCE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "AdmissionSource" AS ENUM ('EMERGENCY', 'OUTPATIENT_CLINIC', 'REFERRAL', 'PLANNED', 'DIRECT');

-- CreateEnum
CREATE TYPE "AdmissionStatus" AS ENUM ('ADMITTED', 'DISCHARGED');

-- CreateEnum
CREATE TYPE "EmergencyVisitStatus" AS ENUM ('ARRIVED', 'TRIAGED', 'ASSESSED', 'IN_TREATMENT', 'OBSERVATION', 'DISCHARGED', 'ADMITTED', 'REFERRED');

-- CreateEnum
CREATE TYPE "EmergencyPriority" AS ENUM ('RESUSCITATION', 'EMERGENT', 'URGENT', 'SEMI_URGENT', 'NON_URGENT');

-- CreateEnum
CREATE TYPE "EmergencyDisposition" AS ENUM ('ADMITTED', 'REFERRED', 'DISCHARGED');

-- CreateTable
CREATE TABLE "wards" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "code" TEXT,
    "floor" TEXT,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "wards_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "rooms" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "wardId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "rooms_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "beds" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "roomId" TEXT NOT NULL,
    "bedNumber" TEXT NOT NULL,
    "status" "BedStatus" NOT NULL DEFAULT 'AVAILABLE',
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "beds_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "bed_assignments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "bedId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "assignedById" TEXT NOT NULL,
    "assignedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "bed_assignments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "admissions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "departmentId" TEXT,
    "encounterId" TEXT,
    "source" "AdmissionSource" NOT NULL DEFAULT 'OUTPATIENT_CLINIC',
    "status" "AdmissionStatus" NOT NULL DEFAULT 'ADMITTED',
    "admittedById" TEXT,
    "admittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "expectedDischargeAt" TIMESTAMP(3),
    "provisionalDiagnosis" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "admissions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "discharges" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "admissionId" TEXT NOT NULL,
    "dischargedById" TEXT,
    "dischargedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "summary" TEXT,
    "instructions" TEXT,
    "medications" JSONB,
    "followUp" JSONB,
    "hasOutstandingBilling" BOOLEAN NOT NULL DEFAULT false,
    "documentIds" JSONB,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "discharges_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "emergency_visits" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "visitNumber" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "status" "EmergencyVisitStatus" NOT NULL DEFAULT 'ARRIVED',
    "priority" "EmergencyPriority",
    "registeredById" TEXT,
    "arrivedById" TEXT,
    "arrivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "chiefComplaint" TEXT,
    "triagedById" TEXT,
    "triagedAt" TIMESTAMP(3),
    "assessedAt" TIMESTAMP(3),
    "assessment" TEXT,
    "treatmentStartedAt" TIMESTAMP(3),
    "treatment" TEXT,
    "observedAt" TIMESTAMP(3),
    "dispositionAt" TIMESTAMP(3),
    "disposition" "EmergencyDisposition",
    "admittedAdmissionId" TEXT,
    "referredTo" TEXT,
    "referralNotes" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "emergency_visits_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "wards_organizationId_branchId_isActive_idx" ON "wards"("organizationId", "branchId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "wards_organizationId_branchId_name_key" ON "wards"("organizationId", "branchId", "name");

-- CreateIndex
CREATE INDEX "rooms_organizationId_wardId_idx" ON "rooms"("organizationId", "wardId");

-- CreateIndex
CREATE UNIQUE INDEX "rooms_organizationId_wardId_name_key" ON "rooms"("organizationId", "wardId", "name");

-- CreateIndex
CREATE INDEX "beds_organizationId_roomId_status_idx" ON "beds"("organizationId", "roomId", "status");

-- CreateIndex
CREATE INDEX "beds_organizationId_status_idx" ON "beds"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "beds_organizationId_roomId_bedNumber_key" ON "beds"("organizationId", "roomId", "bedNumber");

-- CreateIndex
CREATE INDEX "bed_assignments_organizationId_bedId_releasedAt_idx" ON "bed_assignments"("organizationId", "bedId", "releasedAt");

-- CreateIndex
CREATE INDEX "bed_assignments_organizationId_admissionId_assignedAt_idx" ON "bed_assignments"("organizationId", "admissionId", "assignedAt");

-- CreateIndex
CREATE INDEX "admissions_organizationId_patientId_admittedAt_idx" ON "admissions"("organizationId", "patientId", "admittedAt");

-- CreateIndex
CREATE INDEX "admissions_organizationId_branchId_status_admittedAt_idx" ON "admissions"("organizationId", "branchId", "status", "admittedAt");

-- CreateIndex
CREATE UNIQUE INDEX "admissions_organizationId_admissionNumber_key" ON "admissions"("organizationId", "admissionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "discharges_admissionId_key" ON "discharges"("admissionId");

-- CreateIndex
CREATE INDEX "discharges_organizationId_dischargedAt_idx" ON "discharges"("organizationId", "dischargedAt");

-- CreateIndex
CREATE UNIQUE INDEX "discharges_organizationId_admissionId_key" ON "discharges"("organizationId", "admissionId");

-- CreateIndex
CREATE INDEX "emergency_visits_organizationId_branchId_status_arrivedAt_idx" ON "emergency_visits"("organizationId", "branchId", "status", "arrivedAt");

-- CreateIndex
CREATE INDEX "emergency_visits_organizationId_patientId_arrivedAt_idx" ON "emergency_visits"("organizationId", "patientId", "arrivedAt");

-- CreateIndex
CREATE UNIQUE INDEX "emergency_visits_organizationId_visitNumber_key" ON "emergency_visits"("organizationId", "visitNumber");

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "wards" ADD CONSTRAINT "wards_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "rooms" ADD CONSTRAINT "rooms_wardId_fkey" FOREIGN KEY ("wardId") REFERENCES "wards"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "beds" ADD CONSTRAINT "beds_roomId_fkey" FOREIGN KEY ("roomId") REFERENCES "rooms"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_bedId_fkey" FOREIGN KEY ("bedId") REFERENCES "beds"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_assignedById_fkey" FOREIGN KEY ("assignedById") REFERENCES "users"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "bed_assignments" ADD CONSTRAINT "bed_assignments_releasedById_fkey" FOREIGN KEY ("releasedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "admissions" ADD CONSTRAINT "admissions_admittedById_fkey" FOREIGN KEY ("admittedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharges" ADD CONSTRAINT "discharges_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharges" ADD CONSTRAINT "discharges_admissionId_fkey" FOREIGN KEY ("admissionId") REFERENCES "admissions"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "discharges" ADD CONSTRAINT "discharges_dischargedById_fkey" FOREIGN KEY ("dischargedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_visits" ADD CONSTRAINT "emergency_visits_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_visits" ADD CONSTRAINT "emergency_visits_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "emergency_visits" ADD CONSTRAINT "emergency_visits_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- One-bed-one-patient (brief §7, §6.9): at most ONE active assignment per bed.
-- Prisma cannot declare partial indexes, so this is created here; the service
-- also row-locks the bed (FOR UPDATE) before assigning. A second concurrent
-- insert for the same bed violates this unique partial index (P2002) and is
-- surfaced as BED_UNAVAILABLE.
CREATE UNIQUE INDEX "bed_assignments_active_bed_uidx"
  ON "bed_assignments"("organizationId", "bedId")
  WHERE "releasedAt" IS NULL;

-- Tenant isolation (RLS) for Phase 8 inpatient & emergency tables
ALTER TABLE "wards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "beds" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "bed_assignments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "admissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "discharges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "emergency_visits" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_wards ON "wards"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_rooms ON "rooms"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_beds ON "beds"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_bed_assignments ON "bed_assignments"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_admissions ON "admissions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_discharges ON "discharges"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_emergency_visits ON "emergency_visits"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "wards", "rooms", "beds",
  "bed_assignments", "admissions", "discharges", "emergency_visits"
  TO careos_app;
