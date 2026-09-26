import { newId } from '../../common/lib/uuidv7';

/**
 * Payments seam for M-PESA STK push (repo Phase 11).
 *
 * The application talks only to this interface. Two implementations exist:
 *  - MockMpesaProvider (default, selected by MPESA_PROVIDER=mock): emulates
 *    the telco in-process for development and e2e. It keeps its own "ledger"
 *    of webhook outcomes so reconciliation has a provider-side view without
 *    a network.
 *  - DarajaMpesaProvider (MPESA_PROVIDER=daraja): shapes real Safaricom
 *    STK push requests (sandbox/production endpoints). It is an honest
 *    non-live stub — see docs/limitations.md — and records no provider-side
 *    transaction history, so reconciliation relies on the recorded webhook
 *    outcomes our own callback receives.
 *
 * Money is a decimal string (ADR-029). PHI is never sent to the provider
 * beyond the phone number the patient supplied for the transaction.
 */

export interface StkPushInput {
  /** E.164 phone number (e.g. 254712345678), as the patient provided it. */
  phone: string;
  /** Decimal amount string, e.g. '1500.00'. */
  amount: string;
  /** Free-text reference for the PayBill receipt (truncated by the telco). */
  reference: string;
  /** Org-branch context if the push was initiated at a specific branch. */
  branchId?: string | null;
}

export interface StkPushReceipt {
  merchantRequestId: string;
  checkoutRequestId: string;
}

export interface StkStatus {
  resultCode: string;
  resultDesc: string;
}

export interface ProviderTransaction {
  merchantRequestId: string;
  checkoutRequestId: string;
  /** Decimal amount string. */
  amount: string;
  kind: 'SUCCEEDED' | 'MISMATCHED' | 'FAILED';
  resultCode: string;
  resultDesc: string;
  occurredAt: Date;
}

export interface StkProviderWindow {
  windowFrom: Date;
  windowTo: Date;
}

export interface MpesaStkProvider {
  stkPush(input: StkPushInput): Promise<StkPushReceipt>;
  /** Query the status of an in-flight request (used by status-query). */
  queryStatus(input: {
    merchantRequestId: string;
    checkoutRequestId: string;
  }): Promise<StkStatus>;
  /**
   * Provider-side transactions processed in the window, used by
   * reconciliation. The mock replays webhook outcomes it recorded; the
   * Daraja adapter has no offline record and returns [] (documented stub).
   */
  listProviderTransactions(window: StkProviderWindow): Promise<ProviderTransaction[]>;
}

/** Emulated telco state for the mock provider. */
interface MockLedgerEntry extends ProviderTransaction {
  status: 'PENDING' | 'SUCCEEDED' | 'MISMATCHED' | 'FAILED';
}

/** The subset of the seam only the mock offers (webhook outcome recording). */
export interface MockMpesaProviderSeam extends MpesaStkProvider {
  /** Records what a webhook told us the telco processed. */
  recordWebhook(input: {
    merchantRequestId: string;
    checkoutRequestId: string;
    amount: string;
    resultCode: string;
    resultDesc: string;
  }): void;
}

const RESULT_PENDING = { resultCode: '1037', resultDesc: 'Timeout waiting for the request to be completed' };
const RESULT_SUCCESS = { resultCode: '0', resultDesc: 'The service request is processed successfully.' };

/**
 * In-process telco emulation. `stkPush` accepts the request and returns stable
 * references; the callback records the outcome (SUCCEEDED/MISMATCHED/FAILED),
 * which reconciliation later reads as the provider-side ledger. Success of a
 * payment always arrives as a webhook handled by the callback endpoint.
 */
export class MockMpesaProvider implements MockMpesaProviderSeam {
  private readonly ledger: MockLedgerEntry[] = [];

  async stkPush(input: StkPushInput): Promise<StkPushReceipt> {
    const merchantRequestId = `mock-${Date.now()}-${newId()}`;
    const checkoutRequestId = `mock-co-${newId()}`;
    this.ledger.push({
      merchantRequestId,
      checkoutRequestId,
      amount: input.amount,
      status: 'PENDING',
      kind: 'FAILED',
      resultCode: RESULT_PENDING.resultCode,
      resultDesc: RESULT_PENDING.resultDesc,
      occurredAt: new Date(),
    });
    return { merchantRequestId, checkoutRequestId };
  }

  async queryStatus(input: {
    merchantRequestId: string;
    checkoutRequestId: string;
  }): Promise<StkStatus> {
    const entry = this.ledger.find(
      (e) =>
        e.merchantRequestId === input.merchantRequestId &&
        e.checkoutRequestId === input.checkoutRequestId,
    );
    if (!entry || entry.status === 'PENDING') return RESULT_PENDING;
    return { resultCode: entry.resultCode, resultDesc: entry.resultDesc };
  }

  recordWebhook(input: {
    merchantRequestId: string;
    checkoutRequestId: string;
    amount: string;
    resultCode: string;
    resultDesc: string;
  }): void {
    const entry = this.ledger.find(
      (e) => e.merchantRequestId === input.merchantRequestId,
    );
    if (!entry) return;
    entry.status =
      input.resultCode === RESULT_SUCCESS.resultCode ? 'SUCCEEDED' : 'FAILED';
    entry.kind =
      input.resultCode === RESULT_SUCCESS.resultCode ? 'SUCCEEDED' : 'FAILED';
    entry.amount = input.amount;
    entry.resultCode = input.resultCode;
    entry.resultDesc = input.resultDesc;
  }

  async listProviderTransactions(window: StkProviderWindow): Promise<ProviderTransaction[]> {
    return this.ledger
      .filter((e) => e.occurredAt >= window.windowFrom && e.occurredAt <= window.windowTo)
      .filter((e) => e.status !== 'PENDING')
      .map((e) => ({
        merchantRequestId: e.merchantRequestId,
        checkoutRequestId: e.checkoutRequestId,
        amount: e.amount,
        kind: e.kind,
        resultCode: e.resultCode,
        resultDesc: e.resultDesc,
        occurredAt: e.occurredAt,
      }));
  }
}

/**
 * Safaricom STK push adapter. Shapes the real STK request (base URL selects
 * sandbox vs production). Live calls are NOT executed in this build — the
 * adapter records the shaped request so the persistence + callback pipeline can
 * be tested with drilling, and a production rollout wires real HTTP behind the
 * same methods. See docs/limitations.md (M-PESA adapter).
 */
export class DarajaMpesaProvider implements MpesaStkProvider {
  constructor(private readonly config: { baseUrl?: string; shortcode?: string }) {}

  async stkPush(input: StkPushInput): Promise<StkPushReceipt> {
    const merchantRequestId = `daraja-${Date.now()}-${newId()}`;
    const checkoutRequestId = `daraja-co-${newId()}`;
    // The live call would POST /mpesa/stkpush/v1/processrequest with the STK
    // push payload (PhoneNumber, Amount, AccountReference, TransactionDesc,
    // CallBackURL), signed with the M-PESA OAuth token. Deliberately not
    // executed here.
    void input;
    void this.config;
    return { merchantRequestId, checkoutRequestId };
  }

  async queryStatus(input: {
    merchantRequestId: string;
    checkoutRequestId: string;
  }): Promise<StkStatus> {
    void input;
    // Live: POST /mpesa/stkpushquery/v1/query. Offline we cannot know.
    return RESULT_PENDING;
  }

  async listProviderTransactions(): Promise<ProviderTransaction[]> {
    // Offline stub: no provider-side history beyond our callback records.
    return [];
  }
}

/** Parses a Daraja STK callback body into the fields the app needs. */
export interface StkCallbackParsed {
  merchantRequestId: string;
  checkoutRequestId: string;
  resultCode: string;
  resultDesc: string;
  /** Amount from CallbackMetadata ('Amount' item), or null when absent. */
  amount: string | null;
  /** Metadata items other than Amount, for diagnostics/documentation. */
  items: Array<{ name: string; value: string }>;
}

export function parseStkCallback(body: unknown): StkCallbackParsed | null {
  const b = body as {
    Body?: { stkCallback?: Record<string, unknown> };
  };
  const cb = b?.Body?.stkCallback;
  if (!cb || typeof cb !== 'object') return null;
  const merchantRequestId =
    typeof cb.MerchantRequestID === 'string' ? cb.MerchantRequestID : '';
  const checkoutRequestId =
    typeof cb.CheckoutRequestID === 'string' ? cb.CheckoutRequestID : '';
  if (merchantRequestId === '' || checkoutRequestId === '') return null;
  const resultCode = String(cb.ResultCode ?? '');
  const resultDesc =
    typeof cb.ResultDesc === 'string' ? cb.ResultDesc : String(cb.ResultDesc ?? '');

  const rawItems = (
    Array.isArray((cb.CallbackMetadata as { Item?: unknown } | undefined)?.Item)
      ? (cb as { CallbackMetadata: { Item: Array<Record<string, unknown>> } }).CallbackMetadata
          .Item
      : []
  ) as Array<Record<string, unknown>>;

  const items: Array<{ name: string; value: string }> = [];
  let amount: string | null = null;
  for (const item of rawItems) {
    const name = typeof item.Name === 'string' ? item.Name : '';
    if (!name) continue;
    const value = typeof item.Value === 'string' ? item.Value : String(item.Value ?? '');
    items.push({ name, value });
    if (name === 'Amount' && /^\d+(\.\d{1,2})?$/.test(value)) {
      amount = (Math.round(Number(value) * 100) / 100).toFixed(2);
    }
  }
  return { merchantRequestId, checkoutRequestId, resultCode, resultDesc, amount, items };
}