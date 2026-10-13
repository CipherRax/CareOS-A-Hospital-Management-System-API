'use client';

import Link from 'next/link';
import { AlertTriangle, ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
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
import { Field, Input, Textarea } from '@/components/ui/field';
import {
  useAcknowledgeCritical,
  useAmendLabResult,
  useEnterLabResults,
  useLabOrder,
  useLabOrderTransition,
  useLabTests,
  usePatientName,
} from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  LAB_ORDER_ACTIONS_BY_STATUS,
  type CriticalResultRow,
  type LabOrderDetail,
  type LabOrderItemRow,
  type LabOrderPriority,
  type LabOrderStatus,
  type LabResultRow,
  type LabSampleStatus,
  type LabTestFieldRow,
} from '@/lib/data/laboratory';

/**
 * Laboratory worklist (F5) — one order, at whatever point of the pipeline it
 * sits.
 *
 * The read answers `{ order }` while the export types the bare entity, and the
 * transition writes answer the same shape (GAP-020), so every body is validated
 * in `src/lib/data/laboratory.ts`. The action bar is the server's transition
 * graph (`LAB_ORDER_ACTIONS_BY_STATUS`): a move the server would refuse is never
 * offered, and one that races a stale tab resolves to a 409 rendered in place.
 *
 * Entering results needs field metadata the order omits, so the test catalog is
 * joined in — the same field-to-analyte mapping the doctor's results view uses.
 */

const STATUS_TONE: Record<LabOrderStatus, StatusTone> = {
  ORDERED: 'neutral',
  COLLECTED: 'info',
  RECEIVED: 'info',
  PROCESSING: 'warning',
  RESULT_READY: 'info',
  VERIFIED: 'info',
  RELEASED: 'success',
  REJECTED: 'critical',
  CANCELLED: 'neutral',
};

const PRIORITY_TONE: Record<LabOrderPriority, StatusTone> = {
  ROUTINE: 'neutral',
  URGENT: 'warning',
  STAT: 'critical',
};

const SAMPLE_TONE: Record<LabSampleStatus, StatusTone> = {
  ORDERED: 'neutral',
  COLLECTED: 'info',
  RECEIVED: 'info',
  PROCESSING: 'warning',
  COMPLETED: 'success',
  REJECTED: 'critical',
};

function referenceRange(field: LabTestFieldRow): string | null {
  if (field.referenceMin && field.referenceMax) return `${field.referenceMin}–${field.referenceMax}`;
  if (field.referenceMin) return `≥ ${field.referenceMin}`;
  if (field.referenceMax) return `≤ ${field.referenceMax}`;
  return null;
}

export function LabOrderWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('laboratory');
  const order = useLabOrder(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/lab"
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
        <LabOrderBody order={order.data.data} />
      )}
    </div>
  );
}

function LabOrderBody({ order }: { order: LabOrderDetail }) {
  const t = useTranslations('laboratory');
  const locale = useLocale();

  const patient = usePatientName(order.patientId);
  const catalog = useLabTests({ active: 'true' });

  const fields = useMemo<readonly LabTestFieldRow[]>(
    () => (catalog.data?.data.items ?? []).flatMap((test) => test.fields),
    [catalog.data],
  );
  const fieldIndex = useMemo(() => new Map(fields.map((field) => [field.id, field])), [fields]);
  const fieldsByTest = useMemo(() => {
    const index = new Map<string, LabTestFieldRow[]>();
    for (const field of fields) {
      const list = index.get(field.testId) ?? [];
      list.push(field);
      index.set(field.testId, list);
    }
    return index;
  }, [fields]);

  const transition = useLabOrderTransition();
  const enterResults = useEnterLabResults();
  const amend = useAmendLabResult();
  const acknowledge = useAcknowledgeCritical();

  const [confirmAction, setConfirmAction] = useState<'verify' | 'release' | null>(null);
  const [reasonAction, setReasonAction] = useState<'reject' | 'cancel' | null>(null);
  const [amendTarget, setAmendTarget] = useState<LabResultRow | null>(null);
  const [criticalTarget, setCriticalTarget] = useState<CriticalResultRow | null>(null);

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const failure: QueryError | null =
    (transition.isError && transition.error) ||
    (enterResults.isError && enterResults.error) ||
    (amend.isError && amend.error) ||
    (acknowledge.isError && acknowledge.error) ||
    null;

  const alert = failure ? describeFailure(failure, t) : null;

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {patient.isLoading ? '…' : patient.data?.data ?? t('unknownPatient')}
        </h1>
        <StatusPill tone={STATUS_TONE[order.status]} label={t(`status.${order.status}`)} />
        <StatusPill
          size="sm"
          tone={PRIORITY_TONE[order.priority]}
          label={t(`priority.${order.priority}`)}
        />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">
            {t('workspace.orderHeading')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('workspace.priority')}</dt>
            <dd className="text-primary">{t(`priority.${order.priority}`)}</dd>
            <dt className="text-tertiary">{t('workspace.ordered')}</dt>
            <dd className="tabular-nums text-primary">{format(order.orderedAt) ?? t('unknownDate')}</dd>
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
          {order.status === 'REJECTED' && order.rejectionReason ? (
            <NoteLine label={t('workspace.rejectReason')} value={order.rejectionReason} />
          ) : null}

          <Link
            href={`/patients/${order.patientId}`}
            className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
          >
            {t('workspace.openPatient')}
          </Link>
        </section>

        <SampleCard order={order} format={format} />

        <ActionBar
          order={order}
          pending={transition.isPending}
          onTransition={(action) => transition.mutate({ id: order.id, action })}
          onConfirm={setConfirmAction}
          onReason={setReasonAction}
        />
      </div>

      <ResultsSection
        order={order}
        fieldIndex={fieldIndex}
        fieldsByTest={fieldsByTest}
        catalogLoading={catalog.isLoading}
        enterResults={enterResults}
        onAmend={setAmendTarget}
      />

      <CriticalSection
        order={order}
        fieldIndex={fieldIndex}
        onAcknowledge={setCriticalTarget}
      />

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
        key={reasonAction ?? 'no-reason'}
        open={reasonAction !== null}
        title={reasonAction ? t(`reason.${reasonAction}Title`) : ''}
        description={reasonAction ? t(`reason.${reasonAction}Body`) : ''}
        confirmLabel={reasonAction ? t(`action.${reasonAction}`) : ''}
        cancelLabel={t('dialog.cancel')}
        pending={transition.isPending}
        onOpenChange={(open) => !open && setReasonAction(null)}
        onConfirm={(reason) => {
          if (reasonAction) transition.mutate({ id: order.id, action: reasonAction, reason });
          setReasonAction(null);
        }}
      />

      <AmendDialog
        key={amendTarget?.id ?? 'no-amend'}
        result={amendTarget}
        fieldName={amendTarget ? fieldIndex.get(amendTarget.testFieldId)?.name ?? null : null}
        cancelLabel={t('dialog.cancel')}
        pending={amend.isPending}
        onOpenChange={(open) => !open && setAmendTarget(null)}
        onConfirm={(value, reason) => {
          if (amendTarget) amend.mutate({ id: amendTarget.id, value, reason });
          setAmendTarget(null);
        }}
      />

      <AcknowledgeDialog
        key={criticalTarget?.id ?? 'no-critical'}
        critical={criticalTarget}
        order={order}
        fieldIndex={fieldIndex}
        cancelLabel={t('dialog.cancel')}
        pending={acknowledge.isPending}
        onOpenChange={(open) => !open && setCriticalTarget(null)}
        onConfirm={(note) => {
          if (criticalTarget) acknowledge.mutate({ id: criticalTarget.id, note });
          setCriticalTarget(null);
        }}
      />
    </div>
  );
}

function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return { title: t('errors.staleTitle'), body: t('errors.staleBody') };
  }
  if (error.code === 'LAB_RESULT_NOT_ACKNOWLEDGED') {
    return { title: t('errors.criticalTitle'), body: t('errors.criticalBody') };
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

function SampleCard({
  order,
  format,
}: {
  order: LabOrderDetail;
  format: (iso: string | null) => string | null;
}) {
  const t = useTranslations('laboratory');
  const sample = order.sample;

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('workspace.sample')}</h2>
      {sample ? (
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
          <dt className="text-tertiary">{t('workspace.sampleNumber')}</dt>
          <dd className="tabular-nums text-primary">{sample.sampleNumber}</dd>
          <dt className="text-tertiary">{t('workspace.sampleType')}</dt>
          <dd className="text-primary">{t(`sampleType.${sample.sampleType}`)}</dd>
          <dt className="text-tertiary">{t('workspace.sampleStatus')}</dt>
          <dd>
            <StatusPill
              size="sm"
              tone={SAMPLE_TONE[sample.status]}
              label={t(`sampleStatus.${sample.status}`)}
            />
          </dd>
          <dt className="text-tertiary">{t('workspace.collected')}</dt>
          <dd className="tabular-nums text-primary">
            {format(sample.collectedAt) ?? t('workspace.notYet')}
          </dd>
          <dt className="text-tertiary">{t('workspace.received')}</dt>
          <dd className="tabular-nums text-primary">
            {format(sample.receivedAt) ?? t('workspace.notYet')}
          </dd>
          <dt className="text-tertiary">{t('workspace.completed')}</dt>
          <dd className="tabular-nums text-primary">
            {format(sample.completedAt) ?? t('workspace.notYet')}
          </dd>
        </dl>
      ) : (
        <p className="text-meta text-tertiary">{t('workspace.noSample')}</p>
      )}
    </section>
  );
}

function ActionBar({
  order,
  pending,
  onTransition,
  onConfirm,
  onReason,
}: {
  order: LabOrderDetail;
  pending: boolean;
  onTransition: (action: 'collect' | 'receive' | 'process') => void;
  onConfirm: (action: 'verify' | 'release') => void;
  onReason: (action: 'reject' | 'cancel') => void;
}) {
  const t = useTranslations('laboratory');
  const actions = LAB_ORDER_ACTIONS_BY_STATUS[order.status].filter(
    (action) => action !== 'enter_results',
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
            if (action === 'reject' || action === 'cancel') {
              return (
                <Button key={action} variant="secondary" onClick={() => onReason(action)}>
                  {t(`action.${action}`)}
                </Button>
              );
            }
            return (
              <Button
                key={action}
                variant="primary"
                disabled={pending}
                onClick={() => onTransition(action as 'collect' | 'receive' | 'process')}
              >
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

function ResultsSection({
  order,
  fieldIndex,
  fieldsByTest,
  catalogLoading,
  enterResults,
  onAmend,
}: {
  order: LabOrderDetail;
  fieldIndex: ReadonlyMap<string, LabTestFieldRow>;
  fieldsByTest: ReadonlyMap<string, readonly LabTestFieldRow[]>;
  catalogLoading: boolean;
  enterResults: ReturnType<typeof useEnterLabResults>;
  onAmend: (result: LabResultRow) => void;
}) {
  const t = useTranslations('laboratory');

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('workspace.tests')}</h2>
      {order.status === 'PROCESSING' ? (
        <EnterResultsForm
          order={order}
          fieldsByTest={fieldsByTest}
          catalogLoading={catalogLoading}
          enterResults={enterResults}
        />
      ) : (
        <div className="flex flex-col gap-4">
          {order.items.map((item) => (
            <TestResultGroup key={item.id} item={item} fieldIndex={fieldIndex} onAmend={onAmend} />
          ))}
        </div>
      )}
    </section>
  );
}

function TestResultGroup({
  item,
  fieldIndex,
  onAmend,
}: {
  item: LabOrderItemRow;
  fieldIndex: ReadonlyMap<string, LabTestFieldRow>;
  onAmend: (result: LabResultRow) => void;
}) {
  const t = useTranslations('laboratory');

  return (
    <div className="flex flex-col gap-2">
      <h3 className="text-meta font-semibold text-primary">{item.testName || item.testCode}</h3>
      {item.notes ? <p className="text-caption text-tertiary">{item.notes}</p> : null}
      {item.results.length === 0 ? (
        <p className="text-meta text-tertiary">{t('workspace.noValues')}</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {item.results.map((result) => (
            <li key={result.id}>
              <ResultLine
                result={result}
                field={fieldIndex.get(result.testFieldId) ?? null}
                onAmend={() => onAmend(result)}
              />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function ResultLine({
  result,
  field,
  onAmend,
}: {
  result: LabResultRow;
  field: LabTestFieldRow | null;
  onAmend: () => void;
}) {
  const t = useTranslations('laboratory');
  const range = field ? referenceRange(field) : null;

  return (
    <div className="flex flex-wrap items-center justify-between gap-2">
      <span className="flex flex-col">
        <span className="text-meta text-primary">
          {field?.name ?? t('workspace.unknownField')}
          {range ? <span className="ml-2 text-caption text-tertiary">{t('workspace.reference', { range })}</span> : null}
        </span>
        <span className="text-caption text-tertiary">
          {formatValue(result.value, field?.unit ?? null)}
        </span>
      </span>
      <span className="flex flex-wrap items-center gap-2">
        {result.isCritical ? (
          <StatusPill size="sm" tone="critical" label={t('workspace.flagCritical')} />
        ) : result.isAbnormal ? (
          <StatusPill size="sm" tone="warning" label={t('workspace.flagAbnormal')} />
        ) : null}
        <Button variant="tertiary" size="sm" onClick={onAmend}>
          {t('workspace.amend')}
        </Button>
      </span>
    </div>
  );
}

function formatValue(value: string, unit: string | null): string {
  return unit ? `${value} ${unit}` : value;
}

function EnterResultsForm({
  order,
  fieldsByTest,
  catalogLoading,
  enterResults,
}: {
  order: LabOrderDetail;
  fieldsByTest: ReadonlyMap<string, readonly LabTestFieldRow[]>;
  catalogLoading: boolean;
  enterResults: ReturnType<typeof useEnterLabResults>;
}) {
  const t = useTranslations('laboratory');
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);

  const groups = order.items.map((item) => ({
    item,
    fields: fieldsByTest.get(item.testId) ?? [],
  }));
  const allFields = groups.flatMap((group) => group.fields);

  const submit = () => {
    if (allFields.length === 0) {
      setError(t('results.nothing'));
      return;
    }
    for (const field of allFields) {
      if (!(values[field.id] ?? '').trim()) {
        setError(t('results.required'));
        return;
      }
    }
    setError(null);
    enterResults.mutate({
      id: order.id,
      results: allFields.map((field) => ({
        testFieldId: field.id,
        value: (values[field.id] ?? '').trim(),
      })),
    });
  };

  if (catalogLoading && allFields.length === 0) {
    return (
      <p role="status" className="text-meta text-tertiary">
        {t('results.loading')}
      </p>
    );
  }

  if (allFields.length === 0) {
    return <p className="text-meta text-tertiary">{t('results.nothing')}</p>;
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-meta text-secondary">{t('results.intro')}</p>
      {groups.map((group) => (
        <fieldset key={group.item.id} className="flex flex-col gap-3">
          <legend className="text-meta font-semibold text-primary">
            {group.item.testName || group.item.testCode}
          </legend>
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            {group.fields
              .slice()
              .sort((a, b) => a.displayOrder - b.displayOrder)
              .map((field) => (
                <Field
                  key={field.id}
                  id={`lab-result-${field.id}`}
                  label={field.name}
                  hint={
                    field.unit
                      ? t('results.unitHint', { unit: field.unit })
                      : undefined
                  }
                >
                  {({ controlId, describedBy, invalid }) => (
                    <Input
                      id={controlId}
                      aria-describedby={describedBy}
                      invalid={invalid}
                      value={values[field.id] ?? ''}
                      onChange={(event) => {
                        const next = event.target.value;
                        setValues((current) => ({ ...current, [field.id]: next }));
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
              ))}
          </div>
        </fieldset>
      ))}

      {error ? (
        <p role="alert" className="text-caption text-status-critical">
          {error}
        </p>
      ) : null}

      <div>
        <Button variant="primary" disabled={enterResults.isPending} onClick={submit}>
          {t('results.submit')}
        </Button>
      </div>
    </div>
  );
}

function CriticalSection({
  order,
  fieldIndex,
  onAcknowledge,
}: {
  order: LabOrderDetail;
  fieldIndex: ReadonlyMap<string, LabTestFieldRow>;
  onAcknowledge: (critical: CriticalResultRow) => void;
}) {
  const t = useTranslations('laboratory');
  if (order.criticalResults.length === 0) return null;

  const resultsById = new Map<string, LabResultRow>();
  for (const item of order.items) {
    for (const result of item.results) resultsById.set(result.id, result);
  }

  return (
    <section className="flex flex-col gap-3 rounded-lg border border-status-critical bg-surface p-4">
      <h2 className="flex items-center gap-2 text-subheading font-semibold text-status-critical">
        <AlertTriangle aria-hidden className="size-4 shrink-0" strokeWidth={1.5} />
        {t('workspace.critical')}
      </h2>
      <ul className="flex flex-col gap-3">
        {order.criticalResults.map((critical) => {
          const result = resultsById.get(critical.resultId) ?? null;
          const field = result ? fieldIndex.get(result.testFieldId) ?? null : null;
          return (
            <li
              key={critical.id}
              className="flex flex-wrap items-center justify-between gap-2 border-t border-border pt-3 first:border-t-0 first:pt-0"
            >
              <span className="text-meta text-primary">
                {field?.name ?? t('workspace.unknownField')}
                {result ? ` — ${formatValue(result.value, field?.unit ?? null)}` : ''}
              </span>
              <span className="flex flex-wrap items-center gap-2">
                <StatusPill
                  size="sm"
                  tone={critical.acknowledgedAt ? 'success' : 'critical'}
                  label={
                    critical.acknowledgedAt
                      ? t('critical.acknowledged')
                      : t('critical.unacknowledged')
                  }
                />
                {critical.acknowledgedAt ? null : (
                  <Button variant="secondary" size="sm" onClick={() => onAcknowledge(critical)}>
                    {t('critical.acknowledge')}
                  </Button>
                )}
              </span>
            </li>
          );
        })}
      </ul>
    </section>
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
  const t = useTranslations('laboratory');
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

function AmendDialog({
  result,
  fieldName,
  cancelLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  result: LabResultRow | null;
  fieldName: string | null;
  cancelLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (value: string, reason: string) => void;
}) {
  const t = useTranslations('laboratory');
  const [value, setValue] = useState(result?.value ?? '');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => onOpenChange(false);
  const submit = () => {
    if (!value.trim()) {
      setError(t('amend.valueRequired'));
      return;
    }
    const message = reasonError(reason);
    if (message) {
      setError(message);
      return;
    }
    setError(null);
    onConfirm(value.trim(), reason.trim());
  };

  return (
    <Dialog
      open={result !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : close())}
    >
      <DialogContent>
        <DialogHeader
          title={t('amend.title')}
          description={fieldName ? t('amend.body', { field: fieldName }) : t('amend.bodyPlain')}
        />
        <DialogBody className="flex flex-col gap-4">
          <Field id="amend-value" label={t('amend.value')} required>
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                invalid={invalid}
                value={value}
                onChange={(event) => setValue(event.target.value)}
              />
            )}
          </Field>
          <ReasonField
            value={reason}
            onChange={(value) => {
              setReason(value);
              if (error) setError(null);
            }}
            error={error}
          />
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {cancelLabel}
          </Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {t('amend.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AcknowledgeDialog({
  critical,
  order,
  fieldIndex,
  cancelLabel,
  pending,
  onOpenChange,
  onConfirm,
}: {
  critical: CriticalResultRow | null;
  order: LabOrderDetail;
  fieldIndex: ReadonlyMap<string, LabTestFieldRow>;
  cancelLabel: string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: (note?: string) => void;
}) {
  const t = useTranslations('laboratory');
  const [note, setNote] = useState('');

  let fieldName: string | null = null;
  if (critical) {
    for (const item of order.items) {
      const result = item.results.find((row) => row.id === critical.resultId);
      if (result) {
        fieldName = fieldIndex.get(result.testFieldId)?.name ?? null;
        break;
      }
    }
  }

  return (
    <Dialog
      open={critical !== null}
      onOpenChange={(next) => (next ? onOpenChange(true) : onOpenChange(false))}
    >
      <DialogContent>
        <DialogHeader
          title={t('critical.dialogTitle')}
          description={
            fieldName ? t('critical.dialogBody', { field: fieldName }) : t('critical.dialogBodyPlain')
          }
        />
        <DialogBody>
          <Field id="acknowledge-note" label={t('critical.note')} hint={t('critical.noteHint')}>
            {({ controlId, describedBy }) => (
              <Textarea
                id={controlId}
                aria-describedby={describedBy}
                rows={3}
                value={note}
                onChange={(event) => setNote(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button
            variant="primary"
            disabled={pending}
            onClick={() => onConfirm(note.trim() || undefined)}
          >
            {t('critical.acknowledge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

