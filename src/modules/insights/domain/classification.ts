import type {
  ReconciliationExceptionType,
  ReconciliationExceptionSeverity,
} from '@prisma/client';

/**
 * Pure classification for reconciliation findings (brief Phase 11 §7.16).
 * Kept module-side so unit tests can assert severity mapping without a DB.
 * Descriptions are written by the service in neutral, data-driven language.
 */
export interface SeverityClass {
  severity: ReconciliationExceptionSeverity;
  suggestion: string;
}

const CLASSIFICATION: Record<ReconciliationExceptionType, SeverityClass> = {
  ENCOUNTER_WITHOUT_INVOICE: {
    severity: 'MEDIUM',
    suggestion: 'Verify whether the completed encounter was billed; if so, issue and link the invoice.',
  },
  INVOICE_TOTAL_MISMATCH: {
    severity: 'HIGH',
    suggestion: 'Verify the invoice line items, taxes and discounts; recalculate or cancel/issue a corrective invoice.',
  },
  PAYMENT_APPLICATION_MISMATCH: {
    severity: 'MEDIUM',
    suggestion: 'Verify payment allocation against the invoice balance and the ledger.',
  },
  OVERPAID_INVOICE: {
    severity: 'HIGH',
    suggestion: 'Confirm the excess amount and issue a refund or apply a credit note.',
  },
  REFUND_WITHOUT_PAYMENT: {
    severity: 'HIGH',
    suggestion: 'Confirm a refund was actually issued; reconcile the flagged refund against the invoice status.',
  },
  CLAIM_PAYMENT_MISMATCH: {
    severity: 'MEDIUM',
    suggestion: 'Verify the insurer remitted payment and whether the invoice should be settled from the claim proceeds.',
  },
};

export function classifyExceptionType(
  type: ReconciliationExceptionType,
): SeverityClass {
  return CLASSIFICATION[type];
}

export function exceptionSeverityOf(
  type: ReconciliationExceptionType,
): ReconciliationExceptionSeverity {
  return CLASSIFICATION[type].severity;
}

export function exceptionSuggestionOf(
  type: ReconciliationExceptionType,
): string {
  return CLASSIFICATION[type].suggestion;
}