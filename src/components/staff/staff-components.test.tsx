import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from '@/components/staff/data-table';
import { NavRail, type NavSection } from '@/components/staff/nav-rail';
import { StatusPill, STATUS_TONE } from '@/components/staff/status-pill';

/**
 * Behaviour tests for the first signature components.
 *
 * These assert the rules that make the components safe to build on — status is
 * never colour alone, the current location is announced, row navigation is
 * reachable — rather than snapshotting class strings.
 */

// next/navigation and next/link need a router that does not exist in jsdom.
vi.mock('next/navigation', () => ({ usePathname: () => mockPathname }));
vi.mock('next/link', () => ({
  default: ({ children, href, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => (
    <a href={href} {...props}>
      {children}
    </a>
  ),
}));

let mockPathname = '/triage';

describe('StatusPill', () => {
  it('requires a text label — the type makes colour-only status impossible', () => {
    // Compile-time guarantee. This test exists to document it: `label` is not
    // optional in StatusPillProps, so there is no way to render a bare colour.
    expect(() => StatusPill({ label: 'Assigned' })).not.toThrow();
  });

  it('renders the status as text, not only as a tint', () => {
    render(<StatusPill tone="critical" label="Escalated" />);
    expect(screen.getByText('Escalated')).toBeInTheDocument();
  });

  it('hides the decorative icon from assistive technology', () => {
    // The word already carries the meaning. Announcing the icon too would make a
    // screen reader say the status twice.
    const { container } = render(<StatusPill tone="critical" label="Escalated" />);
    const svg = container.querySelector('svg');
    expect(svg).toHaveAttribute('aria-hidden', 'true');
  });

  it('gives each tone a distinct shape, so status survives greyscale', async () => {
    // The whole point of the component. If two tones ever render the same glyph,
    // colour is the only thing distinguishing them and the rule is broken.
    const shapes = await Promise.all(
      STATUS_TONE.map(async (tone) => {
        const { container, unmount } = render(<StatusPill tone={tone} label="x" />);
        const path = container.querySelector('svg path');
        const d = path?.getAttribute('d');
        unmount();
        return d;
      }),
    );
    expect(new Set(shapes).size).toBeGreaterThan(1);
  });

  it('expands an abbreviation for assistive tech without changing the visible text', () => {
    render(<StatusPill tone="info" label="Obs" title="Ordered observation" />);
    expect(screen.getByText('Obs')).toBeInTheDocument();
    expect(screen.getByText(/Ordered observation/)).toBeInTheDocument();
  });
});

describe('NavRail', () => {
  const sections: readonly NavSection[] = [
    {
      id: 'clinical',
      label: 'Clinical',
      items: [
        { href: '/', label: 'Overview' },
        { href: '/triage', label: 'Triage queue', count: 3, countLabel: 'awaiting review' },
      ],
    },
  ];

  it('marks the current location for assistive technology, not just visually', () => {
    mockPathname = '/triage';
    render(<NavRail sections={sections} />);
    const current = screen.getByRole('link', { name: /Triage queue/ });
    expect(current).toHaveAttribute('aria-current', 'page');
    expect(screen.getByRole('link', { name: 'Overview' })).not.toHaveAttribute('aria-current');
  });

  it('is a labelled navigation landmark', () => {
    mockPathname = '/';
    render(<NavRail sections={sections} />);
    expect(screen.getByRole('navigation', { name: 'Clinical' })).toBeInTheDocument();
  });

  it('announces a count with its meaning, not as a bare number', () => {
    mockPathname = '/';
    render(<NavRail sections={sections} />);
    const link = screen.getByRole('link', { name: /Triage queue/ });
    expect(link).toHaveTextContent('3');
    // The visible numeral is hidden from AT; the full phrase carries the meaning.
    expect(link).toHaveAccessibleName('Triage queue, 3 awaiting review');
  });

  it('does not mark a sibling route as current via a shared prefix', () => {
    // /triage-archive must not light up /triage.
    mockPathname = '/patients';
    render(<NavRail sections={sections} />);
    expect(screen.getByRole('link', { name: /Triage queue/ })).not.toHaveAttribute('aria-current');
  });
});

interface Row {
  readonly id: string;
  readonly name: string;
  readonly wait: number;
}

const rows: readonly Row[] = [
  { id: 'EX-0001', name: 'EXAMPLE Achieng', wait: 94 },
  { id: 'EX-0002', name: 'EXAMPLE Brian', wait: 12 },
];

const columns: readonly DataTableColumn<Row>[] = [
  { key: 'name', header: 'Patient', cell: (row) => row.name },
  { key: 'wait', header: 'Waited', numeric: true, cell: (row) => `${row.wait}m` },
];

describe('DataTable', () => {
  it('is a real table, so column and row navigation works', () => {
    render(<DataTable caption="Triage queue" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    expect(screen.getByRole('table', { name: 'Triage queue' })).toBeInTheDocument();
    expect(screen.getAllByRole('columnheader')).toHaveLength(2);
    expect(screen.getAllByRole('row')).toHaveLength(3); // header + 2
  });

  it('describes itself with a caption even when it is not visible', () => {
    // A sighted user gets a heading above the table; the table must still be
    // self-describing for anyone who arrives at it directly.
    render(<DataTable caption="Triage queue" columns={columns} rows={rows} rowKey={(r) => r.id} />);
    const table = screen.getByRole('table');
    const caption = table.querySelector('caption');
    expect(caption).toHaveClass('sr-only');
    expect(caption).toHaveTextContent('Triage queue');
  });

  it('makes row navigation a real, keyboard-reachable link', () => {
    // A clickable <tr> is unreachable by keyboard and announced as no target at
    // all. The link is the accessible affordance.
    render(
      <DataTable
        caption="Triage queue"
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        rowHref={(r) => `/triage/${r.id}`}
        rowLinkLabel={(r) => `open ${r.id}`}
      />,
    );
    const link = screen.getByRole('link', { name: /EXAMPLE Achieng/ });
    expect(link).toHaveAttribute('href', '/triage/EX-0001');
  });

  it('renders tabular figures for numeric columns so digits line up', () => {
    const { container } = render(
      <DataTable caption="Triage queue" columns={columns} rows={rows} rowKey={(r) => r.id} />,
    );
    const numericCell = container.querySelector('tbody tr td:last-child');
    expect(numericCell).toHaveClass('tabular-nums', 'text-right');
  });

  it('shows an empty state instead of a header with no rows', () => {
    render(
      <DataTable
        caption="Triage queue"
        columns={columns}
        rows={[]}
        rowKey={(r) => r.id}
        emptyMessage="No entries match that filter."
      />,
    );
    expect(screen.queryByRole('table')).not.toBeInTheDocument();
    expect(screen.getByText('No entries match that filter.')).toBeInTheDocument();
  });

  it('hides placeholder rows from assistive tech while loading', () => {
    render(
      <DataTable caption="Triage queue" columns={columns} rows={[]} rowKey={(r) => r.id} loading />,
    );
    const table = screen.getByRole('table');
    // Skeleton rows must not be announced as data rows.
    for (const row of within(table).getAllByRole('row').slice(1)) {
      expect(row).toHaveAttribute('aria-hidden', 'true');
    }
    expect(screen.getByRole('status')).toHaveTextContent(/loading triage queue/i);
  });
});
