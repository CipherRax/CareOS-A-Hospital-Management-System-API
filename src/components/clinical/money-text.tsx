import { cn } from '@/lib/cn';

/**
 * Money display.
 *
 * The API sends money as a **decimal string** (`"1234.50"`), and this component
 * never converts one. That is the whole point of its existence: `parseFloat` on a
 * monetary string is the origin of the class of bug where a total is off by a
 * cent, the invoice does not add up, and nobody can say which line is wrong.
 *
 * `Intl.NumberFormat.format` accepts a string and formats it exactly — the
 * ECMA-402 conversion keeps the decimal digits and never routes the value through
 * a binary float. So the currency, grouping and the number of minor units all come
 * from the org's locale and currency without any arithmetic happening here.
 *
 * **Display only.** Nothing in this file adds, subtracts or compares amounts. Any
 * client-side arithmetic on money needs a decimal library and is out of scope until
 * something actually needs it — a totals row that is silently a cent out is worse
 * than no totals row.
 *
 * An unparseable amount is rendered verbatim rather than as `NaN`. A screen showing
 * "KES NaN" is a bug report; a screen showing the raw value is a diagnosable one.
 */

export interface MoneyTextProps {
  /** Decimal string exactly as the API sent it. Never a number. */
  amount: string;
  /** ISO 4217. Org currency comes from `/auth/me`; KES is Kenya's, not a default. */
  currency: string;
  /** BCP 47 tag. Org locale, not the browser's. */
  locale?: string;
  /** Hides the symbol where the surrounding column already establishes it. */
  hideSymbol?: boolean;
  /** Renders the negative sign ahead of the symbol, as accountants write it. */
  accounting?: boolean;
  className?: string;
}

const DECIMAL_STRING = /^-?\d+(\.\d+)?$/;

export function MoneyText({
  amount,
  currency,
  locale = 'en-KE',
  hideSymbol,
  accounting,
  className,
}: MoneyTextProps) {
  if (!DECIMAL_STRING.test(amount)) {
    return (
      <span className={cn('font-mono tabular-nums text-status-critical', className)}>{amount}</span>
    );
  }

  const negative = amount.startsWith('-');
  const formatter = new Intl.NumberFormat(locale, {
    style: 'currency',
    currency,
    currencyDisplay: hideSymbol ? 'code' : 'symbol',
  });

  /**
   * The cast is confined to this call and is safe at runtime, which is the part
   * worth being careful about.
   *
   * `Intl.NumberFormat.format` is typed to accept only numeric *literals* and
   * numbers — not a runtime string — because the usual way to get a string into a
   * formatter is `Number(s)`, and that routes the value through a binary float.
   * `Number('12345678901234567890.99')` is `12345678901234567000`.
   *
   * The runtime does something better. Per ECMA-402, a string argument goes through
   * `ToIntlMathematicalValue`, which keeps the decimal digits as a mathematical
   * value and never converts to binary floating point. The same input formats as
   * `Ksh 12,345,678,901,234,567,890.99`, exact.
   *
   * So the type is narrower than the behaviour, the cast is sound, and
   * `DECIMAL_STRING` above is what keeps it sound at runtime: an unvalidated string
   * would reach `ToIntlMathematicalValue` as NaN and render "Ksh NaN".
   *
   * The target type is read off `format` itself rather than written out, so it tracks
   * whatever the lib types allow instead of asserting a name that may not exist.
   */
  const formatted = formatter.format(amount as unknown as Parameters<typeof formatter.format>[0]);

  // `Intl` writes the sign ahead of the symbol ("-KES 500.00"); financial
  // statements put it outside the currency mark. Kept as an option because both
  // appear in real documents and neither is universally right.
  const text = accounting && negative ? `(${formatted.replace('-', '')})` : formatted;

  return <span className={cn('font-mono tabular-nums', className)}>{text}</span>;
}
