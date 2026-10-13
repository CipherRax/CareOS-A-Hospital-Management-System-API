'use client';

import { FlaskConical } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Field, Select } from '@/components/ui/field';
import { useLabOrders, usePatientName } from '@/lib/data/queries';
import {
  LAB_ORDER_STATUSES,
  type LabOrderPriority,
  type LabOrderStatus,
  type LabOrderSummaryRow,
} from '@/lib/data/laboratory';

/**
 * Laboratory worklist (F5) — every order, newest first.
 *
 * `GET /lab/orders` is a thin projection (no results, no test names) and the
 * export mis-types the 200 as the request DTO (GAP-020), so rows are validated
 * structurally in `src/lib/data/laboratory.ts`. Rows carry only `patientId`;
 * names resolve on demand like the day book (GAP-018).
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

export function LabWorklistScreen() {
  const t = useTranslations('laboratory');
  const locale = useLocale();
  const [status, setStatus] = useState<LabOrderStatus | ''>('');

  const orders = useLabOrders({ status: status || undefined });
  const rows = orders.data?.data.items ?? [];

  const formatDateTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const columns: readonly DataTableColumn<LabOrderSummaryRow>[] = [
    {
      key: 'order',
      header: t('columnOrder'),
      cell: (row) => (
        <span className="font-medium tabular-nums text-primary">{row.orderNumber}</span>
      ),
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'priority',
      header: t('columnPriority'),
      cell: (row) => (
        <StatusPill size="sm" tone={PRIORITY_TONE[row.priority]} label={t(`priority.${row.priority}`)} />
      ),
    },
    {
      key: 'ordered',
      header: t('columnOrdered'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDateTime(row.orderedAt) ?? t('unknownDate')}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={STATUS_TONE[row.status]} label={t(`status.${row.status}`)} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-meta text-secondary">{t('pageIntro')}</p>
      </header>

      <div className="w-48">
        <Field id="lab-status-filter" label={t('filterStatus')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={status}
              onChange={(event) => setStatus(event.target.value as LabOrderStatus | '')}
            >
              <option value="">{t('allStatuses')}</option>
              {LAB_ORDER_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {orders.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={FlaskConical}
          headingLevel={2}
        />
      ) : (
        <DataTable<LabOrderSummaryRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/lab/${row.id}`}
          rowLinkLabel={(row) => t('openOrder', { number: row.orderNumber })}
          loading={orders.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('laboratory');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}
