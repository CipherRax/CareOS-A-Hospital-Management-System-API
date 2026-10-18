'use client';

import { ArrowLeft, Plus, ShieldAlert } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { RaisePurchaseOrderDialog } from '@/components/staff/purchase-order-dialog';
import { Button } from '@/components/ui/button';
import { Field, Select } from '@/components/ui/field';
import {
  PURCHASE_ORDER_STATUSES,
  type PurchaseOrderRow,
  type PurchaseOrderStatus,
} from '@/lib/data/purchase-orders';
import { usePurchaseOrders, useSuppliers } from '@/lib/data/queries';

/**
 * Purchase-order worklist `GET /purchase-orders` (F6 — procurement).
 *
 * The export types the 200 as the *request* DTO while the service returns
 * `pageOf(...)` of serialized orders (GAP-020), so the rows are validated
 * structurally in `src/lib/data/purchase-orders.ts` and a drifted body reads as
 * an error rather than an empty shelf of orders.
 *
 * Each row opens the order's own screen, which carries the lifecycle moves; the
 * header raises a new one. A supplier has no detail route either, so the name
 * comes from the directory read and the column falls back to the id rather than
 * inventing a label. Units are reported as ordered against received — coverage,
 * not value: `unitCost` is a decimal (ADR-029) and a list that rounds it would
 * misstate a commitment.
 *
 * Only the first page is requested; a footer names how many of the total are
 * shown instead of silently truncating.
 */

/** Tone per status. A cancelled order and a received one must not look alike. */
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

const PAGE_LIMIT = 25;

function orderedUnits(row: PurchaseOrderRow): number {
  return row.items.reduce((total, line) => total + line.quantityOrdered, 0);
}

function receivedUnits(row: PurchaseOrderRow): number {
  return row.items.reduce((total, line) => total + line.quantityReceived, 0);
}

export function PharmacyPurchaseOrdersScreen() {
  const t = useTranslations('pharmacy');
  const [status, setStatus] = useState<PurchaseOrderStatus | ''>('');
  const [raising, setRaising] = useState(false);
  const orders = usePurchaseOrders({
    ...(status ? { status } : {}),
    page: 1,
    limit: PAGE_LIMIT,
  });
  const suppliers = useSuppliers({ limit: 100 });

  const page = orders.data?.data;
  const supplierName = (supplierId: string): string | null =>
    suppliers.data?.data.rows.find((supplier) => supplier.id === supplierId)?.name ?? null;

  const columns: readonly DataTableColumn<PurchaseOrderRow>[] = [
    {
      key: 'poNumber',
      header: t('purchaseOrders.columnPo'),
      cell: (row) => <span className="font-medium text-primary">{row.poNumber}</span>,
    },
    {
      key: 'supplier',
      header: t('purchaseOrders.columnSupplier'),
      cell: (row) =>
        supplierName(row.supplierId) ?? (
          <span className="text-tertiary">{t('purchaseOrders.unknownSupplier')}</span>
        ),
    },
    {
      key: 'ordered',
      header: t('purchaseOrders.columnOrdered'),
      numeric: true,
      cell: (row) => <span className="tabular-nums text-primary">{orderedUnits(row)}</span>,
    },
    {
      key: 'received',
      header: t('purchaseOrders.columnReceived'),
      numeric: true,
      cell: (row) => {
        const ordered = orderedUnits(row);
        const received = receivedUnits(row);
        return (
          <span
            className={
              received < ordered ? 'tabular-nums text-status-warning' : 'tabular-nums text-primary'
            }
          >
            {received}
          </span>
        );
      },
    },
    {
      key: 'expected',
      header: t('purchaseOrders.columnExpected'),
      cell: (row) =>
        row.expectedAt ? (
          formatUtcDate(row.expectedAt)
        ) : (
          <span className="text-tertiary">{t('purchaseOrders.notRecorded')}</span>
        ),
    },
    {
      key: 'status',
      header: t('purchaseOrders.columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={STATUS_TONE[row.status]}
          label={t(`purchaseOrders.status.${row.status}`)}
        />
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
        {t('purchaseOrders.back')}
      </Link>

      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('purchaseOrders.title')}</h1>
          <p className="max-w-prose text-meta text-secondary">{t('purchaseOrders.description')}</p>
        </div>
        <div className="flex flex-wrap items-end gap-3">
          <div className="w-56">
            <Field id="purchase-order-status-filter" label={t('purchaseOrders.filterStatus')}>
              {({ controlId }) => (
                <Select
                  id={controlId}
                  value={status}
                  onChange={(event) => setStatus(event.target.value as PurchaseOrderStatus | '')}
                >
                  <option value="">{t('purchaseOrders.allStatuses')}</option>
                  {PURCHASE_ORDER_STATUSES.map((value) => (
                    <option key={value} value={value}>
                      {t(`purchaseOrders.status.${value}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
          <Button variant="primary" onClick={() => setRaising(true)}>
            <Plus aria-hidden="true" className="size-4" />
            {t('purchaseOrders.raise')}
          </Button>
        </div>
      </header>

      <RaisePurchaseOrderDialog open={raising} onOpenChange={setRaising} />

      {orders.error ? (
        <EmptyState
          title={t('purchaseOrders.unavailableTitle')}
          description={t('purchaseOrders.unavailableBody')}
          icon={ShieldAlert}
          headingLevel={2}
        />
      ) : (
        <>
          <DataTable<PurchaseOrderRow>
            caption={t('purchaseOrders.caption')}
            columns={columns}
            rows={page?.rows ?? []}
            rowKey={(row) => row.id}
            loading={orders.isLoading}
            rowHref={(row) => `/pharmacy/purchase-orders/${row.id}`}
            rowLinkLabel={(row) => t('purchaseOrders.openOrder', { number: row.poNumber })}
            emptyMessage={
              status
                ? t('purchaseOrders.emptyFiltered')
                : t('purchaseOrders.empty')
            }
          />
          {page && page.total > page.rows.length ? (
            <p className="text-meta text-secondary">
              {t('purchaseOrders.showing', {
                shown: page.rows.length,
                total: page.total,
              })}
            </p>
          ) : null}
        </>
      )}
    </div>
  );
}

/** Formats an ISO instant as a UTC date — stable between server and client. */
function formatUtcDate(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
