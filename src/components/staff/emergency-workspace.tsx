'use client';

import Link from 'next/link';
import { ArrowLeft } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill } from '@/components/clinical/status-pill';
import { Button } from '@/components/ui/button';
import {
  ConfirmDialog,
  Dialog,
  DialogBody,
  DialogContent,
  DialogFooter,
  DialogHeader,
} from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/field';
import {
  useAdmitFromEmergency,
  useAssessEmergencyVisit,
  useDischargeEmergencyVisit,
  useEmergencyVisit,
  useObserveEmergencyVisit,
  usePatientName,
  useReferEmergencyVisit,
  useSetEmergencyPriority,
  useTreatEmergencyVisit,
  useTriageEmergencyVisit,
  useWards,
} from '@/lib/data/queries';
import type { QueryError } from '@/lib/data/queries';
import {
  type EmergencyPriority,
  type EmergencyVisitRow,
  isEmergencyTerminal,
} from '@/lib/data/emergency';
import { collectBeds } from '@/lib/data/inpatient';
import {
  EMERGENCY_PRIORITY_TONE,
  EMERGENCY_STATUS_TONE,
} from '@/components/staff/emergency-worklist';

/**
 * Emergency workspace (F8 slice 3) — one visit, whichever point of its workflow
 * it sits at.
 *
 * The read answers `{ visit }` while the export types the bare entity (GAP-020),
 * so the body is validated in `src/lib/data/emergency.ts`. The action bar offers
 * only the moves the service allows: triage from ARRIVED, assess from TRIAGED,
 * treat from ASSESSED, observe from ASSESSED or IN_TREATMENT, and one final
 * disposition (admit, refer or discharge) from ASSESSED, IN_TREATMENT or
 * OBSERVATION. A re-triage of priority is available until the visit is closed.
 */

export function EmergencyWorkspaceScreen({ id }: { id: string }) {
  const t = useTranslations('emergency');
  const visit = useEmergencyVisit(id);

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <Link
        href="/emergency"
        className="inline-flex items-center gap-1.5 text-meta font-medium text-brand-ink underline-offset-2 hover:underline"
      >
        <ArrowLeft aria-hidden className="size-4" />
        {t('back')}
      </Link>

      {visit.isLoading && !visit.data ? (
        <p role="status" className="text-meta text-tertiary">
          {t('loadingVisit')}
        </p>
      ) : visit.error ? (
        <EmptyState
          title={t('visitUnavailableTitle')}
          description={t('visitUnavailableBody')}
          headingLevel={2}
        />
      ) : !visit.data ? (
        <EmptyState
          title={t('visitNotFoundTitle')}
          description={t('visitNotFoundBody')}
          headingLevel={2}
        />
      ) : (
        <VisitBody visit={visit.data.data} />
      )}
    </div>
  );
}

function VisitBody({ visit }: { visit: EmergencyVisitRow }) {
  const t = useTranslations('emergency');
  const locale = useLocale();

  const [triageOpen, setTriageOpen] = useState(false);
  const [priorityOpen, setPriorityOpen] = useState(false);
  const [assessOpen, setAssessOpen] = useState(false);
  const [treatOpen, setTreatOpen] = useState(false);
  const [observeOpen, setObserveOpen] = useState(false);
  const [admitOpen, setAdmitOpen] = useState(false);
  const [referOpen, setReferOpen] = useState(false);
  const [dischargeOpen, setDischargeOpen] = useState(false);

  const patient = usePatientName(visit.patientId);

  const format = (iso: string | null) =>
    iso
      ? new Intl.DateTimeFormat(locale, {
          dateStyle: 'medium',
          timeStyle: 'short',
          timeZone: 'UTC',
        }).format(new Date(iso))
      : null;

  const terminal = isEmergencyTerminal(visit.status);
  const canTriage = visit.status === 'ARRIVED';
  const canAssess = visit.status === 'TRIAGED';
  const canTreat = visit.status === 'ASSESSED';
  const canObserve = visit.status === 'ASSESSED' || visit.status === 'IN_TREATMENT';
  const canDispose =
    visit.status === 'ASSESSED' || visit.status === 'IN_TREATMENT' || visit.status === 'OBSERVATION';

  const timeline: readonly { readonly key: string; readonly label: string; readonly at: string }[] = [
    { key: 'registered', label: t('timelineRegistered'), at: visit.arrivedAt },
    ...(visit.triagedAt ? [{ key: 'triaged', label: t('timelineTriaged'), at: visit.triagedAt }] : []),
    ...(visit.assessedAt
      ? [{ key: 'assessed', label: t('timelineAssessed'), at: visit.assessedAt }]
      : []),
    ...(visit.treatmentStartedAt
      ? [{ key: 'treated', label: t('timelineTreated'), at: visit.treatmentStartedAt }]
      : []),
    ...(visit.observedAt
      ? [{ key: 'observed', label: t('timelineObserved'), at: visit.observedAt }]
      : []),
    ...(visit.dispositionAt && visit.disposition
      ? [
          {
            key: 'disposition',
            label: t(`emergencyDisposition.${visit.disposition}`),
            at: visit.dispositionAt,
          },
        ]
      : []),
  ];

  return (
    <div className="flex flex-col gap-6">
      <header className="flex flex-wrap items-center gap-3">
        <h1 className="text-heading font-semibold tabular-nums text-primary">{visit.visitNumber}</h1>
        <StatusPill
          tone={EMERGENCY_STATUS_TONE[visit.status]}
          label={t(`emergencyStatus.${visit.status}`)}
        />
        {visit.priority ? (
          <StatusPill
            tone={EMERGENCY_PRIORITY_TONE[visit.priority]}
            label={t(`emergencyPriority.${visit.priority}`)}
          />
        ) : null}
      </header>

      <div className="grid grid-cols-1 gap-4 lg:grid-cols-3">
        <section className="flex flex-col gap-4 rounded-lg border border-border bg-surface p-4 lg:col-span-2">
          <h2 className="text-subheading font-semibold text-primary">{t('summaryHeading')}</h2>
          <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-2 text-meta">
            <dt className="text-tertiary">{t('patient')}</dt>
            <dd className="text-primary">{patient.data?.data ?? t('unknownPatient')}</dd>
            <dt className="text-tertiary">{t('arrival')}</dt>
            <dd className="tabular-nums text-primary">{format(visit.arrivedAt)}</dd>
            <dt className="text-tertiary">{t('chiefComplaint')}</dt>
            <dd className="text-primary">{visit.chiefComplaint ?? t('none')}</dd>
            <dt className="text-tertiary">{t('priority')}</dt>
            <dd className="text-primary">
              {visit.priority ? t(`emergencyPriority.${visit.priority}`) : t('priorityPending')}
            </dd>
            <dt className="text-tertiary">{t('assessment')}</dt>
            <dd className="text-primary">{visit.assessment ?? t('none')}</dd>
            <dt className="text-tertiary">{t('treatment')}</dt>
            <dd className="text-primary">{visit.treatment ?? t('none')}</dd>
            {visit.disposition ? (
              <>
                <dt className="text-tertiary">{t('disposition')}</dt>
                <dd className="text-primary">{t(`emergencyDisposition.${visit.disposition}`)}</dd>
              </>
            ) : null}
            {visit.admittedAdmissionId ? (
              <>
                <dt className="text-tertiary">{t('admittedAdmission')}</dt>
                <dd>
                  <Link
                    href={`/admissions/${visit.admittedAdmissionId}`}
                    className="tabular-nums font-medium text-brand-ink underline-offset-2 hover:underline"
                  >
                    {visit.admittedAdmissionId}
                  </Link>
                </dd>
              </>
            ) : null}
            {visit.referredTo ? (
              <>
                <dt className="text-tertiary">{t('referredTo')}</dt>
                <dd className="text-primary">{visit.referredTo}</dd>
              </>
            ) : null}
            {visit.referralNotes ? (
              <>
                <dt className="text-tertiary">{t('referralNotes')}</dt>
                <dd className="text-primary">{visit.referralNotes}</dd>
              </>
            ) : null}
          </dl>
        </section>

        <section className="flex flex-col gap-3 rounded-lg border border-border bg-surface p-4">
          <h2 className="text-subheading font-semibold text-primary">{t('actionsHeading')}</h2>
          {terminal ? (
            <p className="text-meta text-secondary">{t('noActions')}</p>
          ) : (
            <>
              {canTriage ? (
                <Button variant="primary" onClick={() => setTriageOpen(true)}>
                  {t('actionTriage')}
                </Button>
              ) : null}
              {canAssess ? (
                <Button variant="primary" onClick={() => setAssessOpen(true)}>
                  {t('actionAssess')}
                </Button>
              ) : null}
              {canTreat ? (
                <Button variant="primary" onClick={() => setTreatOpen(true)}>
                  {t('actionTreat')}
                </Button>
              ) : null}
              {canObserve ? (
                <Button variant="secondary" onClick={() => setObserveOpen(true)}>
                  {t('actionObserve')}
                </Button>
              ) : null}
              {canDispose ? (
                <>
                  <Button variant="primary" onClick={() => setAdmitOpen(true)}>
                    {t('actionAdmit')}
                  </Button>
                  <Button variant="secondary" onClick={() => setReferOpen(true)}>
                    {t('actionRefer')}
                  </Button>
                  <Button variant="secondary" onClick={() => setDischargeOpen(true)}>
                    {t('actionDischarge')}
                  </Button>
                </>
              ) : null}
              <Button variant="tertiary" onClick={() => setPriorityOpen(true)}>
                {t('actionPriority')}
              </Button>
            </>
          )}
        </section>
      </div>

      <section className="flex flex-col gap-3">
        <h2 className="text-subheading font-semibold text-primary">{t('timelineHeading')}</h2>
        <ol className="flex flex-col gap-2">
          {timeline.map((event) => (
            <li
              key={event.key}
              className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1 rounded-lg border border-border bg-surface px-4 py-3"
            >
              <span className="text-body text-primary">{event.label}</span>
              <span className="text-caption tabular-nums text-secondary">{format(event.at)}</span>
            </li>
          ))}
        </ol>
      </section>

      {triageOpen ? <TriageDialog visit={visit} onClose={() => setTriageOpen(false)} /> : null}
      {priorityOpen ? <PriorityDialog visit={visit} onClose={() => setPriorityOpen(false)} /> : null}
      {assessOpen ? <AssessDialog visit={visit} onClose={() => setAssessOpen(false)} /> : null}
      {treatOpen ? <TreatDialog visit={visit} onClose={() => setTreatOpen(false)} /> : null}
      {observeOpen ? <ObserveDialog visit={visit} onClose={() => setObserveOpen(false)} /> : null}
      {admitOpen ? <AdmitDialog visit={visit} onClose={() => setAdmitOpen(false)} /> : null}
      {referOpen ? <ReferDialog visit={visit} onClose={() => setReferOpen(false)} /> : null}
      {dischargeOpen ? <DischargeDialog visit={visit} onClose={() => setDischargeOpen(false)} /> : null}
    </div>
  );
}

function PriorityOptions() {
  const t = useTranslations('emergency');
  return (
    <>
      {(['RESUSCITATION', 'EMERGENT', 'URGENT', 'SEMI_URGENT', 'NON_URGENT'] as const).map(
        (value) => (
          <option key={value} value={value}>
            {t(`emergencyPriority.${value}`)}
          </option>
        ),
      )}
    </>
  );
}

function TriageDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const triage = useTriageEmergencyVisit();
  const [priority, setPriority] = useState<EmergencyPriority>(visit.priority ?? 'URGENT');
  const [complaint, setComplaint] = useState(visit.chiefComplaint ?? '');

  const submit = () => {
    triage.mutate(
      { id: visit.id, priority, complaint: complaint.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('triageTitle')} description={t('triageBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={triage.error} />
          <Field id="triage-priority" label={t('priorityLabel')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={priority}
                onChange={(event) => setPriority(event.target.value as EmergencyPriority)}
              >
                <PriorityOptions />
              </Select>
            )}
          </Field>
          <Field id="triage-complaint" label={t('complaintLabel')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={3}
                value={complaint}
                onChange={(event) => setComplaint(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={triage.isPending} onClick={submit}>
            {t('submitTriage')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function PriorityDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const changePriority = useSetEmergencyPriority();
  const [priority, setPriority] = useState<EmergencyPriority>(visit.priority ?? 'URGENT');

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('priorityTitle')} description={t('priorityBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={changePriority.error} />
          <Field id="priority-value" label={t('priorityLabel')} required>
            {({ controlId }) => (
              <Select
                id={controlId}
                value={priority}
                onChange={(event) => setPriority(event.target.value as EmergencyPriority)}
              >
                <PriorityOptions />
              </Select>
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={changePriority.isPending}
            onClick={() =>
              changePriority.mutate({ id: visit.id, priority }, { onSuccess: () => onClose() })
            }
          >
            {t('submitPriority')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function AssessDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const assess = useAssessEmergencyVisit();
  const [assessment, setAssessment] = useState(visit.assessment ?? '');

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('assessTitle')} description={t('assessBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={assess.error} />
          <Field id="assess-notes" label={t('assessmentLabel')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={4}
                value={assessment}
                onChange={(event) => setAssessment(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={assess.isPending}
            onClick={() =>
              assess.mutate(
                { id: visit.id, assessment: assessment.trim() || undefined },
                { onSuccess: () => onClose() },
              )
            }
          >
            {t('submitAssess')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function TreatDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const treat = useTreatEmergencyVisit();
  const [treatment, setTreatment] = useState(visit.treatment ?? '');

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('treatTitle')} description={t('treatBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={treat.error} />
          <Field id="treat-notes" label={t('treatmentLabel')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={4}
                value={treatment}
                onChange={(event) => setTreatment(event.target.value)}
              />
            )}
          </Field>
        </DialogBody>
        <DialogFooter>
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button
            variant="primary"
            disabled={treat.isPending}
            onClick={() =>
              treat.mutate(
                { id: visit.id, treatment: treatment.trim() || undefined },
                { onSuccess: () => onClose() },
              )
            }
          >
            {t('submitTreat')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ObserveDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const observe = useObserveEmergencyVisit();
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      onConfirm={() => observe.mutate({ id: visit.id }, { onSuccess: () => onClose() })}
      title={t('observeConfirmTitle')}
      description={t('observeConfirmBody')}
      confirmLabel={t('confirmObserve')}
      tone="primary"
      pending={observe.isPending}
    />
  );
}

function DischargeDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const discharge = useDischargeEmergencyVisit();
  return (
    <ConfirmDialog
      open
      onOpenChange={(next) => (next ? undefined : onClose())}
      onConfirm={() => discharge.mutate({ id: visit.id }, { onSuccess: () => onClose() })}
      title={t('dischargeConfirmTitle')}
      description={t('dischargeConfirmBody')}
      confirmLabel={t('confirmDischarge')}
      pending={discharge.isPending}
    />
  );
}

function AdmitDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const admit = useAdmitFromEmergency();

  const wards = useWards({ active: true });
  const available = collectBeds(wards.data?.data.rows ?? []).filter(
    (bed) => bed.status === 'AVAILABLE',
  );
  const wardNames = [...new Set(available.map((bed) => bed.wardName))];

  const [bedId, setBedId] = useState('');
  const [diagnosis, setDiagnosis] = useState('');
  const [expected, setExpected] = useState('');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!bedId) {
      setError(t('bedRequired'));
      return;
    }
    admit.mutate(
      {
        id: visit.id,
        bedId,
        provisionalDiagnosis: diagnosis.trim() || undefined,
        expectedDischargeAt: expected ? new Date(`${expected}T00:00:00.000Z`).toISOString() : undefined,
      },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('admitTitle')} description={t('admitBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={admit.error} />
          <Field id="ed-admit-bed" label={t('bed')} required>
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
          <Field id="ed-admit-diagnosis" label={t('provisionalDiagnosis')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={2}
                value={diagnosis}
                onChange={(event) => setDiagnosis(event.target.value)}
              />
            )}
          </Field>
          <Field id="ed-admit-expected" label={t('expectedDischarge')}>
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
          <Button variant="secondary" onClick={onClose}>
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

function ReferDialog({ visit, onClose }: { visit: EmergencyVisitRow; onClose: () => void }) {
  const t = useTranslations('emergency');
  const refer = useReferEmergencyVisit();
  const [referredTo, setReferredTo] = useState(visit.referredTo ?? '');
  const [notes, setNotes] = useState(visit.referralNotes ?? '');
  const [error, setError] = useState<string | null>(null);

  const submit = () => {
    if (!referredTo.trim()) {
      setError(t('referredToRequired'));
      return;
    }
    refer.mutate(
      { id: visit.id, referredTo: referredTo.trim(), referralNotes: notes.trim() || undefined },
      { onSuccess: () => onClose() },
    );
  };

  return (
    <Dialog open onOpenChange={(next) => (next ? undefined : onClose())}>
      <DialogContent>
        <DialogHeader title={t('referTitle')} description={t('referBody')} />
        <DialogBody className="flex flex-col gap-4">
          <ActionAlert error={refer.error} />
          <Field id="refer-destination" label={t('referredToLabel')} required>
            {({ controlId }) => (
              <Input
                id={controlId}
                value={referredTo}
                onChange={(event) => {
                  setReferredTo(event.target.value);
                  if (error) setError(null);
                }}
              />
            )}
          </Field>
          <Field id="refer-notes" label={t('referralNotesLabel')}>
            {({ controlId }) => (
              <Textarea
                id={controlId}
                rows={3}
                value={notes}
                onChange={(event) => setNotes(event.target.value)}
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
          <Button variant="secondary" onClick={onClose}>
            {t('cancel')}
          </Button>
          <Button variant="primary" disabled={refer.isPending} onClick={submit}>
            {t('submitRefer')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ActionAlert({ error }: { error: QueryError | null | undefined }) {
  const t = useTranslations('emergency');
  if (!error) return null;

  if (error.code === 'EMERGENCY_VISIT_CLOSED') {
    return <AlertBlock title={t('conflictClosedTitle')} body={t('conflictClosedBody')} />;
  }
  if (error.code === 'INVALID_WORKFLOW_TRANSITION') {
    return <AlertBlock title={t('conflictTransitionTitle')} body={t('conflictTransitionBody')} />;
  }
  if (error.code === 'BED_UNAVAILABLE') {
    return <AlertBlock title={t('conflictBedTitle')} body={t('conflictBedBody')} />;
  }
  if (error.code === 'ADMISSION_ALREADY_ACTIVE') {
    return <AlertBlock title={t('conflictAdmissionTitle')} body={t('conflictAdmissionBody')} />;
  }
  return <AlertBlock title={t('writeFailed')} body={t('writeFailedBody')} />;
}

function AlertBlock({ title, body }: { title: string; body: string }) {
  return (
    <div role="alert" className="flex flex-col gap-1 border border-status-critical px-4 py-3">
      <h3 className="text-body font-semibold text-status-critical">{title}</h3>
      <p className="text-meta text-secondary">{body}</p>
    </div>
  );
}
