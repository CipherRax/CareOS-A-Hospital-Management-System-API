'use client';

import { Pill } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import {
  useDispensePrescription,
  useMedicationName,
  usePatientName,
  usePrescriptions,
  useStockOnHand,
} from '@/lib/data/queries';
import type { PrescriptionRow } from '@/lib/data/prescriptions';

/**
 * Pharmacy dispense worklist (F6 — slice 1).
 *
 * Lists every prescription the pharmacy can act on (`ISSUED` or
 * `PARTIALLY_DISPENSED`) and lets the pharmacist adjust the quantity of each
 * outstanding line, checked against the branch's stock on hand before the
 * `POST /pharmacy/stock/dispense` write. The service answers a bare
 * `{ prescriptionStatus, dispensedLines }` while the export types the 201 as
 * `InventoryResponseDto` (GAP-020), so the dispense hook validates the body
 * structurally. The list read carries `query: never` and a request-DTO 200, so
 * it rides the raw-fetch path too.
 */

const ACTIONABLE = new Set<PrescriptionRow['status']>(['ISSUED', 'PARTIALLY_DISPENSED']);

export function PharmacyWorklistScreen() {
  const t = useTranslations('pharmacy');
  const prescriptions = usePrescriptions({});
  const stock = useStockOnHand({});

  const rows = (prescriptions.data?.data.items ?? []).filter((row) => ACTIONABLE.has(row.status));
  const onHand = stock.data?.data ?? [];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
          <p className="text-meta text-secondary">{t('pageIntro')}</p>
        </div>
        <Link
          href="/pharmacy/stock"
          className="inline-flex items-center gap-1.5 text-meta font-medium text-secondary underline-offset-2 hover:underline"
        >
          {t('stockControl')}
        </Link>
      </header>

      {prescriptions.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={Pill}
          headingLevel={2}
        />
      ) : prescriptions.isLoading && rows.length === 0 ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : rows.length === 0 ? (
        <EmptyState title={t('empty')} headingLevel={2} />
      ) : (
        <ul className="flex flex-col gap-4">
          {rows.map((prescription) => (
            <li key={prescription.id}>
              <DispenseCard prescription={prescription} onHand={onHand} />
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DispenseCard({
  prescription,
  onHand,
}: {
  prescription: PrescriptionRow;
  onHand: readonly { medicationId: string; branchId: string; quantity: number }[];
}) {
  const t = useTranslations('pharmacy');
  const dispense = useDispensePrescription();
  const outstanding = prescription.items.filter((item) => item.quantity > item.dispensedQuantity);

  const [quantities, setQuantities] = useState<Record<string, string>>(() =>
    Object.fromEntries(
      outstanding.map((item) => [item.medicationId, String(item.quantity - item.dispensedQuantity)]),
    ),
  );
  const [formError, setFormError] = useState<string | null>(null);

  const quantityFor = (medicationId: string) => quantities[medicationId] ?? '';
  const onHandFor = (medicationId: string) =>
    onHand.find(
      (row) => row.medicationId === medicationId && row.branchId === prescription.branchId,
    )?.quantity ?? null;

  function submit() {
    setFormError(null);
    const lines = outstanding
      .map((item) => ({
        medicationId: item.medicationId,
        quantity: Number(quantityFor(item.medicationId)),
      }))
      .filter((line) => Number.isInteger(line.quantity) && line.quantity > 0);
    if (lines.length === 0) {
      setFormError(t('error.noLines'));
      return;
    }
    if (
      lines.some((line) => {
        const item = outstanding.find((entry) => entry.medicationId === line.medicationId);
        return item === undefined || line.quantity > item.quantity - item.dispensedQuantity;
      })
    ) {
      setFormError(t('error.invalidQuantity'));
      return;
    }
    dispense.mutate({ prescriptionId: prescription.id, branchId: prescription.branchId, lines });
  }

  return (
    <article className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
      <header className="flex flex-wrap items-center gap-2">
        <Pill aria-hidden className="size-4 text-tertiary" />
        <h2 className="text-body font-semibold text-primary">
          <PatientName id={prescription.patientId} />
        </h2>
        <StatusPill tone={prescription.status === 'ISSUED' ? 'info' : 'warning'} label={t(`status.${prescription.status}`)} />
        <span className="text-caption tabular-nums text-tertiary">v{prescription.version}</span>
      </header>

      {dispense.isSuccess && dispense.data ? (
        <p
          role="status"
          className="border border-status-success px-3 py-2 text-meta text-status-success"
        >
          {t('dispensed', { status: t(`status.${dispense.data.prescriptionStatus}`) })}
        </p>
      ) : dispense.error ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {dispense.error.code === 'INSUFFICIENT_STOCK'
            ? t('error.insufficientStock')
            : dispense.error.code === 'INVALID_WORKFLOW_TRANSITION'
              ? t('error.staleBody')
              : t('error.failedBody')}
        </p>
      ) : null}

      {formError ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {formError}
        </p>
      ) : null}

      <ul className="flex flex-col gap-3">
        {outstanding.map((item) => {
          const remaining = item.quantity - item.dispensedQuantity;
          const available = onHandFor(item.medicationId);
          const short = available !== null && available < remaining;
          return (
            <li key={item.id} className="flex flex-wrap items-end justify-between gap-3">
              <div className="flex min-w-0 flex-col">
                <span className="text-meta font-medium text-primary">
                  <MedicationNameCell medicationId={item.medicationId} />
                </span>
                <span className="text-caption text-tertiary">
                  {t('remaining', { count: remaining })}
                  {available !== null ? (
                    <span className={short ? ' text-status-critical' : ''}>
                      {' · '}
                      {t('onHand', { count: available })}
                    </span>
                  ) : null}
                </span>
              </div>
              <div className="w-28">
                <Field
                  id={`dispense-${prescription.id}-${item.id}`}
                  label={t('quantityLabel')}
                >
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      type="number"
                      min={0}
                      max={remaining}
                      step={1}
                      inputMode="numeric"
                      value={quantityFor(item.medicationId)}
                      onChange={(event) =>
                        setQuantities((current) => ({
                          ...current,
                          [item.medicationId]: event.target.value,
                        }))
                      }
                    />
                  )}
                </Field>
              </div>
            </li>
          );
        })}
      </ul>

      <div>
        <Button type="button" variant="primary" size="sm" onClick={submit} disabled={dispense.isPending}>
          {dispense.isPending ? t('working') : t('dispense')}
        </Button>
      </div>
    </article>
  );
}

function PatientName({ id }: { id: string }) {
  const t = useTranslations('pharmacy');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span>{name.data?.data ?? t('unknownPatient')}</span>;
}

function MedicationNameCell({ medicationId }: { medicationId: string }) {
  const value = useMedicationName(medicationId);
  if (value.isLoading) return <span className="text-tertiary">…</span>;
  return <span>{value.data?.data ?? medicationId}</span>;
}
