'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { ArrowLeft } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { AdminActionAlert } from '@/components/staff/admin-alert';
import { PermissionsEditor } from '@/components/staff/permission-editor';
import {
  useCreateRole,
  useDeleteRole,
  useRole,
  useRoleCatalog,
  useUpdateRole,
  type QueryError,
} from '@/lib/data/queries';
import { isValidRoleKey, type RoleRow } from '@/lib/data/admin';

/**
 * Role administration (F9 administration).
 *
 * A role's read answers `{ role }` while the export types the bare entity
 * (GAP-020), so the body is validated in `src/lib/data/admin.ts`. Custom roles
 * are created with `POST /roles` and edited with `PATCH /roles/{id}`; the service
 * refuses a role that would exceed the caller's own permissions (403
 * `PERMISSION_DENIED`) and a duplicate key or name (409 `CONFLICT`). Deletion
 * (`DELETE /roles/{id}`) is guarded the same way and is refused while the role is
 * still assigned to anyone, so those outcomes are surfaced rather than hidden.
 */

export function RoleWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('admin');
  const role = useRole(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/roles"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToRoles')}
      </Link>

      {role.isLoading && !role.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingRole')}
        </p>
      ) : role.error ? (
        <EmptyState
          title={t('roleUnavailableTitle')}
          description={t('roleUnavailableBody')}
          headingLevel={2}
        />
      ) : !role.data ? (
        <EmptyState
          title={t('roleNotFoundTitle')}
          description={t('roleNotFoundBody')}
          headingLevel={2}
        />
      ) : (
        <RoleBody role={role.data.data} />
      )}
    </div>
  );
}

function RoleBody({ role }: { role: RoleRow }) {
  const t = useTranslations('admin');
  const update = useUpdateRole();
  const remove = useDeleteRole();
  const [deleteOpen, setDeleteOpen] = useState(false);

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">{role.name}</h1>
        <StatusPill
          tone={role.isSystem ? 'info' : 'neutral'}
          label={role.isSystem ? t('roleSystem') : t('roleCustom')}
        />
      </header>

      {role.isSystem ? (
        <p className="border border-border bg-surface px-4 py-3 text-meta text-secondary">
          {t('systemRoleNotice')}
        </p>
      ) : null}

      <RoleForm
        mode="edit"
        role={role}
        pending={update.isPending}
        error={update.error}
        onSave={(values) =>
          update.mutate({
            id: role.id,
            name: values.name,
            description: values.description,
            permissions: values.permissions,
          })
        }
      />

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">{t('deleteRoleHeading')}</h2>
        <p className="text-meta text-secondary">{t('deleteRoleBody')}</p>
        <AdminActionAlert error={remove.error} />
        <div className="flex justify-start">
          <Button variant="danger" onClick={() => setDeleteOpen(true)}>
            {t('deleteRole')}
          </Button>
        </div>
        <ConfirmDialog
          open={deleteOpen}
          onOpenChange={setDeleteOpen}
          onConfirm={() =>
            remove.mutate({ id: role.id }, { onSuccess: () => setDeleteOpen(false) })
          }
          title={t('deleteRole')}
          description={t('deleteRoleConfirmBody')}
          confirmLabel={t('deleteRole')}
          pending={remove.isPending}
        />
      </section>
    </div>
  );
}

export function RoleCreateScreen() {
  const t = useTranslations('admin');
  const router = useRouter();
  const create = useCreateRole();

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/roles"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('backToRoles')}
      </Link>
      <h1 className="text-heading font-semibold text-primary">{t('createRoleTitle')}</h1>

      <RoleForm
        mode="create"
        pending={create.isPending}
        error={create.error}
        onSave={(values) =>
          create.mutate(
            {
              name: values.name,
              key: values.key,
              description: values.description || undefined,
              permissions: values.permissions,
            },
            { onSuccess: (role) => router.push(`/roles/${role.id}`) },
          )
        }
      />
    </div>
  );
}

interface RoleFormValues {
  readonly name: string;
  readonly key: string;
  readonly description: string | null;
  readonly permissions: readonly string[];
}

function RoleForm({
  mode,
  role,
  pending,
  error,
  onSave,
}: {
  mode: 'create' | 'edit';
  role?: RoleRow;
  pending: boolean;
  error: QueryError | null;
  onSave: (values: RoleFormValues) => void;
}) {
  const t = useTranslations('admin');
  const catalog = useRoleCatalog();

  const [name, setName] = useState(role?.name ?? '');
  const [key, setKey] = useState(role?.key ?? '');
  const [description, setDescription] = useState(role?.description ?? '');
  const [selected, setSelected] = useState<readonly string[]>(role?.permissions ?? []);
  const [localError, setLocalError] = useState<string | null>(null);

  const groups = catalog.data?.data.permissionGroups ?? [];
  const templates = catalog.data?.data.groups ?? [];

  const toggle = (permission: string) => {
    setSelected((current) =>
      current.includes(permission)
        ? current.filter((value) => value !== permission)
        : [...current, permission],
    );
  };

  const applyTemplate = (templateKey: string) => {
    const template = templates.find((entry) => entry.key === templateKey);
    setSelected(template ? template.permissions : []);
  };

  const submit = () => {
    if (!name.trim()) {
      setLocalError(t('roleNameRequired'));
      return;
    }
    if (mode === 'create' && !isValidRoleKey(key.trim())) {
      setLocalError(t('roleKeyInvalid'));
      return;
    }
    if (selected.length === 0) {
      setLocalError(t('rolePermissionsRequired'));
      return;
    }
    setLocalError(null);
    onSave({
      name: name.trim(),
      key: key.trim(),
      description: description.trim() || null,
      permissions: selected,
    });
  };

  return (
    <div className="flex flex-col gap-6">
      <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">
          {mode === 'create' ? t('roleDetailsHeading') : t('editRoleHeading')}
        </h2>
        <AdminActionAlert error={error} />
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          <Field id="role-name" label={t('roleFieldName')} required>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (localError) setLocalError(null);
                }}
              />
            )}
          </Field>
          {mode === 'create' ? (
            <Field
              id="role-key"
              label={t('roleFieldKey')}
              hint={t('roleFieldKeyHint')}
              required
            >
              {({ controlId, describedBy }) => (
                <Input
                  id={controlId}
                  aria-describedby={describedBy}
                  value={key}
                  onChange={(event) => {
                    setKey(event.target.value.toUpperCase());
                    if (localError) setLocalError(null);
                  }}
                />
              )}
            </Field>
          ) : (
            <Field id="role-key" label={t('roleFieldKey')} hint={t('roleKeyImmutable')}>
              {({ controlId, describedBy }) => (
                <Input
                  id={controlId}
                  aria-describedby={describedBy}
                  value={key}
                  readOnly
                  disabled
                />
              )}
            </Field>
          )}
        </div>
        <Field id="role-description" label={t('roleFieldDescription')}>
          {({ controlId }) => (
            <Textarea
              id={controlId}
              value={description}
              onChange={(event) => setDescription(event.target.value)}
            />
          )}
        </Field>
        {mode === 'create' && templates.length > 0 ? (
          <Field id="role-template" label={t('roleTemplate')} hint={t('roleTemplateHint')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                defaultValue=""
                onChange={(event) => applyTemplate(event.target.value)}
              >
                <option value="">{t('roleTemplateBlank')}</option>
                {templates.map((template) => (
                  <option key={template.key} value={template.key}>
                    {template.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        ) : null}
      </section>

      <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="text-subheading font-semibold text-primary">{t('rolePermissionsHeading')}</h2>
          <p role="status" className="text-meta text-tertiary">
            {t('rolePermissionsCount', { count: selected.length })}
          </p>
        </div>
        <AdminActionAlert error={catalog.error} />
        {catalog.isLoading ? (
          <p role="status" className="text-meta text-tertiary">
            {t('loadingCatalog')}
          </p>
        ) : (
          <PermissionsEditor groups={groups} selected={selected} onToggle={toggle} />
        )}
      </section>

      {localError ? (
        <p role="alert" className="text-caption text-status-critical">
          {localError}
        </p>
      ) : null}

      <div className="flex justify-end">
        <Button variant="primary" disabled={pending} onClick={submit}>
          {mode === 'create' ? t('createRole') : t('saveRole')}
        </Button>
      </div>
    </div>
  );
}
