'use client';

import { useMemo, useState } from 'react';

import { DataTable, type DataTableColumn } from '@/components/staff/data-table';
import { StatusPill, type StatusTone } from '@/components/staff/status-pill';
import { Badge } from '@/components/ui';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/field';
import { TRIAGE_ROWS } from '@/mocks/fixtures/triage';
import { cn } from '@/lib/cn';

/**
 * Triage queue.
 *
 * Fitted with EXAMPLE fixtures rather than a live query. The queue endpoint is not
 * in the contract (`GET /triage/queue`, GAP-010), and rendering an empty screen
 * against an endpoint that does not exist would prove nothing about the design.
 * What this does establish is the shape of the screen: column order, density,
 * status treatment, and how a row behaves at realistic text lengths — which is
 * the part worth reviewing before the contract catches up.
 *
 * The ordering here is the clinical one: time waited first, because that is what a
 * clinician triaging a queue is actually working through.
 */

const TONE_BY_WAIT: { maxMinutes: number; tone: StatusTone; label: string }[] = [
  { maxMinutes: 15, tone: 'critical', label: 'Overdue' },
  { maxMinutes: 60, tone: 'warning', label: 'Waiting' },
  { maxMinutes: Infinity, tone: 'info', label: 'Queued' },
];

function toneFor(waitMinutes: number) {
  return (
    TONE_BY_WAIT.find((band) => waitMinutes <= band.maxMinutes) ?? {
      tone: 'info' as StatusTone,
      label: 'Queued',
    }
  );
}

export function TriageQueueScreen() {
  const [query, setQuery] = useState('');

  const rows = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return TRIAGE_ROWS;
    return TRIAGE_ROWS.filter((row) =>
      [row.reference, row.patientName, row.reason].some((field) =>
        field.toLowerCase().includes(needle),
      ),
    );
  }, [query]);

  const columns: readonly DataTableColumn<(typeof TRIAGE_ROWS)[number]>[] = [
    {
      key: 'wait',
      header: 'Waited',
      width: '7rem',
      numeric: true,
      cell: (row) => {
        const band = toneFor(row.waitMinutes);
        // The figure and the word are both present on purpose: the pill states the
        // band, the number states the fact, and neither has to be inferred from
        // the other's colour.
        return (
          <span className="flex items-center justify-end gap-2">
            <span className="tabular-nums text-primary">{row.waitLabel}</span>
            <StatusPill tone={band.tone} label={band.label} size="sm" />
          </span>
        );
      },
    },
    { key: 'reference', header: 'Reference', width: '9rem', cell: (row) => row.reference },
    { key: 'patient', header: 'Patient', cell: (row) => row.patientName },
    {
      key: 'reason',
      header: 'Presenting reason',
      cell: (row) => <span className="text-secondary">{row.reason}</span>,
    },
    {
      key: 'acuity',
      header: 'Acuity',
      width: '7rem',
      cell: (row) => <Badge tone={row.acuityTone}>{row.acuityLabel}</Badge>,
    },
    {
      key: 'status',
      header: 'Status',
      width: '10rem',
      cell: (row) => <StatusPill tone={row.statusTone} label={row.statusLabel} size="sm" />,
    },
  ];

  return (
    <div className="flex flex-col gap-4 px-6 py-6">
      <header className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="text-heading font-semibold text-primary">Triage queue</h1>
          <p className="text-meta text-secondary">
            Ordered by time waited. Fixture data — no patient records.
          </p>
        </div>
        <div className="flex items-end gap-2">
          <div className="w-64">
            <label htmlFor="triage-search" className="mb-1 block text-meta text-secondary">
              Filter queue
            </label>
            <Input
              id="triage-search"
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              placeholder="Reference, patient or reason"
              type="search"
            />
          </div>
          <Button variant="secondary">Refresh</Button>
        </div>
      </header>

      {/* Announced on change so a filter result is not silent for a screen reader. */}
      <p role="status" aria-live="polite" className={cn('text-meta text-tertiary')}>
        {rows.length} {rows.length === 1 ? 'entry' : 'entries'}
        {query.trim() ? ` matching “${query.trim()}”` : ''}
      </p>

      <DataTable
        caption="Triage queue, ordered by time waited"
        columns={columns}
        rows={rows}
        rowKey={(row) => row.reference}
        rowHref={(row) => `/triage/${row.reference}`}
        rowLinkLabel={(row) => `open ${row.reference}`}
        loading={false}
        emptyMessage="No entries match that filter."
      />
    </div>
  );
}
