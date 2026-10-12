'use client';

import { useLocale, useTranslations } from 'next-intl';
import { Activity, Search } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { FormSection } from '@/components/clinical/form-section';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import { Field, Input, Textarea } from '@/components/ui/field';
import {
  useCorrectVital,
  usePatientName,
  usePatientSearch,
  useRecordVital,
  useVitals,
  type VitalValues,
} from '@/lib/data/queries';
import {
  VITAL_FIELD_SPECS,
  byObservedAt,
  correctedIds,
  hasVitalContent,
  type BmiCategory,
  type VitalMeasurementKey,
  type VitalRow,
} from '@/lib/data/vitals';
import { cn } from '@/lib/cn';

/**
 * Nursing — vitals console (F3).
 *
 * A patient is chosen through the registry search, then their chart is
 * `GET /vitals?patientId=` — an unmodelled, mis-typed read (GAP-017), so rows are
 * validated structurally in `src/lib/data/vitals.ts`.
 *
 * Vitals are **append-only**: a correction writes a *new* record pointing at the
 * original (`correctionOfId`) with a mandatory reason, and never edits history.
 * The table therefore shows the whole chain, newest first, with superseded rows
 * marked rather than hidden — that is the point of an audit trail.
 *
 * BMI is computed server-side and only displayed here; the form never sends it.
 */

const BMI_TONE: Record<BmiCategory, 'warning' | 'success' | 'info' | 'critical'> = {
  UNDERWEIGHT: 'info',
  NORMAL: 'success',
  OVERWEIGHT: 'warning',
  OBESE: 'critical',
};

type FormValues = Record<VitalMeasurementKey, string>;

function emptyFormValues(): FormValues {
  return {
    temperatureC: '',
    systolicMmHg: '',
    diastolicMmHg: '',
    pulseBpm: '',
    respiratoryRate: '',
    spo2: '',
    weightKg: '',
    heightCm: '',
    painScore: '',
  };
}

function formValuesFrom(row: VitalRow): FormValues {
  const values = emptyFormValues();
  for (const spec of VITAL_FIELD_SPECS) {
    const raw = row[spec.key];
    values[spec.key] = raw === null ? '' : String(raw);
  }
  return values;
}

/** Parses one field, returning the number or a range/format error key. */
function parseField(
  key: VitalMeasurementKey,
  raw: string,
): { value: number } | { error: 'range' | 'format' } | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const spec = VITAL_FIELD_SPECS.find((candidate) => candidate.key === key);
  const parsed = Number(trimmed);
  if (!Number.isFinite(parsed)) return { error: 'format' };
  if (!spec) return { value: parsed };
  if (spec.integer && !Number.isInteger(parsed)) return { error: 'format' };
  if (parsed < spec.min || parsed > spec.max) return { error: 'range' };
  return { value: parsed };
}

export function VitalsConsoleScreen() {
  const t = useTranslations('vitals');
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [patientId, setPatientId] = useState('');

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(query), 300);
    return () => clearTimeout(timer);
  }, [query]);

  const search = usePatientSearch(debounced);
  const results = search.data?.data.items ?? [];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header>
        <h1 className="text-heading font-semibold text-primary">{t('pageTitle')}</h1>
        <p className="text-meta text-secondary">{t('pageIntro')}</p>
      </header>

      {patientId ? (
        <>
          <PatientContext patientId={patientId} onChange={setPatientId} />
          <PatientChart patientId={patientId} />
        </>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="w-full max-w-md">
            <Field id="vitals-search" label={t('searchLabel')}>
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

          <p role="status" aria-live="polite" className="text-meta text-tertiary">
            {debounced.trim() && !search.isFetching
              ? t('resultsCount', { count: search.data?.data.total ?? 0 })
              : search.isFetching
                ? t('searching')
                : ''}
          </p>

          {results.length > 0 ? (
            <ul className="flex flex-col divide-y divide-border border border-border">
              {results.map((patient) => (
                <li key={patient.id}>
                  <button
                    type="button"
                    onClick={() => setPatientId(patient.id)}
                    className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-surface-raised"
                  >
                    <span className="text-body text-primary">{patient.displayName}</span>
                    <span className="tabular-nums text-meta text-secondary">
                      {patient.patientNumber}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          ) : debounced.trim() && !search.isFetching ? (
            <EmptyState title={t('noResults')} description={t('noResultsBody')} icon={Search} headingLevel={2} />
          ) : (
            <EmptyState title={t('selectPromptTitle')} description={t('selectPrompt')} icon={Activity} headingLevel={2} />
          )}
        </div>
      )}
    </div>
  );
}

/** The chosen patient's name, plus a way back to the search. */
function PatientContext({ patientId, onChange }: { patientId: string; onChange: (id: string) => void }) {
  const t = useTranslations('vitals');
  const name = usePatientName(patientId);
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border border-border bg-surface px-4 py-2">
      <p className="text-body text-primary">
        {t('selected', { name: name.data?.data ?? t('unknownPatient') })}
      </p>
      <Button variant="ghost" size="sm" onClick={() => onChange('')}>
        {t('changePatient')}
      </Button>
    </div>
  );
}

/** The record form and the chart, bound to the selected patient. */
function PatientChart({ patientId }: { patientId: string }) {
  const t = useTranslations('vitals');
  const [correctionTarget, setCorrectionTarget] = useState<VitalRow | null>(null);

  const history = useVitals(patientId);
  const rows = byObservedAt(history.data?.data.items ?? []);
  const superseded = useMemo(() => correctedIds(rows), [rows]);

  return (
    <>
      <VitalsForm patientId={patientId} />

      {correctionTarget ? (
        <VitalsForm
          patientId={patientId}
          mode="correct"
          source={correctionTarget}
          onDone={() => setCorrectionTarget(null)}
        />
      ) : null}

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('history.title')}</h2>
        {history.error ? (
          <Alert title={t('history.unavailableTitle')} body={t('history.unavailableBody')} />
        ) : (
          <VitalsTable
            rows={rows}
            superseded={superseded}
            loading={history.isLoading}
            onCorrect={setCorrectionTarget}
          />
        )}
      </section>
    </>
  );
}

function VitalsTable({
  rows,
  superseded,
  loading,
  onCorrect,
}: {
  rows: readonly VitalRow[];
  superseded: ReadonlySet<string>;
  loading: boolean;
  onCorrect: (row: VitalRow) => void;
}) {
  const t = useTranslations('vitals');
  const locale = useLocale();

  const formatDateTime = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'short',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : '—';

  const cell = (value: number | null, unit = '') =>
    value === null ? (
      <span className="text-tertiary">—</span>
    ) : (
      <span className="tabular-nums text-secondary">
        {value}
        {unit}
      </span>
    );

  const columns: readonly DataTableColumn<VitalRow>[] = [
    {
      key: 'observed',
      header: t('history.columnObserved'),
      width: '12rem',
      cell: (row) => (
        <span className="tabular-nums text-primary">{formatDateTime(row.observedAt ?? row.createdAt)}</span>
      ),
    },
    { key: 'temperature', header: t('history.columnTemperature'), cell: (row) => cell(row.temperatureC, '°C') },
    {
      key: 'bp',
      header: t('history.columnBloodPressure'),
      cell: (row) =>
        row.systolicMmHg === null && row.diastolicMmHg === null ? (
          <span className="text-tertiary">—</span>
        ) : (
          <span className="tabular-nums text-secondary">
            {row.systolicMmHg ?? '—'}/{row.diastolicMmHg ?? '—'}
          </span>
        ),
    },
    { key: 'pulse', header: t('history.columnPulse'), cell: (row) => cell(row.pulseBpm, ' bpm') },
    { key: 'resp', header: t('history.columnRespiratory'), cell: (row) => cell(row.respiratoryRate) },
    { key: 'spo2', header: t('history.columnSpo2'), cell: (row) => cell(row.spo2, '%') },
    { key: 'weight', header: t('history.columnWeight'), cell: (row) => cell(row.weightKg, ' kg') },
    { key: 'height', header: t('history.columnHeight'), cell: (row) => cell(row.heightCm, ' cm') },
    {
      key: 'bmi',
      header: t('history.columnBmi'),
      cell: (row) =>
        row.bmi === null ? (
          <span className="text-tertiary">—</span>
        ) : (
          <span className="flex items-center gap-2">
            <span className="tabular-nums text-secondary">{row.bmi}</span>
            {row.bmiCategory && isBmiCategory(row.bmiCategory) ? (
              <StatusPill
                tone={BMI_TONE[row.bmiCategory]}
                size="sm"
                label={t(`bmi.${row.bmiCategory}`)}
              />
            ) : null}
          </span>
        ),
    },
    { key: 'pain', header: t('history.columnPain'), cell: (row) => cell(row.painScore, '/10') },
    {
      key: 'notes',
      header: t('history.columnNotes'),
      cell: (row) => (
        <span className="text-secondary">
          {row.notes ?? '—'}
          {row.correctionReason ? (
            <span className="block text-meta text-tertiary">
              {t('history.correctionReason', { reason: row.correctionReason })}
            </span>
          ) : null}
        </span>
      ),
    },
    {
      key: 'actions',
      header: t('history.columnActions'),
      cell: (row) =>
        superseded.has(row.id) ? (
          <StatusPill tone="neutral" size="sm" label={t('history.corrected')} />
        ) : (
          <Button variant="secondary" size="sm" onClick={() => onCorrect(row)}>
            {t('history.correct')}
          </Button>
        ),
    },
  ];

  return (
    <DataTable
      caption={t('history.caption')}
      columns={columns}
      rows={rows}
      rowKey={(row) => row.id}
      loading={loading}
      emptyMessage={t('history.empty')}
    />
  );
}

function VitalsForm({
  patientId,
  mode = 'record',
  source,
  onDone,
}: {
  patientId: string;
  mode?: 'record' | 'correct';
  source?: VitalRow;
  onDone?: () => void;
}) {
  const t = useTranslations('vitals');
  const [values, setValues] = useState<FormValues>(() =>
    source ? formValuesFrom(source) : emptyFormValues(),
  );
  const [observedAt, setObservedAt] = useState('');
  const [notes, setNotes] = useState(source?.notes ?? '');
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<ReadonlySet<VitalMeasurementKey>>(new Set());
  const [alert, setAlert] = useState<{ title: string; body: string } | null>(null);
  const [receipt, setReceipt] = useState(false);

  const record = useRecordVital();
  const correct = useCorrectVital();
  const pending = record.isPending || correct.isPending;
  const correcting = mode === 'correct';

  function submit() {
    setAlert(null);
    const nextErrors = new Set<VitalMeasurementKey>();
    const parsed: VitalValues = {};
    for (const spec of VITAL_FIELD_SPECS) {
      const result = parseField(spec.key, values[spec.key]);
      if (!result) continue;
      if ('error' in result) {
        nextErrors.add(spec.key);
        continue;
      }
      parsed[spec.key] = result.value;
    }
    setErrors(nextErrors);

    if (nextErrors.size > 0) {
      setAlert({ title: t('rangeTitle'), body: t('rangeBody') });
      return;
    }
    if (!hasVitalContent({ ...parsed, notes })) {
      setAlert({ title: t('missingTitle'), body: t('missingBody') });
      return;
    }
    if (correcting && reason.trim().length === 0) {
      setAlert({ title: t('correct.missingReasonTitle'), body: t('correct.missingReasonBody') });
      return;
    }

    const errorTitleKey = correcting ? 'correct.failedTitle' : 'record.failedTitle';
    const errorBodyKey = correcting ? 'correct.failedBody' : 'record.failedBody';
    const onError = () => setAlert({ title: t(errorTitleKey), body: t(errorBodyKey) });
    const onSuccess = () => {
      if (correcting) {
        onDone?.();
      } else {
        setValues(emptyFormValues());
        setObservedAt('');
        setNotes('');
        setReceipt(true);
      }
    };

    if (correcting && source) {
      correct.mutate(
        {
          id: source.id,
          patientId,
          correctionReason: reason.trim(),
          values: parsed,
          ...(notes.trim() ? { notes: notes.trim() } : {}),
        },
        { onSuccess, onError },
      );
      return;
    }

    record.mutate(
      {
        patientId,
        values: parsed,
        ...(observedAt ? { observedAt: new Date(observedAt).toISOString() } : {}),
        ...(notes.trim() ? { notes: notes.trim() } : {}),
      },
      { onSuccess, onError },
    );
  }

  return (
    <FormSection
      title={t(correcting ? 'correct.title' : 'record.title')}
      description={t(correcting ? 'correct.intro' : 'record.intro')}
    >
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {VITAL_FIELD_SPECS.map((spec) => (
          <Field
            key={spec.key}
            id={`vitals-${mode}-${spec.key}`}
            label={`${t(spec.labelKey)} (${spec.unit})`}
            error={errors.has(spec.key) ? t('rangeField') : undefined}
          >
            {({ controlId, describedBy, invalid }) => (
              <Input
                id={controlId}
                aria-describedby={describedBy}
                aria-invalid={invalid || undefined}
                type="number"
                inputMode="decimal"
                min={spec.min}
                max={spec.max}
                step={spec.step}
                value={values[spec.key]}
                onChange={(event) =>
                  setValues((current) => ({ ...current, [spec.key]: event.target.value }))
                }
              />
            )}
          </Field>
        ))}
      </div>

      {!correcting ? (
        <Field
          id="vitals-observed-at"
          label={t('record.observedAt')}
          hint={t('record.observedAtHint')}
        >
          {({ controlId, describedBy }) => (
            <Input
              id={controlId}
              aria-describedby={describedBy}
              type="datetime-local"
              value={observedAt}
              onChange={(event) => setObservedAt(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      <Field id={`vitals-${mode}-notes`} label={t('record.notes')}>
        {({ controlId, describedBy }) => (
          <Textarea
            id={controlId}
            aria-describedby={describedBy}
            rows={2}
            value={notes}
            onChange={(event) => setNotes(event.target.value)}
          />
        )}
      </Field>

      {correcting ? (
        <Field
          id="vitals-correction-reason"
          label={t('correct.reason')}
          hint={t('correct.reasonHint')}
        >
          {({ controlId, describedBy }) => (
            <Textarea
              id={controlId}
              aria-describedby={describedBy}
              rows={2}
              value={reason}
              onChange={(event) => setReason(event.target.value)}
            />
          )}
        </Field>
      ) : null}

      {alert ? <Alert title={alert.title} body={alert.body} /> : null}
      {receipt ? (
        <Alert title={t('record.saved')} body={t('record.savedBody')} tone="success" />
      ) : null}

      <div className="flex gap-2">
        <Button onClick={submit} disabled={pending}>
          {pending
            ? t(correcting ? 'correct.submitting' : 'record.submitting')
            : t(correcting ? 'correct.submit' : 'record.submit')}
        </Button>
        {correcting ? (
          <Button variant="ghost" onClick={onDone} disabled={pending}>
            {t('correct.dismiss')}
          </Button>
        ) : null}
      </div>
    </FormSection>
  );
}

function isBmiCategory(value: string): value is BmiCategory {
  return value === 'UNDERWEIGHT' || value === 'NORMAL' || value === 'OVERWEIGHT' || value === 'OBESE';
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

export { PatientChart };
