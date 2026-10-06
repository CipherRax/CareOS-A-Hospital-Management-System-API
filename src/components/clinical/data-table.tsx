'use client';

import Link from 'next/link';

import { Skeleton } from '@/components/ui';
import { cn } from '@/lib/cn';

/**
 * DataTable.
 *
 * Built as a real `<table>` with a `<caption>`, not a grid of divs. A triage queue
 * is scanned by comparing values down a column, and screen-reader users navigate
 * it by column and announce "row 3, column 4". Any `role="grid"` reconstruction
 * throws that away and has to reimplement it badly.
 *
 * Density over decoration: row rules and whitespace separate rows, with no zebra
 * striping. Striping fights the status tint a row may already carry, and it is one
 * more thing to read past before reaching the data.
 *
 * The table scrolls horizontally in its own container rather than being squeezed,
 * because a truncated clinical value is a safety problem.
 *
 * Row navigation is a real link, not an `onClick` on the `<tr>`. A clickable row
 * is unreachable by keyboard and unannounced as a target, which is precisely the
 * kind of thing that passes review and then strands a keyboard user. The link
 * carries a stretched pseudo-element so the whole row is the hit area for a mouse,
 * and it stays a single, correctly-labelled tab stop.
 */

export interface DataTableColumn<T> {
  readonly key: string;
  readonly header: React.ReactNode;
  /** Right-aligned for figures, and rendered tabular so digits line up. */
  readonly numeric?: boolean;
  readonly width?: string;
  readonly cell: (row: T) => React.ReactNode;
}

export interface DataTableProps<T> {
  /** Describes the table for someone arriving by screen reader. Required. */
  caption: string;
  columns: readonly DataTableColumn<T>[];
  rows: readonly T[];
  rowKey: (row: T) => string;
  /**
   * Destination for the row. When present the first column's content is wrapped in
   * a stretched link, so the whole row is clickable for a mouse while remaining a
   * single, keyboard-reachable link.
   */
  rowHref?: (row: T) => string;
  /** Names the row's link. Defaults to the row key, which is rarely readable. */
  rowLinkLabel?: (row: T) => string;
  /** Announced while loading, and rendered instead of an empty table. */
  loading?: boolean;
  loadingRowCount?: number;
  emptyMessage?: string;
  captionVisible?: boolean;
  className?: string;
}

export function DataTable<T>({
  caption,
  columns,
  rows,
  rowKey,
  rowHref,
  rowLinkLabel,
  loading = false,
  loadingRowCount = 6,
  emptyMessage = 'Nothing to show.',
  captionVisible = false,
  className,
}: DataTableProps<T>) {
  if (loading) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface', className)}>
        <table className="w-full border-collapse">
          <caption
            className={cn(
              'px-4 py-3 text-left text-meta text-secondary',
              captionVisible && 'sr-only',
            )}
          >
            {caption}
          </caption>
          <thead>
            <tr>
              {columns.map((column) => (
                <th
                  key={column.key}
                  scope="col"
                  style={column.width ? { width: column.width } : undefined}
                  className={cn(
                    'border-b border-strong px-4 py-2 text-meta font-medium text-secondary',
                    column.numeric && 'text-right',
                  )}
                >
                  {column.header}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: loadingRowCount }, (_, rowIndex) => (
              // Placeholder rows, not real data, so a loading table cannot be
              // mistaken for a short one.
              <tr key={`skeleton-${rowIndex}`} aria-hidden="true">
                {columns.map((column) => (
                  <td key={column.key} className="border-b border-border px-4 py-3">
                    <Skeleton className="h-4 w-3/4" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {/* Announced once, politely: the row count is changing underneath. */}
        <p role="status" aria-live="polite" className="px-4 py-3 text-meta text-secondary">
          Loading {caption.toLowerCase()}
        </p>
      </div>
    );
  }

  if (rows.length === 0) {
    return (
      <div className={cn('rounded-lg border border-border bg-surface', className)}>
        <p className="px-4 py-8 text-center text-body text-secondary">{emptyMessage}</p>
      </div>
    );
  }

  return (
    <div className={cn('overflow-x-auto rounded-lg border border-border bg-surface', className)}>
      <table className="w-full border-collapse">
        {/* Visually hidden by default: sighted users get the heading above the
            table, but the table must still be self-describing. */}
        <caption
          className={cn(
            'px-4 py-3 text-left text-meta text-secondary',
            !captionVisible && 'sr-only',
          )}
        >
          {caption}
        </caption>
        <thead>
          <tr>
            {columns.map((column) => (
              <th
                key={column.key}
                scope="col"
                style={column.width ? { width: column.width } : undefined}
                className={cn(
                  'border-b border-strong px-4 py-2 text-left text-meta font-medium text-secondary',
                  column.numeric && 'text-right',
                )}
              >
                {column.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr
              key={rowKey(row)}
              className={cn(
                'relative border-b border-border last:border-b-0',
                rowHref && 'hover:bg-surface-hover',
              )}
            >
              {columns.map((column, columnIndex) => {
                const content = column.cell(row);
                // The first column carries the row's link, so the link is read
                // before the rest of the row's values.
                const isLinkCell = Boolean(rowHref) && columnIndex === 0;

                return (
                  <td
                    key={column.key}
                    className={cn(
                      'px-4 py-3 text-body text-primary',
                      column.numeric && 'text-right tabular-nums',
                    )}
                  >
                    {isLinkCell && rowHref ? (
                      <Link
                        href={rowHref(row)}
                        className={cn(
                          'font-medium underline-offset-2 hover:underline',
                          // Covers the row for pointer users without adding a
                          // second tab stop or wrapping other cells.
                          'after:absolute after:inset-0 after:content-[""]',
                        )}
                      >
                        {content}
                        <span className="sr-only">
                          {rowLinkLabel ? ` — ${rowLinkLabel(row)}` : ''}
                        </span>
                      </Link>
                    ) : (
                      content
                    )}
                  </td>
                );
              })}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
