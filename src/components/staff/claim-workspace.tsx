'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { MoneyText } from '@/components/clinical/money-text';
import { ReasonField, reasonError } from '@/components/clinical/reason-field';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { useClaim, useClaimAction, useOrgCurrency, usePatientName } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import type { ClaimStatus, InsuranceClaimRow } from '@/lib/data/insurance';

/**
 * Claim workspace (F7) — one insurance claim, whichever point of its lifecycle it
 * sits at.
 *
 * The read answers `{ claim }` while the export types the bare entity, and every
 * action write answers the same envelope (GAP-020), so every body is validated in
 * `src/lib/data/insurance.ts`. The action bar offers only the moves the server's
 * lifecycle allows (DRAFT→SUBMITTED; SUBMITTED→APPROVED|PARTIALLY_APPROVED|DENIED;
 * APPROVED|PARTIALLY_APPROVED→PAID), and a move that races a stale tab resolves to
 * a 409 rendered in place.
 *
 * Amounts are decimal strings throughout. Only `MoneyText` formats them and
 * nothing here adds or subtracts one — the approved amount shown is the server's.
 * Paying a claim posts an INSURANCE payment against the linked invoice, so that
 * invoice is linked for the ledger view rather than recomputed here.
 */

const STATUS_TONE: Record<ClaimStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'info',
  PARTIALLY_APPROVED: 'warning',
  DENIED: 'critical',
  PAID: 'success',
};

export function ClaimWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('insurance');
  const claim = useClaim(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/insurance"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('workspace.back')}
      </Link>

      {claim.isLoading && !claim.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : claim.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !claim.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <ClaimBody claim={claim.data.data} />
      )}
    </div>
  );
}

function ClaimBody({ claim }: { claim: InsuranceClaimRow }) {
  const t = useTranslations('insurance');
  const locale = useLocale();
  const currency = useOrgCurrency();

  const patient = usePatientName(claim.patientId);
  const action = useClaimAction();

  const [submitOpen, setSubmitOpen] = useState(false);
  const [approveOpen, setApproveOpen] = useState(false);
  const [denyOpen, setDenyOpen] = useState(false);
  const [payOpen, setPayOpen] = useState(false);

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const failure: QueryError | null = action.isError && action.error ? action.error : null;
  const alert = failure ? describeFailure(failure, t) : null;

  const canSubmit = claim.status === 'DRAFT';
  const canDecide = claim.status === 'SUBMITTED';
  const canPay = claim.status === 'APPROVED' || claim.status === 'PARTIALLY_APPROVED';
  const hasActions = canSubmit || canDecide || canPay;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold tabular-nums text-primary">
          {claim.claimNumber}
        </h1>
        <StatusPill tone={STATUS_TONE[claim.status]} label={t(`status.${claim.status}`)} />
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
            <dt className="text-tertiary">{t('workspace.policy')}</dt>
            <dd className="tabular-nums text-primary">{claim.policyId}</dd>
            <dt className="text-tertiary">{t('workspace.submitted')}</dt>
            <dd className="tabular-nums text-primary">
              {format(claim.submittedAt) ?? t('workspace.notSubmitted')}
            </dd>
            <dt className="text-tertiary">{t('workspace.decided')}</dt>
            <dd className="tabular-nums text-primary">
              {format(claim.approvedAt ?? claim.deniedAt) ?? t('workspace.notDecided')}
            </dd>
            {claim.paidAt ? (
              <>
                <dt className="text-tertiary">{t('workspace.paid')}</dt>
                <dd className="tabular-nums text-primary">{format(claim.paidAt)}</dd>
              </>
            ) : null}
          </dl>
          <Link
            href={`/patients/${claim.patientId}`}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            {t('workspace.openPatient')}
          </Link>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.amountsHeading')}</h2>
          <dl className="grid grid-cols-[1fr_auto] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('workspace.claimed')}</dt>
            <dd className="text-right">
              <MoneyText amount={claim.amount} currency={currency} />
            </dd>
            <dt className="font-medium text-primary">{t('workspace.approved')}</dt>
            <dd className="text-right font-medium">
              {claim.approvedAmount ? (
                <MoneyText amount={claim.approvedAmount} currency={currency} />
              ) : (
                <span className="text-tertiary">{t('notApproved')}</span>
              )}
            </dd>
          </dl>
          <Link
            href={`/billing/${claim.invoiceId}`}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            {t('workspace.openInvoice')}
          </Link>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.actionsHeading')}</h2>
          {hasActions ? (
            <div className="flex flex-col items-start gap-2">
              {canSubmit ? (
                <Button variant="primary" onClick={() => setSubmitOpen(true)}>
                  {t('action.submit')}
                </Button>
              ) : null}
              {canDecide ? (
                <Button variant="primary" onClick={() => setApproveOpen(true)}>
                  {t('action.decide')}
                </Button>
              ) : null}
              {canPay ? (
                <Button variant="primary" onClick={() => setPayOpen(true)}>
                  {t('action.pay')}
                </Button>
              ) : null}
              {canDecide ? (
                <Button variant="danger" onClick={() => setDenyOpen(true)}>
                  {t('action.deny')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-meta text-secondary">{t('workspace.noActions')}</p>
          )}
          <p className="text-caption text-tertiary">
            {t('workspace.version', { version: claim.version })}
          </p>
        </section>
      </div>

      {claim.notes || claim.denyReason ? (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('workspace.notesHeading')}</h2>
          {claim.notes ? <NoteLine label={t('workspace.note')} value={claim.notes} /> : null}
          {claim.denyReason ? (
            <NoteLine label={t('workspace.denyReason')} value={claim.denyReason} />
          ) : null}
        </section>
      ) : null}

      <ConfirmDialog
        open={submitOpen}
        onOpenChange={(open) => !open && setSubmitOpen(false)}
        onConfirm={() => {
          action.mutate({ id: claim.id, action: 'submit' });
          setSubmitOpen(false);
        }}
        title={t('confirm.submitTitle')}
        description={t('confirm.submitBody')}
        confirmLabel={t('action.submit')}
        cancelLabel={t('dialog.cancel')}
        tone="primary"
        pending={action.isPending}
      />

      <DecideClaimDialog
        key={`decide-${claim.id}`}
        open={approveOpen}
        claimAmount={claim.amount}
        currency={currency}
        pending={action.isPending}
        cancelLabel={t('dialog.cancel')}
        onOpenChange={(open) => !open && setApproveOpen(false)}
        onConfirm={(nextAction, approvedAmount) => {
          action.mutate({ id: claim.id, action: nextAction, approvedAmount });
          setApproveOpen(false);
        }}
      />

      <ReasonDialog
        key={`deny-${claim.id}`}
        open={denyOpen}
        title={t('reason.denyTitle')}
        description={t('reason.denyBody')}
        confirmLabel={t('action.deny')}
        cancelLabel={t('dialog.cancel')}
        pending={action.isPending}
        onOpenChange={(open) => !open && setDenyOpen(false)}
        onConfirm={(reason) => {
          action.mutate({ id: claim.id, action: 'deny', reason });
          setDenyOpen(false);
        }}
      />

      <ConfirmDialog
        open={payOpen}
        onOpenChange={(open) => !open && setPayOpen(false)}
        onConfirm={() => {
          action.mutate({ id: claim.id, action: 'pay' });
          setPayOpen(false);
        }}
        title={t('confirm.payTitle')}
        description={t('confirm.payBody')}
        confirmLabel={t('action.pay')}
        cancelLabel={t('dialog.cancel')}
        tone="primary"
        pending={action.isPending}
      />
    </div>
  );
}

function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return { title: t('errors.staleTitle'), body: t('errors.staleBody') };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return { title: t('errors.invalidTitle'), body: t('errors.invalidBody') };
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
  const t = useTranslations('insurance');
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

function DecideClaimDialog({
  open,
  claimAmount,
  currency,
  pending,
  cancelLabel,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  claimAmount: string;
  currency: string;
  pending: boolean;
  cancelLabel: string;
  onOpenChange: (open: boolean) => void;
  onConfirm: (action: 'approve' | 'partial_approve', approvedAmount: string) => void;
}) {
  const t = useTranslations('insurance');
  const [amount, setAmount] = useState(claimAmount);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setAmount(claimAmount);
    setError(null);
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = amount.trim();
    if (!trimmed) {
      setError(t('decide.amountRequired'));
      return;
    }
    if (!AMOUNT_PATTERN.test(trimmed) || /^0+(\.0+)?$/.test(trimmed)) {
      setError(t('decide.amountInvalid'));
      return;
    }
    if (toCents(trimmed) > toCents(claimAmount)) {
      setError(t('decide.amountAboveClaim'));
      return;
    }
    const nextAction = toCents(trimmed) < toCents(claimAmount) ? 'partial_approve' : 'approve';
    onConfirm(nextAction, trimmed);
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('decide.title')} description={t('decide.body')} />
        <DialogBody className="flex flex-col gap-4">
          <p className="text-meta text-secondary">
            {t('decide.claimed')} <MoneyText amount={claimAmount} currency={currency} />
          </p>
          <Field
            id="claim-approved-amount"
            label={t('decide.amount')}
            hint={t('decide.amountHint')}
            required
          >
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
            {t('decide.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function toCents(value: string): number {
  const [whole, fraction = ''] = value.split('.');
  return Number(whole) * 100 + Number((fraction + '00').slice(0, 2));
}
