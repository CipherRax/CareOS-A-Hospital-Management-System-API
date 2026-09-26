import {
  classifyExceptionType,
  exceptionSeverityOf,
  exceptionSuggestionOf,
} from '../../../src/modules/insights/domain/classification';

describe('classifyExceptionType', () => {
  it('maps every reconciliation exception type to a severity and suggestion', () => {
    const types = [
      'ENCOUNTER_WITHOUT_INVOICE',
      'INVOICE_TOTAL_MISMATCH',
      'PAYMENT_APPLICATION_MISMATCH',
      'OVERPAID_INVOICE',
      'REFUND_WITHOUT_PAYMENT',
      'CLAIM_PAYMENT_MISMATCH',
    ] as const;
    for (const type of types) {
      const c = classifyExceptionType(type);
      expect(['LOW', 'MEDIUM', 'HIGH'].includes(c.severity)).toBe(true);
      expect(c.suggestion.length).toBeGreaterThan(0);
    }
  });

  it('ranks revenue-class losses as HIGH', () => {
    expect(exceptionSeverityOf('INVOICE_TOTAL_MISMATCH')).toBe('HIGH');
    expect(exceptionSeverityOf('OVERPAID_INVOICE')).toBe('HIGH');
    expect(exceptionSeverityOf('REFUND_WITHOUT_PAYMENT')).toBe('HIGH');
    expect(exceptionSeverityOf('ENCOUNTER_WITHOUT_INVOICE')).toBe('MEDIUM');
  });

  it('returns a data-driven suggestion for a finding', () => {
    expect(exceptionSuggestionOf('ENCOUNTER_WITHOUT_INVOICE')).toMatch(/invoice/i);
  });
});