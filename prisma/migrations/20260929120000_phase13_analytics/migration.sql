-- CreateEnum
CREATE TYPE "ReconciliationExceptionType" AS ENUM ('ENCOUNTER_WITHOUT_INVOICE', 'INVOICE_TOTAL_MISMATCH', 'PAYMENT_APPLICATION_MISMATCH', 'OVERPAID_INVOICE', 'REFUND_WITHOUT_PAYMENT', 'CLAIM_PAYMENT_MISMATCH');

-- CreateEnum
CREATE TYPE "ReconciliationExceptionSeverity" AS ENUM ('LOW', 'MEDIUM', 'HIGH');

-- CreateEnum
CREATE TYPE "ReconciliationExceptionStatus" AS ENUM ('OPEN', 'ACKNOWLEDGED', 'RESOLVED');

-- CreateEnum
CREATE TYPE "ReportType" AS ENUM ('PATIENT', 'APPOINTMENT', 'CLINICAL_OPERATIONS', 'LABORATORY', 'PHARMACY', 'FINANCIAL', 'INSURANCE', 'OPERATIONS');

-- CreateEnum
CREATE TYPE "ReportFormat" AS ENUM ('JSON', 'CSV', 'PDF');

-- CreateEnum
CREATE TYPE "ReportExportStatus" AS ENUM ('PENDING', 'READY', 'FAILED', 'EXPIRED');

-- CreateTable
CREATE TABLE "daily_rollups" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL DEFAULT '',
    "departmentId" TEXT NOT NULL DEFAULT '',
    "date" TIMESTAMP(3) NOT NULL,
    "visitsRegistered" INTEGER NOT NULL DEFAULT 0,
    "visitsCompleted" INTEGER NOT NULL DEFAULT 0,
    "queueTickets" INTEGER NOT NULL DEFAULT 0,
    "queueServed" INTEGER NOT NULL DEFAULT 0,
    "queueNoShow" INTEGER NOT NULL DEFAULT 0,
    "waitMinutes" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "waitSamples" INTEGER NOT NULL DEFAULT 0,
    "appointmentsBooked" INTEGER NOT NULL DEFAULT 0,
    "appointmentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "appointmentsCancelled" INTEGER NOT NULL DEFAULT 0,
    "appointmentsNoShow" INTEGER NOT NULL DEFAULT 0,
    "appointmentsRescheduled" INTEGER NOT NULL DEFAULT 0,
    "encountersOpened" INTEGER NOT NULL DEFAULT 0,
    "encountersCompleted" INTEGER NOT NULL DEFAULT 0,
    "consultationMinutes" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "consultationSamples" INTEGER NOT NULL DEFAULT 0,
    "diagnosesRecorded" INTEGER NOT NULL DEFAULT 0,
    "tasksCompleted" INTEGER NOT NULL DEFAULT 0,
    "prescriptionsIssued" INTEGER NOT NULL DEFAULT 0,
    "prescriptionsDispensed" INTEGER NOT NULL DEFAULT 0,
    "unitsDispensed" INTEGER NOT NULL DEFAULT 0,
    "stockReceivedLots" INTEGER NOT NULL DEFAULT 0,
    "labOrdersCreated" INTEGER NOT NULL DEFAULT 0,
    "labOrdersReleased" INTEGER NOT NULL DEFAULT 0,
    "labSamplesRejected" INTEGER NOT NULL DEFAULT 0,
    "labTatMinutes" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "labTatSamples" INTEGER NOT NULL DEFAULT 0,
    "radiologyOrdersCreated" INTEGER NOT NULL DEFAULT 0,
    "radiologyReportsReleased" INTEGER NOT NULL DEFAULT 0,
    "admissionsCreated" INTEGER NOT NULL DEFAULT 0,
    "admissionsDischarged" INTEGER NOT NULL DEFAULT 0,
    "emergencyArrivals" INTEGER NOT NULL DEFAULT 0,
    "emergencyTriaged" INTEGER NOT NULL DEFAULT 0,
    "emergencyTimeToTriageMinutes" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "emergencySamples" INTEGER NOT NULL DEFAULT 0,
    "invoicesIssued" INTEGER NOT NULL DEFAULT 0,
    "invoicesTotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "paymentsCompleted" INTEGER NOT NULL DEFAULT 0,
    "paymentsTotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "refundsCount" INTEGER NOT NULL DEFAULT 0,
    "refundsTotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "claimsSubmitted" INTEGER NOT NULL DEFAULT 0,
    "claimsPaid" INTEGER NOT NULL DEFAULT 0,
    "claimsPaidTotal" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "feedbackSubmitted" INTEGER NOT NULL DEFAULT 0,
    "feedbackRatingSum" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "daily_rollups_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "from" TIMESTAMP(3) NOT NULL,
    "to" TIMESTAMP(3) NOT NULL,
    "method" TEXT NOT NULL DEFAULT 'MANUAL',
    "exceptionsFound" INTEGER NOT NULL DEFAULT 0,
    "completedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "reconciliation_exceptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "type" "ReconciliationExceptionType" NOT NULL,
    "severity" "ReconciliationExceptionSeverity" NOT NULL,
    "status" "ReconciliationExceptionStatus" NOT NULL DEFAULT 'OPEN',
    "description" TEXT NOT NULL,
    "visitId" TEXT,
    "encounterId" TEXT,
    "invoiceId" TEXT,
    "claimId" TEXT,
    "patientId" TEXT,
    "referenceId" TEXT,
    "amount" DECIMAL(12, 2),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "reconciliation_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "report_exports" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "reportType" "ReportType" NOT NULL,
    "format" "ReportFormat" NOT NULL,
    "status" "ReportExportStatus" NOT NULL DEFAULT 'PENDING',
    "from" TIMESTAMP(3),
    "to" TIMESTAMP(3),
    "branchId" TEXT,
    "departmentId" TEXT,
    "artifact" TEXT,
    "sizeBytes" INTEGER,
    "contentType" TEXT,
    "error" TEXT,
    "expiresAt" TIMESTAMP(3),
    "requestedById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "report_exports_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "daily_rollups_organizationId_date_branchId_departmentId_key" ON "daily_rollups"("organizationId", "date", "branchId", "departmentId");

-- CreateIndex
CREATE INDEX "daily_rollups_organizationId_date_idx" ON "daily_rollups"("organizationId", "date");

-- CreateIndex
CREATE INDEX "daily_rollups_organizationId_branchId_date_idx" ON "daily_rollups"("organizationId", "branchId", "date");

-- CreateIndex
CREATE INDEX "reconciliation_runs_organizationId_createdAt_idx" ON "reconciliation_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "reconciliation_exceptions_organizationId_runId_idx" ON "reconciliation_exceptions"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "reconciliation_exceptions_organizationId_status_idx" ON "reconciliation_exceptions"("organizationId", "status");

-- CreateIndex
CREATE INDEX "report_exports_organizationId_createdAt_idx" ON "report_exports"("organizationId", "createdAt");

-- AddForeignKey
ALTER TABLE "daily_rollups" ADD CONSTRAINT "daily_rollups_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_runs" ADD CONSTRAINT "reconciliation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "reconciliation_exceptions" ADD CONSTRAINT "reconciliation_exceptions_runId_fkey" FOREIGN KEY ("runId") REFERENCES "reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "report_exports" ADD CONSTRAINT "report_exports_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Tenant isolation (RLS) for repo Phase 13 analytics tables. Every row is
-- org-scoped; RLS enforces that even a direct DB read cannot cross orgs
-- (same pattern as prior phases).
ALTER TABLE "daily_rollups" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "reconciliation_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "report_exports" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_daily_rollups ON "daily_rollups"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_reconciliation_runs ON "reconciliation_runs"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_reconciliation_exceptions ON "reconciliation_exceptions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_report_exports ON "report_exports"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "daily_rollups",
  "reconciliation_runs", "reconciliation_exceptions", "report_exports"
  TO careos_app;