'use client';

import { useTranslations } from 'next-intl';

import { usePortalMe } from '@/lib/data/queries';
import type { PortalPatient, PortalPatientStatus } from '@/lib/data/portal';

/**
 * Portal profile `GET /portal/me`.
 *
 * Read-only demographics, exactly the allowlist `toPublicPatient` projects
 * upstream — no clinical data ever reaches this screen, by construction. The
 * body is validated in `src/lib/data/portal.ts`, so a drifted response shows the
 * error state rather than a half-filled record a patient could read as the
 * clinic's record of them.
 *
 * Dates are formatted with `Intl` and pinned to UTC: a birth date is a calendar
 * date, and rendering it in the browser's zone is how a `2026-01-01` becomes
 * `2025-12-31` west of Greenwich. No `Date.now()` in render, so the server and
 * client agree.
 */

const STATUS_KEYS: Record<PortalPatientStatus, string> = {
  ACTIVE: 'active',
  MERGED: 'merged',
  ARCHIVED: 'archived',
};

export function PortalProfile() {
  const t = useTranslations('portal');
  const query = usePortalMe();

  return (
    <section aria-labelledby="portal-profile-title" className="flex flex-col gap-6">
      <header>
        <h1 id="portal-profile-title" className="text-heading-sm font-semibold text-primary">
          {t('profile.title')}
        </h1>
        <p className="mt-1 text-body text-secondary">{t('profile.description')}</p>
      </header>

      {query.isPending ? (
        <p role="status" className="text-body text-secondary">
          {t('profile.loading')}
        </p>
      ) : query.isError || !query.data ? (
        <p
          role="alert"
          className="rounded-lg border border-status-critical bg-surface px-4 py-3 text-body text-status-critical"
        >
          {t('profile.error')}
        </p>
      ) : (
        <PatientDetails patient={query.data.data} />
      )}
    </section>
  );
}

function PatientDetails({ patient }: { patient: PortalPatient }) {
  const t = useTranslations('portal');
  const missing = t('profile.notRecorded');

  const fullName = [patient.firstName, patient.lastName].filter(Boolean).join(' ');

  return (
    <dl className="grid grid-cols-1 gap-x-8 gap-y-4 rounded-lg border border-border bg-surface p-6 sm:grid-cols-2">
      <Detail label={t('profile.patientNumber')} value={patient.patientNumber} />
      <Detail label={t('profile.name')} value={fullName} />
      <Detail
        label={t('profile.dateOfBirth')}
        value={patient.dateOfBirth ? formatCalendar(patient.dateOfBirth) : null}
        missing={missing}
      />
      <Detail label={t('profile.status')} value={t(`status.${STATUS_KEYS[patient.status]}`)} />
      <Detail label={t('profile.phone')} value={patient.phone} missing={missing} />
      <Detail label={t('profile.email')} value={patient.email} missing={missing} />
      <Detail
        label={t('profile.registered')}
        value={formatInstant(patient.createdAt)}
      />
    </dl>
  );
}

function Detail({
  label,
  value,
  missing,
}: {
  label: string;
  value: string | null;
  missing?: string;
}) {
  return (
    <div>
      <dt className="text-meta font-medium text-secondary">{label}</dt>
      <dd className="mt-0.5 text-body text-primary">
        {value ? value : <span className="text-tertiary">{missing ?? '—'}</span>}
      </dd>
    </div>
  );
}

/** Formats a `YYYY-MM-DD` calendar date without letting the browser's zone move it. */
function formatCalendar(value: string): string {
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}

/** Formats an ISO instant as a UTC date — stable between server and client. */
function formatInstant(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return value;
  return new Intl.DateTimeFormat(undefined, {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
    timeZone: 'UTC',
  }).format(parsed);
}
