'use client';

import { FileText, Pill, Plus, Trash2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useCreatePrescription,
  useMedications,
  useMedicationName,
  usePrescriptionAction,
  usePrescriptions,
} from '@/lib/data/queries';
import { PRESCRIPTION_ACTIONS_BY_STATUS, type PrescriptionRow } from '@/lib/data/prescriptions';
import type { PrescriptionItemRow } from '@/lib/data/prescriptions';

/**
 * Prescription panel (F4 — medication orders).
 *
 * A prescription pins the patient, the issuing provider and the dispensing
 * branch — not an encounter — so this panel shows the encounter patient's full
 * medication-order history and lets the doctor write to it with the visit's
 * patient. The lifecycle mirrors the API domain: a prescription starts DRAFT,
 * is issued (DRAFT → ISSUED), is dispensed by pharmacy (read-only here), and
 * can be cancelled while the drug is un- or partially-dispensed. DISPENSED is
 * terminal. A stale action answers 409 INVALID_WORKFLOW_TRANSITION and is
 * surfaced in place.
 */

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_DISPENSED: 'warning',
  DISPENSED: 'success',
  CANCELLED: 'neutral',
};

interface DraftLine {
  key: number;
  medicationId: string;
  quantity: string;
  dosage: string;
  frequency: string;
  durationDays: string;
  instructions: string;
}

export function PrescriptionsPanel({ patientId }: { patientId: string }) {
  const t = useTranslations('prescriptions');
  const [composerOpen, setComposerOpen] = useState(false);
  const [cancelTarget, setCancelTarget] = useState<PrescriptionRow | null>(null);

  const prescriptions = usePrescriptions({ patientId });
  const rows = prescriptions.data?.data.items ?? [];
  const cancelAction = usePrescriptionAction();

  return (
    <section className="flex flex-col gap-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('title')}</h2>
        {!composerOpen ? (
          <Button variant="secondary" size="sm" onClick={() => setComposerOpen(true)}>
            <Plus aria-hidden className="size-4" />
            {t('newPrescription')}
          </Button>
        ) : null}
      </div>
      <p className="max-w-prose text-meta text-secondary">{t('intro')}</p>

      {composerOpen ? (
        <PrescriptionComposer patientId={patientId} onClose={() => setComposerOpen(false)} />
      ) : null}

      {prescriptions.isLoading && rows.length === 0 ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : prescriptions.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={FileText}
          headingLevel={3}
        />
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} headingLevel={3} />
      ) : (
        <ul className="flex flex-col gap-3">
          {rows.map((prescription) => (
            <li key={prescription.id}>
              <PrescriptionCard
                prescription={prescription}
                onCancel={() => setCancelTarget(prescription)}
              />
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={cancelTarget !== null}
        onOpenChange={(open) => {
          if (!open) setCancelTarget(null);
        }}
        onConfirm={() => {
          if (cancelTarget) cancelAction.mutate({ id: cancelTarget.id, action: 'cancel' });
          setCancelTarget(null);
        }}
        title={t('confirmCancelTitle')}
        description={t('confirmCancelBody')}
        confirmLabel={t('confirmCancel')}
        cancelLabel={t('composer.cancel')}
        pending={cancelAction.isPending}
      />
    </section>
  );
}

function PrescriptionCard({
  prescription,
  onCancel,
}: {
  prescription: PrescriptionRow;
  onCancel: () => void;
}) {
  const t = useTranslations('prescriptions');
  const locale = useLocale();
  const action = usePrescriptionAction();
  const pending = action.isPending && action.variables?.id === prescription.id;
  const actions = PRESCRIPTION_ACTIONS_BY_STATUS[prescription.status];

  const format = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const errorCode = (action.error?.code as string | null) ?? null;

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <Pill aria-hidden className="size-4 text-tertiary" />
          <h3 className="text-body font-semibold text-primary">
            {t('lineCount', { count: prescription.items.length })}
          </h3>
          <StatusPill tone={STATUS_TONE[prescription.status] ?? 'neutral'} label={t(`status.${prescription.status}`)} />
          <span className="text-caption tabular-nums text-tertiary">v{prescription.version}</span>
        </div>
      </header>

      {errorCode === 'INVALID_WORKFLOW_TRANSITION' ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {t('error.staleBody')}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {prescription.items.map((item) => (
          <PrescriptionLine key={item.id} item={item} />
        ))}
      </ul>

      {prescription.notes || prescription.cancelReason ? (
        <div className="flex flex-col gap-2">
          {prescription.notes ? (
            <p className="border-l-2 border-strong pl-3 text-meta text-secondary">{prescription.notes}</p>
          ) : null}
          {prescription.cancelReason ? (
            <p className="border-l-2 border-strong pl-3 text-meta text-secondary">
              <span className="font-medium text-primary">{t('cancelledReason')}: </span>
              {prescription.cancelReason}
            </p>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-caption text-tertiary">
        {prescription.issuedAt ? (
          <span>{t('issued', { date: format(prescription.issuedAt) })}</span>
        ) : null}
        {prescription.dispensedAt ? (
          <span>{t('dispensed', { date: format(prescription.dispensedAt) })}</span>
        ) : null}
        {prescription.cancelledAt ? (
          <span>{t('cancelled', { date: format(prescription.cancelledAt) })}</span>
        ) : null}
      </div>

      {actions.includes('issue') || actions.includes('cancel') ? (
        <div className="flex flex-wrap items-center gap-2">
          {actions.includes('issue') ? (
            <Button
              variant="secondary"
              size="sm"
              disabled={pending}
              onClick={() => action.mutate({ id: prescription.id, action: 'issue' })}
            >
              {pending ? t('working') : t('issue')}
            </Button>
          ) : null}
          {actions.includes('cancel') ? (
            <Button variant="tertiary" size="sm" disabled={pending} onClick={onCancel}>
              {t('cancel')}
            </Button>
          ) : null}
        </div>
      ) : null}
    </article>
  );
}

function PrescriptionLine({ item }: { item: PrescriptionItemRow }) {
  const t = useTranslations('prescriptions');
  const remaining =
    item.dispensedQuantity >= item.quantity ? null : item.quantity - item.dispensedQuantity;

  return (
    <li className="flex flex-col gap-1">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-meta font-medium text-primary">
          <MedicationNameCell medicationId={item.medicationId} />
        </span>
        {remaining !== null ? (
          <span className="text-caption tabular-nums text-secondary">
            {t('remaining', { count: remaining })}
          </span>
        ) : null}
      </div>
      <dl className="grid grid-cols-1 gap-x-6 gap-y-1 text-meta text-secondary sm:grid-cols-3">
        <div>
          <dt className="inline text-tertiary">{t('line.quantity')}: </dt>
          <dd className="inline">{item.quantity}</dd>
        </div>
        {item.dosage ? (
          <div>
            <dt className="inline text-tertiary">{t('line.dosage')}: </dt>
            <dd className="inline">{item.dosage}</dd>
          </div>
        ) : null}
        {item.frequency ? (
          <div>
            <dt className="inline text-tertiary">{t('line.frequency')}: </dt>
            <dd className="inline">{item.frequency}</dd>
          </div>
        ) : null}
        {item.durationDays ? (
          <div>
            <dt className="inline text-tertiary">{t('line.durationDays')}: </dt>
            <dd className="inline">{item.durationDays}</dd>
          </div>
        ) : null}
        {item.instructions ? (
          <div>
            <dt className="inline text-tertiary">{t('line.instructions')}: </dt>
            <dd className="inline">{item.instructions}</dd>
          </div>
        ) : null}
        {item.dispensedQuantity > 0 ? (
          <div>
            <dt className="inline text-tertiary">{t('line.dispensed')}: </dt>
            <dd className="inline">{item.dispensedQuantity}</dd>
          </div>
        ) : null}
      </dl>
    </li>
  );
}

/** Renders a medication name, resolving `medicationId` via the catalog lookup. */
function MedicationNameCell({ medicationId }: { medicationId: string }) {
  const value = useMedicationName(medicationId);
  if (value.isLoading) return <span className="text-tertiary">…</span>;
  return <span>{value.data?.data ?? medicationId}</span>;
}

function PrescriptionComposer({
  patientId,
  onClose,
}: {
  patientId: string;
  onClose: () => void;
}) {
  const t = useTranslations('prescriptions');
  const medications = useMedications({ isActive: 'true', category: 'MEDICATION' });
  const create = useCreatePrescription();

  const catalog = medications.data?.data.items ?? [];
  const [lines, setLines] = useState<DraftLine[]>(() => [
    { key: 1, medicationId: '', quantity: '', dosage: '', frequency: '', durationDays: '', instructions: '' },
  ]);
  const [prescriptionNotes, setPrescriptionNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  let nextKey = 1000;
  const updateLine = (key: number, patch: Partial<DraftLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: number) => setLines((current) => current.filter((line) => line.key !== key));
  const addLine = () =>
    setLines((current) => [
      ...current,
      { key: nextKey++, medicationId: '', quantity: '', dosage: '', frequency: '', durationDays: '', instructions: '' },
    ]);

  const errorCode = (create.error?.code as string | null) ?? null;

  function submit() {
    setFormError(null);
    const items = lines
      .filter((line) => line.medicationId.length > 0)
      .map((line) => ({
        medicationId: line.medicationId,
        quantity: Number(line.quantity),
        dosage: line.dosage.trim() || undefined,
        frequency: line.frequency.trim() || undefined,
        durationDays: line.durationDays.trim() ? Number(line.durationDays) : undefined,
        instructions: line.instructions.trim() || undefined,
      }))
      .filter((item) => Number.isInteger(item.quantity) && item.quantity > 0);
    if (items.length === 0) {
      setFormError(t('composer.noLines'));
      return;
    }
    create.mutate(
      {
        patientId,
        notes: prescriptionNotes.trim() || undefined,
        items,
      },
      {
        onSuccess: () => onClose(),
        onError: () => undefined,
      },
    );
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-primary bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h3 className="text-body font-semibold text-primary">{t('composer.createTitle')}</h3>

      {formError !== null ? (
        <div role="alert" className="border border-status-critical px-3 py-2">
          <p className="text-body font-semibold text-status-critical">{t('error.validationTitle')}</p>
          <p className="text-meta text-secondary">{formError}</p>
        </div>
      ) : errorCode === 'INVALID_WORKFLOW_TRANSITION' ? (
        <div role="alert" className="border border-status-critical px-3 py-2">
          <p className="text-body font-semibold text-status-critical">{t('error.staleTitle')}</p>
          <p className="text-meta text-secondary">{t('error.staleBody')}</p>
        </div>
      ) : create.isError ? (
        <div role="alert" className="border border-status-critical px-3 py-2">
          <p className="text-body font-semibold text-status-critical">{t('error.failedTitle')}</p>
          <p className="text-meta text-secondary">{t('error.failedBody')}</p>
        </div>
      ) : null}

      <ol className="flex flex-col gap-6">
        {lines.map((line, index) => (
          <li key={line.key} className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0">
            {lines.length > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <h4 className="text-meta font-medium text-secondary">{t('composer.lineHeading', { number: index + 1 })}</h4>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(line.key)}>
                  <Trash2 aria-hidden className="size-4" />
                  {t('composer.removeLine')}
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`line-${line.key}-medication`} label={t('composer.medicationLabel')} required>
                {({ controlId }) => (
                  <Select
                    id={controlId}
                    value={line.medicationId}
                    onChange={(event) => updateLine(line.key, { medicationId: event.target.value })}
                  >
                    <option value="">{t('composer.medicationPlaceholder')}</option>
                    {catalog.map((medication) => (
                      <option key={medication.id} value={medication.id}>
                        {medication.name}
                        {medication.strength ? ` — ${medication.strength}` : ''}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>

              <Field id={`line-${line.key}-quantity`} label={t('composer.quantityLabel')} required>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={line.quantity}
                    onChange={(event) => updateLine(line.key, { quantity: event.target.value })}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field id={`line-${line.key}-dosage`} label={t('composer.dosageLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={line.dosage}
                    onChange={(event) => updateLine(line.key, { dosage: event.target.value })}
                    maxLength={200}
                  />
                )}
              </Field>
              <Field id={`line-${line.key}-frequency`} label={t('composer.frequencyLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={line.frequency}
                    onChange={(event) => updateLine(line.key, { frequency: event.target.value })}
                    maxLength={200}
                  />
                )}
              </Field>
              <Field id={`line-${line.key}-duration`} label={t('composer.durationLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    type="number"
                    min={1}
                    step={1}
                    inputMode="numeric"
                    value={line.durationDays}
                    onChange={(event) => updateLine(line.key, { durationDays: event.target.value })}
                  />
                )}
              </Field>
            </div>

            <Field id={`line-${line.key}-instructions`} label={t('composer.instructionsLabel')}>
              {({ controlId }) => (
                <Textarea
                  id={controlId}
                  value={line.instructions}
                  onChange={(event) => updateLine(line.key, { instructions: event.target.value })}
                  rows={2}
                  maxLength={2000}
                />
              )}
            </Field>
          </li>
        ))}
      </ol>

      <Button type="button" variant="secondary" size="sm" onClick={addLine}>
        <Plus aria-hidden className="size-4" />
        {t('composer.addLine')}
      </Button>

      <Field id="prescription-notes" label={t('composer.notesLabel')}>
        {({ controlId }) => (
          <Textarea
            id={controlId}
            value={prescriptionNotes}
            onChange={(event) => setPrescriptionNotes(event.target.value)}
            rows={2}
            maxLength={2000}
          />
        )}
      </Field>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={create.isPending}>
          {create.isPending ? t('working') : t('composer.save')}
        </Button>
        <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={create.isPending}>
          {t('composer.cancel')}
        </Button>
      </div>
    </form>
  );
}