-- AlterEnum
-- MPESA STK-push payments (repo Phase 11). The new value is not used inside
-- this migration, so the non-transactional ALTER is safe with Prisma's
-- single-transaction deploy.
ALTER TYPE "PaymentMethod" ADD VALUE 'MPESA' BEFORE 'OTHER';

-- CreateEnum
CREATE TYPE "AccountCategoryType" AS ENUM ('ASSET', 'LIABILITY', 'EQUITY', 'REVENUE', 'EXPENSE');

-- CreateEnum
CREATE TYPE "AccountNormalBalance" AS ENUM ('DEBIT', 'CREDIT');

-- CreateEnum
CREATE TYPE "FinancialPeriodStatus" AS ENUM ('OPEN', 'CLOSED', 'LOCKED');

-- CreateEnum
CREATE TYPE "FinanceTransactionStatus" AS ENUM ('POSTED', 'REVERSED');

-- CreateEnum
CREATE TYPE "MpesaRequestStatus" AS ENUM ('PENDING', 'SUCCEEDED', 'FAILED', 'MISMATCHED', 'EXPIRED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "MpesaReconciliationMatchStatus" AS ENUM ('MATCHED', 'UNMATCHED', 'DUPLICATE', 'AMOUNT_MISMATCH', 'REFERENCE_MISMATCH');

-- CreateTable
CREATE TABLE "chart_accounts" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "category" "AccountCategoryType" NOT NULL,
    "normalBalance" "AccountNormalBalance" NOT NULL,
    "description" TEXT,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "chart_accounts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "financial_periods" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "startDate" TIMESTAMP(3) NOT NULL,
    "endDate" TIMESTAMP(3) NOT NULL,
    "status" "FinancialPeriodStatus" NOT NULL DEFAULT 'OPEN',
    "openedById" TEXT,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedById" TEXT,
    "closedAt" TIMESTAMP(3),
    "lockedById" TEXT,
    "lockedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "financial_periods_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transactions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "periodId" TEXT,
    "transactionNumber" TEXT NOT NULL,
    "date" TIMESTAMP(3) NOT NULL,
    "description" TEXT,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "status" "FinanceTransactionStatus" NOT NULL DEFAULT 'POSTED',
    "postedById" TEXT,
    "postedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "reversedById" TEXT,
    "reversedAt" TIMESTAMP(3),
    "reversalOfId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "finance_transactions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "finance_transaction_lines" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "transactionId" TEXT NOT NULL,
    "accountId" TEXT NOT NULL,
    "debit" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "credit" DECIMAL(12, 2) NOT NULL DEFAULT 0,
    "memo" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "finance_transaction_lines_pkey" PRIMARY KEY ("id")
);

-- Each leg moves exactly one side of the ledger (debit XOR credit).
ALTER TABLE "finance_transaction_lines"
  ADD CONSTRAINT "finance_transaction_lines_single_side_check"
  CHECK ((("debit" > 0)::int + ("credit" > 0)::int) = 1);

-- CreateTable
CREATE TABLE "ledger_posting_exceptions" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "eventId" TEXT NOT NULL,
    "eventType" TEXT NOT NULL,
    "referenceType" TEXT,
    "referenceId" TEXT,
    "reason" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ledger_posting_exceptions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_requests" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "branchId" TEXT,
    "invoiceId" TEXT NOT NULL,
    "patientId" TEXT NOT NULL,
    "phone" TEXT NOT NULL,
    "amount" DECIMAL(12, 2) NOT NULL,
    "checkoutRequestId" TEXT NOT NULL,
    "merchantRequestId" TEXT NOT NULL,
    "status" "MpesaRequestStatus" NOT NULL DEFAULT 'PENDING',
    "resultCode" TEXT,
    "resultDesc" TEXT,
    "rawCallback" JSONB,
    "initiatedById" TEXT,
    "initiatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "callbackReceivedAt" TIMESTAMP(3),
    "confirmedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "mpesa_requests_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_reconciliation_runs" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "windowFrom" TIMESTAMP(3) NOT NULL,
    "windowTo" TIMESTAMP(3) NOT NULL,
    "providerCount" INTEGER NOT NULL DEFAULT 0,
    "paymentCount" INTEGER NOT NULL DEFAULT 0,
    "matchedCount" INTEGER NOT NULL DEFAULT 0,
    "unmatchedCount" INTEGER NOT NULL DEFAULT 0,
    "duplicateCount" INTEGER NOT NULL DEFAULT 0,
    "amountMismatchCount" INTEGER NOT NULL DEFAULT 0,
    "referenceMismatchCount" INTEGER NOT NULL DEFAULT 0,
    "runById" TEXT,
    "startedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "completedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpesa_reconciliation_runs_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "mpesa_reconciliation_matches" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "runId" TEXT NOT NULL,
    "mpesaRequestId" TEXT,
    "paymentId" TEXT,
    "reference" TEXT NOT NULL,
    "status" "MpesaReconciliationMatchStatus" NOT NULL,
    "expectedAmount" DECIMAL(12, 2),
    "providerAmount" DECIMAL(12, 2),
    "notes" TEXT,
    "resolution" TEXT,
    "resolutionReason" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "mpesa_reconciliation_matches_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "chart_accounts_organizationId_code_key" ON "chart_accounts"("organizationId", "code");

-- CreateIndex
CREATE INDEX "chart_accounts_organizationId_category_isActive_idx" ON "chart_accounts"("organizationId", "category", "isActive");

-- CreateIndex
CREATE UNIQUE INDEX "financial_periods_organizationId_code_key" ON "financial_periods"("organizationId", "code");

-- CreateIndex
CREATE INDEX "financial_periods_organizationId_status_startDate_idx" ON "financial_periods"("organizationId", "status", "startDate");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_organizationId_transactionNumber_key" ON "finance_transactions"("organizationId", "transactionNumber");

-- CreateIndex
CREATE UNIQUE INDEX "finance_transactions_organizationId_referenceType_referenceI_key" ON "finance_transactions"("organizationId", "referenceType", "referenceId");

-- CreateIndex
CREATE INDEX "finance_transactions_organizationId_date_status_idx" ON "finance_transactions"("organizationId", "date", "status");

-- CreateIndex
CREATE INDEX "finance_transactions_organizationId_periodId_idx" ON "finance_transactions"("organizationId", "periodId");

-- CreateIndex
CREATE INDEX "finance_transaction_lines_organizationId_transactionId_idx" ON "finance_transaction_lines"("organizationId", "transactionId");

-- CreateIndex
CREATE INDEX "finance_transaction_lines_organizationId_accountId_idx" ON "finance_transaction_lines"("organizationId", "accountId");

-- CreateIndex
CREATE UNIQUE INDEX "ledger_posting_exceptions_organizationId_eventId_key" ON "ledger_posting_exceptions"("organizationId", "eventId");

-- CreateIndex
CREATE INDEX "ledger_posting_exceptions_organizationId_createdAt_idx" ON "ledger_posting_exceptions"("organizationId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_requests_organizationId_checkoutRequestId_key" ON "mpesa_requests"("organizationId", "checkoutRequestId");

-- CreateIndex
CREATE UNIQUE INDEX "mpesa_requests_merchantRequestId_key" ON "mpesa_requests"("merchantRequestId");

-- CreateIndex
CREATE INDEX "mpesa_requests_organizationId_status_initiatedAt_idx" ON "mpesa_requests"("organizationId", "status", "initiatedAt");

-- CreateIndex
CREATE INDEX "mpesa_requests_organizationId_invoiceId_idx" ON "mpesa_requests"("organizationId", "invoiceId");

-- CreateIndex
CREATE INDEX "mpesa_reconciliation_runs_organizationId_createdAt_idx" ON "mpesa_reconciliation_runs"("organizationId", "createdAt");

-- CreateIndex
CREATE INDEX "mpesa_reconciliation_matches_organizationId_runId_idx" ON "mpesa_reconciliation_matches"("organizationId", "runId");

-- CreateIndex
CREATE INDEX "mpesa_reconciliation_matches_organizationId_status_idx" ON "mpesa_reconciliation_matches"("organizationId", "status");

-- AddForeignKey
ALTER TABLE "chart_accounts" ADD CONSTRAINT "chart_accounts_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_openedById_fkey" FOREIGN KEY ("openedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_closedById_fkey" FOREIGN KEY ("closedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "financial_periods" ADD CONSTRAINT "financial_periods_lockedById_fkey" FOREIGN KEY ("lockedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_periodId_fkey" FOREIGN KEY ("periodId") REFERENCES "financial_periods"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_postedById_fkey" FOREIGN KEY ("postedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_reversedById_fkey" FOREIGN KEY ("reversedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transactions" ADD CONSTRAINT "finance_transactions_reversalOfId_fkey" FOREIGN KEY ("reversalOfId") REFERENCES "finance_transactions"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transaction_lines" ADD CONSTRAINT "finance_transaction_lines_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transaction_lines" ADD CONSTRAINT "finance_transaction_lines_transactionId_fkey" FOREIGN KEY ("transactionId") REFERENCES "finance_transactions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "finance_transaction_lines" ADD CONSTRAINT "finance_transaction_lines_accountId_fkey" FOREIGN KEY ("accountId") REFERENCES "chart_accounts"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ledger_posting_exceptions" ADD CONSTRAINT "ledger_posting_exceptions_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_branchId_fkey" FOREIGN KEY ("branchId") REFERENCES "branches"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_invoiceId_fkey" FOREIGN KEY ("invoiceId") REFERENCES "invoices"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "patients"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_requests" ADD CONSTRAINT "mpesa_requests_initiatedById_fkey" FOREIGN KEY ("initiatedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_runs" ADD CONSTRAINT "mpesa_reconciliation_runs_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_runs" ADD CONSTRAINT "mpesa_reconciliation_runs_runById_fkey" FOREIGN KEY ("runById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_matches" ADD CONSTRAINT "mpesa_reconciliation_matches_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_matches" ADD CONSTRAINT "mpesa_reconciliation_matches_runId_fkey" FOREIGN KEY ("runId") REFERENCES "mpesa_reconciliation_runs"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_matches" ADD CONSTRAINT "mpesa_reconciliation_matches_mpesaRequestId_fkey" FOREIGN KEY ("mpesaRequestId") REFERENCES "mpesa_requests"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_matches" ADD CONSTRAINT "mpesa_reconciliation_matches_paymentId_fkey" FOREIGN KEY ("paymentId") REFERENCES "payments"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "mpesa_reconciliation_matches" ADD CONSTRAINT "mpesa_reconciliation_matches_resolvedById_fkey" FOREIGN KEY ("resolvedById") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- Journal balance backstop: a POSTED journal must have equal debit and credit
-- totals. Referenced by ADR-035. Enforced in the application first; this is the
-- DB-level guarantee.
CREATE OR REPLACE FUNCTION enforce_balanced_journal() RETURNS trigger AS $$
DECLARE
  dr NUMERIC;
  cr NUMERIC;
BEGIN
  IF NEW."status" = 'POSTED' THEN
    SELECT COALESCE(SUM(l."debit"), 0), COALESCE(SUM(l."credit"), 0)
      INTO dr, cr
      FROM "finance_transaction_lines" l
     WHERE l."transactionId" = NEW."id";
    IF dr <> cr THEN
      RAISE EXCEPTION USING
        errcode = '22000',
        message = 'UNBALANCED_JOURNAL';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER finance_transactions_balance_guard
  BEFORE INSERT OR UPDATE OF "status" ON "finance_transactions"
  FOR EACH ROW EXECUTE FUNCTION enforce_balanced_journal();

-- Tenant isolation (RLS) for repo Phase 11 financial tables. Financing records
-- are org-scoped; RLS enforces that even a direct DB read cannot cross orgs.
ALTER TABLE "chart_accounts" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "financial_periods" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_transactions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "finance_transaction_lines" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "ledger_posting_exceptions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mpesa_requests" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mpesa_reconciliation_runs" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "mpesa_reconciliation_matches" ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_chart_accounts ON "chart_accounts"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_financial_periods ON "financial_periods"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_finance_transactions ON "finance_transactions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_finance_transaction_lines ON "finance_transaction_lines"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_ledger_posting_exceptions ON "ledger_posting_exceptions"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_mpesa_requests ON "mpesa_requests"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_mpesa_reconciliation_runs ON "mpesa_reconciliation_runs"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));
CREATE POLICY tenant_isolation_mpesa_reconciliation_matches ON "mpesa_reconciliation_matches"
  FOR ALL USING ("organizationId" = current_setting('app.current_org', true))
  WITH CHECK ("organizationId" = current_setting('app.current_org', true));

GRANT SELECT, INSERT, UPDATE, DELETE ON "chart_accounts", "financial_periods",
  "finance_transactions", "finance_transaction_lines", "ledger_posting_exceptions",
  "mpesa_requests", "mpesa_reconciliation_runs", "mpesa_reconciliation_matches"
  TO careos_app;