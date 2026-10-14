'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import {
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { CheckboxField } from '@/components/ui/primitives';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useAdmission,
  useDischargeAdmission,
  usePatientName,
  useTransferAdmission,
  useWards,
} from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  activeAssignment,
  collectBeds,
  type AdmissionRow,
  type AdmissionStatus,
} from '@/lib/data/inpatient';

/**
 * Admission workspace (F8 slice 2) — one admission, whichever point of its
 * lifecycle it sits at.
 *
 * The read answers `{ admission }` while the export types the bare entity
 * (GAP-020), so the body is validated in `src/lib/data/inpatient.ts`. The bed
 * history is the assignment rows newest-first; a transfer does not change the
 * status, it moves the active assignment, and a discharge closes the admission
 * and releases the bed to cleaning — both reflected on the ward board.
 *
 * The action bar offers only the moves the service allows: a transfer needs
 * another available bed while ADMITTED, and a discharge is final.
 */

const STATUS_TONE: Record<AdmissionStatus, StatusTone> = {
  ADMITTED: 'info',
  DISCHARGED: 'neutral',
};

export function AdmissionWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('inpatient');
  const admission = useAdmission(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/admissions"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('admissionsBack')}
      </Link>

      {admission.isLoading && !admission.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingAdmission')}
        </p>
      ) : admission.error ? (
        <EmptyState
          title={t('admissionUnavailableTitle')}
          description={t('admissionUnavailableBody')}
          headingLevel={2}
        />
      ) : !admission.data ? (
        <EmptyState
          title={t('admissionNotFoundTitle')}
          description={t('admissionNotFoundBody')}
          headingLevel={2}
        />
      ) : (
        <AdmissionBody admission={admission.data.data} />
      )}
    </div>
  );
}

function AdmissionBody({ admission }: { admission: AdmissionRow }) {
  const t = useTranslations('inpatient');
  const locale = useLocale();

  const [transferOpen, setTransferOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);

  const patient = usePatientName(admission.patientId);
  const wards = useWards({ active: true });
  const bedLabels = new Map(
    collectBeds(wards.data?.data.rows ?? []).map((bed) => [
      bed.id,
      `${bed.wardName} · ${bed.roomName} · ${bed.bedNumber}`,
    ]),
  );

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const current = activeAssignment(admission);
  const history = [...admission.assignments].sort((a, b) => b.assignedAt.localeCompare(a.assignedAt));
  const admitted = admission.status === 'ADMITTED';

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold tabular-nums text-primary">
          {admission.admissionNumber}
        </h1>
        <StatusPill tone={STATUS_TONE[admission.status]} label={t(`admissionStatus.${admission.status}`)} />
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 lg:col-span-2">
          <h2 className="text-subheading font-semibold text-primary">{t('summaryHeading')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('patient')}</dt>
            <dd className="text-primary">{patient.data?.data ?? t('unknownPatient')}</dd>
            <dt className="text-tertiary">{t('currentBed')}</dt>
            <dd className="text-primary">
              {current ? bedLabels.get(current.bedId) ?? t('bedUnknown') : t('bedNone')}
            </dd>
            <dt className="text-tertiary">{t('source')}</dt>
            <dd className="text-primary">{t(`admissionSource.${admission.source}`)}</dd>
            <dt className="text-tertiary">{t('admitted')}</dt>
            <dd className="tabular-nums text-primary">{format(admission.admittedAt)}</dd>
            <dt className="text-tertiary">{t('expectedDischarge')}</dt>
            <dd className="tabular-nums text-primary">
              {format(admission.expectedDischargeAt) ?? t('none')}
            </dd>
            <dt className="text-tertiary">{t('provisionalDiagnosis')}</dt>
            <dd className="text-primary">{admission.provisionalDiagnosis ?? t('none')}</dd>
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('actionsHeading')}</h2>
          {admitted ? (
            <>
              <Button variant="secondary" onClick={() => setTransferOpen(true)}>
                {t('transferBed')}
              </Button>
              <Button variant="primary" onClick={() => setDischargeOpen(true)}>
                {t('discharge')}
              </Button>
            </>
          ) : (
            <p className="text-meta text-secondary">{t('noActions')}</p>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('bedHistoryHeading')}</h2>
        {history.length === 0 ? (
          <p className="text-meta text-secondary">{t('noAssignments')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {history.map((row) => (
              <li
                key={row.id}
                className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3"
              >
                <span className="text-body text-primary">
                  {bedLabels.get(row.bedId) ?? t('bedUnknown')}
                </span>
                <span className="text-caption tabular-nums text-secondary">
                  {format(row.assignedAt)}
                  {row.releasedAt ? ` – ${format(row.releasedAt)}` : ` · ${t('stillAssigned')}`}
                </span>
                {row.reason ? (
                  <span className="w-full text-caption text-tertiary">{row.reason}</span>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>

      {admission.discharge ? (
        <section className="flex flex-col gap-2 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('dischargeHeading')}</h2>
          <p className="text-meta text-secondary">
            <span className="font-medium text-tertiary">{t('dischargedAt')}: </span>
            <span className="tabular-nums">{format(admission.discharge.dischargedAt)}</span>
          </p>
          {admission.discharge.summary ? (
            <p className="text-meta text-primary">{admission.discharge.summary}</p>
          ) : null}
          {admission.discharge.instructions ? (
            <p className="text-meta text-secondary">{admission.discharge.instructions}</p>
          ) : null}
          {admission.discharge.followUp ? (
            <p className="text-meta text-secondary">
              <span className="font-medium text-tertiary">{t('followUp')}: </span>
              {admission.discharge.followUp.type}
              {admission.discharge.followUp.date
                ? ` · ${format(admission.discharge.followUp.date)}`
                : ''}
            </p>
          ) : null}
          {admission.discharge.hasOutstandingBilling ? (
            <p className="text-caption text-status-warning">{t('outstandingBilling')}</p>
          ) : null}
        </section>
      ) : null}

      {transferOpen ? (
        <TransferDialog admission={admission} onClose={() => setTransferOpen(false)} />
      ) : null}
      {dischargeOpen ? (
        <DischargeDialog admission={admission} onClose={() => setDischargeOpen(false)} />
      ) : null}
    </div>
  );
}

function TransferDialog({
  admission,
  onClose,
}: {
  admission: AdmissionRow;
  onClose: () => void;
}) {
  const t = useTranslations('inpatient');
  const transfer = useTransferAdmission();

  const current = activeAssignment(admission);
  const wards = useWards({ active: true });
  const available = collectBeds(wards.data?.data.rows ?? []).filter(
    (bed) => bed.status === 'AVAILABLE' && bed.id !== current?.bedId,
  );
  const wardNames = [...new Set(available.map((bed) => bed.wardName))];

  const [bedId, setBedId] = useState('');
  const [reason, setReason] = useState('');
  const [error, setError] = useState<string | null>(null);

  const conflict = transfer.isError && transfer.error?.code === 'BED_UNAVAILABLE';
  const stale = transfer.isError && transfer.error?.code === 'INVALID_WORKFLOW_TRANSITION';
  const failure: QueryError | null =
    transfer.isError && transfer.error && !conflict && !stale ? transfer.error : null;

  const submit = () => {
    if (!bedId) {
      setError(t('bedRequired'));
      return;
    }
    transfer.mutate(
      { id: admission.id, toBedId: bedId, reason: reason.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('transferTitle')} description={t('transferBody')} />
        <DialogBody className="flex flex-col gap-4">
          {conflict ? <AlertBlock title={t('conflictBedTitle')} body={t('conflictBedBody')} /> : null}
          {stale ? <AlertBlock title={t('conflictAdmissionTitle')} body={t('conflictAdmissionBody')} /> : null}
          <Field id="transfer-bed" label={t('targetBed')} required>
            {({ controlId, invalid }) => (
              <Select
                id={controlId}
                invalid={invalid}
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
          {available.length === 0 ? (
            <p className="text-caption text-secondary">{t('noAvailableBeds')}</p>
          ) : null}
          <Field id="transfer-reason" label={t('transferReason')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={reason}
                onChange={(event) => setReason(event.target.value)}
              />
            )}
          </Field>
          {error ? (
            <p role="alert" className="text-caption text-status-critical">
              {error}
            </p>
          ) : null}
          {failure ? (
            <p role="alert" className="text-caption text-status-critical">
              {t('writeFailed')}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={transfer.isPending} onClick={submit}>
            {t('submitTransfer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function DischargeDialog({
  admission,
  onClose,
}: {
  admission: AdmissionRow;
  onClose: () => void;
}) {
  const t = useTranslations('inpatient');
  const discharge = useDischargeAdmission();

  const [summary, setSummary] = useState('');
  const [instructions, setInstructions] = useState('');
  const [followUpType, setFollowUpType] = useState('');
  const [followUpDate, setFollowUpDate] = useState('');
  const [followUpNotes, setFollowUpNotes] = useState('');
  const [outstanding, setOutstanding] = useState(false);

  const stale = discharge.isError && discharge.error?.code === 'INVALID_WORKFLOW_TRANSITION';
  const failure: QueryError | null =
    discharge.isError && discharge.error && !stale ? discharge.error : null;

  const submit = () => {
    const hasFollowUp = followUpType.trim().length > 0;
    discharge.mutate(
      {
        id: admission.id,
        summary: summary.trim() || undefined,
        instructions: instructions.trim() || undefined,
        followUp: hasFollowUp
          ? {
              type: followUpType.trim(),
              date: followUpDate ? new Date(`${followUpDate}T00:00:00.000Z`).toISOString() : undefined,
              notes: followUpNotes.trim() || undefined,
            }
          : undefined,
        hasOutstandingBilling: outstanding,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('dischargeTitle')} description={t('dischargeBody')} />
        <DialogBody className="flex flex-col gap-4">
          {stale ? <AlertBlock title={t('conflictAdmissionTitle')} body={t('conflictAdmissionBody')} /> : null}
          <Field id="discharge-summary" label={t('dischargeSummary')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={3}
                value={summary}
                onChange={(event) => setSummary(event.target.value)}
              />
            )}
          </Field>
          <Field id="discharge-instructions" label={t('dischargeInstructions')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={instructions}
                onChange={(event) => setInstructions(event.target.value)}
              />
            )}
          </Field>
          <Field id="discharge-followup-type" label={t('followUpType')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={followUpType}
                onChange={(event) => setFollowUpType(event.target.value)}
              />
            )}
          </Field>
          <Field id="discharge-followup-date" label={t('followUpDate')}>
            {({ controlId }) => (
              <Input
                id={controlId}
                type="date"
                value={followUpDate}
                onChange={(event) => setFollowUpDate(event.target.value)}
              />
            )}
          </Field>
          <Field id="discharge-followup-notes" label={t('followUpNotes')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={followUpNotes}
                onChange={(event) => setFollowUpNotes(event.target.value)}
              />
            )}
          </Field>
          <CheckboxField
            id="discharge-outstanding"
            label={t('hasOutstandingBilling')}
            checked={outstanding}
            onCheckedChange={(next) => setOutstanding(next === true)}
          />
          {failure ? (
            <p role="alert" className="text-caption text-status-critical">
              {t('writeFailed')}
            </p>
          ) : null}
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={discharge.isPending} onClick={submit}>
            {t('submitDischarge')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AlertBlock({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
      <h3 className="text-body font-semibold text-status-critical">{title}</h3>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}
