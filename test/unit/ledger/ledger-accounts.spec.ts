import { ErrorCodes } from '../../../src/common/errors/codes';
import {
  DEFAULT_CHART_ACCOUNTS,
  assertAccountCode,
  assertAccountNormalBalance,
  defaultAccountByCode,
} from '../../../src/modules/ledger/domain/ledger-accounts';

describe('ledger-accounts: default chart', () => {
  it('defines the six accounts the auto-posting map references', () => {
    const codes = DEFAULT_CHART_ACCOUNTS.map((a) => a.code);
    expect(codes).toEqual(['1000', '1200', '2100', '3000', '4000', '5000']);
    expect(DEFAULT_CHART_ACCOUNTS.find((a) => a.code === '1000')?.normalBalance).toBe('DEBIT');
    expect(DEFAULT_CHART_ACCOUNTS.find((a) => a.code === '4000')?.normalBalance).toBe('CREDIT');
    expect(DEFAULT_CHART_ACCOUNTS.find((a) => a.code === '1200')?.category).toBe('ASSET');
  });

  it('looks up a default account by code', () => {
    expect(defaultAccountByCode('4000')?.name).toBe('Service revenue');
    expect(defaultAccountByCode('9999')).toBeUndefined();
  });
});

describe('ledger-accounts: assertAccountCode', () => {
  it('accepts 3-6 digit codes and trims whitespace', () => {
    expect(assertAccountCode(' 1000 ')).toBe('1000');
    expect(assertAccountCode('10000')).toBe('10000');
  });

  it('rejects malformed codes', () => {
    for (const bad of ['12', '1234567', 'abc', '', '12a0']) {
      let code = '';
      try {
        assertAccountCode(bad);
      } catch (err) {
        code = (err as { code: string }).code;
      }
      expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
    }
  });
});

describe('ledger-accounts: assertAccountNormalBalance', () => {
  it('accepts DEBIT and CREDIT', () => {
    expect(() => assertAccountNormalBalance('DEBIT')).not.toThrow();
    expect(() => assertAccountNormalBalance('CREDIT')).not.toThrow();
  });

  it('rejects anything else', () => {
    let code = '';
    try {
      assertAccountNormalBalance('BALANCED');
    } catch (err) {
      code = (err as { code: string }).code;
    }
    expect(code).toBe(ErrorCodes.VALIDATION_ERROR);
  });
});