'use client';

import { Stethoscope } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import {
  DataTable,
  type DataTableColumn,
} from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Field, Select } from '@/components/ui/field';
import {
  useDepartmentList,
  useEncounters,
  usePatientName,
} from '@/lib/data/queries';
import type { EncounterRow } from '@/lib/data/encounters';

/**
 * Doctor workspace — encounter list (F4).
 *
 * `GET /encounters` is an unmodelled, mis-typed read (GAP-020), so rows are
 * validated structurally in `src/lib/data/encounters.ts`. Rows carry only
 * `patientId`; names resolve on demand like the day book (GAP-018).
 */

const STATUS_TONE: Readonly<Record<string, StatusTone>> = {
  OPEN: 'info',
  IN_PROGRESS: 'warning',
  COMPLETED: 'success',
};

export function EncounterListScreen() {
  const t = useTranslations('encounters');
  const locale = useLocale();
  const [status, setStatus] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const departments = useDepartmentList();
  const filtered = useEncounters({
    status: status || undefined,
    departmentId: departmentId || undefined,
  });
  const rows = filtered.data?.data.items ?? [];

  const departmentNames = new Map(
    (departments.data?.data ?? []).map((department) => [department.id, department.name]),
  );
  const departmentName = (id: string) => departmentNames.get(id) ?? id;

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'short',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const columns: readonly DataTableColumn<EncounterRow>[] = [
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'opened',
      header: t('columnOpened'),
      numeric: false,
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDateTime(row.openedAt)}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('columnType'),
      cell: (row) => <span className="text-secondary">{t(`type.${row.type}`)}</span>,
    },
    {
      key: 'department',
      header: t('columnDepartment'),
      cell: (row) => <span className="text-secondary">{departmentName(row.departmentId)}</span>,
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill tone={STATUS_TONE[row.status] ?? 'neutral'} label={t(`status.${row.status}`)} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-meta text-secondary">{t('pageIntro')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-3">
        <div className="w-48">
          <Field id="encounter-status-filter" label={t('filterStatus')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={status}
                onChange={(event) => setStatus(event.target.value)}
              >
                <option value="">{t('allStatuses')}</option>
                <option value="OPEN">{t('status.OPEN')}</option>
                <option value="IN_PROGRESS">{t('status.IN_PROGRESS')}</option>
                <option value="COMPLETED">{t('status.COMPLETED')}</option>
              </Select>
            )}
          </Field>
        </div>
        <div className="w-60">
          <Field id="encounter-department-filter" label={t('filterDepartment')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('allDepartments')}</option>
                {(departments.data?.data ?? []).map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {filtered.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={Stethoscope}
          headingLevel={2}
        />
      ) : (
        <DataTable<EncounterRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/encounters/${row.id}`}
          rowLinkLabel={(_row) => t('openWorkspace')}
          loading={filtered.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

/** One row's patient name, resolved on demand (GAP-018). */
function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('encounters');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}