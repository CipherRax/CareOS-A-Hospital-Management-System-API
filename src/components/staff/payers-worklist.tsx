'use client';

import { Landmark } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input } from '@/components/ui/field';
import { CheckboxField } from '@/components/ui/primitives';
import { useCreatePayer, useInsurancePayers } from '@/lib/data/queries';
import type { InsurancePayerRow } from '@/lib/data/insurance';

/**
 * Insurance payers (F7) — the insurers the facility bills for cover.
 *
 * `GET /insurance/payers` types its 200 as the bare entity while the service
 * answers a `PageResult` (GAP-020), so rows are validated structurally in
 * `src/lib/data/insurance.ts`. Adding a payer posts to `POST /insurance/payers`,
 * which answers `{ payer }` and 409 `CONFLICT` on a duplicate name — surfaced in
 * the dialog rather than as a generic failure.
 */

export function PayersWorklistScreen() {
  const t = useTranslations('insurance');
  const payers = useInsurancePayers();
  const rows = payers.data?.data.rows ?? [];

  const [addOpen, setAddOpen] = useState(false);

  const columns: readonly DataTableColumn<InsurancePayerRow>[] = [
    {
      key: 'name',
      header: t('payers.columnName'),
      cell: (row) => <span className="font-medium text-primary">{row.name}</span>,
    },
    {
      key: 'phone',
      header: t('payers.columnPhone'),
      cell: (row) => (
        <span className="tabular-nums text-secondary">{row.contactPhone ?? t('payers.none')}</span>
      ),
    },
    {
      key: 'email',
      header: t('payers.columnEmail'),
      cell: (row) => <span className="text-secondary">{row.email ?? t('payers.none')}</span>,
    },
    {
      key: 'status',
      header: t('payers.columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={row.isActive ? 'success' : 'neutral'}
          label={row.isActive ? t('payers.statusActive') : t('payers.statusInactive')}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('payers.pageTitle')}</h1>
          <p className="text-meta text-secondary">{t('payers.pageIntro')}</p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          {t('payers.addPayer')}
        </Button>
      </header>

      {payers.error ? (
        <EmptyState
          title={t('payers.unavailableTitle')}
          description={t('payers.unavailableBody')}
          icon={Landmark}
          headingLevel={2}
        />
      ) : (
        <DataTable<InsurancePayerRow>
          caption={t('payers.tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={payers.isLoading}
          emptyMessage={t('payers.empty')}
        />
      )}

      <AddPayerDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function AddPayerDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('insurance');
  const createPayer = useCreatePayer();

  const [name, setName] = useState('');
  const [phone, setPhone] = useState('');
  const [email, setEmail] = useState('');
  const [active, setActive] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName('');
    setPhone('');
    setEmail('');
    setActive(true);
    setError(null);
    createPayer.reset();
    onOpenChange(false);
  };

  const conflict = createPayer.isError && createPayer.error?.code === 'CONFLICT';

  const submit = () => {
    const trimmedName = name.trim();
    if (!trimmedName) {
      setError(t('payers.nameRequired'));
      return;
    }
    const trimmedEmail = email.trim();
    if (trimmedEmail && !EMAIL_PATTERN.test(trimmedEmail)) {
      setError(t('payers.emailInvalid'));
      return;
    }
    createPayer.mutate(
      {
        name: trimmedName,
        contactPhone: phone.trim() || undefined,
        email: trimmedEmail || undefined,
        isActive: active,
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('payers.dialogTitle')} description={t('payers.dialogBody')} />
        <DialogBody className="flex flex-col gap-4">
          {conflict ? (
            <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
              <h3 className="text-body font-semibold text-status-critical">
                {t('payers.conflictTitle')}
              </h3>
              <p className="text-meta text-secondary">{t('payers.conflictBody')}</p>
            </div>
          ) : null}
          <Field id="payer-name" label={t('payers.name')} required>
            {({ controlId, invalid }) => (
              <Input
                id={controlId}
                invalid={invalid}
                value={name}
                onChange={(event) => {
                  setName(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <Field id="payer-phone" label={t('payers.contactPhone')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                inputMode="tel"
                value={phone}
                onChange={(event) => setPhone(event.target.value)}
              />
            )}
          </Field>
          <Field id="payer-email" label={t('payers.email')}>
            {({ controlId, invalid }) => (
              <Input
                id={controlId}
                type="email"
                invalid={invalid}
                value={email}
                onChange={(event) => {
                  setEmail(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <CheckboxField
            id="payer-active"
            label={t('payers.active')}
            checked={active}
            onCheckedChange={(next) => setActive(next === true)}
          />
          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={close}>
            {t('dialog.cancel')}
          </Button>
          <Button variant="primary" disabled={createPayer.isPending} onClick={submit}>
            {t('payers.submit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
