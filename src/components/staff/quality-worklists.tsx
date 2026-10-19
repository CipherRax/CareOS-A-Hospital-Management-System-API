'use client';

import { ClipboardList, MessageSquareText, TriangleAlert } from 'lucide-react';
import { useLocale, useTranslations } from 'next-intl';
import { useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/clinical/data-table';
import { EmptyState } from '@/components/clinical/empty-state';
import { StatusPill, type StatusTone } from '@/components/clinical/status-pill';
import { Field, Select } from '@/components/ui/field';
import {
  COMPLAINT_STATUSES,
  FEEDBACK_CATEGORIES,
  FEEDBACK_STATUSES,
  INCIDENT_CATEGORIES,
  INCIDENT_SEVERITIES,
  INCIDENT_STATUSES,
  type ComplaintRow,
  type ComplaintStatus,
  type FeedbackCategory,
  type FeedbackRow,
  type FeedbackStatus,
  type IncidentCategory,
  type IncidentRow,
  type IncidentSeverity,
  type IncidentStatus,
} from '@/lib/data/quality';
import { useComplaintsList, useFeedbackList, useIncidentsList } from '@/lib/data/queries';

/**
 * Quality worklists (brief Phase 10) — feedback, complaints and incidents, each
 * filtered by the axis an officer actually triages on.
 *
 * Every list endpoint in this family mis-types its 200 (the item response DTO, or
 * the request query DTO) while the service answers a `PageResult` (GAP-020
 * family), so rows are validated structurally in `src/lib/data/quality.ts`. These
 * desks list one page: the API's default page size is 20 and there is no pager in
 * the app yet (see docs/limitations.md).
 *
 * Complaints are shown by assignment *state* — "Assigned" or "Unassigned" — not by
 * assignee name. Naming the assignee needs a staff-directory read keyed by id,
 * which this desk does not make; a name resolved from a different page of a
 * different module would be exactly the kind of half-truth that misleads a
 * reviewer. The detail view will name it.
 */

function formatUtc(iso: string | null, locale: string): string | null {
  if (!iso) return null;
  return new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(
    new Date(iso),
  );
}

const FEEDBACK_TONE: Record<FeedbackStatus, StatusTone> = {
  NEW: 'info',
  ACKNOWLEDGED: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

const COMPLAINT_TONE: Record<ComplaintStatus, StatusTone> = {
  OPEN: 'critical',
  ASSIGNED: 'info',
  INVESTIGATING: 'warning',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

const INCIDENT_TONE: Record<IncidentStatus, StatusTone> = {
  OPEN: 'critical',
  INVESTIGATING: 'warning',
  ACTION_PLAN: 'info',
  RESOLVED: 'success',
  CLOSED: 'neutral',
};

const SEVERITY_TONE: Record<IncidentSeverity, StatusTone> = {
  LOW: 'neutral',
  MEDIUM: 'info',
  HIGH: 'warning',
  CRITICAL: 'critical',
};

interface FilterOption {
  readonly value: string;
  readonly label: string;
}

/** One labelled "all + options" filter select, shared by the three desks. */
function SelectFilter({
  id,
  label,
  allLabel,
  value,
  onChange,
  options,
}: {
  id: string;
  label: string;
  allLabel: string;
  value: string;
  onChange: (value: string) => void;
  options: readonly FilterOption[];
}) {
  return (
    <div className="w-56">
      <Field id={id} label={label}>
        {({ controlId }) => (
          <Select id={controlId} value={value} onChange={(event) => onChange(event.target.value)}>
            <option value="">{allLabel}</option>
            {options.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </Select>
        )}
      </Field>
    </div>
  );
}

function WorklistHeader({ title, intro }: { title: string; intro: string }) {
  return (
    <header>
      <h1 className="text-heading font-semibold text-primary">{title}</h1>
      <p className="text-meta text-secondary">{intro}</p>
    </header>
  );
}

// ─── Feedback ─────────────────────────────────────────────────────────────────

export function FeedbackWorklistScreen() {
  const t = useTranslations('quality.feedback');
  const locale = useLocale();
  const [status, setStatus] = useState<FeedbackStatus | ''>('');
  const [category, setCategory] = useState<FeedbackCategory | ''>('');

  const feedback = useFeedbackList({
    status: status || undefined,
    category: category || undefined,
  });
  const rows = feedback.data?.data.rows ?? [];

  const columns: readonly DataTableColumn<FeedbackRow>[] = [
    {
      key: 'category',
      header: t('columnCategory'),
      cell: (row) => <span className="text-primary">{t(`category.${row.category}`)}</span>,
    },
    {
      key: 'rating',
      header: t('columnRating'),
      numeric: true,
      cell: (row) => (
        <span className="tabular-nums text-primary">{t('ratingValue', { rating: row.rating })}</span>
      ),
    },
    {
      key: 'comment',
      header: t('columnComment'),
      cell: (row) =>
        row.comment ? (
          <span className="block max-w-[40ch] truncate text-secondary" title={row.comment}>
            {row.comment}
          </span>
        ) : (
          <span className="text-tertiary">{t('noComment')}</span>
        ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={FEEDBACK_TONE[row.status]} label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: 'submitted',
      header: t('columnSubmitted'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatUtc(row.createdAt, locale) ?? t('unknownDate')}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <WorklistHeader title={t('pageTitle')} intro={t('pageIntro')} />

      <div className="flex flex-wrap items-end gap-4">
        <SelectFilter
          id="feedback-status-filter"
          label={t('filterStatus')}
          allLabel={t('allStatuses')}
          value={status}
          onChange={(value) => setStatus(value as FeedbackStatus | '')}
          options={FEEDBACK_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
        />
        <SelectFilter
          id="feedback-category-filter"
          label={t('filterCategory')}
          allLabel={t('allCategories')}
          value={category}
          onChange={(value) => setCategory(value as FeedbackCategory | '')}
          options={FEEDBACK_CATEGORIES.map((value) => ({ value, label: t(`category.${value}`) }))}
        />
      </div>

      {feedback.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={MessageSquareText}
          headingLevel={2}
        />
      ) : (
        <DataTable<FeedbackRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          scrollable
          loading={feedback.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

// ─── Complaints ───────────────────────────────────────────────────────────────

export function ComplaintsWorklistScreen() {
  const t = useTranslations('quality.complaints');
  const locale = useLocale();
  const [status, setStatus] = useState<ComplaintStatus | ''>('');

  const complaints = useComplaintsList({ status: status || undefined });
  const rows = complaints.data?.data.rows ?? [];

  const columns: readonly DataTableColumn<ComplaintRow>[] = [
    {
      key: 'category',
      header: t('columnCategory'),
      cell: (row) => <span className="text-primary">{row.category}</span>,
    },
    {
      key: 'origin',
      header: t('columnOrigin'),
      cell: (row) => <span className="text-secondary">{t(`origin.${row.origin}`)}</span>,
    },
    {
      key: 'assigned',
      header: t('columnAssigned'),
      cell: (row) =>
        row.assignedToId ? (
          <span className="text-secondary">{t('assigned')}</span>
        ) : (
          <span className="text-tertiary">{t('unassigned')}</span>
        ),
    },
    {
      key: 'due',
      header: t('columnDue'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatUtc(row.dueAt, locale) ?? t('noDue')}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={COMPLAINT_TONE[row.status]} label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: 'submitted',
      header: t('columnSubmitted'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatUtc(row.createdAt, locale) ?? t('unknownDate')}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <WorklistHeader title={t('pageTitle')} intro={t('pageIntro')} />

      <SelectFilter
        id="complaints-status-filter"
        label={t('filterStatus')}
        allLabel={t('allStatuses')}
        value={status}
        onChange={(value) => setStatus(value as ComplaintStatus | '')}
        options={COMPLAINT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
      />

      {complaints.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={ClipboardList}
          headingLevel={2}
        />
      ) : (
        <DataTable<ComplaintRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          scrollable
          loading={complaints.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}

// ─── Incidents ────────────────────────────────────────────────────────────────

export function IncidentsWorklistScreen() {
  const t = useTranslations('quality.incidents');
  const locale = useLocale();
  const [status, setStatus] = useState<IncidentStatus | ''>('');
  const [severity, setSeverity] = useState<IncidentSeverity | ''>('');
  const [category, setCategory] = useState<IncidentCategory | ''>('');

  const incidents = useIncidentsList({
    status: status || undefined,
    severity: severity || undefined,
    category: category || undefined,
  });
  const rows = incidents.data?.data.rows ?? [];

  const columns: readonly DataTableColumn<IncidentRow>[] = [
    {
      key: 'category',
      header: t('columnCategory'),
      cell: (row) => <span className="text-primary">{t(`category.${row.category}`)}</span>,
    },
    {
      key: 'severity',
      header: t('columnSeverity'),
      cell: (row) => (
        <StatusPill size="sm" tone={SEVERITY_TONE[row.severity]} label={t(`severity.${row.severity}`)} />
      ),
    },
    {
      key: 'description',
      header: t('columnDescription'),
      cell: (row) => (
        <span className="block max-w-[48ch] truncate text-secondary" title={row.description}>
          {row.description}
        </span>
      ),
    },
    {
      key: 'status',
      header: t('columnStatus'),
      cell: (row) => (
        <StatusPill size="sm" tone={INCIDENT_TONE[row.status]} label={t(`status.${row.status}`)} />
      ),
    },
    {
      key: 'reported',
      header: t('columnReported'),
      cell: (row) => (
        <span className="whitespace-nowrap tabular-nums text-secondary">
          {formatUtc(row.createdAt, locale) ?? t('unknownDate')}
        </span>
      ),
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <WorklistHeader title={t('pageTitle')} intro={t('pageIntro')} />

      <div className="flex flex-wrap items-end gap-4">
        <SelectFilter
          id="incidents-status-filter"
          label={t('filterStatus')}
          allLabel={t('allStatuses')}
          value={status}
          onChange={(value) => setStatus(value as IncidentStatus | '')}
          options={INCIDENT_STATUSES.map((value) => ({ value, label: t(`status.${value}`) }))}
        />
        <SelectFilter
          id="incidents-severity-filter"
          label={t('filterSeverity')}
          allLabel={t('allSeverities')}
          value={severity}
          onChange={(value) => setSeverity(value as IncidentSeverity | '')}
          options={INCIDENT_SEVERITIES.map((value) => ({ value, label: t(`severity.${value}`) }))}
        />
        <SelectFilter
          id="incidents-category-filter"
          label={t('filterCategory')}
          allLabel={t('allCategories')}
          value={category}
          onChange={(value) => setCategory(value as IncidentCategory | '')}
          options={INCIDENT_CATEGORIES.map((value) => ({ value, label: t(`category.${value}`) }))}
        />
      </div>

      {incidents.error ? (
        <EmptyState
          title={t('unavailableTitle')}
          description={t('unavailableBody')}
          icon={TriangleAlert}
          headingLevel={2}
        />
      ) : (
        <DataTable<IncidentRow>
          caption={t('tableCaption')}
          columns={columns}
          rows={rows}
          rowKey={(row) => row.id}
          scrollable
          loading={incidents.isLoading}
          emptyMessage={t('empty')}
        />
      )}
    </div>
  );
}
