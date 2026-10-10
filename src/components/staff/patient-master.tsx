'use client';

import { useTranslations } from 'next-intl';
import Link from 'next/link';
import { ChevronLeft } from 'lucide-react';
import { useState } from 'react';

import { PatientBanner, type AllergyState } from '@/components/clinical/patient-banner';
import { Timeline, type TimelineEvent } from '@/components/clinical/timeline';
import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { KeyValueGrid, type KeyValueItem } from '@/components/clinical/key-value-grid';
import { Skeleton } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { EmptyState } from '@/components/clinical/empty-state';
import {
  usePatientAccessLog,
  usePatientMaster,
  usePatientTimeline,
  type AccessLogRow,
  type QueryError,
} from '@/lib/data/queries';
import type { AllergyRow, PatientMasterRecord } from '@/lib/data/patients';
import { cn } from '@/lib/cn';

/**
 * Patient master record (F2).
 *
 * `/patients/{id}/master` returns `{ patient, sections }`; the exported document
 * types that body as a plain patient, so the envelope is validated structurally
 * (GAP-013) and a drifted body fails into "record unavailable" rather than a
 * banner a clinician trusts.
 *
 * Tabs reflect the sections reception cares about: summary (contact, guardians,
 * consents, allergies, history), timeline, and access log. The access log is
 * rendered here; the server still decides who may read it.
 *
 * The data comes from the patient registry fixtures, marked EXAMPLE.
 */

type TabId = 'summary' | 'timeline' | 'access-log';

const TONE_BY_STATUS: Record<string, StatusTone> = {
  ACTIVE: 'success',
  MERGED: 'neutral',
  ARCHIVED: 'warning',
};

export function PatientMasterScreen({ id }: { id: string }) {
  const [tab, setTab] = useState<TabId>('summary');

  const master = usePatientMaster(id);
  const timeline = usePatientTimeline(id);
  const accessLog = usePatientAccessLog(id);

  if (master.isPending) {
    return (
      <div className="flex flex-col gap-4">
        <div className="border-b border-border bg-surface px-6 py-4">
          <Skeleton className="h-6 w-72 max-w-full" />
          <Skeleton className="mt-2 h-4 w-96 max-w-full" />
        </div>
        <div className="flex flex-col gap-3 px-6">
          <Skeleton className="h-4 w-40" />
          <Skeleton className="h-24 w-full max-w-2xl" />
        </div>
      </div>
    );
  }

  if (master.error) {
    return <RecordUnavailable error={master.error} />;
  }

  const record = master.data.data;

  return (
    <div className="flex flex-col">
      <PatientBanner patient={bannerFrom(record)} />

      <div className="flex flex-col gap-4 px-6 py-6">
        <TabNav tab={tab} onChange={setTab} />

        {tab === 'summary' ? <SummaryTab record={record} /> : null}
        {tab === 'timeline' ? (
          <TimelineTab events={timelineEvents(timeline.data?.data ?? [])} />
        ) : null}
        {tab === 'access-log' ? (
          <AccessLogTab rows={accessLog.data?.data ?? []} loading={accessLog.isPending} />
        ) : null}
      </div>
    </div>
  );
}

function RecordUnavailable({ error }: { error: QueryError }) {
  const err = useTranslations('error');
  const t = useTranslations('record');
  const isMissing = error.code === 'RESOURCE_NOT_FOUND' || error.status === 404;
  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <h1 className="text-heading font-semibold text-primary">{t('title')}</h1>
      <EmptyState
        headingLevel={2}
        title={isMissing ? err('notFound.title') : err('internal.title')}
        description={isMissing ? err('notFound.body') : err('internal.body')}
        icon={ChevronLeft}
        action={
          <Button variant="secondary" size="sm">
            <Link href="/patients">Back to reception</Link>
          </Button>
        }
      />
    </div>
  );
}

function TabNav({ tab, onChange }: { tab: TabId; onChange: (next: TabId) => void }) {
  const t = useTranslations('record');
  const tabs: readonly { id: TabId; label: string }[] = [
    { id: 'summary', label: t('tabSummary') },
    { id: 'timeline', label: t('tabTimeline') },
    { id: 'access-log', label: t('tabAccessLog') },
  ];
  return (
    <div
      role="tablist"
      aria-label={t('title')}
      className="flex flex-wrap gap-1 border-b border-border"
    >
      {tabs.map((item) => {
        const active = item.id === tab;
        return (
          <button
            key={item.id}
            role="tab"
            id={`tab-${item.id}`}
            aria-selected={active}
            aria-controls={`panel-${item.id}`}
            onClick={() => onChange(item.id)}
            className={cn(
              'border-b-2 px-3 py-2 text-body font-medium transition-colors duration-[--duration-fast]',
              active
                ? 'border-text-strong text-primary'
                : 'border-transparent text-secondary hover:text-primary',
            )}
          >
            {item.label}
          </button>
        );
      })}
    </div>
  );
}

function SummaryTab({ record }: { record: PatientMasterRecord }) {
  const t = useTranslations('record');
  const { patient, sections } = record;

  const contact: readonly KeyValueItem[] = [
    { label: 'Phone', value: patient.phone ?? t('none') },
    { label: 'County', value: patient.county ?? t('none') },
    { label: 'Town', value: patient.town ?? t('none') },
  ];

  return (
    <div
      id="panel-summary"
      role="tabpanel"
      aria-labelledby="tab-summary"
      className="flex flex-col gap-4"
    >
      <section aria-labelledby="summary-contact" className="flex flex-col gap-3">
        <h2 id="summary-contact" className="text-heading-xs font-semibold text-primary">
          {t('summarySections.contact')}
        </h2>
        <KeyValueGrid items={contact} />
      </section>

      <section aria-labelledby="summary-guardians" className="flex flex-col gap-3">
        <h2 id="summary-guardians" className="text-heading-xs font-semibold text-primary">
          {t('summarySections.guardians')}
        </h2>
        {sections.guardians.length === 0 ? (
          <p className="text-meta text-secondary">{t('emptyGuardians')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sections.guardians.map((guardian) => (
              <li key={guardian.id} className="border border-border bg-surface px-4 py-3">
                <p className="text-body font-medium text-primary">
                  {guardian.firstName} {guardian.lastName}
                  {guardian.isEmergencyContact ? (
                    <StatusPill
                      tone="warning"
                      label={t('emergencyContact')}
                      size="sm"
                      className="ml-2"
                    />
                  ) : null}
                </p>
                <p className="text-meta text-secondary">
                  {guardian.relationship}
                  {guardian.phone ? ` · ${guardian.phone}` : ''}
                </p>
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="summary-consents" className="flex flex-col gap-3">
        <h2 id="summary-consents" className="text-heading-xs font-semibold text-primary">
          {t('summarySections.consents')}
        </h2>
        {sections.consents.length === 0 ? (
          <p className="text-meta text-secondary">{t('emptyConsents')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sections.consents.map((consent) => (
              <li
                key={consent.type}
                className="flex items-center gap-2 border border-border bg-surface px-4 py-2"
              >
                <span className="text-body text-primary">{consent.type}</span>
                <StatusPill
                  size="sm"
                  tone={consent.status.toUpperCase() === 'GRANTED' ? 'success' : 'neutral'}
                  label={consent.status.toUpperCase()}
                />
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="summary-allergies" className="flex flex-col gap-3">
        <h2 id="summary-allergies" className="text-heading-xs font-semibold text-primary">
          {t('summarySections.allergies')}
        </h2>
        {sections.allergies.length === 0 ? (
          <p className="text-meta text-secondary">{t('none')}</p>
        ) : (
          <ul className="flex flex-wrap gap-2">
            {sections.allergies.map((allergy) => (
              <li
                key={allergy.substance}
                className="rounded-md border border-status-critical bg-status-critical-bg px-2 py-1 text-caption font-medium text-status-critical"
              >
                {allergy.substance}
                {allergy.severity ? ` · ${allergy.severity.toUpperCase()}` : ''}
              </li>
            ))}
          </ul>
        )}
      </section>

      <section aria-labelledby="summary-history" className="flex flex-col gap-3">
        <h2 id="summary-history" className="text-heading-xs font-semibold text-primary">
          {t('summarySections.medicalHistory')}
        </h2>
        {sections.medicalHistory.length === 0 ? (
          <p className="text-meta text-secondary">{t('emptyMedicalHistory')}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {sections.medicalHistory.map((entry, index) => (
              <li
                key={`${entry.category}-${index}`}
                className="border border-border bg-surface px-4 py-3"
              >
                <p className="text-body font-medium text-primary">
                  {entry.category.replace(/_/g, ' ')}
                </p>
                <p className="text-meta text-secondary">{entry.description}</p>
                {entry.onsetDate ? (
                  <p className="text-caption text-tertiary">Onset {entry.onsetDate}</p>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function TimelineTab({ events }: { events: readonly TimelineEvent[] }) {
  return (
    <div id="panel-timeline" role="tabpanel" aria-labelledby="tab-timeline" className="max-w-2xl">
      <Timeline events={events} timeZone="Africa/Nairobi" />
    </div>
  );
}

function AccessLogTab({ rows, loading }: { rows: readonly AccessLogRow[]; loading: boolean }) {
  const t = useTranslations('record');
  const columns: readonly DataTableColumn<AccessLogRow>[] = [
    {
      key: 'when',
      header: 'When',
      width: '13rem',
      cell: (row) => (
        <span className="tabular-nums text-secondary">{formatWhen(row.createdAt)}</span>
      ),
    },
    { key: 'action', header: 'Action', cell: (row) => row.action },
    { key: 'section', header: 'Section', cell: (row) => row.section },
  ];
  return (
    <div
      id="panel-access-log"
      role="tabpanel"
      aria-labelledby="tab-access-log"
      className="flex flex-col gap-3"
    >
      {rows.length === 0 && !loading ? (
        <p className="text-meta text-secondary">{t('none')}</p>
      ) : (
        <DataTable
          caption="Access log"
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          loading={loading}
          emptyMessage={t('none')}
        />
      )}
    </div>
  );
}

function bannerFrom(record: PatientMasterRecord) {
  const { patient, sections } = record;
  const tone = TONE_BY_STATUS[patient.status] ?? 'neutral';
  return {
    reference: patient.patientNumber || patient.id,
    displayName: patient.displayName,
    dateOfBirth: patient.dateOfBirth ?? 'Date of birth not recorded',
    sex: sexLabel(patient.sex),
    allergies: allergyStateFor(sections.allergies),
    statusLabel: patient.status
      ? patient.status.charAt(0) + patient.status.slice(1).toLowerCase()
      : 'Unknown',
    statusTone: tone as StatusTone,
  };
}

function sexLabel(sex: string | null): string {
  if (sex === 'MALE') return 'Male';
  if (sex === 'FEMALE') return 'Female';
  if (sex === 'OTHER') return 'Other';
  return 'Not recorded';
}

/**
 * Maps the allergies section onto the banner's three-way state. An empty section
 * cannot be taken as "checked and none" — the raw row list carries nothing saying
 * anyone asked — so it becomes `not-recorded`, the most guarded reading.
 */
function allergyStateFor(rows: readonly AllergyRow[]): AllergyState {
  if (rows.length === 0) return { status: 'not-recorded' };
  return {
    status: 'recorded',
    allergies: rows.map((row) => row.substance),
  };
}

function timelineEvents(rows: readonly TimelineEventRowMini[]): readonly TimelineEvent[] {
  return rows.map((row) => ({
    id: row.id,
    timestamp: row.timestamp,
    author: row.author ?? '',
    eventType: 'note' as const,
    summary: row.summary,
    detail: row.detail ?? undefined,
    tag: row.type,
  }));
}

interface TimelineEventRowMini {
  readonly id: string;
  readonly timestamp: string;
  readonly summary: string;
  readonly detail: string | null;
  readonly author: string | null;
  readonly type: string;
}

function formatWhen(value: string): string {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toISOString().slice(0, 16).replace('T', ' ');
}
