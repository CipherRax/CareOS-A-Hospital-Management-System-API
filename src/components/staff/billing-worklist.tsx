'use client';

import { Receipt } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { MoneyText } from '@/components/clinical/money-text';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Field, Select } from '@/components/ui/field';
import { useInvoices, useOrgCurrency, usePatientName } from '@/lib/data/queries';
import { INVOICE_STATUSES, type InvoiceRow, type InvoiceStatus } from '@/lib/data/billing';

/**
 * Billing worklist (F7) — every invoice, by status.
 *
 * `GET /invoices` is a thin projection and the export mis-types the 200 as the
 * request DTO (GAP-020), so rows are validated structurally in
 * `src/lib/data/billing.ts`. Rows carry only `patientId`; names resolve on
 * demand like the rest of the desks. Money is rendered through `MoneyText` with
 * the org currency from the session — never parsed or totalled here.
 */

const STATUS_TONE: Record<InvoiceStatus, StatusTone> = {
  DRAFT: 'neutral',
  ISSUED: 'info',
  PARTIALLY_PAID: 'warning',
  PAID: 'success',
  CANCELLED: 'neutral',
  REFUNDED: 'critical',
};

export function BillingWorklistScreen() {
  const t = useTranslations('billing');
  const locale = useLocale();
  const currency = useOrgCurrency();
  const [status, setStatus] = useState<InvoiceStatus | ''>('');

  const invoices = useInvoices({ status: status || undefined });
  const rows = invoices.data?.data.rows ?? [];

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(
          new Date(iso),
        )
      : null;

  const columns: readonly DataTableColumn<InvoiceRow>[] = [
    {
      key: 'invoice',
      header: t('columnInvoice'),
      cell: (row) => (
        <span className="font-medium tabular-nums text-primary">{row.invoiceNumber}</span>
      ),
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'total',
      header: t('columnTotal'),
      cell: (row) => <MoneyText amount={row.total} currency={currency} />,
    },
    {
      key: 'balance',
      header: t('columnBalance'),
      cell: (row) => <MoneyText amount={row.balanceDue} currency={currency} />,
    },
    {
      key: 'issued',
      header: t('columnIssued'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDate(row.issuedAt) ?? t('notIssued')}
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
        <Field id="billing-status-filter" label={t('filterStatus')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={status}
              onChange={(event) => setStatus(event.target.value as InvoiceStatus | '')}
            >
              <option value="">{t('allStatuses')}</option>
              {INVOICE_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {invoices.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={Receipt}
          headingLevel={2}
        />
      ) : (
        <DataTable<InvoiceRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/billing/${row.id}`}
          rowLinkLabel={(row) => t('openInvoice', { number: row.invoiceNumber })}
          loading={invoices.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('billing');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}
