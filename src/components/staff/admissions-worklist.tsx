'use client';

import { BedDouble } from 'lucide-react';
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
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useAdmissions,
  useAdmitPatient,
  usePatientSearch,
  usePatientName,
  useWards,
} from '@/lib/data/queries';
import {
  activeAssignment,
  ADMISSION_STATUSES,
  collectBeds,
  INPATIENT_BRANCH_ID,
  type AdmissionRow,
  type AdmissionStatus,
} from '@/lib/data/inpatient';
import type { PatientListItem } from '@/lib/data/patients';

/**
 * Admissions desk (F8 slice 2) — every inpatient admission, newest first.
 *
 * `GET /admissions` types its 200 as the request DTO while the service answers a
 * `PageResult` (GAP-020 family), so rows are validated structurally in
 * `src/lib/data/inpatient.ts`. Rows carry only `patientId`; names resolve on
 * demand (GAP-018). An admission exposes its bed-assignment history, so the
 * current bed is resolved from the ward tree rather than a second endpoint.
 *
 * Admitting posts to `POST /admissions`. The service assigns the source
 * (`OUTPATIENT_CLINIC` for this desk) and row-locks the bed, and the app has no
 * branch picker, so the EXAMPLE branch is used (GAP-018).
 */

const STATUS_TONE: Record<AdmissionStatus, StatusTone> = {
  ADMITTED: 'info',
  DISCHARGED: 'neutral',
};

export function AdmissionsWorklistScreen() {
  const t = useTranslations('inpatient');
  const locale = useLocale();
  const [status, setStatus] = useState<AdmissionStatus | ''>('');
  const [admitOpen, setAdmitOpen] = useState(false);

  const admissions = useAdmissions({ status: status || undefined });
  const rows = admissions.data?.data.rows ?? [];

  const wards = useWards({});
  const bedLabels = new Map(
    collectBeds(wards.data?.data.rows ?? []).map((bed) => [
      bed.id,
      `${bed.roomName} · ${bed.bedNumber}`,
    ]),
  );

  const formatDate = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(new Date(iso))
      : null;

  const columns: readonly DataTableColumn<AdmissionRow>[] = [
    {
      key: 'admission',
      header: t('columnAdmission'),
      cell: (row) => (
        <span className="font-medium tabular-nums text-primary">{row.admissionNumber}</span>
      ),
    },
    {
      key: 'patient',
      header: t('columnPatient'),
      cell: (row) => <PatientNameCell id={row.patientId} />,
    },
    {
      key: 'bed',
      header: t('columnBed'),
      cell: (row) => {
        const active = activeAssignment(row);
        if (!active) return <span className="text-tertiary">{t('bedNone')}</span>;
        return (
          <span className="text-secondary">{bedLabels.get(active.bedId) ?? t('bedUnknown')}</span>
        );
      },
    },
    {
      key: 'source',
      header: t('columnSource'),
      cell: (row) => <span className="text-secondary">{t(`admissionSource.${row.source}`)}</span>,
    },
    {
      key: 'admitted',
      header: t('columnAdmitted'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatDate(row.admittedAt)}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={STATUS_TONE[row.status]} label={t(`admissionStatus.${row.status}`)} />
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-heading font-semibold text-primary">{t('admissionsTitle')}</h1>
          <p className="text-meta text-secondary">{t('admissionsIntro')}</p>
        </div>
        <Button variant="primary" onClick={() => setAdmitOpen(true)}>
          {t('admitPatient')}
        </Button>
      </header>

      <div className="w-48">
        <Field id="admissions-status-filter" label={t('filterStatus')}>
          {({ controlId }) => (
            <Select
              id={controlId}
              value={status}
              onChange={(event) => setStatus(event.target.value as AdmissionStatus | '')}
            >
              <option value="">{t('allStatuses')}</option>
              {ADMISSION_STATUSES.map((value) => (
                <option key={value} value={value}>
                  {t(`admissionStatus.${value}`)}
                </option>
              ))}
            </Select>
          )}
        </Field>
      </div>

      {admissions.error ? (
        <EmptyState
          title={t('admissionsUnavailableTitle')}
          description={t('admissionsUnavailableBody')}
          icon={BedDouble}
          headingLevel={2}
        />
      ) : (
        <DataTable<AdmissionRow>
          caption={t('admissionsTableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          rowHref={(row) => `/admissions/${row.id}`}
          rowLinkLabel={(row) => t('openAdmission', { number: row.admissionNumber })}
          loading={admissions.isLoading}
          emptyMessage={t('admissionsEmpty')}
        />
      )}

      <AdmitDialog open={admitOpen} onOpenChange={setAdmitOpen} />
    </div>
  );
}

function PatientNameCell({ id }: { id: string }) {
  const t = useTranslations('inpatient');
  const name = usePatientName(id);
  if (name.isLoading) return <span className="text-tertiary">…</span>;
  return <span className="text-primary">{name.data?.data ?? t('unknownPatient')}</span>;
}

function AdmitDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations('inpatient');
  const admit = useAdmitPatient();

  const [query, setQuery] = useState('');
  const [patient, setPatient] = useState<PatientListItem | null>(null);
  const [bedId, setBedId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [expected, setExpected] = useState('');
  const [error, setError] = useState<string | null>(null);

  const search = usePatientSearch(query);
  const wards = useWards({ active: true });
  const beds = collectBeds(wards.data?.data.rows ?? []);
  const available = beds.filter((bed) => bed.status === 'AVAILABLE');
  const wardNames = [...new Set(available.map((bed) => bed.wardName))];

  const close = () => {
    setQuery('');
    setPatient(null);
    setBedId('');
    setDiagnosis('');
    setExpected('');
    setError(null);
    admit.reset();
    onOpenChange(false);
  };

  const conflict = admit.isError && admit.error?.code === 'ADMISSION_ALREADY_ACTIVE';
  const unavailable = admit.isError && admit.error?.code === 'BED_UNAVAILABLE';

  const submit = () => {
    if (!patient) {
      setError(t('patientRequired'));
      return;
    }
    if (!bedId) {
      setError(t('bedRequired'));
      return;
    }
    admit.mutate(
      {
        patientId: patient.id,
        branchId: INPATIENT_BRANCH_ID,
        bedId,
        provisionalDiagnosis: diagnosis.trim() || undefined,
        expectedDischargeAt: expected ? new Date(`${expected}T00:00:00.000Z`).toISOString() : undefined,
      },
      { onSuccess: () => close() },
    );
  };

  return (
    <Dialog open={open} onOpenChange={(next) => (next ? onOpenChange(true) : close())}>
      <DialogContent>
        <DialogHeader title={t('admitTitle')} description={t('admitBody')} />
        <DialogBody className="flex flex-col gap-4">
          {conflict ? (
            <Alert title={t('conflictAdmissionTitle')} body={t('conflictAdmissionBody')} />
          ) : null}
          {unavailable ? (
            <Alert title={t('conflictBedTitle')} body={t('conflictBedBody')} />
          ) : null}

          {patient ? (
            <div className="flex items-center justify-between gap-3 border border-border px-3 py-2">
              <span className="text-body text-primary">{patient.displayName}</span>
              <Button
                variant="tertiary"
                size="sm"
                onClick={() => {
                  setPatient(null);
                  setQuery('');
                }}
              >
                {t('changePatient')}
              </Button>
            </div>
          ) : (
            <>
              <Field id="admit-patient-search" label={t('patientSearch')} required>
                {({ controlId }) => (
                  <Input
                    id={controlId}
                    value={query}
                    placeholder={t('patientSearchPlaceholder')}
                    onChange={(event) => setQuery(event.target.value)}
                  />
                )}
              </Field>
              {query.trim() ? (
                search.isLoading ? (
                  <p role="status" className="text-meta text-tertiary">
                    {t('searching')}
                  </p>
                ) : (search.data?.data.items.length ?? 0) === 0 ? (
                  <p className="text-meta text-secondary">{t('noPatients')}</p>
                ) : (
                  <ul className="max-h-48 overflow-y-auto border border-border">
                    {search.data?.data.items.map((item) => (
                      <li key={item.id} className="border-b border-border last:border-b-0">
                        <button
                          type="button"
                          onClick={() => {
                            setPatient(item);
                            if (error) setError(null);
                          }}
                          className="flex w-full flex-col items-start px-3 py-2 text-left hover:bg-surface-hover"
                        >
                          <span className="text-body text-primary">{item.displayName}</span>
                          <span className="text-caption tabular-nums text-tertiary">
                            {item.patientNumber}
                          </span>
                        </button>
                      </li>
                    ))}
                  </ul>
                )
              ) : null}
            </>
          )}

          <Field id="admit-bed" label={t('bed')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={bedId}
                onChange={(event) => {
                  setBedId(event.target.value);
                  if (error) setError(null);
                }}
              >
                <option value="">{t('chooseBed')}</option>
                {wardNames.map((wardName) => (
                  <optgroup key={wardName} label={wardName}>
                    {available
                      .filter((bed) => bed.wardName === wardName)
                      .map((bed) => (
                        <option key={bed.id} value={bed.id}>
                          {bed.roomName} · {bed.bedNumber}
                        </option>
                      ))}
                  </optgroup>
                ))}
              </Select>
            )}
          </Field>
          {available.length === 0 && !wards.isLoading ? (
            <p className="text-caption text-secondary">{t('noAvailableBeds')}</p>
          ) : null}

          <Field id="admit-diagnosis" label={t('provisionalDiagnosis')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
              />
            )}
          </Field>
          <Field id="admit-expected" label={t('expectedDischarge')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={expected}
                onChange={(event) => setExpected(event.target.value)}
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
          <Button variant="primary" disabled={admit.isPending} onClick={submit}>
            {t('submitAdmit')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function Alert({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
      <h3 className="text-body font-semibold text-status-critical">{title}</h3>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}
