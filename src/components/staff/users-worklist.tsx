'use client';

import { UsersRound } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';
import { useInviteUser, useRoles, useUsers } from '@/lib/data/queries';
import {
  USER_STATUSES,
  displayName,
  type InvitedUser,
  type UserRow,
  type UserStatus,
} from '@/lib/data/admin';

/**
 * User directory (F9 administration).
 *
 * `GET /users` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/admin.ts`. Inviting posts to `POST /users`; the app has no branch
 * picker, so no branch or department is sent (GAP-018).
 */

export const USER_STATUS_TONE: Record<UserStatus, StatusTone> = {
  ACTIVE: 'success',
  INVITED: 'warning',
  SUSPENDED: 'critical',
  DEACTIVATED: 'neutral',
};

export function UsersWorklistScreen() {
  const t = useTranslations('admin');
  const locale = useLocale();
  const [status, setStatus] = useState<UserStatus | ''>('');
  const [query, setQuery] = useState('');
  const [inviteOpen, setInviteOpen] = useState(false);

  const users = useUsers({ status: status || undefined, q: query.trim() || undefined });
  const rows = users.data?.data.rows ?? [];

  const formatDate = (iso: string) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'medium', timeZone: 'UTC' }).format(new Date(iso))
      : t('unknownDate');

  const columns: readonly DataTableColumn<UserRow>[] = [
    {
      key: 'user',
      header: t('columnUser'),
      cell: (row) => (
        <span className="flex flex-col">
          <span className="font-medium text-primary">{displayName(row) || row.email}</span>
          <span className="text-caption text-tertiary">{row.email}</span>
        </span>
      ),
    },
    {
      key: 'roles',
      header: t('columnRoles'),
      cell: (row) =>
        row.roles.length > 0 ? (
          <span className="flex flex-wrap gap-1">
            {row.roles.map((role) => (
              <StatusPill key={role.id} size="sm" tone="neutral" label={role.name} />
            ))}
          </span>
        ) : (
          <span className="text-tertiary">{t('noRoles')}</span>
        ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={USER_STATUS_TONE[row.status]}
          label={t(`userStatus.${row.status}`)}
        />
      ),
    },
    {
      key: 'created',
      header: t('columnCreated'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDate(row.createdAt)}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('usersTitle')}</h1>
          <p className="text-meta text-secondary">{t('usersIntro')}</p>
        </div>
        <Button variant="primary" onClick={() => setInviteOpen(true)}>
          {t('inviteUser')}
        </Button>
      </header>

      <div className="flex flex-wrap gap-4">
        <div className="w-64">
          <Field id="users-search" label={t('searchLabel')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="search"
                value={query}
                placeholder={t('searchPlaceholder')}
                onChange={(event) => setQuery(event.target.value)}
              />
            )}
          </Field>
        </div>
        <div className="w-52">
          <Field id="users-status-filter" label={t('filterStatus')}>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={status}
                onChange={(event) => setStatus(event.target.value as UserStatus | '')}
              >
                <option value="">{t('allStatuses')}</option>
                {USER_STATUSES.map((value) => (
                  <option key={value} value={value}>
                    {t(`userStatus.${value}`)}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      {users.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={UsersRound}
          headingLevel={2}
        />
      ) : (
        <DataTable<UserRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/users/${row.id}`}
          rowLinkLabel={(row) => t('openUser', { name: displayName(row) || row.email })}
          loading={users.isLoading}
          emptyMessage={t('empty')}
        />
      )}

      <InviteDialog open={inviteOpen} onOpenChange={setInviteOpen} />
    </div>
  );
}

function InviteDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('admin');
  const invite = useInviteUser();
  const roles = useRoles({ limit: 100 });

  const [email, setEmail] = useState('');
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [otherNames, setOtherNames] = useState('');
  const [phone, setPhone] = useState('');
  const [roleIds, setRoleIds] = useState<readonly string[]>([]);
  const [withStaff, setWithStaff] = useState(false);
  const [staffNumber, setStaffNumber] = useState('');
  const [professionalTitle, setProfessionalTitle] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [invited, setInvited] = useState<InvitedUser | null>(null);

  const reset = () => {
    setEmail('');
    setFirstName('');
    setLastName('');
    setOtherNames('');
    setPhone('');
    setRoleIds([]);
    setWithStaff(false);
    setStaffNumber('');
    setProfessionalTitle('');
    setError(null);
    setInvited(null);
    invite.reset();
  };

  const close = () => {
    reset();
    onOpenChange(false);
  };

  const toggleRole = (id: string) => {
    setRoleIds((current) =>
      current.includes(id) ? current.filter((value) => value !== id) : [...current, id],
    );
  };

  const submit = () => {
    if (!email.trim() || !firstName.trim() || !lastName.trim()) {
      setError(t('inviteRequired'));
      return;
    }
    if (withStaff && !staffNumber.trim()) {
      setError(t('staffNumberRequired'));
      return;
    }
    invite.mutate(
      {
        email: email.trim(),
        firstName: firstName.trim(),
        lastName: lastName.trim(),
        otherNames: otherNames.trim() || undefined,
        phone: phone.trim() || undefined,
        roleIds: roleIds.length > 0 ? roleIds : undefined,
        staff: withStaff
          ? { staffNumber: staffNumber.trim(), professionalTitle: professionalTitle.trim() || undefined }
          : undefined,
      },
      {
        onSuccess: (result) => setInvited(result),
        onError: () => setError(t('inviteFailed')),
      },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent className="max-w-2xl">
        <DialogHeader title={t('inviteTitle')} description={t('inviteBody')} />
        {invited ? (
          <>
            <DialogBody className="flex flex-col gap-4">
              <div className="flex flex-col gap-1 border border-border bg-surface px-4 py-3">
                <p className="text-body text-primary">
                  {t('invitedConfirmation', { name: displayName(invited.user) || invited.user.email })}
                </p>
                {invited.inviteToken ? (
                  <p className="break-all text-caption tabular-nums text-tertiary">
                    {t('inviteToken', { token: invited.inviteToken })}
                  </p>
                ) : null}
              </div>
            </DialogBody>
            <DialogFooter>
              <Button variant="primary" onClick={close}>
                {t('done')}
              </Button>
            </DialogFooter>
          </>
        ) : (
          <>
            <DialogBody className="flex flex-col gap-4">
              <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                <Field id="invite-email" label={t('fieldEmail')} required>
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      type="email"
                      value={email}
                      onChange={(event) => {
                        setEmail(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field id="invite-phone" label={t('fieldPhone')}>
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      value={phone}
                      onChange={(event) => setPhone(event.target.value)}
                    />
                  )}
                </Field>
                <Field id="invite-first" label={t('fieldFirstName')} required>
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      value={firstName}
                      onChange={(event) => {
                        setFirstName(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field id="invite-last" label={t('fieldLastName')} required>
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      value={lastName}
                      onChange={(event) => {
                        setLastName(event.target.value);
                        if (error) setError(null);
                      }}
                    />
                  )}
                </Field>
                <Field id="invite-other" label={t('fieldOtherNames')}>
                  {({ controlId }) => (
                    <Input
                      id={controlId}
                      value={otherNames}
                      onChange={(event) => setOtherNames(event.target.value)}
                    />
                  )}
                </Field>
              </div>

              <fieldset className="flex flex-col gap-2">
                <legend className="text-meta font-medium text-secondary">{t('fieldRoles')}</legend>
                {roles.isLoading ? (
                  <p role="status" className="text-meta text-tertiary">
                    {t('loadingRoles')}
                  </p>
                ) : (roles.data?.data.rows.length ?? 0) === 0 ? (
                  <p className="text-meta text-tertiary">{t('noRoles')}</p>
                ) : (
                  <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                    {roles.data?.data.rows.map((role) => (
                      <CheckboxField
                        key={role.id}
                        id={`invite-role-${role.id}`}
                        label={role.name}
                        checked={roleIds.includes(role.id)}
                        onCheckedChange={() => toggleRole(role.id)}
                      />
                    ))}
                  </div>
                )}
              </fieldset>

              <CheckboxField
                id="invite-with-staff"
                label={t('withStaffProfile')}
                description={t('withStaffProfileHint')}
                checked={withStaff}
                onCheckedChange={() => setWithStaff((value) => !value)}
              />
              {withStaff ? (
                <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
                  <Field id="invite-staff-number" label={t('fieldStaffNumber')} required>
                    {({ controlId }) => (
                      <Input
                        id={controlId}
                        value={staffNumber}
                        onChange={(event) => {
                          setStaffNumber(event.target.value);
                          if (error) setError(null);
                        }}
                      />
                    )}
                  </Field>
                  <Field id="invite-staff-title" label={t('fieldProfessionalTitle')}>
                    {({ controlId }) => (
                      <Input
                        id={controlId}
                        value={professionalTitle}
                        onChange={(event) => setProfessionalTitle(event.target.value)}
                      />
                    )}
                  </Field>
                </div>
              ) : null}

              {error ? (
                <p role="alert" className="text-caption text-status-critical">
                  {error}
                </p>
              ) : null}
            </DialogBody>
            <DialogFooter>
              <Button variant="secondary" onClick={close}>
                {t('cancel')}
              </Button>
              <Button variant="primary" disabled={invite.isPending} onClick={submit}>
                {t('submitInvite')}
              </Button>
            </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}
