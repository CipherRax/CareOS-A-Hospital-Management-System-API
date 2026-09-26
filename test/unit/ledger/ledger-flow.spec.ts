import { Prisma } from '@prisma/client';
import { EventTypes } from '../../../src/events/catalog';
import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  assertBalancedJournal,
  normalizeJournalLine,
  periodOverlaps,
  planAutoPosting,
  resolveJournalPeriod,
} from '../../../src/modules/ledger/domain/ledger-flow';

function dec(n: string | number): Prisma.Decimal {
  return new Prisma.Decimal(n);
}

const accounts = new Map([
  ['1000', 'acc-cash'],
  ['1200', 'acc-ar'],
  ['4000', 'acc-rev'],
]);

describe('ledger-flow: normalizeJournalLine', () => {
  it('normalizes a single-side debit line', () => {
    const line = normalizeJournalLine(
      { accountCode: '1000', debit: dec('250.00'), memo: 'x' },
      accounts,
    );
    expect(line).toEqual({
      accountId: 'acc-cash',
      debit: dec('250.00'),
      credit: dec(0),
      memo: 'x',
    });
  });

  it('rounds all amounts to cents', () => {
    const line = normalizeJournalLine({ accountCode: '1200', debit: dec('99.995') }, accounts);
    expect(line.debit.toFixed(2)).toBe('100.00');
  });

  it('rejects a line with both sides set (no double-entry per line)', () => {
    let code = '';
    try {
      normalizeJournalLine(
        { accountCode: '1000', debit: dec(10), credit: dec(5) },
        accounts,
      );
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects a line with no side set', () => {
    let code = '';
    try {
      normalizeJournalLine({ accountCode: '1000' }, accounts);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects negative amounts', () => {
    let code = '';
    try {
      normalizeJournalLine({ accountCode: '1000', credit: dec('-5') }, accounts);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
  });

  it('rejects unknown account codes', () => {
    expect(() => normalizeJournalLine({ accountCode: '9999', debit: dec(1) }, accounts)).toThrow(
      /Unknown account code/,
    );
  });

  it('trims and nulls empty memos', () => {
    const line = normalizeJournalLine(
      { accountCode: '1000', debit: dec(1), memo: '   ' },
      accounts,
    );
    expect(line.memo).toBeNull();
  });
});

describe('ledger-flow: assertBalancedJournal', () => {
  it('accepts balanced books and returns the totals', () => {
    const lines = [
      { debit: dec('10'), credit: dec('0') },
      { debit: dec('0'), credit: dec('10') },
    ];
    const { debit, credit } = assertBalancedJournal(lines);
    expect(debit.toString()).toBe('10');
    expect(credit.toString()).toBe('10');
  });

  it('throws UNBALANCED_JOURNAL when debits != credits', () => {
    let code = '';
    try {
      assertBalancedJournal([
        { debit: dec('10'), credit: dec(0) },
        { debit: dec('25'), credit: dec(0) },
        { debit: dec(0), credit: dec('10') },
      ]);
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.UNBALANCED_JOURNAL);
  });
});

describe('ledger-flow: resolveJournalPeriod', () => {
  const periods = [
    { id: 'p1', status: 'OPEN' as const, startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T23:59:59Z') },
    { id: 'p0', status: 'CLOSED' as const, startDate: new Date('2026-08-01T00:00:00Z'), endDate: new Date('2026-08-31T23:59:59Z') },
  ];

  it('resolves the covering open period', () => {
    const resolved = resolveJournalPeriod(periods, new Date('2026-09-15T00:00:00Z'));
    expect(resolved?.id).toBe('p1');
  });

  it('returns null when no period covers the date', () => {
    expect(resolveJournalPeriod(periods, new Date('2026-07-15T00:00:00Z'))).toBeNull();
  });

  it('throws PERIOD_LOCKED when the date falls in a closed period', () => {
    let code = '';
    try {
      resolveJournalPeriod(periods, new Date('2026-08-15T00:00:00Z'));
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.PERIOD_LOCKED);
  });

  it('throws PERIOD_LOCKED when overlapping periods cover the date', () => {
    const overlapping = [
      ...periods,
      { id: 'p2', status: 'OPEN' as const, startDate: new Date('2026-09-10T00:00:00Z'), endDate: new Date('2026-10-10T00:00:00Z') },
    ];
    let code = '';
    try {
      resolveJournalPeriod(overlapping, new Date('2026-09-15T00:00:00Z'));
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.PERIOD_LOCKED);
  });
});

describe('ledger-flow: periodOverlaps', () => {
  const existing = [
    { id: 'p1', status: 'OPEN' as const, startDate: new Date('2026-09-01T00:00:00Z'), endDate: new Date('2026-09-30T00:00:00Z') },
  ];

  it('detects overlap on either boundary', () => {
    expect(periodOverlaps(existing, new Date('2026-09-15T00:00:00Z'), new Date('2026-10-15T00:00:00Z'))).toBe(true);
    expect(periodOverlaps(existing, new Date('2026-08-01T00:00:00Z'), new Date('2026-09-15T00:00:00Z'))).toBe(true);
  });

  it('allows a gap between periods', () => {
    expect(periodOverlaps(existing, new Date('2026-10-01T00:00:00Z'), new Date('2026-10-15T00:00:00Z'))).toBe(false);
  });
});

describe('ledger-flow: planAutoPosting', () => {
  const base = { date: new Date('2026-09-15T00:00:00Z'), description: 'post' };

  it('maps InvoiceIssued to DR AR / CR Revenue', () => {
    const legs = planAutoPosting({ ...base, referenceType: EventTypes.InvoiceIssued, referenceId: 'i1', amount: dec(500) });
    expect(legs).toEqual([
      { accountCode: '1200', debit: dec(500), memo: 'Invoice issued' },
      { accountCode: '4000', credit: dec(500), memo: 'Invoice issued' },
    ]);
  });

  it('maps InvoiceCancelled to DR Revenue / CR AR', () => {
    const legs = planAutoPosting({ ...base, referenceType: EventTypes.InvoiceCancelled, referenceId: 'i1', amount: dec(500) });
    expect(legs[0]!.accountCode).toBe('4000');
    expect(legs[0]!.debit!.toString()).toBe('500');
    expect(legs[1]!.accountCode).toBe('1200');
    expect(legs[1]!.credit!.toString()).toBe('500');
  });

  it('maps PaymentCompleted to DR Cash / CR AR', () => {
    const legs = planAutoPosting({ ...base, referenceType: EventTypes.PaymentCompleted, referenceId: 'p1', amount: dec(200) });
    expect(legs[0]!.accountCode).toBe('1000');
    expect(legs[1]!.accountCode).toBe('1200');
  });

  it('maps PaymentRefunded to DR AR / CR Cash', () => {
    const legs = planAutoPosting({ ...base, referenceType: EventTypes.PaymentRefunded, referenceId: 'p1', amount: dec(200) });
    expect(legs[0]!.accountCode).toBe('1200');
    expect(legs[1]!.accountCode).toBe('1000');
  });

  it('rounds the posted amount to cents', () => {
    const legs = planAutoPosting({ ...base, referenceType: EventTypes.PaymentCompleted, referenceId: 'p1', amount: dec('200.005') });
    expect(legs[0]!.debit!.toString()).toBe('200.01');
  });

  it('throws for unknown sources (never reached by the consumer)', () => {
    let code = '';
    try {
      planAutoPosting({ ...base, referenceType: 'Nope' as never, referenceId: 'x', amount: dec(1) });
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.INTERNAL_ERROR);
  });
});