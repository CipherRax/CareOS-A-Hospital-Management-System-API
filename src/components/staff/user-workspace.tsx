'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';
import { AdminActionAlert } from '@/components/staff/admin-alert';
import { USER_STATUS_TONE } from '@/components/staff/users-worklist';
import { displayName, type UserRow, type UserStatus } from '@/lib/data/admin';
import {
  useDeactivateUser,
  useRevokeUserSessions,
  useRoles,
  useSession,
  useSetUserRoles,
  useUpdateUser,
  useUser,
} from '@/lib/data/queries';

/**
 * User administration workspace (F9 administration).
 *
 * The read answers `{ user }` while the export types the bare entity (GAP-020),
 * so the body is validated in `src/lib/data/admin.ts`. Profile and status writes
 * go through `PATCH /users/{id}`; role assignment through `POST /users/{id}/roles`;
 * session revocation through `POST /users/{id}/sessions/revoke`; deactivation
 * through `DELETE /users/{id}` (a soft delete that revokes sessions).
 *
 * The service refuses self-management, so when the record is the signed-in user
 * the mutation controls are replaced with a notice rather than left to fail.
 */

export function UserWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('admin');
  const user = useUser(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/users"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      {user.isLoading && !user.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingUser')}
        </p>
      ) : user.error ? (
        <EmptyState
          title={t('userUnavailableTitle')}
          description={t('userUnavailableBody')}
          headingLevel={2}
        />
      ) : !user.data ? (
        <EmptyState
          title={t('userNotFoundTitle')}
          description={t('userNotFoundBody')}
          headingLevel={2}
        />
      ) : (
        <UserBody user={user.data.data} />
      )}
    </div>
  );
}

function UserBody({ user }: { user: UserRow }) {
  const t = useTranslations('admin');
  const locale = useLocale();
  const session = useSession();
  const isSelf = session.data?.data.id === user.id;

  const created = user.createdAt
    ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(
        new Date(user.createdAt),
      )
    : t('unknownDate');

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">
          {displayName(user) || user.email}
        </h1>
        <StatusPill tone={USER_STATUS_TONE[user.status]} label={t(`userStatus.${user.status}`)} />
      </header>

      <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
        <h2 className="text-subheading font-semibold text-primary">{t('identityHeading')}</h2>
        <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
          <dt className="text-tertiary">{t('fieldEmail')}</dt>
          <dd className="text-primary">{user.email}</dd>
          <dt className="text-tertiary">{t('fieldPhone')}</dt>
          <dd className="text-primary">{user.phone ?? t('none')}</dd>
          <dt className="text-tertiary">{t('columnCreated')}</dt>
          <dd className="tabular-nums text-primary">{created}</dd>
          {user.staff ? (
            <>
              <dt className="text-tertiary">{t('staffNumber')}</dt>
              <dd className="tabular-nums text-primary">{user.staff.staffNumber}</dd>
            </>
          ) : null}
        </dl>
      </section>

      {isSelf ? (
        <p className="border border-border bg-surface px-4 py-3 text-meta text-secondary">
          {t('selfManageNotice')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
          <ProfileForm user={user} />
          <div className="flex flex-col gap-6">
            <StatusActions user={user} />
            <SessionsCard user={user} />
          </div>
          <RolesForm user={user} />
        </div>
      )}
    </div>
  );
}

function ProfileForm({ user }: { user: UserRow }) {
  const t = useTranslations('admin');
  const update = useUpdateUser();
  const [firstName, setFirstName] = useState(user.firstName);
  const [lastName, setLastName] = useState(user.lastName);
  const [otherNames, setOtherNames] = useState(user.otherNames ?? '');
  const [phone, setPhone] = useState(user.phone ?? '');

  const submit = () => {
    update.mutate({
      id: user.id,
      firstName: firstName.trim(),
      lastName: lastName.trim(),
      otherNames: otherNames.trim() || null,
      phone: phone.trim() || null,
    });
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('profileHeading')}</h2>
      <AdminActionAlert error={update.error} />
      <Field id="user-first" label={t('fieldFirstName')} required>
        {({ controlId }) => (
          <Input
            id={controlId}
            value={firstName}
            onChange={(event) => setFirstName(event.target.value)}
          />
        )}
      </Field>
      <Field id="user-last" label={t('fieldLastName')} required>
        {({ controlId }) => (
          <Input
            id={controlId}
            value={lastName}
            onChange={(event) => setLastName(event.target.value)}
          />
        )}
      </Field>
      <Field id="user-other" label={t('fieldOtherNames')}>
        {({ controlId }) => (
          <Input
            id={controlId}
            value={otherNames}
            onChange={(event) => setOtherNames(event.target.value)}
          />
        )}
      </Field>
      <Field id="user-phone" label={t('fieldPhone')}>
        {({ controlId }) => (
          <Input id={controlId} value={phone} onChange={(event) => setPhone(event.target.value)} />
        )}
      </Field>
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={update.isPending || !firstName.trim() || !lastName.trim()}
          onClick={submit}
        >
          {t('saveProfile')}
        </Button>
      </div>
    </section>
  );
}

function StatusActions({ user }: { user: UserRow }) {
  const t = useTranslations('admin');
  const update = useUpdateUser();
  const deactivate = useDeactivateUser();
  const [confirm, setConfirm] = useState<null | { status: UserStatus; label: string }>(null);
  const [deactivateOpen, setDeactivateOpen] = useState(false);

  const apply = (status: UserStatus) =>
    update.mutate({ id: user.id, status }, { onSuccess: () => setConfirm(null) });

  const options: readonly { readonly status: UserStatus; readonly label: string }[] = [
    { status: 'ACTIVE', label: t('statusActivate') },
    { status: 'SUSPENDED', label: t('statusSuspend') },
  ];
  const available = options.filter((option) => option.status !== user.status);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('statusHeading')}</h2>
      <AdminActionAlert error={update.error ?? deactivate.error} />
      <div className="flex flex-wrap gap-2">
        {available.map((option) => (
          <Button
            key={option.status}
            variant="secondary"
            onClick={() => setConfirm({ status: option.status, label: option.label })}
          >
            {option.label}
          </Button>
        ))}
        {user.status !== 'DEACTIVATED' ? (
          <Button variant="danger" onClick={() => setDeactivateOpen(true)}>
            {t('statusDeactivate')}
          </Button>
        ) : null}
      </div>

      <ConfirmDialog
        open={confirm !== null}
        onOpenChange={(next) => (next ? undefined : setConfirm(null))}
        onConfirm={() => (confirm ? apply(confirm.status) : undefined)}
        title={confirm ? confirm.label : ''}
        description={t('statusConfirmBody')}
        confirmLabel={confirm ? confirm.label : ''}
        pending={update.isPending}
        tone="primary"
      />
      <ConfirmDialog
        open={deactivateOpen}
        onOpenChange={setDeactivateOpen}
        onConfirm={() =>
          deactivate.mutate({ id: user.id }, { onSuccess: () => setDeactivateOpen(false) })
        }
        title={t('statusDeactivate')}
        description={t('deactivateConfirmBody')}
        confirmLabel={t('statusDeactivate')}
        pending={deactivate.isPending}
      />
    </section>
  );
}

function SessionsCard({ user }: { user: UserRow }) {
  const t = useTranslations('admin');
  const revoke = useRevokeUserSessions();
  const [open, setOpen] = useState(false);

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4">
      <h2 className="text-subheading font-semibold text-primary">{t('sessionsHeading')}</h2>
      <p className="text-meta text-secondary">{t('sessionsBody')}</p>
      <AdminActionAlert error={revoke.error} />
      {revoke.data ? (
        <p role="status" className="text-meta text-secondary">
          {t('sessionsRevoked', { count: revoke.data.revoked })}
        </p>
      ) : null}
      <div className="flex justify-start">
        <Button variant="secondary" onClick={() => setOpen(true)}>
          {t('revokeSessions')}
        </Button>
      </div>
      <ConfirmDialog
        open={open}
        onOpenChange={setOpen}
        onConfirm={() => revoke.mutate({ id: user.id }, { onSuccess: () => setOpen(false) })}
        title={t('revokeSessions')}
        description={t('revokeConfirmBody')}
        confirmLabel={t('revokeSessions')}
        pending={revoke.isPending}
      />
    </section>
  );
}

function RolesForm({ user }: { user: UserRow }) {
  const t = useTranslations('admin');
  const roles = useRoles({ limit: 100 });
  const setRoles = useSetUserRoles();
  const [selected, setSelected] = useState<readonly string[]>(user.roles.map((role) => role.id));

  const toggle = (id: string) => {
    setSelected((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  return (
    <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 lg:col-span-1">
      <h2 className="text-subheading font-semibold text-primary">{t('rolesHeading')}</h2>
      <p className="text-meta text-secondary">{t('rolesBody')}</p>
      <AdminActionAlert error={setRoles.error} />
      {roles.isLoading ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingRoles')}
        </p>
      ) : (
        <div className="grid grid-cols-1 gap-2">
          {roles.data?.data.rows.map((role) => (
            <CheckboxField
              key={role.id}
              id={`user-role-${role.id}`}
              label={role.name}
              description={role.key}
              checked={selected.includes(role.id)}
              onCheckedChange={() => toggle(role.id)}
            />
          ))}
        </div>
      )}
      <div className="flex justify-end">
        <Button
          variant="primary"
          disabled={setRoles.isPending || selected.length === 0}
          onClick={() => setRoles.mutate({ id: user.id, roleIds: selected })}
        >
          {t('saveRoles')}
        </Button>
      </div>
    </section>
  );
}
