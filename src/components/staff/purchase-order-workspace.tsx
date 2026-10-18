'use client';

import { ArrowLeft } from 'lucide-react';
import Link from 'next/link';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import {
  useMedications,
  usePurchaseOrder,
  usePurchaseOrderAction,
  useReceivePurchaseOrder,
  useSuppliers,
} from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  outstandingUnits,
  PURCHASE_ORDER_ACTION_FROM,
  type PurchaseOrderAction,
  type PurchaseOrderLine,
  type PurchaseOrderRow,
  type PurchaseOrderStatus,
  type ReceivePurchaseOrderLineInput,
} from '@/lib/data/purchase-orders';

/**
 * Purchase-order workspace (F6 — procurement writes) — one order, at whatever
 * point of its lifecycle it sits.
 *
 * The read answers `{ purchaseOrder }` while the export types the bare entity,
 * and the action/receive writes answer the same shape (GAP-020), so every body
 * is validated in `src/lib/data/purchase-orders.ts`. The action bar is the
 * server's transition graph: submit→approve→order, then receive (its own
 * endpoint, because it writes stock), then close. A move the server would refuse
 * is never offered, and one that races a stale tab resolves to a 409 rendered in
 * place.
 *
 * Receiving is capped per line at what is still outstanding: the service rejects
 * an over-receipt with a `VALIDATION_ERROR`, so the composer holds the same
 * ceiling rather than letting the operator discover it from a failed submit.
 *
 * Lines report coverage — ordered against received — and deliberately not value:
 * `unitCost` rides the wire as a decimal string (ADR-029) and a procurement
 * screen that summed it would need decimal arithmetic the client does not have.
 */

const STATUS_TONE: Record<PurchaseOrderStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'info',
  ORDERED: 'warning',
  PARTIALLY_RECEIVED: 'warning',
  RECEIVED: 'success',
  CLOSED: 'neutral',
  CANCELLED: 'critical',
};

/** The statuses that still have stock to receive, i.e. `receive`'s allowed-from set. */
const RECEIVABLE: readonly PurchaseOrderStatus[] = ['ORDERED', 'PARTIALLY_RECEIVED'];

export function PurchaseOrderWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('pharmacy');
  const order = usePurchaseOrder(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/pharmacy/purchase-orders"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden="true" className="size-4" />
        {t('purchaseOrders.workspace.back')}
      </Link>

      {order.isLoading && !order.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('purchaseOrders.workspace.loading')}
        </p>
      ) : order.error ? (
        <EmptyState
          title={t('purchaseOrders.workspace.unavailableTitle')}
          description={t('purchaseOrders.workspace.unavailableBody')}
          headingLevel={2}
        />
      ) : !order.data ? (
        <EmptyState
          title={t('purchaseOrders.workspace.notFoundTitle')}
          description={t('purchaseOrders.workspace.notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <PurchaseOrderBody order={order.data.data} />
      )}
    </div>
  );
}

function PurchaseOrderBody({ order }: { order: PurchaseOrderRow }) {
  const t = useTranslations('pharmacy');
  const locale = useLocale();

  const suppliers = useSuppliers({ limit: 100 });
  const medications = useMedications({ isActive: 'true' });
  const action = usePurchaseOrderAction();
  const receive = useReceivePurchaseOrder();

  const [receiveOpen, setReceiveOpen] = useState(false);

  const supplierName =
    suppliers.data?.data.rows.find((supplier) => supplier.id === order.supplierId)?.name ?? null;
  const catalog = medications.data?.data.items ?? [];
  const medicationName = (id: string): string =>
    catalog.find((medication) => medication.id === id)?.name ?? id;

  const failure: QueryError | null =
    (action.isError && action.error) || (receive.isError && receive.error) || null;
  const alert = failure ? describeFailure(failure, t) : null;

  const available: readonly PurchaseOrderAction[] = (
    Object.keys(PURCHASE_ORDER_ACTION_FROM) as PurchaseOrderAction[]
  ).filter((candidate) => PURCHASE_ORDER_ACTION_FROM[candidate] === order.status);
  const receivable = order.items.some((line) => outstandingUnits(line) > 0);
  const hasActions = available.length > 0 || (RECEIVABLE.includes(order.status) && receivable);

  const itemColumns: readonly DataTableColumn<PurchaseOrderLine>[] = [
    {
      key: 'medication',
      header: t('purchaseOrders.columnLineMedication'),
      cell: (row) => <span className="font-medium text-primary">{medicationName(row.medicationId)}</span>,
    },
    {
      key: 'ordered',
      header: t('purchaseOrders.columnOrdered'),
      numeric: true,
      cell: (row) => <span className="tabular-nums text-primary">{row.quantityOrdered}</span>,
    },
    {
      key: 'received',
      header: t('purchaseOrders.columnReceived'),
      numeric: true,
      cell: (row) => <span className="tabular-nums text-primary">{row.quantityReceived}</span>,
    },
    {
      key: 'outstanding',
      header: t('purchaseOrders.columnOutstanding'),
      numeric: true,
      cell: (row) => {
        const outstanding = outstandingUnits(row);
        return (
          <span
            className={
              outstanding > 0 ? 'tabular-nums text-status-warning' : 'tabular-nums text-secondary'
            }
          >
            {outstanding}
          </span>
        );
      },
    },
  ];

  const format = (iso: string | null) =>
    iso ? formatUtc(iso, locale) : t('purchaseOrders.notRecorded');

  return (
    <div className="flex flex-col gap-4">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold tabular-nums text-primary">{order.poNumber}</h1>
        <StatusPill
          tone={STATUS_TONE[order.status]}
          label={t(`purchaseOrders.status.${order.status}`)}
        />
      </header>

      {alert ? (
        <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
          <h2 className="text-body font-semibold text-status-critical">{alert.title}</h2>
          <p className="text-meta text-secondary">{alert.body}</p>
        </div>
      ) : null}

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section
          aria-labelledby="purchase-order-summary-heading"
          className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4"
        >
          <h2
            id="purchase-order-summary-heading"
            className="text-subheading font-semibold text-primary"
          >
            {t('purchaseOrders.summaryHeading')}
          </h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('purchaseOrders.columnSupplier')}</dt>
            <dd className="text-primary">
              {suppliers.isLoading ? '…' : (supplierName ?? t('purchaseOrders.unknownSupplier'))}
            </dd>
            <dt className="text-tertiary">{t('purchaseOrders.columnExpected')}</dt>
            <dd className="tabular-nums text-primary">{format(order.expectedAt)}</dd>
            <dt className="text-tertiary">{t('purchaseOrders.submitted')}</dt>
            <dd className="tabular-nums text-primary">{format(order.submittedAt)}</dd>
            <dt className="text-tertiary">{t('purchaseOrders.approved')}</dt>
            <dd className="tabular-nums text-primary">{format(order.approvedAt)}</dd>
            <dt className="text-tertiary">{t('purchaseOrders.received')}</dt>
            <dd className="tabular-nums text-primary">{format(order.receivedAt)}</dd>
            <dt className="text-tertiary">{t('purchaseOrders.closed')}</dt>
            <dd className="tabular-nums text-primary">{format(order.closedAt)}</dd>
          </dl>
          {order.notes ? (
            <p className="text-meta text-secondary">
              <span className="font-medium text-tertiary">{t('purchaseOrders.notesLabel')}: </span>
              {order.notes}
            </p>
          ) : null}
        </section>

        <section
          aria-labelledby="purchase-order-actions-heading"
          className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
        >
          <h2
            id="purchase-order-actions-heading"
            className="text-subheading font-semibold text-primary"
          >
            {t('purchaseOrders.actionsHeading')}
          </h2>
          {hasActions ? (
            <div className="flex flex-col items-start gap-2">
              {available.map((candidate) => (
                <Button
                  key={candidate}
                  variant={candidate === 'close' ? 'secondary' : 'primary'}
                  disabled={action.isPending || receive.isPending}
                  onClick={() => action.mutate({ id: order.id, action: candidate })}
                >
                  {t(`purchaseOrders.action.${candidate}`)}
                </Button>
              ))}
              {RECEIVABLE.includes(order.status) && receivable ? (
                <Button
                  variant="primary"
                  disabled={action.isPending || receive.isPending}
                  onClick={() => setReceiveOpen(true)}
                >
                  {t('purchaseOrders.action.receive')}
                </Button>
              ) : null}
            </div>
          ) : (
            <p className="text-meta text-secondary">{t('purchaseOrders.noActions')}</p>
          )}
          <p className="text-caption text-tertiary">
            {t('purchaseOrders.version', { version: order.version })}
          </p>
        </section>
      </div>

      <section
        aria-labelledby="purchase-order-lines-heading"
        className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4"
      >
        <h2
          id="purchase-order-lines-heading"
          className="text-subheading font-semibold text-primary"
        >
          {t('purchaseOrders.linesHeading')}
        </h2>
        <DataTable<PurchaseOrderLine>
          caption={t('purchaseOrders.linesCaption')}
          columns={itemColumns}
          rows={order.items}
          rowKey={(line) => line.medicationId}
          emptyMessage={t('purchaseOrders.emptyLines')}
          scrollable
        />
      </section>

      <ReceiveDialog
        key={receiveOpen ? order.id : 'closed'}
        open={receiveOpen}
        order={order}
        medicationName={medicationName}
        pending={receive.isPending}
        onOpenChange={(open) => !open && setReceiveOpen(false)}
        onSubmit={(lines) => {
          receive.mutate(
            { id: order.id, lines },
            {
              onSuccess: () => setReceiveOpen(false),
            },
          );
        }}
        cancelLabel={t('purchaseOrders.receive.cancel')}
      />
    </div>
  );
}

interface ReceiptDraft {
  quantity: string;
  batchNumber: string;
  expiryDate: string;
}

function ReceiveDialog({
  open,
  order,
  medicationName,
  pending,
  onOpenChange,
  onSubmit,
  cancelLabel,
}: {
  open: boolean;
  order: PurchaseOrderRow;
  medicationName: (id: string) => string;
  pending: boolean;
  onOpenChange: (open: boolean) => void;
  onSubmit: (lines: readonly ReceivePurchaseOrderLineInput[]) => void;
  cancelLabel: string;
}) {
  const t = useTranslations('pharmacy');
  const outstanding = order.items.filter((line) => outstandingUnits(line) > 0);
  const [draft, setDraft] = useState<Record<string, ReceiptDraft>>(() =>
    Object.fromEntries(
      outstanding.map((line) => [
        line.medicationId,
        { quantity: String(outstandingUnits(line)), batchNumber: '', expiryDate: '' },
      ]),
    ),
  );
  const [error, setError] = useState<string | null>(null);

  const update = (medicationId: string, patch: Partial<ReceiptDraft>) =>
    setDraft((current) => {
      const existing = current[medicationId];
      if (!existing) return current;
      return { ...current, [medicationId]: { ...existing, ...patch } };
    });

  /** The draft for a line, defaulting to "everything outstanding" on first open. */
  const draftFor = (line: PurchaseOrderLine): ReceiptDraft =>
    draft[line.medicationId] ?? {
      quantity: String(outstandingUnits(line)),
      batchNumber: '',
      expiryDate: '',
    };

  const submit = () => {
    setError(null);
    const lines: ReceivePurchaseOrderLineInput[] = [];
    for (const line of outstanding) {
      const entry = draftFor(line);
      const ceiling = outstandingUnits(line);
      const quantity = Number(entry.quantity);
      if (entry.quantity.trim() === '' || quantity === 0) continue;
      if (!Number.isInteger(quantity) || quantity < 0) {
        setError(t('purchaseOrders.receive.errorQuantity'));
        return;
      }
      if (quantity > ceiling) {
        setError(t('purchaseOrders.receive.errorCeiling', { count: ceiling }));
        return;
      }
      if (entry.batchNumber.trim() === '') {
        setError(t('purchaseOrders.receive.errorBatch'));
        return;
      }
      lines.push({
        medicationId: line.medicationId,
        quantity,
        batchNumber: entry.batchNumber.trim(),
        ...(entry.expiryDate ? { expiryDate: entry.expiryDate } : {}),
      });
    }
    if (lines.length === 0) {
      setError(t('purchaseOrders.receive.errorNoLines'));
      return;
    }
    onSubmit(lines);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader
          title={t('purchaseOrders.receive.title')}
          description={t('purchaseOrders.receive.body')}
        />
        <DialogBody className="flex flex-col gap-4">
          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
          <ul className="flex flex-col gap-4">
            {outstanding.map((line) => {
              const entry = draftFor(line);
              const ceiling = outstandingUnits(line);
              return (
                <li key={line.medicationId} className="flex flex-col gap-3 border border-border p-3">
                  <p className="text-meta font-medium text-primary">
                    {medicationName(line.medicationId)}{' '}
                    <span className="font-normal text-tertiary">
                      {t('purchaseOrders.receive.outstanding', { count: ceiling })}
                    </span>
                  </p>
                  <div className="flex flex-wrap items-end gap-3">
                    <div className="w-28">
                      <Field
                        id={`receive-quantity-${line.medicationId}`}
                        label={t('purchaseOrders.receive.quantityLabel')}
                      >
                        {({ controlId }) => (
                          <Input
                            id={controlId}
                            type="number"
                            min={1}
                            max={ceiling}
                            step={1}
                            inputMode="numeric"
                            value={entry.quantity}
                            onChange={(event) =>
                              update(line.medicationId, { quantity: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    </div>
                    <div className="min-w-40 flex-1">
                      <Field
                        id={`receive-batch-${line.medicationId}`}
                        label={t('purchaseOrders.receive.batchLabel')}
                      >
                        {({ controlId }) => (
                          <Input
                            id={controlId}
                            maxLength={200}
                            value={entry.batchNumber}
                            onChange={(event) =>
                              update(line.medicationId, { batchNumber: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    </div>
                    <div className="w-40">
                      <Field
                        id={`receive-expiry-${line.medicationId}`}
                        label={t('purchaseOrders.receive.expiryLabel')}
                      >
                        {({ controlId }) => (
                          <Input
                            id={controlId}
                            type="date"
                            value={entry.expiryDate}
                            onChange={(event) =>
                              update(line.medicationId, { expiryDate: event.target.value })
                            }
                          />
                        )}
                      </Field>
                    </div>
                  </div>
                </li>
              );
            })}
          </ul>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {cancelLabel}
          </Button>
          <Button variant="primary" disabled={pending} onClick={submit}>
            {pending ? t('purchaseOrders.receive.submitting') : t('purchaseOrders.receive.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/** Renders a 409 from a stale tab as "reload", anything else as a generic failure. */
function describeFailure(error: QueryError, t: (key: string) => string) {
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return { title: t('purchaseOrders.errors.staleTitle'), body: t('purchaseOrders.errors.staleBody') };
  }
  if (error.code === 'VALIDATION_ERROR') {
    return {
      title: t('purchaseOrders.errors.invalidTitle'),
      body: t('purchaseOrders.errors.invalidBody'),
    };
  }
  return { title: t('purchaseOrders.errors.failedTitle'), body: t('purchaseOrders.errors.failedBody') };
}

/** Formats an ISO instant as a UTC date — stable between server and client. */
function formatUtc(value: string, locale: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(locale, {
    dateStyle: 'medium',
    timeStyle: 'short',
    timeZone: 'UTC',
  }).format(parsed);
}
