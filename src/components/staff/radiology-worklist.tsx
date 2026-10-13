'use client';

import { ScanLine } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Field, Select } from '@/components/ui/field';
import { usePatientName, useRadiologyOrders } from '@/lib/data/queries';
import {
  IMAGING_MODALITIES,
  RADIOLOGY_STATUSES,
  type ImagingModality,
  type RadiologyOrderRow,
  type RadiologyStatus,
} from '@/lib/data/radiology';

/**
 * Radiology worklist (F5) — every imaging order, newest first.
 *
 * `GET /radiology/orders` serializes the full order (including the report) but
 * the export mis-types the 200 as the request DTO (GAP-020), so rows are
 * validated structurally in `src/lib/data/radiology.ts`. Rows carry only
 * `patientId`; names resolve on demand like the day book (GAP-018).
 */

const STATUS_TONE: Record<RadiologyStatus, StatusTone> = {
  ORDERED: 'neutral',
  SCHEDULED: 'info',
  PERFORMED: 'warning',
  REPORTED: 'info',
  VERIFIED: 'info',
  RELEASED: 'success',
  CANCELLED: 'neutral',
};

export function RadiologyWorklistScreen() {
  const t = useTranslations('radiology');
  const locale = useLocale();
  const [status, setStatus] = useState<RadiologyStatus | ''>('');
  const [modality, setModality] = useState<ImagingModality | ''>('');

  const orders = useRadiologyOrders({
    status: status || undefined,
  });
  const rows = (orders.data?.data.items ?? []).filter(
    (row) => !modality || row.modality === modality,
  );

  const formatDateTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const columns: readonly DataTableColumn<RadiologyOrderRow>[] = [
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
      key: 'study',
      header: t('columnStudy'),
      cell: (row) => (
        <span className="text-primary">
          {t(`modality.${row.modality}`)}
          {row.region ? <span className="text-tertiary"> · {row.region}</span> : null}
        </span>
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

      <div className="flex flex-wrap gap-4">
        <div className="w-48">
          <Field id="radiology-status-filter" label={t('filterStatus')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={status}
                onChange={(event) => setStatus(event.target.value as RadiologyStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {RADIOLOGY_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`status.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>

        <div className="w-48">
          <Field id="radiology-modality-filter" label={t('filterModality')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={modality}
                onChange={(event) => setModality(event.target.value as ImagingModality | '')}
              >
                <option value="">{t('allModalities')}</option>
                {IMAGING_MODALITIES.map((value) => (
                  <option key={value} value={value}>
                    {t(`modality.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {orders.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={ScanLine}
          headingLevel={2}
        />
      ) : (
        <DataTable<RadiologyOrderRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/radiology/${row.id}`}
          rowLinkLabel={(row) => t('openOrder', { number: row.orderNumber })}
          loading={orders.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('radiology');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}
