'use client';

import { ClipboardList, ScanLine } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useCreateLabOrder,
  useCreateRadiologyOrder,
  useLabTests,
} from '@/lib/data/queries';
import {
  LAB_ORDER_PRIORITIES,
  type LabOrderPriority,
} from '@/lib/data/laboratory';
import { IMAGING_MODALITIES, type ImagingModality } from '@/lib/data/radiology';

/**
 * Order entry (F5 — laboratory & radiology), on the encounter workspace.
 *
 * The doctor places a laboratory or imaging request for the encounter's patient,
 * which is what the laboratory and radiology worklists then process. The order
 * writes answer `{ order }` while the export types the bare entity (GAP-020), so
 * every body is validated in the data layer. The laboratory test picker reads
 * the shared catalog (`GET /lab/tests`), the same source the results view names
 * its analytes from.
 */

export function OrdersPanel({
  patientId,
  branchId,
  encounterId,
}: {
  patientId: string;
  branchId: string;
  encounterId: string;
}) {
  const t = useTranslations('orders');
  const [composer, setComposer] = useState<'lab' | 'imaging' | null>(null);
  const [placed, setPlaced] = useState<string | null>(null);

  return (
    <section className="flex flex-col gap-3">
      <h2 className="text-subheading font-semibold text-primary">{t('title')}</h2>
      <p className="max-w-prose text-meta text-secondary">{t('intro')}</p>

      {placed ? (
        <p role="status" className="text-meta text-status-success">
          {placed}
        </p>
      ) : null}

      {composer === null ? (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setComposer('lab')}>
            <ClipboardList aria-hidden className="size-4" />
            {t('orderLab')}
          </Button>
          <Button variant="secondary" size="sm" onClick={() => setComposer('imaging')}>
            <ScanLine aria-hidden className="size-4" />
            {t('orderImaging')}
          </Button>
        </div>
      ) : null}

      {composer === 'lab' ? (
        <LabOrderComposer
          patientId={patientId}
          branchId={branchId}
          encounterId={encounterId}
          onClose={() => setComposer(null)}
          onPlaced={(orderNumber) => {
            setComposer(null);
            setPlaced(t('placedLab', { number: orderNumber }));
          }}
        />
      ) : null}

      {composer === 'imaging' ? (
        <ImagingOrderComposer
          patientId={patientId}
          branchId={branchId}
          encounterId={encounterId}
          onClose={() => setComposer(null)}
          onPlaced={(orderNumber) => {
            setComposer(null);
            setPlaced(t('placedImaging', { number: orderNumber }));
          }}
        />
      ) : null}
    </section>
  );
}

function LabOrderComposer({
  patientId,
  branchId,
  encounterId,
  onClose,
  onPlaced,
}: {
  patientId: string;
  branchId: string;
  encounterId: string;
  onClose: () => void;
  onPlaced: (orderNumber: string) => void;
}) {
  const t = useTranslations('orders');
  const tl = useTranslations('laboratory');
  const catalog = useLabTests({ active: 'true' });
  const create = useCreateLabOrder();

  const tests = catalog.data?.data.items ?? [];
  const [selected, setSelected] = useState<readonly string[]>([]);
  const [priority, setPriority] = useState<LabOrderPriority>('ROUTINE');
  const [notes, setNotes] = useState('');
  const [formError, setFormError] = useState<string | null>(null);

  const errorCode = (create.error?.code as string | null) ?? null;

  function submit() {
    setFormError(null);
    if (selected.length === 0) {
      setFormError(t('selectAtLeastOne'));
      return;
    }
    create.mutate(
      {
        patientId,
        branchId,
        encounterId,
        priority,
        clinicalNotes: notes.trim() || undefined,
        testIds: selected,
      },
      {
        onSuccess: (order) => onPlaced(order.orderNumber),
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
      <h3 className="text-body font-semibold text-primary">{t('laboratoryTitle')}</h3>

      <ErrorNotice formError={formError} errorCode={errorCode} fallback={create.isError} />

      {catalog.isLoading && tests.length === 0 ? (
        <p role="status" className="text-meta text-tertiary">
          {t('catalogLoading')}
        </p>
      ) : tests.length === 0 ? (
        <p className="text-meta text-tertiary">{t('catalogEmpty')}</p>
      ) : (
        <fieldset className="flex flex-col gap-2">
          <legend className="text-meta font-medium text-secondary">{t('testsLegend')}</legend>
          <ul className="flex flex-col gap-2">
            {tests.map((test) => (
              <li key={test.id}>
                <label className="flex items-start gap-2 text-meta text-primary">
                  <input
                    type="checkbox"
                    className="mt-0.5 size-4"
                    checked={selected.includes(test.id)}
                    onChange={() =>
                      setSelected((current) =>
                        current.includes(test.id)
                          ? current.filter((id) => id !== test.id)
                          : [...current, test.id],
                      )
                    }
                  />
                  <span>
                    <span className="font-medium">{test.name}</span>
                    <span className="text-tertiary"> · {test.code}</span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        </fieldset>
      )}

      <Field id="lab-order-priority" label={t('priority')}>
        {({ controlId }) => (
          <Select
            id={controlId}
            value={priority}
            onChange={(event) => setPriority(event.target.value as LabOrderPriority)}
          >
            {LAB_ORDER_PRIORITIES.map((value) => (
              <option key={value} value={value}>
                {tl(`priority.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="lab-order-notes" label={t('clinicalNotes')} hint={t('clinicalNotesHint')}>
        {({ controlId, describedBy }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>

      <ComposerActions
        pending={create.isPending}
        submitLabel={t('submitLaboratory')}
        onClose={onClose}
      />
    </form>
  );
}

function ImagingOrderComposer({
  patientId,
  branchId,
  encounterId,
  onClose,
  onPlaced,
}: {
  patientId: string;
  branchId: string;
  encounterId: string;
  onClose: () => void;
  onPlaced: (orderNumber: string) => void;
}) {
  const t = useTranslations('orders');
  const tr = useTranslations('radiology');
  const create = useCreateRadiologyOrder();

  const [modality, setModality] = useState<ImagingModality>('XRAY');
  const [region, setRegion] = useState('');
  const [notes, setNotes] = useState('');

  const errorCode = (create.error?.code as string | null) ?? null;

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-primary bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        create.mutate(
          {
            patientId,
            branchId,
            encounterId,
            modality,
            region: region.trim() || undefined,
            clinicalNotes: notes.trim() || undefined,
          },
          {
            onSuccess: (order) => onPlaced(order.orderNumber),
            onError: () => undefined,
          },
        );
      }}
    >
      <h3 className="text-body font-semibold text-primary">{t('imagingTitle')}</h3>

      <ErrorNotice formError={null} errorCode={errorCode} fallback={create.isError} />

      <Field id="imaging-order-modality" label={t('modality')} required>
        {({ controlId }) => (
          <Select
            id={controlId}
            value={modality}
            onChange={(event) => setModality(event.target.value as ImagingModality)}
          >
            {IMAGING_MODALITIES.map((value) => (
              <option key={value} value={value}>
                {tr(`modality.${value}`)}
              </option>
            ))}
          </Select>
        )}
      </Field>

      <Field id="imaging-order-region" label={t('region')} hint={t('regionHint')}>
        {({ controlId, describedBy }) => (
          <Input
            id={controlId}
            aria-describedby={describedBy}
            maxLength={200}
            value={region}
            onChange={(event) => setRegion(event.target.value)}
          />
        )}
      </Field>

      <Field id="imaging-order-notes" label={t('clinicalNotes')} hint={t('clinicalNotesHint')}>
        {({ controlId, describedBy }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            rows={2}
            maxLength={2000}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>

      <ComposerActions
        pending={create.isPending}
        submitLabel={t('submitImaging')}
        onClose={onClose}
      />
    </form>
  );
}

function ErrorNotice({
  formError,
  errorCode,
  fallback,
}: {
  formError: string | null;
  errorCode: string | null;
  fallback: boolean;
}) {
  const t = useTranslations('orders');
  if (formError !== null) {
    return (
      <div role="alert" className="border border-status-critical px-3 py-2">
        <p className="text-body font-semibold text-status-critical">{t('error.validationTitle')}</p>
        <p className="text-meta text-secondary">{formError}</p>
      </div>
    );
  }
  if (errorCode === 'VALIDATION_ERROR') {
    return (
      <div role="alert" className="border border-status-critical px-3 py-2">
        <p className="text-body font-semibold text-status-critical">{t('error.validationTitle')}</p>
        <p className="text-meta text-secondary">{t('error.validationBody')}</p>
      </div>
    );
  }
  if (fallback) {
    return (
      <div role="alert" className="border border-status-critical px-3 py-2">
        <p className="text-body font-semibold text-status-critical">{t('error.failedTitle')}</p>
        <p className="text-meta text-secondary">{t('error.failedBody')}</p>
      </div>
    );
  }
  return null;
}

function ComposerActions({
  pending,
  submitLabel,
  onClose,
}: {
  pending: boolean;
  submitLabel: string;
  onClose: () => void;
}) {
  const t = useTranslations('orders');
  return (
    <div className="flex flex-wrap items-center gap-2">
      <Button type="submit" variant="primary" size="sm" disabled={pending}>
        {pending ? t('working') : submitLabel}
      </Button>
      <Button type="button" variant="secondary" size="sm" onClick={onClose} disabled={pending}>
        {t('cancel')}
      </Button>
    </div>
  );
}
