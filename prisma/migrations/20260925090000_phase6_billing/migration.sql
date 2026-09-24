-- CreateEnum
CREATE TYPE "BillableItemCategory" AS ENUM ('CONSULTATION', 'LAB', 'RADIOLOGY', 'PHARMACY', 'PROCEDURE', 'ADMISSION', 'OTHER');

-- CreateEnum
CREATE TYPE "InvoiceStatus" AS ENUM ('DRAFT', 'ISSUED', 'PARTIALLY_PAID', 'PAID', 'CANCELLED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "PaymentMethod" AS ENUM ('CASH', 'CARD', 'MOBILE_MONEY', 'BANK_TRANSFER', 'CHEQUE', 'INSURANCE', 'OTHER');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'COMPLETED', 'FAILED', 'REFUNDED');

-- CreateEnum
CREATE TYPE "CoverageType" AS ENUM ('FULL', 'PARTIAL');

-- CreateEnum
CREATE TYPE "ClaimStatus" AS ENUM ('DRAFT', 'SUBMITTED', 'APPROVED', 'PARTIALLY_APPROVED', 'DENIED', 'PAID');

-- CreateTable
CREATE TABLE "billable_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "category" "BillableItemCategory" NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "price" DECIMAL(12,2) NOT NULL,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "insuranceEligible" BOOLEAN NOT NULL DEFAULT false,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "billable_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoices" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "invoiceNumber" TEXT NOT NULL,
    "status" "InvoiceStatus" NOT NULL DEFAULT 'DRAFT',
    "visitId" TEXT,
    "encounterId" TEXT,
    "subtotal" DECIMAL(12,2) NOT NULL,
    "discountAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "taxAmount" DECIMAL(12,2) NOT NULL DEFAULT 0,
    "total" DECIMAL(12,2) NOT NULL,
    "balanceDue" DECIMAL(12,2) NOT NULL,
    "dueAt" TIMESTAMP(3),
    "notes" TEXT,
    "issuedById" TEXT,
    "issuedAt" TIMESTAMP(3),
    "cancelledById" TEXT,
    "cancelledAt" TIMESTAMP(3),
    "cancelReason" TEXT,
    "refundedById" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "invoices_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "invoice_items" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "billableItemId" TEXT,
    "medicationId" TEXT,
    "description" TEXT NOT NULL,
    "quantity" INTEGER NOT NULL,
    "unitPrice" DECIMAL(12,2) NOT NULL,
    "lineTotal" DECIMAL(12,2) NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "invoice_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "payments" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "receiptNumber" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "method" "PaymentMethod" NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "externalReference" TEXT,
    "note" TEXT,
    "recordedById" TEXT,
    "recordedAt" TIMESTAMP(3),
    "refundedById" TEXT,
    "refundedAt" TIMESTAMP(3),
    "refundReason" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "payments_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_payers" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "contactPhone" TEXT,
    "email" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_payers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "patient_insurance_policies" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "payerId" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "coverageType" "CoverageType" NOT NULL DEFAULT 'PARTIAL',
    "coveragePercent" INTEGER NOT NULL DEFAULT 0,
    "validityStart" TIMESTAMP(3),
    "validityEnd" TIMESTAMP(3),
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "patient_insurance_policies_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "insurance_claims" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "claimNumber" TEXT NOT NULL,
    "invoiceId" TEXT NOT NULL,
    "policyId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "amount" DECIMAL(12,2) NOT NULL,
    "status" "ClaimStatus" NOT NULL DEFAULT 'DRAFT',
    "notes" TEXT,
    "submittedById" TEXT,
    "submittedAt" TIMESTAMP(3),
    "approvedById" TEXT,
    "approvedAt" TIMESTAMP(3),
    "approvedAmount" DECIMAL(12,2),
    "deniedById" TEXT,
    "deniedAt" TIMESTAMP(3),
    "denyReason" TEXT,
    "paidById" TEXT,
    "paidAt" TIMESTAMP(3),
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "insurance_claims_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "billable_items_organizationId_category_isActive_idx" ON "billable_items"("organizationId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "billable_items_organizationId_name_category_key" ON "billable_items"("organizationId", "name", "category");

-- CreateIndex
CREATE INDEX "invoices_organizationId_patientId_createdAt_idx" ON "invoices"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "invoices_organizationId_branchId_status_createdAt_idx" ON "invoices"("organizationId", "branchId", "status", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "invoices_organizationId_invoiceNumber_key" ON "invoices"("organizationId", "invoiceNumber");

-- CreateIndex
CREATE INDEX "invoice_items_organizationId_invoiceId_idx" ON "invoice_items"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "payments_organizationId_invoiceId_idx" ON "payments"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "payments_organizationId_patientId_createdAt_idx" ON "payments"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "payments_organizationId_receiptNumber_key" ON "payments"("organizationId", "receiptNumber");

-- CreateIndex
CREATE INDEX "insurance_payers_organizationId_isActive_idx" ON "insurance_payers"("organizationId", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_payers_organizationId_name_key" ON "insurance_payers"("organizationId", "name");

-- CreateIndex
CREATE INDEX "patient_insurance_policies_organizationId_patientId_idx" ON "patient_insurance_policies"("organizationId", "patientId");

-- CreateIndex
CREATE UNIQUE INDEX "patient_insurance_policies_organizationId_patientId_payerId_key" ON "patient_insurance_policies"("organizationId", "patientId", "payerId", "policyNumber");

-- CreateIndex
CREATE INDEX "insurance_claims_organizationId_invoiceId_idx" ON "insurance_claims"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "insurance_claims_organizationId_patientId_createdAt_idx" ON "insurance_claims"("organizationId", "patientId", "createdAt");

-- CreateIndex
CREATE INDEX "insurance_claims_organizationId_status_idx" ON "insurance_claims"("organizationId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "insurance_claims_organizationId_claimNumber_key" ON "insurance_claims"("organizationId", "claimNumber");

-- AddForeignKey
ALTER TABLE "billable_items" ADD CONSTRAINT "billable_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "billable_items" ADD CONSTRAINT "billable_items_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoices" ADD CONSTRAINT "invoices_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_billableItemId_fkey" FOREIGN KEY ("billableItemId") REFERENCES "billable_items"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "invoice_items" ADD CONSTRAINT "invoice_items_medicationId_fkey" FOREIGN KEY ("medicationId") REFERENCES "medications"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "payments" ADD CONSTRAINT "payments_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_payers" ADD CONSTRAINT "insurance_payers_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurance_policies" ADD CONSTRAINT "patient_insurance_policies_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurance_policies" ADD CONSTRAINT "patient_insurance_policies_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "patient_insurance_policies" ADD CONSTRAINT "patient_insurance_policies_payerId_fkey" FOREIGN KEY ("payerId") REFERENCES "insurance_payers"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_policyId_fkey" FOREIGN KEY ("policyId") REFERENCES "patient_insurance_policies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "insurance_claims" ADD CONSTRAINT "insurance_claims_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;


-- Tenant isolation (RLS) for Phase 6 billing tables
ALTER TABLE "billable_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoices" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "invoice_items" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "payments" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_payers" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "patient_insurance_policies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "insurance_claims" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_billable_items ON "billable_items"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_invoices ON "invoices"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_invoice_items ON "invoice_items"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_payments ON "payments"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_insurance_payers ON "insurance_payers"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_patient_insurance_policies ON "patient_insurance_policies"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_insurance_claims ON "insurance_claims"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "billable_items", "invoices",
  "invoice_items", "payments", "insurance_payers",
  "patient_insurance_policies", "insurance_claims"
  TO careos_app;
