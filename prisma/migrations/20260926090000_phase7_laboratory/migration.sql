-- CreateEnum
CREATE TYPE "LabTestFieldType" AS ENUM ('NUMERIC', 'TEXT', 'CATEGORICAL');

-- CreateEnum
CREATE TYPE "LabOrderStatus" AS ENUM ('ORDERED', 'COLLECTED', 'RECEIVED', 'PROCESSING', 'RESULT_READY', 'VERIFIED', 'RELEASED', 'REJECTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "LabSampleStatus" AS ENUM ('ORDERED', 'COLLECTED', 'RECEIVED', 'PROCESSING', 'COMPLETED', 'REJECTED');

-- CreateEnum
CREATE TYPE "LabSampleType" AS ENUM ('BLOOD', 'URINE', 'STOOL', 'SWAB', 'SPUTUM', 'TISSUE', 'FLUID', 'OTHER');

-- CreateEnum
CREATE TYPE "LabOrderPriority" AS ENUM ('ROUTINE', 'URGENT', 'STAT');

-- CreateEnum
CREATE TYPE "RadiologyOrderStatus" AS ENUM ('ORDERED', 'SCHEDULED', 'PERFORMED', 'REPORTED', 'VERIFIED', 'RELEASED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ImagingModality" AS ENUM ('XRAY', 'CT', 'MRI', 'ULTRASOUND', 'MAMMOGRAPHY', 'DEXA', 'FLUOROSCOPY', 'OTHER');

-- CreateTable
CREATE TABLE "lab_test_categories" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_test_categories_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_tests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "categoryId" TEXT,
    "sampleType" "LabSampleType" NOT NULL DEFAULT 'OTHER',
    "specimenInstructions" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_tests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_test_fields" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "fieldType" "LabTestFieldType" NOT NULL DEFAULT 'NUMERIC',
    "unit" TEXT,
    "referenceMin" DECIMAL(12,4),
    "referenceMax" DECIMAL(12,4),
    "criticalMin" DECIMAL(12,4),
    "criticalMax" DECIMAL(12,4),
    "allowsValues" TEXT,
    "displayOrder" INTEGER NOT NULL DEFAULT 0,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_test_fields_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "encounterId" TEXT,
    "status" "LabOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "priority" "LabOrderPriority" NOT NULL DEFAULT 'ROUTINE',
    "clinicalNotes" TEXT,
    "orderedById" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "rejectionReason" TEXT,
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_order_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "testId" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_order_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_samples" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "sampleNumber" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "sampleType" "LabSampleType" NOT NULL DEFAULT 'BLOOD',
    "status" "LabSampleStatus" NOT NULL DEFAULT 'ORDERED',
    "collectedById" TEXT,
    "collectedAt" TIMESTAMP(3),
    "receivedById" TEXT,
    "receivedAt" TIMESTAMP(3),
    "processingById" TEXT,
    "processingAt" TIMESTAMP(3),
    "completedById" TEXT,
    "completedAt" TIMESTAMP(3),
    "rejectedAt" TIMESTAMP(3),
    "rejectedReason" TEXT,
    "recollectsFromOrderId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_samples_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderItemId" TEXT NOT NULL,
    "testFieldId" TEXT NOT NULL,
    "currentVersion" INTEGER NOT NULL DEFAULT 1,
    "value" TEXT NOT NULL,
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "lab_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "lab_result_versions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "revisionNumber" INTEGER NOT NULL DEFAULT 1,
    "value" TEXT NOT NULL,
    "isAbnormal" BOOLEAN NOT NULL DEFAULT false,
    "isCritical" BOOLEAN NOT NULL DEFAULT false,
    "enteredById" TEXT,
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "amended" BOOLEAN NOT NULL DEFAULT false,
    "reason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "lab_result_versions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "critical_results" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "resultId" TEXT NOT NULL,
    "notifiedToId" TEXT NOT NULL,
    "notifiedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "acknowledgedById" TEXT,
    "acknowledgedAt" TIMESTAMP(3),
    "escalationAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "critical_results_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "radiology_orders" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderNumber" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "encounterId" TEXT,
    "modality" "ImagingModality" NOT NULL DEFAULT 'OTHER',
    "region" TEXT,
    "status" "RadiologyOrderStatus" NOT NULL DEFAULT 'ORDERED',
    "clinicalNotes" TEXT,
    "orderedById" TEXT,
    "orderedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "requestedAt" TIMESTAMP(3),
    "performedById" TEXT,
    "performedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelledReason" TEXT,
    "releasedById" TEXT,
    "releasedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "radiology_orders_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "imaging_reports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "orderId" TEXT NOT NULL,
    "findings" TEXT,
    "summary" TEXT,
    "impression" TEXT,
    "enteredById" TEXT,
    "enteredAt" TIMESTAMP(3),
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 1,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "imaging_reports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "lab_test_categories_organizationId_isActive_idx" ON "lab_test_categories"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "lab_test_categories_organizationId_name_key" ON "lab_test_categories"("organizationId", "name");

-- CreateIndex
CREATE INDEX "lab_tests_organizationId_name_idx" ON "lab_tests"("organizationId", "name");

-- CreateIndex
CREATE INDEX "lab_tests_organizationId_categoryId_isActive_idx" ON "lab_tests"("organizationId", "categoryId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "lab_tests_organizationId_code_key" ON "lab_tests"("organizationId", "code");

-- CreateIndex
CREATE INDEX "lab_test_fields_organizationId_testId_isActive_idx" ON "lab_test_fields"("organizationId", "testId", "isActive");

-- CreateIndex
CREATE INDEX "lab_orders_organizationId_patientId_createdAt_idx" ON "lab_orders"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "lab_orders_organizationId_branchId_status_createdAt_idx" ON "lab_orders"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "lab_orders_organizationId_orderNumber_key" ON "lab_orders"("organizationId", "orderNumber");

-- CreateIndex
CREATE INDEX "lab_order_items_organizationId_orderId_idx" ON "lab_order_items"("organizationId", "orderId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_order_items_organizationId_orderId_testId_key" ON "lab_order_items"("organizationId", "orderId", "testId");

-- CreateIndex
CREATE INDEX "lab_samples_organizationId_orderId_idx" ON "lab_samples"("organizationId", "orderId");

-- CreateIndex
CREATE INDEX "lab_samples_organizationId_patientId_createdAt_idx" ON "lab_samples"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "lab_samples_organizationId_status_idx" ON "lab_samples"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "lab_samples_organizationId_sampleNumber_key" ON "lab_samples"("organizationId", "sampleNumber");

-- CreateIndex
CREATE INDEX "lab_results_organizationId_testFieldId_idx" ON "lab_results"("organizationId", "testFieldId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_results_organizationId_orderItemId_testFieldId_key" ON "lab_results"("organizationId", "orderItemId", "testFieldId");

-- CreateIndex
CREATE INDEX "lab_result_versions_organizationId_resultId_idx" ON "lab_result_versions"("organizationId", "resultId");

-- CreateIndex
CREATE UNIQUE INDEX "lab_result_versions_organizationId_resultId_revisionNumber_key" ON "lab_result_versions"("organizationId", "resultId", "revisionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "critical_results_resultId_key" ON "critical_results"("resultId");

-- CreateIndex
CREATE INDEX "critical_results_organizationId_resultId_idx" ON "critical_results"("organizationId", "resultId");

-- CreateIndex
CREATE INDEX "critical_results_organizationId_acknowledgedById_acknowledg_idx" ON "critical_results"("organizationId", "acknowledgedById", "acknowledgedAt");

-- CreateIndex
CREATE INDEX "radiology_orders_organizationId_patientId_createdAt_idx" ON "radiology_orders"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "radiology_orders_organizationId_branchId_status_createdAt_idx" ON "radiology_orders"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "radiology_orders_organizationId_orderNumber_key" ON "radiology_orders"("organizationId", "orderNumber");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_reports_orderId_key" ON "imaging_reports"("orderId");

-- CreateIndex
CREATE UNIQUE INDEX "imaging_reports_organizationId_orderId_key" ON "imaging_reports"("organizationId", "orderId");

-- AddForeignKey
ALTER TABLE "lab_test_categories" ADD CONSTRAINT "lab_test_categories_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_tests" ADD CONSTRAINT "lab_tests_categoryId_fkey" FOREIGN KEY ("categoryId") REFERENCES "lab_test_categories"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_fields" ADD CONSTRAINT "lab_test_fields_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_test_fields" ADD CONSTRAINT "lab_test_fields_testId_fkey" FOREIGN KEY ("testId") REFERENCES "lab_tests"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_orders" ADD CONSTRAINT "lab_orders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_order_items" ADD CONSTRAINT "lab_order_items_testId_fkey" FOREIGN KEY ("testId") REFERENCES "lab_tests"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "lab_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_samples" ADD CONSTRAINT "lab_samples_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_orderItemId_fkey" FOREIGN KEY ("orderItemId") REFERENCES "lab_order_items"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_results" ADD CONSTRAINT "lab_results_testFieldId_fkey" FOREIGN KEY ("testFieldId") REFERENCES "lab_test_fields"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_versions" ADD CONSTRAINT "lab_result_versions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "lab_result_versions" ADD CONSTRAINT "lab_result_versions_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "lab_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "critical_results" ADD CONSTRAINT "critical_results_resultId_fkey" FOREIGN KEY ("resultId") REFERENCES "lab_results"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_orders" ADD CONSTRAINT "radiology_orders_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_orders" ADD CONSTRAINT "radiology_orders_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "radiology_orders" ADD CONSTRAINT "radiology_orders_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "imaging_reports" ADD CONSTRAINT "imaging_reports_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "radiology_orders"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Tenant isolation (RLS) for Phase 7 laboratory & radiology tables
ALTER TABLE "lab_test_categories" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_tests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_test_fields" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_order_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_samples" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "lab_result_versions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "critical_results" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "radiology_orders" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "imaging_reports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_lab_test_categories ON "lab_test_categories"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_tests ON "lab_tests"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_test_fields ON "lab_test_fields"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_orders ON "lab_orders"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_order_items ON "lab_order_items"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_samples ON "lab_samples"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_results ON "lab_results"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_lab_result_versions ON "lab_result_versions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_critical_results ON "critical_results"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_radiology_orders ON "radiology_orders"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_imaging_reports ON "imaging_reports"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "lab_test_categories", "lab_tests",
  "lab_test_fields", "lab_orders", "lab_order_items", "lab_samples",
  "lab_results", "lab_result_versions", "critical_results",
  "radiology_orders", "imaging_reports"
  TO careos_app;

