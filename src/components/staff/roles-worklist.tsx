'use client';

import { ShieldCheck } from 'lucide-react';
import Link from 'next/link';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { buttonVariants } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/field';
import { useRoles } from '@/lib/data/queries';
import type { RoleRow } from '@/lib/data/admin';

/**
 * Role directory (F9 administration).
 *
 * `GET /roles` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/admin.ts`. Creating and editing a role happen on their own
 * screens (`/roles/new`, `/roles/[id]`) because the permission editor needs the
 * full catalogue, which does not fit a dialog.
 */

export function RolesWorklistScreen() {
  const t = useTranslations('admin');
  const [query, setQuery] = useState('');
  const roles = useRoles({ q: query.trim() || undefined, limit: 100 });
  const rows = roles.data?.data.rows ?? [];

  const columns: readonly DataTableColumn<RoleRow>[] = [
    {
      key: 'name',
      header: t('roleColumnName'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-primary">{row.name}</span>
          {row.description ? (
            <span className="text-caption text-tertiary">{row.description}</span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'key',
      header: t('roleColumnKey'),
      cell: (row) => (
        <code className="font-mono text-caption text-secondary">{row.key}</code>
      ),
    },
    {
      key: 'kind',
      header: t('roleColumnKind'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={row.isSystem ? 'info' : 'neutral'}
          label={row.isSystem ? t('roleSystem') : t('roleCustom')}
        />
      ),
    },
    {
      key: 'permissions',
      header: t('roleColumnPermissions'),
      numeric: true,
      cell: (row) => <span className="tabular-nums text-secondary">{row.permissions.length}</span>,
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('rolesTitle')}</h1>
          <p className="text-meta text-secondary">{t('rolesIntro')}</p>
        </div>
        <Link href="/roles/new" className={buttonVariants({ variant: 'primary' })}>
          {t('newRole')}
        </Link>
      </header>

      <div className="w-64">
        <Field id="roles-search" label={t('searchLabel')}>
          {({ controlId }) => (
            <Input
              id={controlId}
              type="search"
              value={query}
              placeholder={t('roleSearchPlaceholder')}
              onChange={(event) => setQuery(event.target.value)}
            />
          )}
        </Field>
      </div>

      {roles.error ? (
        <EmptyState
          title={t('rolesUnavailableTitle')}
          description={t('rolesUnavailableBody')}
          icon={ShieldCheck}
          headingLevel={2}
        />
      ) : (
        <DataTable<RoleRow>
          caption={t('roleTableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/roles/${row.id}`}
          rowLinkLabel={(row) => t('openRole', { name: row.name })}
          loading={roles.isLoading}
          emptyMessage={t('roleEmpty')}
        />
      )}
    </div>
  );
}
