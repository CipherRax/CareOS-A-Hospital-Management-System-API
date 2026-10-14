'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { MoneyText } from '@/components/clinical/money-text';
import { ReasonField, reasonError } from '@/components/clinical/reason-field';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useInvoice,
  useInvoiceAction,
  useOrgCurrency,
  usePatientName,
  useRecordPayment,
  useRefundPayment,
} from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  PAYMENT_METHODS,
  type InvoiceItemRow,
  type InvoicePaymentRow,
  type InvoiceRow,
  type InvoiceStatus,
  type PaymentMethod,
} from '@/lib/data/billing';

/**
 * Invoice workspace (F7) — one invoice, whichever point of its lifecycle it sits
 * at.
 *
 * The read answers `{ invoice }` while the export types the bare entity, and the
 * action/payment writes answer the same envelope shape (GAP-020), so every body
 * is validated in `src/lib/data/billing.ts`. The action bar offers only the moves
 * the server's lifecycle allows (DRAFT→ISSUED, DRAFT|ISSUED→CANCELLED,
 * PAID→REFUNDED), and a move that races a stale tab resolves to a 409 rendered in
 * place.
 *
 * Amounts are decimal strings throughout. Only `MoneyText` formats them and
 * nothing here adds or subtracts one — the balance shown is the server's.
 */

const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'critical',
};

const PAYMENT_TONE: Record<InvoicePaymentRow['status'], StatusTone> = {
  PENDING: 'warning',
  COMPLETED: 'success',
  FAILED: 'critical',
  REFUNDED: 'neutral',
};

export function InvoiceWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('billing');
  const invoice = useInvoice(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/billing"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('workspace.back')}
      </Link>

      {invoice.isLoading && !invoice.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : invoice.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !invoice.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <InvoiceBody invoice={invoice.data.data} />
      )}
    </div>
  );
}

function InvoiceBody({ invoice }: { invoice: InvoiceRow }) {
  const t = useTranslations('billing');
  const locale = useLocale();
  const currency = useOrgCurrency();

  const patient = usePatientName(invoice.patientId);
  const action = useInvoiceAction();
  const recordPayment = useRecordPayment();
  const refundPayment = useRefundPayment();

  const [issueOpen, setIssueOpen] = useState(false);
  const [cancelOpen, setCancelOpen] = useState(false);
  const [refundInvoiceOpen, setRefundInvoiceOpen] = useState(false);
  const [paymentOpen, setPaymentOpen] = useState(false);
  const [refundTarget, setRefundTarget] = useState<InvoicePaymentRow | null>(null);

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const failure: QueryError | null =
    (action.isError && action.error) ||
    (recordPayment.isError && recordPayment.error) ||
    (refundPayment.isError && refundPayment.error) ||
    null;
  const alert = failure ? describeFailure(failure, t) : null;

  const canIssue = invoice.status === 'DRAFT';
  const canCancel = invoice.status === 'DRAFT' || invoice.status === 'ISSUED';
  const canPay = invoice.status === 'ISSUED' || invoice.status === 'PARTIALLY_PAID';
  const canRefundInvoice = invoice.status === 'PAID';
  const hasActions = canIssue || canCancel || canPay || canRefundInvoice;

  const itemColumns: readonly DataTableColumn<InvoiceItemRow>[] = [
    {
      key: 'description',
      header: t('workspace.columnDescription'),
      cell: (row) => <span className="text-primary">{row.description}</span>,
    },
    {
      key: 'quantity',
      header: t('workspace.columnQuantity'),
      numeric: true,
      cell: (row) => <span className="tabular-nums text-secondary">{row.quantity}</span>,
    },
    {
      key: 'unit',
      header: t('workspace.columnUnitPrice'),
      numeric: true,
      cell: (row) => <MoneyText amount={row.unitPrice} currency={currency} />,
    },
    {
      key: 'line',
      header: t('workspace.columnLineTotal'),
      numeric: true,
      cell: (row) => <MoneyText amount={row.lineTotal} currency={currency} />,
    },
  ];

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold tabular-nums text-primary">
          {invoice.invoiceNumber}
        </h1>
        <StatusPill tone={STATUS_TONE[invoice.status]} label={t(`status.${invoice.status}`)} />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.summaryHeading')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('workspace.patient')}</dt>
            <dd className="text-primary">
              {patient.isLoading ? '…' : patient.data?.data ?? t('unknownPatient')}
            </dd>
            <dt className="text-tertiary">{t('workspace.issued')}</dt>
            <dd className="tabular-nums text-primary">
              {format(invoice.issuedAt) ?? t('workspace.notIssued')}
            </dd>
            <dt className="text-tertiary">{t('workspace.due')}</dt>
            <dd className="tabular-nums text-primary">
              {format(invoice.dueAt) ?? t('workspace.noDueDate')}
            </dd>
          </dl>
          {invoice.cancelReason ? (
            <NoteLine label={t('workspace.cancelReason')} value={invoice.cancelReason} />
          ) : null}
          {invoice.refundReason ? (
            <NoteLine label={t('workspace.refundReason')} value={invoice.refundReason} />
          ) : null}
          <Link
            href={`/patients/${invoice.patientId}`}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            {t('workspace.openPatient')}
          </Link>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.totalsHeading')}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('workspace.subtotal')}</dt>
            <dd className="text-right">
              <MoneyText amount={invoice.subtotal} currency={currency} />
            </dd>
            <dt className="text-tertiary">{t('workspace.discount')}</dt>
            <dd className="text-right">
              <MoneyText amount={invoice.discountAmount} currency={currency} />
            </dd>
            <dt className="text-tertiary">{t('workspace.tax')}</dt>
            <dd className="text-right">
              <MoneyText amount={invoice.taxAmount} currency={currency} />
            </dd>
            <dt className="border-t border-border pt-2 font-medium text-primary">
              {t('workspace.total')}
            </dt>
            <dd className="border-t border-border pt-2 text-right font-medium">
              <MoneyText amount={invoice.total} currency={currency} />
            </dd>
            <dt className="font-medium text-primary">{t('workspace.balance')}</dt>
            <dd className="text-right font-medium">
              <MoneyText amount={invoice.balanceDue} currency={currency} />
            </dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.actionsHeading')}</h2>
          {hasActions ? (
            <div className="flex flex-col items-start gap-2">
              {canIssue ? (
                <Button variant="primary" onClick={() => setIssueOpen(true)}>
                  {t('action.issue')}
                </Button>
              ) : null}
              {canPay ? (
                <Button variant="primary" onClick={() => setPaymentOpen(true)}>
                  {t('action.recordPayment')}
                </Button>
              ) : null}
              {canRefundInvoice ? (
                <Button variant="secondary" onClick={() => setRefundInvoiceOpen(true)}>
                  {t('action.refund')}
                </Button>
              ) : null}
              {canCancel ? (
                <Button variant="secondary" onClick={() => setCancelOpen(true)}>
                  {t('action.cancel')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-meta text-secondary">{t('workspace.noActions')}</p>
          )}
          <p className="text-caption text-tertiary">
            {t('workspace.version', { version: invoice.version })}
          </p>
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('workspace.itemsHeading')}</h2>
        <DataTable<InvoiceItemRow>
          caption={t('workspace.itemsCaption')}
          columns={itemColumns}
          rows={invoice.items}
          rowKey={(row) => row.id}
          emptyMessage={t('workspace.noItems')}
        />
      </section>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('workspace.paymentsHeading')}</h2>
        {invoice.payments.length === 0 ? (
          <p className="text-meta text-tertiary">{t('workspace.noPayments')}</p>
        ) : (
          <ul className="flex flex-col gap-3">
            {invoice.payments.map((payment) => (
              <li
                key={payment.id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <span className="flex flex-col">
                  <span className="text-meta font-medium tabular-nums text-primary">
                    {payment.receiptNumber}
                  </span>
                  <span className="text-caption text-tertiary">
                    {t(`method.${payment.method}`)}
                    {payment.recordedAt
                      ? ` · ${t('workspace.recorded', { date: format(payment.recordedAt) ?? '' })}`
                      : ''}
                  </span>
                </span>
                <span className="flex items-center gap-3">
                  <MoneyText amount={payment.amount} currency={currency} />
                  <StatusPill
                    size="sm"
                    tone={PAYMENT_TONE[payment.status]}
                    label={t(`paymentStatus.${payment.status}`)}
                  />
                  {payment.status === 'COMPLETED' ? (
                    <Button variant="tertiary" size="sm" onClick={() => setRefundTarget(payment)}>
                      {t('action.refundPayment')}
                    </Button>
                  ) : null}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>

      <ConfirmDialog
        open={issueOpen}
        onOpenChange={(open) => !open && setIssueOpen(false)}
        onConfirm={() => {
          action.mutate({ id: invoice.id, action: 'issue' });
          setIssueOpen(false);
        }}
        title={t('confirm.issueTitle')}
        description={t('confirm.issueBody')}
        confirmLabel={t('action.issue')}
        cancelLabel={t('dialog.cancel')}
        tone="primary"
        pending={action.isPending}
      />

      <ReasonDialog
        key={`cancel-${invoice.id}`}
        open={cancelOpen}
        title={t('reason.cancelTitle')}
        description={t('reason.cancelBody')}
        confirmLabel={t('action.cancel')}
        cancelLabel={t('dialog.cancel')}
        pending={action.isPending}
        onOpenChange={(open) => !open && setCancelOpen(false)}
        onConfirm={(reason) => {
          action.mutate({ id: invoice.id, action: 'cancel', reason });
          setCancelOpen(false);
        }}
      />

      <ReasonDialog
        key={`refund-${invoice.id}`}
        open={refundInvoiceOpen}
        title={t('reason.refundTitle')}
        description={t('reason.refundBody')}
        confirmLabel={t('action.refund')}
        cancelLabel={t('dialog.cancel')}
        pending={action.isPending}
        onOpenChange={(open) => !open && setRefundInvoiceOpen(false)}
        onConfirm={(reason) => {
          action.mutate({ id: invoice.id, action: 'refund', reason });
          setRefundInvoiceOpen(false);
        }}
      />

      <RecordPaymentDialog
        key={`payment-${invoice.id}`}
        open={paymentOpen}
        balanceDue={invoice.balanceDue}
        currency={currency}
        pending={recordPayment.isPending}
        cancelLabel={t('dialog.cancel')}
        onOpenChange={(open) => !open && setPaymentOpen(false)}
        onConfirm={(input) => {
          recordPayment.mutate({ invoiceId: invoice.id, ...input });
          setPaymentOpen(false);
        }}
      />

      <RefundPaymentDialog
        key={`refund-payment-${refundTarget?.id ?? 'none'}`}
        payment={refundTarget}
        currency={currency}
        pending={refundPayment.isPending}
        cancelLabel={t('dialog.cancel')}
        onOpenChange={(open) => !open && setRefundTarget(null)}
        onConfirm={(reason) => {
          if (refundTarget) refundPayment.mutate({ id: refundTarget.id, reason });
          setRefundTarget(null);
        }}
      />
    </div>
  );
}

function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return { title: t('errors.staleTitle'), body: t('errors.staleBody') };
  }
  if (error.code === 'PAYMENT_ALREADY_PROCESSED') {
    return { title: t('errors.paymentProcessedTitle'), body: t('errors.paymentProcessedBody') };
  }
  return { title: t('errors.failedTitle'), body: t('errors.failedBody') };
}

function NoteLine({ label, value }: { label: string; value: string }) {
  return (
    <p className="text-meta text-secondary">
      <span className="font-medium text-tertiary">{label}: </span>
      {value}
    </p>
  );
}

function ReasonDialog({
  open,
  title,
  description,
  confirmLabel,
  cancelLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  title: string;
  description: string;
  confirmLabel: string;
  cancelLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('billing');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    const message = reasonError(reason);
    if (message) {
      setError(message);
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={title} description={description} />
        <DialogBody>
          <ReasonField
            value={reason}
            onChange={(next) => {
              setReason(next);
              if (error) setError(null);
            }}
            error={error}
            label={t('reason.label')}
            hint={t('reason.hint')}
            placeholder={t('reason.placeholder')}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {cancelLabel}
          </Button>
          <Button variant="danger" disabled={pending} onClick={submit}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

const AMOUNT_PATTERN = /^\d+(\.\d{1,2})?$/;

function RecordPaymentDialog({
  open,
  balanceDue,
  currency,
  pending,
  cancelLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  balanceDue: string;
  currency: string;
  pending: boolean;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (input: {
    amount: string;
    method: PaymentMethod;
    externalReference?: string;
    note?: string;
  }) => void;
}) {
  const t = useTranslations('billing');
  const [amount, setAmount] = useState('');
  const [method, setMethod] = useState<PaymentMethod | ''>('');
  const [reference, setReference] = useState('');
  const [note, setNote] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setAmount('');
    setMethod('');
    setReference('');
    setNote('');
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = amount.trim();
    if (!trimmed) {
      setError(t('payment.amountRequired'));
      return;
    }
    if (!AMOUNT_PATTERN.test(trimmed) || /^0+(\.0+)?$/.test(trimmed)) {
      setError(t('payment.amountInvalid'));
      return;
    }
    if (!method) {
      setError(t('payment.methodRequired'));
      return;
    }
    onConfirm({
      amount: trimmed,
      method,
      externalReference: reference.trim() || undefined,
      note: note.trim() || undefined,
    });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('payment.title')} description={t('payment.body')} />
        <DialogBody className="flex flex-col gap-4">
          <p className="text-meta text-secondary">
            {t('payment.outstanding')}{' '}
            <MoneyText amount={balanceDue} currency={currency} />
          </p>
          <Field id="payment-amount" label={t('payment.amount')} hint={t('payment.amountHint')} required>
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                inputMode="decimal"
                value={amount}
                onChange={(event) => {
                  setAmount(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <Field id="payment-method" label={t('payment.method')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={method}
                onChange={(event) => {
                  setMethod(event.target.value as PaymentMethod | '');
                  if (error) setError(null);
                }}
              >
                <option value="">{t('payment.chooseMethod')}</option>
                {PAYMENT_METHODS.map((value) => (
                  <option key={value} value={value}>
                    {t(`method.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="payment-reference" label={t('payment.reference')} hint={t('payment.referenceHint')}>
            {({ controlId, describedBy }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                value={reference}
                onChange={(event) => setReference(event.target.value)}
              />
            )}
          </Field>
          <Field id="payment-note" label={t('payment.note')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {cancelLabel}
          </Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {t('payment.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function RefundPaymentDialog({
  payment,
  currency,
  pending,
  cancelLabel,
  onOpenChange,
  onConfirm,
}: {
  payment: InvoicePaymentRow | null;
  currency: string;
  pending: boolean;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (reason: string) => void;
}) {
  const t = useTranslations('billing');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setReason('');
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    const message = reasonError(reason);
    if (message) {
      setError(message);
      return;
    }
    onConfirm(reason.trim());
  };

  return (
    <Dialog
      open={payment !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader
          title={t('refund.title')}
          description={payment ? t('refund.body', { receipt: payment.receiptNumber }) : ''}
        />
        <DialogBody className="flex flex-col gap-4">
          {payment ? (
            <p className="text-meta text-secondary">
              {payment.receiptNumber} ·{' '}
              <MoneyText amount={payment.amount} currency={currency} />
            </p>
          ) : null}
          <ReasonField
            value={reason}
            onChange={(next) => {
              setReason(next);
              if (error) setError(null);
            }}
            error={error}
            label={t('refund.reasonLabel')}
            hint={t('reason.hint')}
            placeholder={t('reason.placeholder')}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {cancelLabel}
          </Button>
          <Button variant="danger" disabled={pending} onClick={submit}>
            {t('refund.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
