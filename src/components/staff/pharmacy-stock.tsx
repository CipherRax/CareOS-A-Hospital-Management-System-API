'use client';

import { ArrowLeft, PackagePlus, Plus, ShieldAlert, Trash2 } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useMedications,
  useReceiveStock,
  useStockAlerts,
  useStockOnHand,
  useWriteOffStock,
} from '@/lib/data/queries';
import type { StockAlertLabel, StockAlertRow, StockOnHandRow } from '@/lib/data/inventory';

/**
 * Pharmacy stock control (F6 — slice 2 stock control, slice 3 write-offs).
 *
 * The branch's stock on hand and its risk advisories are both derived reads with
 * the GAP-020 drift (query unmodelled, 200 typed as the request DTO, body
 * `{ onHand }` / `{ alerts }`), so they ride the raw-fetch path in
 * `src/lib/data/inventory.ts`. Receiving stock writes a batch and a ledger entry
 * per line (bare `{ batches }`, GAP-020); writing stock off FEFO-allocates each
 * line and writes WASTAGE ledger entries, answering a bare `{ writeOffId,
 * branchId, quantity }` the export does not model at all.
 *
 * There is no branch picker in the app yet, so the screen writes against the
 * branch the on-hand read reports. With one example branch that is unambiguous;
 * a multi-branch build would take the active branch from the session.
 */

const ALERT_TONE: Record<StockAlertLabel, StatusTone> = {
  LOW_STOCK: 'critical',
  REORDER_RISK: 'warning',
  EXPIRY_RISK: 'warning',
};

interface DraftReceiveLine {
  key: number;
  medicationId: string;
  batchNumber: string;
  quantity: string;
  expiryDate: string;
  unitCost: string;
}

const EMPTY_LINE: Omit<DraftReceiveLine, 'key'> = {
  medicationId: '',
  batchNumber: '',
  quantity: '',
  expiryDate: '',
  unitCost: '',
};

interface DraftWriteOffLine {
  key: number;
  medicationId: string;
  quantity: string;
}

const EMPTY_WRITE_OFF_LINE: Omit<DraftWriteOffLine, 'key'> = {
  medicationId: '',
  quantity: '',
};

type ComposerMode = 'receive' | 'writeOff';

export function PharmacyStockScreen() {
  const t = useTranslations('pharmacyStock');
  const onHand = useStockOnHand({});
  const alerts = useStockAlerts({});
  const [mode, setMode] = useState<ComposerMode | null>(null);

  const rows = onHand.data?.data ?? [];
  const alertRows = alerts.data?.data ?? [];
  const branchId = rows[0]?.branchId ?? null;

  const columns: readonly DataTableColumn<StockOnHandRow>[] = [
    {
      key: 'medication',
      header: t('columnMedication'),
      cell: (row) => (
        <span className="font-medium text-primary">{row.name ?? row.medicationId}</span>
      ),
    },
    {
      key: 'quantity',
      header: t('columnOnHand'),
      numeric: true,
      cell: (row) => (
        <span className="tabular-nums text-primary">
          {row.quantity}
          {row.unit ? <span className="text-tertiary"> {row.unit}</span> : null}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/pharmacy"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-secondary underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('back')}
      </Link>

      <header className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
          <p className="max-w-prose text-meta text-secondary">{t('pageIntro')}</p>
        </div>
        {mode === null ? (
          <div className="flex flex-wrap items-center gap-2">
            <Button
              variant="secondary"
              size="sm"
              disabled={branchId === null}
              onClick={() => setMode('receive')}
            >
              <PackagePlus aria-hidden className="size-4" />
              {t('receiveStock')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={branchId === null}
              onClick={() => setMode('writeOff')}
            >
              <Trash2 aria-hidden className="size-4" />
              {t('writeOffStock')}
            </Button>
          </div>
        ) : null}
      </header>

      {mode === 'receive' && branchId !== null ? (
        <ReceiveComposer branchId={branchId} onClose={() => setMode(null)} />
      ) : null}

      {mode === 'writeOff' && branchId !== null ? (
        <WriteOffComposer branchId={branchId} onHand={rows} onClose={() => setMode(null)} />
      ) : null}

      {alerts.error ? null : alertRows.length > 0 ? (
        <section className="flex flex-col gap-2">
          <h2 className="text-subheading font-semibold text-primary">{t('alertsTitle')}</h2>
          <p className="max-w-prose text-meta text-secondary">{t('alertsIntro')}</p>
          <ul className="flex flex-col gap-2">
            {alertRows.map((alert) => (
              <AlertRow key={`${alert.medicationId}-${alert.label}`} alert={alert} />
            ))}
          </ul>
        </section>
      ) : null}

      <section className="flex flex-col gap-2">
        <h2 className="text-subheading font-semibold text-primary">{t('onHandTitle')}</h2>
        {onHand.error ? (
          <EmptyState
            title={t('unavailableTitle')}
            description={t('unavailableBody')}
            icon={ShieldAlert}
            headingLevel={3}
          />
        ) : (
          <DataTable<StockOnHandRow>
            caption={t('tableCaption')}
            columns={columns}
            rows={rows}
            rowKey={(row) => `${row.branchId}-${row.medicationId}`}
            loading={onHand.isLoading}
            emptyMessage={t('empty')}
          />
        )}
      </section>
    </div>
  );
}

function AlertRow({ alert }: { alert: StockAlertRow }) {
  const t = useTranslations('pharmacyStock');
  return (
    <li className="flex flex-wrap items-baseline gap-x-3 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3">
      <StatusPill size="sm" tone={ALERT_TONE[alert.label]} label={t(`alert.${alert.label}`)} />
      <span className="text-meta font-medium text-primary">{alert.name}</span>
      <span className="text-meta text-secondary">{alert.detail}</span>
    </li>
  );
}

function ReceiveComposer({ branchId, onClose }: { branchId: string; onClose: () => void }) {
  const t = useTranslations('pharmacyStock');
  const medications = useMedications({ isActive: 'true' });
  const receive = useReceiveStock();

  const catalog = medications.data?.data.items ?? [];
  const [lines, setLines] = useState<DraftReceiveLine[]>([{ key: 1, ...EMPTY_LINE }]);
  const [formError, setFormError] = useState<string | null>(null);

  let nextKey = 1000;
  const updateLine = (key: number, patch: Partial<DraftReceiveLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: number) =>
    setLines((current) => current.filter((line) => line.key !== key));
  const addLine = () => setLines((current) => [...current, { key: nextKey++, ...EMPTY_LINE }]);

  function submit() {
    setFormError(null);
    const payload = lines
      .filter((line) => line.medicationId.length > 0 && line.batchNumber.trim().length > 0)
      .map((line) => ({
        medicationId: line.medicationId,
        quantity: Number(line.quantity),
        batchNumber: line.batchNumber.trim(),
        expiryDate: line.expiryDate || undefined,
        unitCost: line.unitCost.trim() ? Number(line.unitCost) : undefined,
      }));
    if (payload.length === 0) {
      setFormError(t('error.noLines'));
      return;
    }
    if (payload.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) {
      setFormError(t('error.invalidQuantity'));
      return;
    }
    receive.mutate({ branchId, lines: payload }, { onSuccess: () => onClose() });
  }

  return (
    <form
      className="flex flex-col gap-4 rounded-lg border border-primary bg-surface p-4"
      onSubmit={(event) => {
        event.preventDefault();
        submit();
      }}
    >
      <h2 className="text-body font-semibold text-primary">{t('composer.title')}</h2>
      <p className="max-w-prose text-meta text-secondary">{t('receiveIntro')}</p>

      {formError !== null ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {formError}
        </p>
      ) : receive.isError ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {receive.error.code === 'RESOURCE_NOT_FOUND'
            ? t('error.unknownMedication')
            : t('error.failedBody')}
        </p>
      ) : null}

      <ol className="flex flex-col gap-6">
        {lines.map((line, index) => (
          <li
            key={line.key}
            className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0"
          >
            {lines.length > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-meta font-medium text-secondary">
                  {t('composer.lineHeading', { number: index + 1 })}
                </h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(line.key)}>
                  <Trash2 aria-hidden className="size-4" />
                  {t('composer.removeLine')}
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`receive-${line.key}-medication`} label={t('composer.medicationLabel')} required>
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
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field id={`receive-${line.key}-batch`} label={t('composer.batchLabel')} required>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={line.batchNumber}
                    onChange={(event) => updateLine(line.key, { batchNumber: event.target.value })}
                    maxLength={200}
                  />
                )}
              </Field>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
              <Field id={`receive-${line.key}-quantity`} label={t('composer.quantityLabel')} required>
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
              <Field id={`receive-${line.key}-expiry`} label={t('composer.expiryLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    type="date"
                    value={line.expiryDate}
                    onChange={(event) => updateLine(line.key, { expiryDate: event.target.value })}
                  />
                )}
              </Field>
              <Field id={`receive-${line.key}-cost`} label={t('composer.unitCostLabel')}>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    type="number"
                    min={0}
                    step="0.01"
                    inputMode="decimal"
                    value={line.unitCost}
                    onChange={(event) => updateLine(line.key, { unitCost: event.target.value })}
                  />
                )}
              </Field>
            </div>
          </li>
        ))}
      </ol>

      <Button type="button" variant="secondary" size="sm" onClick={addLine}>
        <Plus aria-hidden className="size-4" />
        {t('composer.addLine')}
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={receive.isPending}>
          {receive.isPending ? t('working') : t('composer.save')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={receive.isPending}
        >
          {t('composer.cancel')}
        </Button>
      </div>
    </form>
  );
}

function WriteOffComposer({
  branchId,
  onHand,
  onClose,
}: {
  branchId: string;
  onHand: readonly StockOnHandRow[];
  onClose: () => void;
}) {
  const t = useTranslations('pharmacyStock');
  const medications = useMedications({ isActive: 'true' });
  const writeOff = useWriteOffStock();

  const catalog = medications.data?.data.items ?? [];
  const [reason, setReason] = useState('');
  const [lines, setLines] = useState<DraftWriteOffLine[]>([{ key: 1, ...EMPTY_WRITE_OFF_LINE }]);
  const [formError, setFormError] = useState<string | null>(null);

  let nextKey = 2000;
  const updateLine = (key: number, patch: Partial<DraftWriteOffLine>) =>
    setLines((current) => current.map((line) => (line.key === key ? { ...line, ...patch } : line)));
  const removeLine = (key: number) =>
    setLines((current) => current.filter((line) => line.key !== key));
  const addLine = () => setLines((current) => [...current, { key: nextKey++, ...EMPTY_WRITE_OFF_LINE }]);
  const available = (medicationId: string) =>
    onHand.find((row) => row.medicationId === medicationId)?.quantity ?? 0;

  function submit() {
    setFormError(null);
    if (reason.trim().length === 0) {
      setFormError(t('writeOff.reasonRequired'));
      return;
    }
    const payload = lines
      .filter((line) => line.medicationId.length > 0)
      .map((line) => ({ medicationId: line.medicationId, quantity: Number(line.quantity) }));
    if (payload.length === 0) {
      setFormError(t('error.noLines'));
      return;
    }
    if (payload.some((line) => !Number.isInteger(line.quantity) || line.quantity <= 0)) {
      setFormError(t('error.invalidQuantity'));
      return;
    }
    if (payload.some((line) => line.quantity > available(line.medicationId))) {
      setFormError(t('writeOff.exceedsOnHand'));
      return;
    }
    writeOff.mutate(
      { branchId, reason: reason.trim(), lines: payload },
      { onSuccess: () => onClose() },
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
      <h2 className="text-body font-semibold text-primary">{t('writeOff.title')}</h2>
      <p className="max-w-prose text-meta text-secondary">{t('writeOff.intro')}</p>

      <Field id="write-off-reason" label={t('writeOff.reasonLabel')} required>
        {({ controlId }) => (
          <Textarea
            id={controlId}
            value={reason}
            onChange={(event) => setReason(event.target.value)}
            maxLength={500}
            rows={3}
          />
        )}
      </Field>

      {formError !== null ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {formError}
        </p>
      ) : writeOff.isError ? (
        <p role="alert" className="border border-status-critical px-3 py-2 text-meta text-status-critical">
          {writeOff.error.code === 'INSUFFICIENT_STOCK'
            ? t('writeOff.insufficient')
            : writeOff.error.code === 'RESOURCE_NOT_FOUND'
              ? t('error.unknownMedication')
              : t('writeOff.failedBody')}
        </p>
      ) : null}

      <ol className="flex flex-col gap-4">
        {lines.map((line, index) => (
          <li
            key={line.key}
            className="flex flex-col gap-3 border-t border-border pt-4 first:border-0 first:pt-0"
          >
            {lines.length > 1 ? (
              <div className="flex items-center justify-between gap-2">
                <h3 className="text-meta font-medium text-secondary">
                  {t('composer.lineHeading', { number: index + 1 })}
                </h3>
                <Button type="button" variant="ghost" size="sm" onClick={() => removeLine(line.key)}>
                  <Trash2 aria-hidden className="size-4" />
                  {t('composer.removeLine')}
                </Button>
              </div>
            ) : null}

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <Field id={`write-off-${line.key}-medication`} label={t('composer.medicationLabel')} required>
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
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
              <Field
                id={`write-off-${line.key}-quantity`}
                label={t('composer.quantityLabel')}
                hint={line.medicationId ? t('writeOff.available', { count: available(line.medicationId) }) : undefined}
                required
              >
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
          </li>
        ))}
      </ol>

      <Button type="button" variant="secondary" size="sm" onClick={addLine}>
        <Plus aria-hidden className="size-4" />
        {t('composer.addLine')}
      </Button>

      <div className="flex flex-wrap items-center gap-2">
        <Button type="submit" variant="primary" size="sm" disabled={writeOff.isPending}>
          {writeOff.isPending ? t('working') : t('writeOff.save')}
        </Button>
        <Button
          type="button"
          variant="secondary"
          size="sm"
          onClick={onClose}
          disabled={writeOff.isPending}
        >
          {t('composer.cancel')}
        </Button>
      </div>
    </form>
  );
}
