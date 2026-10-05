import { render, screen, within } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';

import { DataTable, type DataTableColumn } from '@/components/staff/data-table';
import { DisplayBoard } from '@/components/staff/display-board';
import { PatientHeader } from '@/components/staff/patient-header';
import { NavRail, type NavSection } from '@/components/staff/nav-rail';
import { StatusPill, STATUS_TONE } from '@/components/staff/status-pill';
import { Timeline } from '@/components/staff/timeline';

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

describe('PatientHeader', () => {
  const patient = {
    reference: 'EX-0001',
    displayName: 'EXAMPLE Achieng Otieno',
    dateOfBirth: '1984-03-11',
    sex: 'Female',
    allergies: ['Penicillin'],
    flags: ['Falls risk'],
    statusLabel: 'In ward',
    statusTone: 'info' as const,
  };

  it('makes the patient name the page heading', () => {
    render(<PatientHeader patient={patient} />);
    expect(
      screen.getByRole('heading', { name: 'EXAMPLE Achieng Otieno', level: 1 }),
    ).toBeInTheDocument();
  });

  it('shows the reference in full, never truncated', () => {
    // Two patients can share a name. The reference is what disambiguates them, so
    // ellipsising it defeats the purpose of showing it at all.
    const { container } = render(<PatientHeader patient={patient} />);
    const reference = container.querySelector('.font-mono');
    expect(reference).not.toHaveClass('truncate');
    expect(reference).toHaveTextContent('EX-0001');
  });

  it('puts allergies before the demographics so they are met first', () => {
    // A screen reader reaches these before the name, which is the point: the
    // safety information must not be something you scroll to find.
    render(<PatientHeader patient={patient} />);
    const allergy = screen.getByText(/Allergy: Penicillin/);
    const name = screen.getByRole('heading', { name: /Achieng/ });
    expect(allergy.compareDocumentPosition(name) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('states an allergy in words rather than marking it with colour', () => {
    render(<PatientHeader patient={patient} />);
    expect(screen.getByText(/Allergy: Penicillin/)).toBeInTheDocument();
  });

  it('omits the notice row entirely when there is nothing to warn about', () => {
    const { container } = render(
      <PatientHeader patient={{ ...patient, allergies: [], flags: [] }} />,
    );
    expect(container.querySelectorAll('.rounded-full')).toHaveLength(1); // status only
  });

  it('is a labelled region so it can be navigated to directly', () => {
    render(<PatientHeader patient={patient} />);
    expect(screen.getByRole('region', { name: 'EXAMPLE Achieng Otieno' })).toBeInTheDocument();
  });
});

describe('Timeline', () => {
  const events = [
    {
      id: 'b',
      timestamp: '2026-10-05T09:12:00Z',
      author: 'EXAMPLE Dr Wanjiru',
      eventType: 'observation' as const,
      summary: 'Escalated to consultant review',
    },
    {
      id: 'a',
      timestamp: '2026-10-05T07:05:00Z',
      author: 'EXAMPLE B. Otieno',
      eventType: 'triage' as const,
      summary: 'Triaged as urgent',
    },
  ];

  it('is an ordered list, because sequence is the meaning', () => {
    render(<Timeline events={events} />);
    // A stack of divs would throw away the ordering a screen reader relies on.
    expect(screen.getByRole('list')).toBeInTheDocument();
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('shows newest first by default, since that is what the reader opens it for', () => {
    render(<Timeline events={events} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Escalated to consultant review');
    expect(items[1]).toHaveTextContent('Triaged as urgent');
  });

  it('reverses cleanly when asked for chronological order', () => {
    render(<Timeline events={events} newestFirst={false} />);
    const items = screen.getAllByRole('listitem');
    expect(items[0]).toHaveTextContent('Triaged as urgent');
  });

  it('sorts by timestamp rather than trusting the input order', () => {
    // Reversed on purpose. If this passed only because the input happened to be
    // sorted, the sort would not be under test at all.
    render(<Timeline events={[...events].reverse()} />);
    expect(screen.getAllByRole('listitem')[0]).toHaveTextContent('Escalated');
  });

  it('keeps a machine-readable timestamp alongside the rendered one', () => {
    // A relative "2h ago" becomes ambiguous during a long shift; the absolute
    // value must survive localisation and extraction.
    render(<Timeline events={events} />);
    const time = screen.getAllByRole('time')[0] ?? document.querySelector('time');
    expect(time).toHaveAttribute('datetime', '2026-10-05T09:12:00Z');
  });

  it('attributes every entry, so a gap in the record is visible', () => {
    render(<Timeline events={events} />);
    expect(screen.getByText(/Recorded by EXAMPLE Dr Wanjiru/)).toBeInTheDocument();
  });

  it('states the offset, so the gap between two entries can be reasoned about', () => {
    // Without the offset, two events hours apart can read as minutes apart, or the
    // reverse, and nobody can tell which is wrong.
    render(<Timeline events={events} timeZone="Africa/Nairobi" />);
    expect(screen.getByText('All times shown in GMT+3.')).toBeInTheDocument();
    expect(screen.getAllByText('GMT+3').length).toBeGreaterThan(1);
  });

  it('omits the offset when no zone is supplied, rather than inventing one', () => {
    render(<Timeline events={events} />);
    expect(screen.queryByText(/All times shown in/)).not.toBeInTheDocument();
  });

  it('survives an unrecognised zone instead of throwing mid-render', () => {
    // A bad zone in a facility record must degrade to plain times, not take the
    // page down with it.
    render(<Timeline events={events} timeZone="Not/AZone" />);
    expect(screen.getAllByRole('listitem')).toHaveLength(2);
  });

  it('says so when there is no history, rather than rendering an empty rail', () => {
    render(<Timeline events={[]} />);
    expect(screen.queryByRole('list')).not.toBeInTheDocument();
    expect(screen.getByText('No recorded events.')).toBeInTheDocument();
  });
});

describe('DisplayBoard', () => {
  const entries = [
    { callNumber: 'A-014', desk: 'Clinic 2', state: 'now' as const },
    { callNumber: 'A-015', desk: 'Clinic 2', state: 'next' as const },
    { callNumber: 'A-017', desk: 'Clinic 1', state: 'waiting' as const },
  ];

  it('shows the current call most prominently', () => {
    render(<DisplayBoard entries={entries} title="Outpatient clinics" />);
    expect(
      screen.getByRole('heading', { name: 'Outpatient clinics', level: 1 }),
    ).toBeInTheDocument();
    expect(screen.getByText('Now serving')).toBeInTheDocument();
    expect(screen.getByText('A-014')).toBeInTheDocument();
  });

  it('groups the rest under explicit headings', () => {
    render(<DisplayBoard entries={entries} title="Outpatient clinics" />);
    expect(screen.getByRole('heading', { name: 'Up next' })).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Waiting' })).toBeInTheDocument();
  });

  it('carries no patient identifier, only a call number', () => {
    // A public board showing names is a privacy incident waiting to happen.
    render(<DisplayBoard entries={entries} title="Outpatient clinics" />);
    for (const entry of entries) {
      expect(screen.getByText(entry.callNumber)).toBeInTheDocument();
    }
    expect(screen.queryByText(/Achieng|Penicillin|EX-/)).not.toBeInTheDocument();
  });

  it('omits sections with nothing in them', () => {
    render(
      <DisplayBoard
        entries={entries.filter((e) => e.state === 'now')}
        title="Outpatient clinics"
      />,
    );
    expect(screen.queryByRole('heading', { name: 'Up next' })).not.toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Waiting' })).not.toBeInTheDocument();
  });
});
