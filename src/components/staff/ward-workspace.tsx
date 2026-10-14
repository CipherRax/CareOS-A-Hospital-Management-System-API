'use client';

import Link from 'next/link';
import { ArrowLeft, BedDouble } from 'lucide-react';
import { useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { WardBoard, type BedTileProps, type BedState } from '@/components/clinical/ward-board';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import { useWard, useCreateRoom, useCreateBed, useSetBedStatus } from '@/lib/data/queries';
import type { BedRow, BedStatus, ManualBedStatus, RoomRow, WardRow } from '@/lib/data/inpatient';

/**
 * Ward workspace (F8) — one ward: its live bed board and its room/bed setup.
 *
 * The read answers `{ ward }` while the export types the bare entity (GAP-020),
 * so the body is validated in `src/lib/data/inpatient.ts`. The board is the
 * read-at-a-distance view; the table below it is where a bed's status is changed.
 * `OCCUPIED` is assignment-driven and cannot be set here — the operator sets
 * `AVAILABLE`, `RESERVED`, `CLEANING`, `MAINTENANCE` or `BLOCKED`, and the board
 * shows `OCCUPIED` when an admission holds the bed.
 *
 * A status write is optimistic-locked: the version the operator saw travels with
 * the change, and a stale tab resolves to a 409 rendered in place rather than a
 * silent overwrite.
 */

/** Maps the assignment status to the board's state vocabulary. */
const BED_STATE: Record<BedStatus, BedState> = {
  AVAILABLE: 'vacant',
  OCCUPIED: 'occupied',
  RESERVED: 'reserved',
  CLEANING: 'cleaning',
  MAINTENANCE: 'out-of-service',
  BLOCKED: 'out-of-service',
};

const BED_STATUS_TONE: Record<BedStatus, StatusTone> = {
  AVAILABLE: 'success',
  OCCUPIED: 'info',
  RESERVED: 'warning',
  CLEANING: 'warning',
  MAINTENANCE: 'neutral',
  BLOCKED: 'critical',
};

export function WardWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('inpatient');
  const ward = useWard(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/wards"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      {ward.isLoading && !ward.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loading')}
        </p>
      ) : ward.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          headingLevel={2}
        />
      ) : !ward.data ? (
        <EmptyState
          title={t('notFoundTitle')}
          description={t('notFoundBody')}
          headingLevel={2}
        />
      ) : (
        <WardBody ward={ward.data.data} />
      )}
    </div>
  );
}

function WardBody({ ward }: { ward: WardRow }) {
  const t = useTranslations('inpatient');

  const [addRoomOpen, setAddRoomOpen] = useState(false);
  const [addBedOpen, setAddBedOpen] = useState(false);
  const [selected, setSelected] = useState<BedRow | null>(null);

  const beds = ward.rooms.flatMap((room) => room.beds);
  const boardBeds: BedTileProps[] = beds.map((bed) => ({
    bed: bed.bedNumber,
    state: BED_STATE[bed.status],
  }));
  const roomName = (roomId: string) => ward.rooms.find((room) => room.id === roomId)?.name ?? '';

  const columns: readonly DataTableColumn<BedRow>[] = [
    {
      key: 'room',
      header: t('columnRoom'),
      cell: (row) => <span className="text-secondary">{roomName(row.roomId)}</span>,
    },
    {
      key: 'bed',
      header: t('columnBed'),
      cell: (row) => <span className="font-mono text-meta text-primary">{row.bedNumber}</span>,
    },
    {
      key: 'status',
      header: t('columnBedStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={BED_STATUS_TONE[row.status]} label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: 'action',
      header: <span className="sr-only">{t('columnAction')}</span>,
      cell: (row) => (
        <Button variant="tertiary" size="sm" onClick={() => setSelected(row)}>
          {t('changeStatus')}
        </Button>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold text-primary">{ward.name}</h1>
        {ward.code ? <span className="text-meta text-tertiary">{ward.code}</span> : null}
        {ward.floor ? <span className="text-meta text-tertiary">{ward.floor}</span> : null}
        <StatusPill
          size="sm"
          tone={ward.isActive ? 'success' : 'neutral'}
          label={ward.isActive ? t('statusActive') : t('statusInactive')}
        />
      </header>

      {ward.description ? <p className="text-meta text-secondary">{ward.description}</p> : null}

      {boardBeds.length > 0 ? (
        <WardBoard ward={t('boardHeading')} beds={boardBeds} />
      ) : (
        <EmptyState
          title={t('noBedsTitle')}
          description={t('noBedsBody')}
          icon={BedDouble}
          headingLevel={2}
        />
      )}

      <section className="flex flex-col gap-3">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2 className="text-subheading font-semibold text-primary">
            {t('roomsHeading', { count: ward.rooms.length })}
          </h2>
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" size="sm" onClick={() => setAddRoomOpen(true)}>
              {t('addRoom')}
            </Button>
            <Button
              variant="secondary"
              size="sm"
              disabled={ward.rooms.length === 0}
              onClick={() => setAddBedOpen(true)}
            >
              {t('addBed')}
            </Button>
          </div>
        </div>

        {ward.rooms.length === 0 ? (
          <p className="text-meta text-secondary">{t('noRooms')}</p>
        ) : (
          <>
            <ul className="flex flex-wrap gap-x-4 gap-y-1 text-meta text-secondary">
              {ward.rooms.map((room) => (
                <li key={room.id}>
                  {room.name}
                  <span className="ml-1.5 text-tertiary">
                    {t('countBeds', { count: room.beds.length })}
                  </span>
                </li>
              ))}
            </ul>
            {beds.length > 0 ? (
              <DataTable<BedRow>
                caption={t('bedsTableCaption')}
                columns={columns}
                rows={beds}
                rowKey={(row) => row.id}
              />
            ) : (
              <p className="text-meta text-secondary">{t('noBedsInRoom')}</p>
            )}
          </>
        )}
      </section>

      <AddRoomDialog wardId={ward.id} open={addRoomOpen} onOpenChange={setAddRoomOpen} />
      <AddBedDialog rooms={ward.rooms} open={addBedOpen} onOpenChange={setAddBedOpen} />
      {selected ? (
        <SetBedStatusDialog
          bed={selected}
          roomName={roomName(selected.roomId)}
          onClose={() => setSelected(null)}
        />
      ) : null}
    </div>
  );
}

function AddRoomDialog({
  wardId,
  open,
  onOpenChange,
}: {
  wardId: string;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('inpatient');
  const createRoom = useCreateRoom();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setName('');
    setDescription('');
    setError(null);
    createRoom.reset();
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = name.trim();
    if (!trimmed) {
      setError(t('roomNameRequired'));
      return;
    }
    createRoom.mutate(
      { wardId, name: trimmed, description: description.trim() || undefined },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('addRoomTitle')} description={t('addRoomBody')} />
        <DialogBody className="flex flex-col gap-4">
          <Field id="room-name" label={t('roomName')} required>
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
          <Field id="room-description" label={t('roomDescription')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
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
          <Button variant="primary" disabled={createRoom.isPending} onClick={submit}>
            {t('submitRoom')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AddBedDialog({
  rooms,
  open,
  onOpenChange,
}: {
  rooms: readonly RoomRow[];
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('inpatient');
  const createBed = useCreateBed();

  const [roomId, setRoomId] = useState(rooms[0]?.id ?? '');
  const [bedNumber, setBedNumber] = useState('');
  const [error, setError] = useState<string | null>(null);

  const close = () => {
    setBedNumber('');
    setError(null);
    createBed.reset();
    onOpenChange(false);
  };

  const submit = () => {
    const trimmed = bedNumber.trim();
    if (!roomId) {
      setError(t('roomRequired'));
      return;
    }
    if (!trimmed) {
      setError(t('bedNumberRequired'));
      return;
    }
    createBed.mutate({ roomId, bedNumber: trimmed }, { onSuccess: () => close() });
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('addBedTitle')} description={t('addBedBody')} />
        <DialogBody className="flex flex-col gap-4">
          <Field id="bed-room" label={t('room')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={roomId}
                onChange={(event) => setRoomId(event.target.value)}
              >
                {rooms.map((room) => (
                  <option key={room.id} value={room.id}>
                    {room.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field id="bed-number" label={t('bedNumber')} required>
            {({ controlId, invalid }) => (
              <Input
                id={controlId}
                invalid={invalid}
                value={bedNumber}
                onChange={(event) => {
                  setBedNumber(event.target.value);
                  if (error) setError(null);
                }}
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
          <Button variant="primary" disabled={createBed.isPending} onClick={submit}>
            {t('submitBed')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function SetBedStatusDialog({
  bed,
  roomName,
  onClose,
}: {
  bed: BedRow;
  roomName: string;
  onClose: () => void;
}) {
  const t = useTranslations('inpatient');
  const setBedStatus = useSetBedStatus();

  const [status, setStatus] = useState<ManualBedStatus>(
    bed.status === 'OCCUPIED' ? 'AVAILABLE' : bed.status,
  );

  const conflict = setBedStatus.isError && setBedStatus.error?.code === 'OPTIMISTIC_LOCK_CONFLICT';
  const failed = setBedStatus.isError && !conflict;

  const submit = () => {
    setBedStatus.mutate(
      { id: bed.id, status, version: bed.version },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader
          title={t('setStatusTitle', { bed: bed.bedNumber })}
          description={t('setStatusBody', { room: roomName })}
        />
        <DialogBody className="flex flex-col gap-4">
          {conflict ? (
            <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
              <h3 className="text-body font-semibold text-status-critical">
                {t('conflictTitle')}
              </h3>
              <p className="text-meta text-secondary">{t('conflictBody')}</p>
            </div>
          ) : null}
          <Field id="bed-status" label={t('bedStatus')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={status}
                onChange={(event) => setStatus(event.target.value as ManualBedStatus)}
              >
                {(['AVAILABLE', 'RESERVED', 'CLEANING', 'MAINTENANCE', 'BLOCKED'] as const).map(
                  (value) => (
                    <option key={value} value={value}>
                      {t(`status.${value}`)}
                    </option>
                  ),
                )}
              </Select>
            )}
          </Field>
          <p className="text-caption text-secondary">{t('occupiedNotManual')}</p>
          {failed ? (
            <p role="alert" className="text-caption text-status-critical">
              {t('writeFailed')}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={setBedStatus.isPending} onClick={submit}>
            {t('submitStatus')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
