'use client';

import { FileBarChart2 } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  useBranchOptions,
  useDepartmentList,
  useReportExports,
  useRequestReportExport,
} from '@/lib/data/queries';
import {
  REPORT_FORMATS,
  REPORT_TYPES,
  type ReportExportRow,
  type ReportFormat,
  type ReportStatus,
  type ReportType,
} from '@/lib/data/reports';
import { ReportActionAlert } from '@/components/reports/report-alert';

/**
 * Reports desk (F10 analytics & reports).
 *
 * The export history and the request form for a new export. `GET /reports/exports`
 * types its 200 as the request DTO while the service answers a `PageResult`
 * (GAP-020 family), so rows are validated structurally in `src/lib/data/reports.ts`.
 * Requesting an export answers 202 with a PENDING row; the desk does not block on
 * the render — the row is opened on the detail screen, which polls until the
 * artifact is READY.
 */

export const REPORT_STATUS_TONE: Record<ReportStatus, StatusTone> = {
  PENDING: 'info',
  READY: 'success',
  FAILED: 'critical',
  EXPIRED: 'warning',
};

export function ReportsWorklistScreen() {
  const t = useTranslations('reports');
  const locale = useLocale();
  const [reportType, setReportType] = useState<ReportType | ''>('');

  const exports = useReportExports({ reportType: reportType || undefined });
  const rows = exports.data?.data.rows ?? [];

  const formatDateTime = (iso: string) =>
    new Intl.DateTimeFormat(locale, {
      dateStyle: 'medium',
      timeStyle: 'short',
      timeZone: 'UTC',
    }).format(new Date(iso));

  const columns: readonly DataTableColumn<ReportExportRow>[] = [
    {
      key: 'created',
      header: t('columnCreated'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDateTime(row.createdAt)}
        </span>
      ),
    },
    {
      key: 'type',
      header: t('columnType'),
      cell: (row) => <span className="font-medium text-primary">{t(`type.${row.reportType}`)}</span>,
    },
    {
      key: 'format',
      header: t('columnFormat'),
      cell: (row) => <span className="text-secondary">{t(`format.${row.format}`)}</span>,
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={REPORT_STATUS_TONE[row.status]}
          label={t(`status.${row.status}`)}
        />
      ),
    },
    {
      key: 'size',
      header: t('columnSize'),
      numeric: true,
      cell: (row) =>
        row.sizeBytes === null ? (
          <span className="text-tertiary">{t('sizePending')}</span>
        ) : (
          <span className="tabular-nums text-secondary">
            {formatBytes(row.sizeBytes)}
          </span>
        ),
    },
  ];

  return (
    <div className="flex flex-col gap-6 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold text-primary">{t('title')}</h1>
        <p className="text-meta text-secondary">{t('intro')}</p>
      </header>

      <RequestExportPanel />

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <h2 className="text-subheading font-semibold text-primary">{t('historyHeading')}</h2>
          <div className="w-56">
            <Field id="report-type-filter" label={t('filterTypeLabel')}>
              {({ controlId }) => (
                <Select
                  id={controlId}
                  value={reportType}
                  onChange={(event) => setReportType(event.target.value as ReportType | '')}
                >
                  <option value="">{t('filterAllTypes')}</option>
                  {REPORT_TYPES.map((type) => (
                    <option key={type} value={type}>
                      {t(`type.${type}`)}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
          </div>
        </div>

        {exports.error ? (
          <EmptyState
            title={t('historyUnavailableTitle')}
            description={t('historyUnavailableBody')}
            icon={FileBarChart2}
            headingLevel={2}
          />
        ) : (
          <DataTable<ReportExportRow>
            caption={t('historyCaption')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            rowHref={(row) => `/reports/${row.id}`}
            rowLinkLabel={(row) => t('openExport', { type: t(`type.${row.reportType}`) })}
            loading={exports.isLoading}
            emptyMessage={t('historyEmpty')}
          />
        )}
      </section>
    </div>
  );
}

/** The request form. Windows default per report type on the service; dates are optional. */
function RequestExportPanel() {
  const t = useTranslations('reports');
  const request = useRequestReportExport();
  const branches = useBranchOptions();
  const departments = useDepartmentList();

  const [reportType, setReportType] = useState<ReportType>('PATIENT');
  const [format, setFormat] = useState<ReportFormat>('CSV');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [branchId, setBranchId] = useState('');
  const [departmentId, setDepartmentId] = useState('');

  const submit = () => {
    request.mutate({
      reportType,
      format,
      from: from ? new Date(`${from}T00:00:00Z`).toISOString() : undefined,
      to: to ? new Date(`${to}T23:59:59Z`).toISOString() : undefined,
      branchId: branchId || undefined,
      departmentId: departmentId || undefined,
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('requestHeading')}</h2>
      <p className="text-meta text-secondary">{t('requestIntro')}</p>

      {request.isSuccess ? (
        <div role="status" className="text-meta text-status-success">
          {t('requestQueued')}
        </div>
      ) : null}
      <ReportActionAlert error={request.error} />

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="report-type" label={t('fieldType')} required>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={reportType}
              onChange={(event) => setReportType(event.target.value as ReportType)}
            >
              {REPORT_TYPES.map((type) => (
                <option key={type} value={type}>
                  {t(`type.${type}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="report-format" label={t('fieldFormat')} required>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={format}
              onChange={(event) => setFormat(event.target.value as ReportFormat)}
            >
              {REPORT_FORMATS.map((value) => (
                <option key={value} value={value}>
                  {t(`format.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="report-from" label={t('fieldFrom')} hint={t('fieldFromHint')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              type="date"
              aria-describedby={describedBy}
              value={from}
              onChange={(event) => setFrom(event.target.value)}
            />
          )}
        </Field>
        <Field id="report-to" label={t('fieldTo')} hint={t('fieldToHint')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              type="date"
              aria-describedby={describedBy}
              value={to}
              onChange={(event) => setTo(event.target.value)}
            />
          )}
        </Field>
        <Field id="report-branch" label={t('fieldBranch')} hint={t('fieldBranchHint')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={branchId}
              onChange={(event) => setBranchId(event.target.value)}
            >
              <option value="">{t('allBranches')}</option>
              {(branches.data?.data ?? []).map((branch) => (
                <option key={branch.id} value={branch.id}>
                  {branch.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="report-department" label={t('fieldDepartment')} hint={t('fieldDepartmentHint')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
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

      <div className="flex justify-end">
        <Button variant="primary" disabled={request.isPending} onClick={submit}>
          {t('requestAction')}
        </Button>
      </div>
    </section>
  );
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${Math.round(kb)} KB`;
  return `${(kb / 1024).toFixed(1)} MB`;
}
