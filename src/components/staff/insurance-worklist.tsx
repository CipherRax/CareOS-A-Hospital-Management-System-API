'use client';

import { ShieldCheck } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { MoneyText } from '@/components/clinical/money-text';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Field, Select } from '@/components/ui/field';
import { useClaims, useOrgCurrency, usePatientName } from '@/lib/data/queries';
import { CLAIM_STATUSES, type ClaimStatus, type InsuranceClaimRow } from '@/lib/data/insurance';

/**
 * Insurance claims worklist (F7) — every claim, by status.
 *
 * `GET /insurance/claims` mis-types its 200 as the request DTO while the service
 * answers a `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/insurance.ts`. Rows carry only `patientId`; names resolve on
 * demand like the rest of the desks. Money is rendered through `MoneyText` with
 * the org currency — never parsed or totalled here.
 */

const STATUS_TONE: Record<ClaimStatus, StatusTone> = {
  DRAFT: 'neutral',
  SUBMITTED: 'info',
  APPROVED: 'info',
  PARTIALLY_APPROVED: 'warning',
  DENIED: 'critical',
  PAID: 'success',
};

export function InsuranceWorklistScreen() {
  const t = useTranslations('insurance');
  const locale = useLocale();
  const currency = useOrgCurrency();
  const [status, setStatus] = useState<ClaimStatus | ''>('');

  const claims = useClaims({ status: status || undefined });
  const rows = claims.data?.data.rows ?? [];

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(
          new Date(iso),
        )
      : null;

  const columns: readonly DataTableColumn<InsuranceClaimRow>[] = [
    {
      key: 'claim',
      header: t('columnClaim'),
      cell: (row) => (
        <span className="font-medium tabular-nums text-primary">{row.claimNumber}</span>
      ),
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'amount',
      header: t('columnAmount'),
      numeric: true,
      cell: (row) => <MoneyText amount={row.amount} currency={currency} />,
    },
    {
      key: 'approved',
      header: t('columnApproved'),
      numeric: true,
      cell: (row) =>
        row.approvedAmount ? (
          <MoneyText amount={row.approvedAmount} currency={currency} />
        ) : (
          <span className="text-tertiary">{t('notApproved')}</span>
        ),
    },
    {
      key: 'submitted',
      header: t('columnSubmitted'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDate(row.submittedAt) ?? t('notSubmitted')}
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
        <Field id="insurance-status-filter" label={t('filterStatus')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={status}
              onChange={(event) => setStatus(event.target.value as ClaimStatus | '')}
            >
              <option value="">{t('allStatuses')}</option>
              {CLAIM_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`status.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {claims.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={ShieldCheck}
          headingLevel={2}
        />
      ) : (
        <DataTable<InsuranceClaimRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/insurance/${row.id}`}
          rowLinkLabel={(row) => t('openClaim', { number: row.claimNumber })}
          loading={claims.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('insurance');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}
