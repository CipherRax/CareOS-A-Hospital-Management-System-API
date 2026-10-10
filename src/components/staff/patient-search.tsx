'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { Search, UserPlus } from 'lucide-react';
import { useEffect, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { usePatientSearch } from '@/lib/data/queries';
import type { PatientListItem } from '@/lib/data/patients';
import { cn } from '@/lib/cn';

/**
 * Reception — patient search (F2).
 *
 * Lookup is `GET /patients?q=` (there is no `/search` path), typed structurally
 * rather than via the export because the search query is unmodelled there
 * (GAP-012). Results render as a table where each row opens the master record.
 *
 * The data comes from the patient registry fixtures, marked EXAMPLE, so a
 * screenshot can never be mistaken for a real patient list.
 */

export function PatientSearchScreen() {
  const t = useTranslations('patients');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');

  // The API search is server-side and the endpoint has no debounce; typing a phone
  // number one digit at a time would otherwise fire a request per keystroke.
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = usePatientSearch(debounced);
  const searching = Boolean(debounced.trim()) && search.isFetching;

  const columns: readonly DataTableColumn<PatientListItem>[] = [
    { key: 'reference', header: t('reference'), width: '9rem', cell: (row) => row.patientNumber },
    {
      key: 'name',
      header: t('name'),
      cell: (row) => row.displayName,
    },
    {
      key: 'dob',
      header: t('dob'),
      width: '9rem',
      cell: (row) => <span className="tabular-nums text-secondary">{row.dateOfBirth ?? '—'}</span>,
    },
    {
      key: 'sex',
      header: t('sex'),
      width: '7rem',
      cell: (row) => <span className="text-secondary">{sexLabel(row.sex)}</span>,
    },
    {
      key: 'phone',
      header: t('phone'),
      width: '10rem',
      cell: (row) => <span className="tabular-nums text-secondary">{row.phone ?? '—'}</span>,
    },
    { key: 'status', header: 'Status', width: '8rem', cell: (row) => row.status.toUpperCase() },
  ];

  const rows: readonly PatientListItem[] = search.data?.data.items ?? [];
  const total = search.data?.data.total ?? 0;
  const hasQuery = debounced.trim().length > 0;

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
          <p className="text-meta text-secondary">{t('pageIntro')}</p>
        </div>
        <Button asChild variant="secondary">
          <Link href="/patients/register">
            <UserPlus aria-hidden className="size-4" strokeWidth={1.5} />
            {t('newPatient')}
          </Link>
        </Button>
      </header>

      <div className="w-full max-w-md">
        <Field id="patient-search" label={t('searchLabel')}>
          {({ controlId, describedBy }) => (
            <div className="relative">
              <Search
                aria-hidden
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-tertiary"
                strokeWidth={1.5}
              />
              <Input
                id={controlId}
                aria-describedby={describedBy}
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder={t('searchPlaceholder')}
                type="search"
                autoComplete="off"
                className="pl-9"
              />
            </div>
          )}
        </Field>
      </div>

      {search.error ? <SearchError onRetry={() => search.refetch()} /> : null}

      {!search.error ? (
        <>
          {/* Announced on change so a search result is not silent for a screen reader. */}
          <p role="status" aria-live="polite" className="text-meta text-tertiary">
            {hasQuery && !searching
              ? t('resultsCount', { count: total })
              : searching
                ? t('searching')
                : ''}
          </p>

          {!hasQuery ? (
            <EmptyState
              title={t('emptyTitle')}
              description={t('emptyBody')}
              icon={Search}
              headingLevel={2}
            />
          ) : null}

          {hasQuery && !searching && search.data && rows.length === 0 ? (
            <EmptyState
              title={t('noResultsTitle')}
              description={t('noResultsBody')}
              icon={Search}
              headingLevel={2}
              action={
                <Button asChild variant="secondary">
                  <Link href="/patients/register">
                    <UserPlus aria-hidden className="size-4" strokeWidth={1.5} />
                    {t('newPatient')}
                  </Link>
                </Button>
              }
            />
          ) : null}

          {hasQuery && rows.length > 0 ? (
            <DataTable
              caption={`${t('pageTitle')} — ${t('searchLabel')}`}
              columns={columns}
              rows={rows}
              rowKey={(row) => row.id}
              rowHref={(row) => `/patients/${row.id}`}
              rowLinkLabel={(row) => `${t('open')} ${row.patientNumber}`}
              loading={searching}
              emptyMessage={t('noResultsTitle')}
            />
          ) : null}
        </>
      ) : null}
    </div>
  );
}

function sexLabel(sex: string | null): string {
  if (sex === 'MALE') return 'Male';
  if (sex === 'FEMALE') return 'Female';
  if (sex === 'OTHER') return 'Other';
  return '—';
}

function SearchError({ onRetry }: { onRetry: () => void }) {
  const common = useTranslations('common');
  const patients = useTranslations('patients');
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-3 border border-status-critical bg-status-critical-bg px-4 py-3',
      )}
    >
      <div>
        <h2 className="text-body font-semibold text-status-critical">
          {patients('unavailableTitle')}
        </h2>
        <p className="text-meta text-secondary">{patients('unavailableBody')}</p>
      </div>
      <div>
        <Button variant="secondary" size="sm" onClick={onRetry}>
          {common('retry')}
        </Button>
      </div>
    </div>
  );
}
