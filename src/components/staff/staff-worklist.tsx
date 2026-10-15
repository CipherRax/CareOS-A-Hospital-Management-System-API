'use client';

import { UsersRound } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Field, Input } from '@/components/ui/field';
import { useStaff } from '@/lib/data/queries';
import { displayName, type EmploymentStatus } from '@/lib/data/admin';
import type { StaffRow } from '@/lib/data/staff';

/**
 * Staff directory (F9 administration).
 *
 * `GET /staff` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/staff.ts`. Staff profiles are created with a user (the invite
 * dialog) and are only edited here, so the worklist has no create action.
 */

export const EMPLOYMENT_STATUS_TONE: Record<EmploymentStatus, StatusTone> = {
  ACTIVE: 'success',
  ON_LEAVE: 'warning',
  TERMINATED: 'critical',
  CONTRACT: 'info',
};

export function StaffWorklistScreen() {
  const t = useTranslations('admin');
  const [query, setQuery] = useState('');

  const staff = useStaff({ q: query.trim() || undefined });
  const rows = staff.data?.data.rows ?? [];

  const columns: readonly DataTableColumn<StaffRow>[] = [
    {
      key: 'person',
      header: t('staffColumnPerson'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-primary">
            {displayName(row.user) || row.user.email}
          </span>
          <span className="text-caption text-tertiary">{row.user.email}</span>
        </span>
      ),
    },
    {
      key: 'number',
      header: t('staffColumnNumber'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">{row.staffNumber}</span>
      ),
    },
    {
      key: 'role',
      header: t('staffColumnRole'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="text-secondary">{row.professionalTitle ?? t('noTitle')}</span>
          {row.specialization ? (
            <span className="text-caption text-tertiary">{row.specialization}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'assignments',
      header: t('staffColumnAssignments'),
      cell: (row) =>
        row.branches.length > 0 || row.departments.length > 0 ? (
          <span className="flex flex-col">
            <span className="text-secondary">
              {row.branches.map((branch) => branch.name).join(', ') || t('noneBranch')}
            </span>
            <span className="text-caption text-tertiary">
              {row.departments.map((department) => department.name).join(', ') ||
                t('noneDepartment')}
            </span>
          </span>
        ) : (
          <span className="text-tertiary">{t('unassigned')}</span>
        ),
    },
    {
      key: 'employment',
      header: t('staffColumnEmployment'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={EMPLOYMENT_STATUS_TONE[row.employmentStatus]}
          label={t(`employmentStatus.${row.employmentStatus}`)}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-col gap-1">
        <h1 className="text-heading font-semibold text-primary">{t('staffTitle')}</h1>
        <p className="text-meta text-secondary">{t('staffIntro')}</p>
      </header>

      <div className="w-64">
        <Field id="staff-search" label={t('searchLabel')}>
          {({ controlId }) => (
            <Input
              id={controlId}
              type="search"
              value={query}
              placeholder={t('staffSearchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </Field>
      </div>

      {staff.error ? (
        <EmptyState
          title={t('staffUnavailableTitle')}
          description={t('staffUnavailableBody')}
          icon={UsersRound}
          headingLevel={2}
        />
      ) : (
        <DataTable<StaffRow>
          caption={t('staffTableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/staff/${row.id}`}
          rowLinkLabel={(row) => t('openStaff', { name: displayName(row.user) || row.user.email })}
          loading={staff.isLoading}
          emptyMessage={t('staffEmpty')}
        />
      )}
    </div>
  );
}
