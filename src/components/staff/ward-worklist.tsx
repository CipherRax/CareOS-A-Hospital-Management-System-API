'use client';

import { BedDouble } from 'lucide-react';
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
import { Field, Input, Textarea } from '@/components/ui/field';
import { useCreateWard, useWards } from '@/lib/data/queries';
import type { WardRow } from '@/lib/data/inpatient';

/**
 * Ward board worklist (F8) — every ward with its beds and occupancy.
 *
 * `GET /wards` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020), so rows are validated structurally in
 * `src/lib/data/inpatient.ts`. Each ward carries its rooms and beds nested, so
 * the occupancy columns are derived from the row itself, never a second source
 * that could disagree with the ward. Adding a ward posts to `POST /wards`; the
 * app has no branch picker, so it uses the EXAMPLE branch (GAP-018).
 */

export function WardWorklistScreen() {
  const t = useTranslations('inpatient');
  const [activeOnly, setActiveOnly] = useState(false);

  const wards = useWards({ active: activeOnly ? true : undefined });
  const rows = wards.data?.data.rows ?? [];

  const [addOpen, setAddOpen] = useState(false);

  const columns: readonly DataTableColumn<WardRow>[] = [
    {
      key: 'name',
      header: t('columnWard'),
      cell: (row) => (
        <span className="font-medium text-primary">
          {row.name}
          {row.code ? <span className="ml-2 text-caption text-tertiary">{row.code}</span> : null}
        </span>
      ),
    },
    {
      key: 'floor',
      header: t('columnFloor'),
      cell: (row) => <span className="text-secondary">{row.floor ?? t('none')}</span>,
    },
    {
      key: 'beds',
      header: t('columnBeds'),
      cell: (row) => (
        <span className="tabular-nums text-secondary">{t('countBeds', { count: totalBeds(row) })}</span>
      ),
    },
    {
      key: 'occupied',
      header: t('columnOccupied'),
      cell: (row) => (
        <span className="tabular-nums text-secondary">
          {t('countOccupied', { occupied: occupiedBeds(row), total: totalBeds(row) })}
        </span>
      ),
    },
    {
      key: 'available',
      header: t('columnAvailable'),
      cell: (row) => (
        <span className="tabular-nums text-secondary">{availableBeds(row)}</span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill
          size="sm"
          tone={row.isActive ? 'success' : 'neutral'}
          label={row.isActive ? t('statusActive') : t('statusInactive')}
        />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
          <p className="text-meta text-secondary">{t('pageIntro')}</p>
        </div>
        <Button variant="primary" onClick={() => setAddOpen(true)}>
          {t('addWard')}
        </Button>
      </header>

      <label className="flex w-fit items-center gap-2 text-meta text-secondary">
        <input
          type="checkbox"
          checked={activeOnly}
          onChange={(event) => setActiveOnly(event.target.checked)}
          className="size-4"
        />
        {t('filterActiveOnly')}
      </label>

      {wards.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={BedDouble}
          headingLevel={2}
        />
      ) : (
        <DataTable<WardRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/wards/${row.id}`}
          rowLinkLabel={(row) => t('openWard', { name: row.name })}
          loading={wards.isLoading}
          emptyMessage={t('empty')}
        />
      )}

      <AddWardDialog open={addOpen} onOpenChange={setAddOpen} />
    </div>
  );
}

function allBeds(ward: WardRow) {
  return ward.rooms.flatMap((room) => room.beds);
}

function totalBeds(ward: WardRow): number {
  return allBeds(ward).length;
}

function occupiedBeds(ward: WardRow): number {
  return allBeds(ward).filter((bed) => bed.status === 'OCCUPIED').length;
}

function availableBeds(ward: WardRow): number {
  return allBeds(ward).filter((bed) => bed.status === 'AVAILABLE').length;
}

function AddWardDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('inpatient');
  const createWard = useCreateWard();

  const [name, setName] = useState('');
  const [code, setCode] = useState('');
  const [floor, setFloor] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName('');
    setCode('');
    setFloor('');
    setDescription('');
    setError(null);
    createWard.reset();
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('nameRequired'));
      return;
    }
    createWard.mutate(
      {
        name: trimmed,
        code: code.trim() || undefined,
        floor: floor.trim() || undefined,
        description: description.trim() || undefined,
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('dialogTitle')} description={t('dialogBody')} />
        <DialogBody className="flex flex-col gap-4">
          <Field id="ward-name" label={t('name')} required>
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
          <Field id="ward-code" label={t('code')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={code}
                onChange={(event) => setCode(event.target.value)}
              />
            )}
          </Field>
          <Field id="ward-floor" label={t('floor')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={floor}
                onChange={(event) => setFloor(event.target.value)}
              />
            )}
          </Field>
          <Field id="ward-description" label={t('description')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={3}
                value={description}
                onChange={(event) => setDescription(event.target.value)}
              />
            )}
          </Field>
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
          <Button variant="primary" disabled={createWard.isPending} onClick={submit}>
            {t('submitWard')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
