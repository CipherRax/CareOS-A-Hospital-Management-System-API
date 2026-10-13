'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Field, Textarea } from '@/components/ui/field';
import { Button } from '@/components/ui/button';
import { ReasonField, reasonError } from '@/components/clinical/reason-field';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { usePatientName, useRadiologyOrder, useRadiologyOrderTransition, useSubmitImagingReport } from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  RADIOLOGY_ORDER_ACTIONS_BY_STATUS,
  type RadiologyOrderRow,
  type RadiologyStatus,
} from '@/lib/data/radiology';

/**
 * Radiology worklist (F5) — one imaging order, at whatever point of the pipeline
 * it sits.
 *
 * The read answers `{ order }` while the export types the bare entity, and the
 * transition writes answer the same shape (GAP-020), so every body is validated
 * in `src/lib/data/radiology.ts`. The action bar is the server's transition
 * graph (`RADIOLOGY_ORDER_ACTIONS_BY_STATUS`): a move the server would refuse is
 * never offered, and one that races a stale tab resolves to a 409 rendered in
 * place.
 */

const STATUS_TONE: Record<RadiologyStatus, StatusTone> = {
  ORDERED: 'neutral',
  SCHEDULED: 'info',
  PERFORMED: 'warning',
  REPORTED: 'info',
  VERIFIED: 'info',
  RELEASED: 'success',
  CANCELLED: 'neutral',
};

export function RadiologyOrderWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('radiology');
  const order = useRadiologyOrder(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/radiology"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('workspace.back')}
      </Link>

      {order.isLoading && !order.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('workspace.loading')}
        </p>
      ) : order.error ? (
        <EmptyState
          title={t('workspace.unavailableTitle')}
          description={t('workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !order.data ? (
        <EmptyState
          title={t('workspace.notFoundTitle')}
          description={t('workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <RadiologyOrderBody order={order.data.data} />
      )}
    </div>
  );
}

function RadiologyOrderBody({ order }: { order: RadiologyOrderRow }) {
  const t = useTranslations('radiology');
  const locale = useLocale();

  const patient = usePatientName(order.patientId);
  const transition = useRadiologyOrderTransition();
  const submitReport = useSubmitImagingReport();

  const [confirmAction, setConfirmAction] = useState<'verify' | 'release' | null>(null);
  const [cancelOpen, setCancelOpen] = useState(false);

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const failure: QueryError | null =
    (transition.isError && transition.error) || (submitReport.isError && submitReport.error) || null;
  const alert = failure ? describeFailure(failure, t) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {patient.isLoading ? '…' : patient.data?.data ?? t('unknownPatient')}
        </h1>
        <StatusPill tone={STATUS_TONE[order.status]} label={t(`status.${order.status}`)} />
        <span className="text-meta text-secondary">
          {t(`modality.${order.modality}`)}
          {order.region ? <span className="text-tertiary"> · {order.region}</span> : null}
        </span>
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <OrderCard order={order} format={format} />

        <ActionBar
          order={order}
          pending={transition.isPending}
          onTransition={(action) => transition.mutate({ id: order.id, action })}
          onConfirm={setConfirmAction}
          onCancel={() => setCancelOpen(true)}
        />

        <ReportCard order={order} format={format} submitReport={submitReport} />
      </div>

      <ConfirmDialog
        open={confirmAction !== null}
        onOpenChange={(open) => !open && setConfirmAction(null)}
        onConfirm={() => {
          if (confirmAction) transition.mutate({ id: order.id, action: confirmAction });
          setConfirmAction(null);
        }}
        title={confirmAction ? t(`confirm.${confirmAction}Title`) : ''}
        description={confirmAction ? t(`confirm.${confirmAction}Body`) : ''}
        confirmLabel={confirmAction ? t(`action.${confirmAction}`) : ''}
        cancelLabel={t('dialog.cancel')}
        tone="primary"
        pending={transition.isPending}
      />

      <ReasonDialog
        key={cancelOpen ? 'cancel-open' : 'cancel-closed'}
        open={cancelOpen}
        title={t('reason.cancelTitle')}
        description={t('reason.cancelBody')}
        confirmLabel={t('action.cancel')}
        cancelLabel={t('dialog.cancel')}
        pending={transition.isPending}
        onOpenChange={setCancelOpen}
        onConfirm={(reason) => {
          transition.mutate({ id: order.id, action: 'cancel', reason });
          setCancelOpen(false);
        }}
      />
    </div>
  );
}

function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return { title: t('errors.staleTitle'), body: t('errors.staleBody') };
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

function OrderCard({
  order,
  format,
}: {
  order: RadiologyOrderRow;
  format: (iso: string | null) => string | null;
}) {
  const t = useTranslations('radiology');

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('workspace.orderHeading')}</h2>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
        <dt className="text-tertiary">{t('workspace.modality')}</dt>
        <dd className="text-primary">{t(`modality.${order.modality}`)}</dd>
        <dt className="text-tertiary">{t('workspace.region')}</dt>
        <dd className="text-primary">{order.region ?? t('workspace.noRegion')}</dd>
        <dt className="text-tertiary">{t('workspace.ordered')}</dt>
        <dd className="tabular-nums text-primary">{format(order.orderedAt) ?? t('unknownDate')}</dd>
        <dt className="text-tertiary">{t('workspace.requested')}</dt>
        <dd className="tabular-nums text-primary">
          {format(order.requestedAt) ?? t('workspace.notYet')}
        </dd>
        <dt className="text-tertiary">{t('workspace.performed')}</dt>
        <dd className="tabular-nums text-primary">
          {format(order.performedAt) ?? t('workspace.notYet')}
        </dd>
        <dt className="text-tertiary">{t('workspace.released')}</dt>
        <dd className="tabular-nums text-primary">
          {format(order.releasedAt) ?? t('workspace.notYet')}
        </dd>
        <dt className="text-tertiary">{t('workspace.clinicalNotes')}</dt>
        <dd className="text-primary">{order.clinicalNotes ?? t('workspace.noNotes')}</dd>
      </dl>

      {order.status === 'CANCELLED' && order.cancelledReason ? (
        <NoteLine label={t('workspace.cancelReason')} value={order.cancelledReason} />
      ) : null}

      <Link
        href={`/patients/${order.patientId}`}
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        {t('workspace.openPatient')}
      </Link>
    </section>
  );
}

function ActionBar({
  order,
  pending,
  onTransition,
  onConfirm,
  onCancel,
}: {
  order: RadiologyOrderRow;
  pending: boolean;
  onTransition: (action: 'schedule' | 'perform') => void;
  onConfirm: (action: 'verify' | 'release') => void;
  onCancel: () => void;
}) {
  const t = useTranslations('radiology');
  const actions = RADIOLOGY_ORDER_ACTIONS_BY_STATUS[order.status].filter(
    (action) => action !== 'report',
  );

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('workspace.actions')}</h2>
      {actions.length === 0 ? (
        <p className="text-meta text-secondary">{t('workspace.noActions')}</p>
      ) : (
        <div className="flex flex-col items-start gap-2">
          {actions.map((action) => {
            if (action === 'verify' || action === 'release') {
              return (
                <Button key={action} variant="primary" onClick={() => onConfirm(action)}>
                  {t(`action.${action}`)}
                </Button>
              );
            }
            if (action === 'cancel') {
              return (
                <Button key={action} variant="secondary" onClick={onCancel}>
                  {t(`action.${action}`)}
                </Button>
              );
            }
            return (
              <Button key={action} variant="primary" disabled={pending} onClick={() => onTransition(action)}>
                {t(`action.${action}`)}
              </Button>
            );
          })}
        </div>
      )}
      <p className="text-caption text-tertiary">
        {t('workspace.version', { version: order.version })}
      </p>
    </section>
  );
}

function ReportCard({
  order,
  format,
  submitReport,
}: {
  order: RadiologyOrderRow;
  format: (iso: string | null) => string | null;
  submitReport: ReturnType<typeof useSubmitImagingReport>;
}) {
  const t = useTranslations('radiology');
  const report = order.report;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('workspace.report')}</h2>

      {order.status === 'PERFORMED' ? (
        <ReportForm order={order} submitReport={submitReport} />
      ) : report ? (
        <div className="flex flex-col gap-3 text-meta">
          <div>
            <p className="font-medium text-tertiary">{t('workspace.findings')}</p>
            <p className="whitespace-pre-wrap text-primary">
              {report.findings ?? t('workspace.noNotes')}
            </p>
          </div>
          {report.summary ? (
            <div>
              <p className="font-medium text-tertiary">{t('workspace.summary')}</p>
              <p className="whitespace-pre-wrap text-primary">{report.summary}</p>
            </div>
          ) : null}
          {report.impression ? (
            <div>
              <p className="font-medium text-tertiary">{t('workspace.impression')}</p>
              <p className="whitespace-pre-wrap text-primary">{report.impression}</p>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-x-6 gap-y-1 text-caption text-tertiary">
            <span>
              {t('workspace.entered')}: {format(report.enteredAt) ?? t('workspace.notYet')}
            </span>
            <span>
              {t('workspace.verified')}: {format(report.verifiedAt) ?? t('workspace.notYet')}
            </span>
          </div>
        </div>
      ) : (
        <p className="text-meta text-tertiary">{t('workspace.noReport')}</p>
      )}
    </section>
  );
}

function ReportForm({
  order,
  submitReport,
}: {
  order: RadiologyOrderRow;
  submitReport: ReturnType<typeof useSubmitImagingReport>;
}) {
  const t = useTranslations('radiology');
  const [findings, setFindings] = useState('');
  const [summary, setSummary] = useState('');
  const [impression, setImpression] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!findings.trim()) {
      setError(t('report.findingsRequired'));
      return;
    }
    setError(null);
    submitReport.mutate({
      id: order.id,
      findings: findings.trim(),
      summary: summary.trim() || undefined,
      impression: impression.trim() || undefined,
    });
  };

  return (
    <div className="flex flex-col gap-3">
      <p className="text-meta text-secondary">{t('report.intro')}</p>

      <Field id="radiology-report-findings" label={t('report.findings')} required error={error ?? undefined}>
        {({ controlId, describedBy, invalid }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            invalid={invalid}
            rows={4}
            value={findings}
            onChange={(event) => {
              setFindings(event.target.value);
              if (error) setError(null);
            }}
          />
        )}
      </Field>

      <Field id="radiology-report-summary" label={t('report.summary')} hint={t('report.optional')}>
        {({ controlId, describedBy }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            rows={2}
            value={summary}
            onChange={(event) => setSummary(event.target.value)}
          />
        )}
      </Field>

      <Field
        id="radiology-report-impression"
        label={t('report.impression')}
        hint={t('report.optional')}
      >
        {({ controlId, describedBy }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            rows={2}
            value={impression}
            onChange={(event) => setImpression(event.target.value)}
          />
        )}
      </Field>

      <div>
        <Button variant="primary" disabled={submitReport.isPending} onClick={submit}>
          {t('report.submit')}
        </Button>
      </div>
    </div>
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
  const t = useTranslations('radiology');
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
          <Button variant="primary" disabled={pending} onClick={submit}>
            {confirmLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
