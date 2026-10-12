'use client';

import { useTranslations } from 'next-intl';
import { useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { FormSection } from '@/components/clinical/form-section';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Select } from '@/components/ui/field';
import {
  useCreateOverride,
  useCreateTemplate,
  useDeleteTemplate,
  useDepartmentList,
  useProviderDirectory,
  useTemplates,
  useUpdateTemplate,
} from '@/lib/data/queries';
import {
  OVERRIDE_TYPES,
  SCHEDULE_DAYS,
  SCHEDULES_BRANCH_ID,
  byDayAndTime,
  minutesToTime,
  timeToMinutes,
  type OverrideType,
  type ScheduleTemplateRow,
} from '@/lib/data/schedules';
import { cn } from '@/lib/cn';

/**
 * Administration — schedule templates and dated exceptions (F3).
 *
 * `GET /schedules/templates` is unmodelled and mis-typed in the export
 * (GAP-017), so the week is read structurally in `src/lib/data/schedules.ts`.
 * Create and update answer `{ schedule }`; delete answers 204 with no body.
 *
 * **Overrides cannot be listed.** There is no `GET /schedules/overrides` in the
 * contract — only create, update and delete — so this screen can add a dated
 * exception but cannot show the ones already set. That gap (GAP-019) is stated on
 * the form rather than hidden behind a list that would be a lie.
 *
 * `dayOfWeek` uses the API's workweek (0=MONDAY .. 6=SUNDAY); schedule windows
 * are minute offsets from the UTC business day, so times are entered and shown as
 * plain clock values with no local-timezone arithmetic.
 */

export function ScheduleAdminScreen() {
  const t = useTranslations('schedules');
  const [providerId, setProviderId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [editTarget, setEditTarget] = useState<ScheduleTemplateRow | null>(null);
  const [deleteTarget, setDeleteTarget] = useState<ScheduleTemplateRow | null>(null);

  const providers = useProviderDirectory();
  const departments = useDepartmentList();
  const templates = useTemplates({
    providerId: providerId || undefined,
    departmentId: departmentId || undefined,
  });
  const remove = useDeleteTemplate();

  const providerName = useMemo(() => {
    const map = new Map<string, string>();
    for (const provider of providers.data?.data ?? []) map.set(provider.id, provider.name);
    return map;
  }, [providers.data]);

  const departmentName = useMemo(() => {
    const map = new Map<string, string>();
    for (const department of departments.data?.data ?? []) map.set(department.id, department.name);
    return map;
  }, [departments.data]);

  const rows = byDayAndTime(templates.data?.data.items ?? []);

  const columns: readonly DataTableColumn<ScheduleTemplateRow>[] = [
    {
      key: 'provider',
      header: t('columnProvider'),
      cell: (row) => (
        <span className="text-primary">
          {providerName.get(row.providerId) ?? t('unknownProvider')}
        </span>
      ),
    },
    {
      key: 'day',
      header: t('templates.columnDay'),
      width: '8rem',
      cell: (row) => <span className="text-secondary">{t(`day.${row.dayOfWeek}`)}</span>,
    },
    {
      key: 'window',
      header: t('templates.columnWindow'),
      width: '10rem',
      cell: (row) => (
        <span className="tabular-nums text-secondary">
          {minutesToTime(row.startMinutes)}–{minutesToTime(row.endMinutes)}
        </span>
      ),
    },
    {
      key: 'slot',
      header: t('templates.columnSlot'),
      width: '7rem',
      cell: (row) => <span className="tabular-nums text-secondary">{row.slotDurationMinutes}m</span>,
    },
    {
      key: 'capacity',
      header: t('templates.columnCapacity'),
      width: '6rem',
      cell: (row) => <span className="tabular-nums text-secondary">{row.capacity}</span>,
    },
    {
      key: 'available',
      header: t('templates.columnAvailable'),
      width: '8rem',
      cell: (row) => (
        <StatusPill
          tone={row.isAvailable ? 'success' : 'neutral'}
          size="sm"
          label={row.isAvailable ? t('templates.available') : t('templates.unavailable')}
        />
      ),
    },
    {
      key: 'note',
      header: t('templates.columnNote'),
      cell: (row) => <span className="text-secondary">{row.note ?? '—'}</span>,
    },
    {
      key: 'actions',
      header: t('templates.columnActions'),
      cell: (row) => (
        <div className="flex flex-wrap items-center gap-2">
          <Button variant="secondary" size="sm" onClick={() => setEditTarget(row)}>
            {t('templates.edit')}
          </Button>
          <Button variant="danger" size="sm" onClick={() => setDeleteTarget(row)}>
            {t('templates.delete')}
          </Button>
        </div>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-meta text-secondary">{t('pageIntro')}</p>
      </header>

      <div className="flex flex-wrap items-end gap-4">
        <div className="w-full max-w-xs">
          <Field id="sched-provider" label={t('filterProvider')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={providerId}
                onChange={(event) => setProviderId(event.target.value)}
              >
                <option value="">{t('allProviders')}</option>
                {(providers.data?.data ?? []).map((provider) => (
                  <option key={provider.id} value={provider.id}>
                    {provider.name}
                  </option>
                ))}
              </Select>
            )}
          </Field>
        </div>
        <div className="w-full max-w-xs">
          <Field id="sched-department" label={t('filterDepartment')}>
            {({ controlId, describedBy }) => (
              <Select
                id={controlId}
                aria-describedby={describedBy}
                value={departmentId}
                onChange={(event) => setDepartmentId(event.target.value)}
              >
                <option value="">{t('allDepartments')}</option>
                {(departments.data?.data ?? [])
                  .filter((department) => department.active)
                  .map((department) => (
                    <option key={department.id} value={department.id}>
                      {department.name}
                    </option>
                  ))}
              </Select>
            )}
          </Field>
        </div>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('templates.title')}</h2>
        {templates.error ? (
          <Alert title={t('templates.unavailableTitle')} body={t('templates.unavailableBody')} />
        ) : (
          <DataTable
            caption={t('templates.caption')}
            columns={columns}
            rows={rows}
            rowKey={(row) => row.id}
            loading={templates.isLoading}
            emptyMessage={t('templates.empty')}
          />
        )}
      </section>

      {deleteTarget ? (
        <DeleteTemplatePanel
          template={deleteTarget}
          providerLabel={providerName.get(deleteTarget.providerId) ?? t('unknownProvider')}
          onDismiss={() => setDeleteTarget(null)}
          onDeleted={() => setDeleteTarget(null)}
          pendingMeta={{ remove, departmentName }}
        />
      ) : null}

      <TemplateForm
        key={editTarget?.id ?? 'create'}
        providers={providers.data?.data ?? []}
        departments={departments.data?.data ?? []}
        editing={editTarget}
        onDone={() => setEditTarget(null)}
      />

      <OverrideForm
        providers={providers.data?.data ?? []}
        departments={departments.data?.data ?? []}
      />
    </div>
  );
}

function TemplateForm({
  providers,
  departments,
  editing,
  onDone,
}: {
  providers: readonly { id: string; name: string }[];
  departments: readonly { id: string; name: string; active: boolean }[];
  editing: ScheduleTemplateRow | null;
  onDone: () => void;
}) {
  const t = useTranslations('schedules.templateForm');
  const create = useCreateTemplate();
  const update = useUpdateTemplate();

  const [providerId, setProviderId] = useState(editing?.providerId ?? '');
  const [departmentId, setDepartmentId] = useState(editing?.departmentId ?? '');
  const [dayOfWeek, setDayOfWeek] = useState(String(editing?.dayOfWeek ?? 0));
  const [start, setStart] = useState(
    editing ? minutesToTime(editing.startMinutes) : '08:00',
  );
  const [end, setEnd] = useState(editing ? minutesToTime(editing.endMinutes) : '17:00');
  const [slotDuration, setSlotDuration] = useState(String(editing?.slotDurationMinutes ?? 30));
  const [capacity, setCapacity] = useState(String(editing?.capacity ?? 1));
  const [available, setAvailable] = useState(editing?.isAvailable ?? true);
  const [note, setNote] = useState(editing?.note ?? '');
  const [alert, setAlert] = useState<{ title: string; body: string } | null>(null);
  const [receipt, setReceipt] = useState(false);

  const pending = create.isPending || update.isPending;

  function submit() {
    setAlert(null);
    setReceipt(false);
    const startMinutes = timeToMinutes(start);
    const endMinutes = timeToMinutes(end);
    const slot = Number(slotDuration);
    if (!providerId || !departmentId) {
      setAlert({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    if (startMinutes === null || endMinutes === null || endMinutes <= startMinutes || !Number.isFinite(slot) || slot <= 0 || endMinutes - startMinutes < slot) {
      setAlert({ title: t('windowTitle'), body: t('windowBody') });
      return;
    }

    const input = {
      providerId,
      branchId: SCHEDULES_BRANCH_ID,
      departmentId,
      dayOfWeek: Number(dayOfWeek),
      startMinutes,
      endMinutes,
      slotDurationMinutes: slot,
      capacity: Number(capacity) || 1,
      isAvailable: available,
      ...(note.trim() ? { note: note.trim() } : {}),
    };

    if (editing) {
      update.mutate(
        { id: editing.id, ...input },
        {
          onSuccess: () => {
            onDone();
            setReceipt(true);
          },
          onError: () => setAlert({ title: t('failedTitle'), body: t('failedBody') }),
        },
      );
      return;
    }
    create.mutate(input, {
      onSuccess: () => {
        setNote('');
        setReceipt(true);
      },
      onError: () => setAlert({ title: t('failedTitle'), body: t('failedBody') }),
    });
  }

  return (
    <FormSection title={t(editing ? 'editTitle' : 'createTitle')}>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="tpl-provider" label={t('provider')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={providerId}
              disabled={Boolean(editing)}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">{t('chooseProvider')}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="tpl-department" label={t('department')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={departmentId}
              disabled={Boolean(editing)}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">{t('chooseDepartment')}</option>
              {departments
                .filter((department) => department.active)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field id="tpl-day" label={t('day')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={dayOfWeek}
              onChange={(event) => setDayOfWeek(event.target.value)}
            >
              {SCHEDULE_DAYS.map((day) => (
                <option key={day} value={day}>
                  {t(`day.${day}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="tpl-start" label={t('start')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="time"
              value={start}
              onChange={(event) => setStart(event.target.value)}
            />
          )}
        </Field>
        <Field id="tpl-end" label={t('end')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="time"
              value={end}
              onChange={(event) => setEnd(event.target.value)}
            />
          )}
        </Field>
        <Field id="tpl-slot" label={t('slotDuration')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="number"
              min={5}
              max={240}
              value={slotDuration}
              onChange={(event) => setSlotDuration(event.target.value)}
            />
          )}
        </Field>
        <Field id="tpl-capacity" label={t('capacity')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="number"
              min={1}
              max={99}
              value={capacity}
              onChange={(event) => setCapacity(event.target.value)}
            />
          )}
        </Field>
        <div className="flex items-center pt-6">
          <label className="flex items-center gap-2 text-body text-secondary">
            <input
              type="checkbox"
              checked={available}
              onChange={(event) => setAvailable(event.target.checked)}
            />
            {t('available')}
          </label>
        </div>
        <Field id="tpl-note" label={t('note')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>

      {alert ? <Alert title={alert.title} body={alert.body} /> : null}
      {receipt ? <Alert title={t('saved')} body={t('savedBody')} tone="success" /> : null}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending ? t('submitting') : t(editing ? 'update' : 'submit')}
        </Button>
        {editing ? (
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            {t('cancelEdit')}
          </Button>
        ) : null}
      </div>
    </FormSection>
  );
}

function OverrideForm({
  providers,
  departments,
}: {
  providers: readonly { id: string; name: string }[];
  departments: readonly { id: string; name: string; active: boolean }[];
}) {
  const t = useTranslations('schedules.overrideForm');
  const create = useCreateOverride();

  const [providerId, setProviderId] = useState('');
  const [departmentId, setDepartmentId] = useState('');
  const [date, setDate] = useState('');
  const [type, setType] = useState<OverrideType>('LEAVE');
  const [start, setStart] = useState('09:00');
  const [end, setEnd] = useState('13:00');
  const [note, setNote] = useState('');
  const [alert, setAlert] = useState<{ title: string; body: string } | null>(null);
  const [receipt, setReceipt] = useState(false);

  const working = type === 'WORKING';

  function submit() {
    setAlert(null);
    setReceipt(false);
    if (!providerId || !date) {
      setAlert({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    let startMinutes: number | undefined;
    let endMinutes: number | undefined;
    if (working) {
      const parsedStart = timeToMinutes(start);
      const parsedEnd = timeToMinutes(end);
      if (parsedStart === null || parsedEnd === null || parsedEnd <= parsedStart) {
        setAlert({ title: t('windowTitle'), body: t('windowBody') });
        return;
      }
      startMinutes = parsedStart;
      endMinutes = parsedEnd;
    }
    create.mutate(
      {
        providerId,
        branchId: SCHEDULES_BRANCH_ID,
        departmentId,
        date,
        type,
        ...(startMinutes !== undefined ? { startMinutes } : {}),
        ...(endMinutes !== undefined ? { endMinutes } : {}),
        ...(note.trim() ? { note: note.trim() } : {}),
      },
      {
        onSuccess: () => {
          setNote('');
          setReceipt(true);
        },
        onError: (error) => {
          setAlert(
            error.code === 'CONFLICT'
              ? { title: t('conflictTitle'), body: t('conflictBody') }
              : { title: t('failedTitle'), body: t('failedBody') },
          );
        },
      },
    );
  }

  return (
    <FormSection title={t('title')} description={t('intro')}>
      <p className="max-w-prose border border-status-info bg-status-info-bg px-3 py-2 text-meta text-secondary">
        {t('gapNote')}
      </p>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        <Field id="ovr-provider" label={t('provider')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={providerId}
              onChange={(event) => setProviderId(event.target.value)}
            >
              <option value="">{t('chooseProvider')}</option>
              {providers.map((provider) => (
                <option key={provider.id} value={provider.id}>
                  {provider.name}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <Field id="ovr-department" label={t('department')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={departmentId}
              onChange={(event) => setDepartmentId(event.target.value)}
            >
              <option value="">{t('chooseDepartment')}</option>
              {departments
                .filter((department) => department.active)
                .map((department) => (
                  <option key={department.id} value={department.id}>
                    {department.name}
                  </option>
                ))}
            </Select>
          )}
        </Field>
        <Field id="ovr-date" label={t('date')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="date"
              value={date}
              onChange={(event) => setDate(event.target.value)}
            />
          )}
        </Field>
        <Field id="ovr-type" label={t('type')}>
          {({ controlId, describedBy }) => (
            <Select
              id={controlId}
              aria-describedby={describedBy}
              value={type}
              onChange={(event) => setType(event.target.value as OverrideType)}
            >
              {OVERRIDE_TYPES.map((value) => (
                <option key={value} value={value}>
                  {t(`type.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
        {working ? (
          <>
            <Field id="ovr-start" label={t('start')}>
              {({ controlId, describedBy }) => (
                <Input
                  id={controlId}
                  aria-describedby={describedBy}
                  type="time"
                  value={start}
                  onChange={(event) => setStart(event.target.value)}
                />
              )}
            </Field>
            <Field id="ovr-end" label={t('end')}>
              {({ controlId, describedBy }) => (
                <Input
                  id={controlId}
                  aria-describedby={describedBy}
                  type="time"
                  value={end}
                  onChange={(event) => setEnd(event.target.value)}
                />
              )}
            </Field>
          </>
        ) : null}
        <Field id="ovr-note" label={t('note')}>
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              value={note}
              onChange={(event) => setNote(event.target.value)}
            />
          )}
        </Field>
      </div>

      {alert ? <Alert title={alert.title} body={alert.body} /> : null}
      {receipt ? <Alert title={t('created')} body={t('createdBody')} tone="success" /> : null}

      <div>
        <Button onClick={submit} disabled={create.isPending}>
          {create.isPending ? t('submitting') : t('submit')}
        </Button>
      </div>
    </FormSection>
  );
}

function DeleteTemplatePanel({
  template,
  providerLabel,
  onDismiss,
  onDeleted,
  pendingMeta,
}: {
  template: ScheduleTemplateRow;
  providerLabel: string;
  onDismiss: () => void;
  onDeleted: () => void;
  pendingMeta: {
    remove: ReturnType<typeof useDeleteTemplate>;
    departmentName: Map<string, string>;
  };
}) {
  const t = useTranslations('schedules.delete');
  const [alert, setAlert] = useState<string | null>(null);
  const { remove } = pendingMeta;
  const departmentLabel = pendingMeta.departmentName.get(template.departmentId) ?? template.departmentId;

  return (
    <section
      aria-labelledby="sched-delete-title"
      className="flex flex-col gap-3 border border-status-warning bg-surface px-4 py-3"
    >
      <h2 id="sched-delete-title" className="text-body font-semibold text-primary">
        {t('confirm')}
      </h2>
      <p className="text-meta text-secondary">
        {t('body', {
          provider: providerLabel,
          department: departmentLabel,
          day: template.dayOfWeek,
        })}
      </p>
      {alert ? <Alert title={t('failedTitle')} body={alert} /> : null}
      <div className="flex gap-2">
        <Button
          variant="danger"
          disabled={remove.isPending}
          onClick={() => {
            setAlert(null);
            remove.mutate(
              { id: template.id },
              {
                onSuccess: onDeleted,
                onError: () => setAlert(t('failedBody')),
              },
            );
          }}
        >
          {remove.isPending ? t('deleting') : t('confirmButton')}
        </Button>
        <Button variant="ghost" onClick={onDismiss} disabled={remove.isPending}>
          {t('cancel')}
        </Button>
      </div>
    </section>
  );
}

function Alert({
  title,
  body,
  tone = 'critical',
}: {
  title: string;
  body: string;
  tone?: 'critical' | 'success';
}) {
  return (
    <div
      role="alert"
      className={cn(
        'flex flex-col gap-1 border px-4 py-3',
        tone === 'success'
          ? 'border-status-success bg-status-success-bg'
          : 'border-status-critical bg-status-critical-bg',
      )}
    >
      <h3
        className={cn(
          'text-body font-semibold',
          tone === 'success' ? 'text-status-success' : 'text-status-critical',
        )}
      >
        {title}
      </h3>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}
