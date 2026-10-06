import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { NextIntlClientProvider } from 'next-intl';
import { describe, expect, it } from 'vitest';

import messages from '@/i18n/messages/en.json';
import { AuditNote } from './audit-note';
import { Can } from './can';
import { EmptyState } from './empty-state';
import { EstimateBadge } from './estimate-badge';
import { FormSection } from './form-section';
import { KeyValueGrid } from './key-value-grid';
import { MoneyText } from './money-text';
import { hasEveryPermission, hasPermission } from '@/lib/permissions';

/**
 * The foundation signature components.
 *
 * These carry more risk than their plainness suggests. `MoneyText` silently
 * destroying precision and `Can` silently granting on an unknown principal are both
 * invisible in review and obvious in an invoice or an audit, so the tests below
 * target those specific failures rather than snapshotting markup.
 */

function renderWithIntl(ui: React.ReactElement) {
  return render(
    <NextIntlClientProvider locale="en" messages={messages}>
      {ui}
    </NextIntlClientProvider>,
  );
}

describe('MoneyText', () => {
  it('formats a decimal string with the org currency', () => {
    render(<MoneyText amount="1234.50" currency="KES" />);
    expect(screen.getByText(/1,234\.50/)).toBeInTheDocument();
  });

  it('keeps digits a binary float cannot represent', () => {
    // The reason this component exists. `Number('12345678901234567890.99')` is
    // 12345678901234567000 — twenty digits reduced to eighteen, silently, and the
    // resulting invoice is wrong by a hundred billion with nothing to show for it.
    render(<MoneyText amount="12345678901234567890.99" currency="KES" />);
    expect(screen.getByText(/12,345,678,901,234,567,890\.99/)).toBeInTheDocument();
  });

  it('does not round a value that float arithmetic would round', () => {
    // `Number('1.005').toFixed(2)` is "1.00". The decimal string must survive as 1.01.
    render(<MoneyText amount="1.005" currency="KES" />);
    expect(screen.getByText(/1\.01/)).toBeInTheDocument();
  });

  it('marks an amount it cannot parse instead of rendering NaN', () => {
    // A screen showing "Ksh NaN" is a bug report. Showing the raw value is a
    // diagnosable one, and in a clinical system a wrong-but-visible beats a
    // right-looking fiction.
    render(<MoneyText amount="not-a-number" currency="KES" />);
    const el = screen.getByText('not-a-number');
    expect(el).toBeInTheDocument();
    expect(el).not.toHaveTextContent(/NaN/);
  });

  it('renders a negative amount with its sign', () => {
    render(<MoneyText amount="-500.00" currency="KES" />);
    expect(screen.getByText(/-/)).toBeInTheDocument();
  });

  it('can put the sign outside the currency mark for financial statements', () => {
    render(<MoneyText amount="-500.00" currency="KES" accounting />);
    expect(screen.getByText(/^\(.*500\.00\)$/)).toBeInTheDocument();
  });

  it('uses tabular figures so columns of money align', () => {
    const { container } = render(<MoneyText amount="10.00" currency="KES" />);
    expect(container.firstChild).toHaveClass('tabular-nums');
  });
});

describe('Can', () => {
  const principal = { permissions: ['patients:read', 'billing:write'] };

  it('renders children when the permission is held', () => {
    render(
      <Can principal={principal} permission="patients:read">
        <button>Open record</button>
      </Can>,
    );
    expect(screen.getByRole('button', { name: 'Open record' })).toBeInTheDocument();
  });

  it('renders nothing when it is not held', () => {
    render(
      <Can principal={principal} permission="results:release">
        <button>Release result</button>
      </Can>,
    );
    expect(screen.queryByRole('button', { name: 'Release result' })).not.toBeInTheDocument();
  });

  it('fails closed for an unknown principal', () => {
    // A permission check that returns true when it cannot tell renders controls for
    // people who will be refused them, and leaks which roles exist.
    render(
      <Can principal={null} permission="patients:read">
        <button>Open record</button>
      </Can>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('requires every permission for an action that only makes sense whole', () => {
    render(
      <Can principal={principal} allOf={['lab:verify', 'lab:release']}>
        <button>Release</button>
      </Can>,
    );
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });
});

describe('permissions', () => {
  it('honours a global wildcard', () => {
    expect(hasPermission({ permissions: ['*'] }, 'anything:at:all')).toBe(true);
  });

  it('honours a namespace wildcard', () => {
    expect(hasPermission({ permissions: ['patients.*'] }, 'patients:read')).toBe(true);
    expect(hasPermission({ permissions: ['patients.*'] }, 'billing:read')).toBe(false);
  });

  it('does not widen a grant across namespaces', () => {
    // The bug this guards: treating `patients.*` as a prefix match on any string,
    // which would let `patients:read` imply `patientsadmin:write`.
    expect(hasPermission({ permissions: ['patients.*'] }, 'patientsadmin:write')).toBe(false);
  });

  it('treats an empty list as no permissions', () => {
    expect(hasPermission({ permissions: [] }, 'patients:read')).toBe(false);
  });

  it('requires all of a set, not any', () => {
    const p = { permissions: ['lab:verify'] };
    expect(hasEveryPermission(p, ['lab:verify', 'lab:release'])).toBe(false);
    expect(hasEveryPermission(p, ['lab:verify'])).toBe(true);
  });
});

describe('EmptyState', () => {
  it('names what is missing and offers the next action', () => {
    render(
      <EmptyState
        title="No results awaiting verification"
        description="Verified results appear here before release."
        action={<button>Open worklist</button>}
      />,
    );
    expect(
      screen.getByRole('heading', { name: 'No results awaiting verification' }),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Open worklist' })).toBeInTheDocument();
  });

  it('renders without an action rather than a dead button', () => {
    render(<EmptyState title="No encounters today" />);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
  });

  it('does not announce itself, because nothing changed', () => {
    render(<EmptyState title="Nothing here" />);
    expect(screen.queryByRole('status')).not.toBeInTheDocument();
  });
});

describe('FormSection', () => {
  it('groups its controls under a real fieldset legend', () => {
    render(
      <FormSection title="Contact details">
        <input aria-label="Phone" />
      </FormSection>,
    );
    expect(screen.getByRole('group', { name: 'Contact details' })).toBeInTheDocument();
  });

  it('associates its description with the group', () => {
    render(
      <FormSection title="Contact details" description="Used only for follow-up.">
        <input aria-label="Phone" />
      </FormSection>,
    );
    const group = screen.getByRole('group', { name: 'Contact details' });
    expect(group).toHaveAccessibleDescription('Used only for follow-up.');
  });

  it('marks a required group in text', () => {
    render(
      <FormSection title="Contact details" required>
        <input aria-label="Phone" />
      </FormSection>,
    );
    expect(screen.getByText('Required')).toBeInTheDocument();
  });
});

describe('KeyValueGrid', () => {
  const items = [
    { label: 'Patient number', value: 'PT-000123', mono: true },
    { label: 'Date of birth', value: '1991-04-02' },
    { label: 'Insurance', value: '' },
  ];

  it('is a description list of term/definition pairs', () => {
    // A `<dl>` carries no implicit ARIA role, so this asserts the structure
    // directly. `role="list"` on a `<dl>` would be wrong anyway: it demands
    // `listitem` children, and `dt`/`dd` are not those.
    const { container } = render(<KeyValueGrid items={items} label="Patient details" />);
    const list = container.querySelector('dl');
    expect(list).toBeInTheDocument();
    expect(list!.querySelectorAll('dt')).toHaveLength(3);
    expect(list!.querySelectorAll('dd')).toHaveLength(3);
  });

  it('shows its label as visible text, not an ARIA name nobody hears', () => {
    render(<KeyValueGrid items={items} label="Patient details" />);
    expect(screen.getByText('Patient details')).toBeInTheDocument();
  });

  it('marks an absent value rather than leaving a blank that reads as nothing', () => {
    render(<KeyValueGrid items={items} />);
    // An empty cell is ambiguous between "not recorded" and "not applicable".
    expect(screen.getAllByText('—').length).toBeGreaterThan(0);
  });

  it('renders identifiers in a tabular mono face', () => {
    render(<KeyValueGrid items={items} />);
    const value = screen.getByText('PT-000123');
    expect(value).toHaveClass('font-mono');
    expect(value).toHaveClass('tabular-nums');
  });
});

describe('AuditNote', () => {
  it('names what is being recorded', () => {
    render(<AuditNote>the patient access log</AuditNote>);
    expect(screen.getByText(/patient access log/)).toBeInTheDocument();
  });

  it('states that the access is recorded', () => {
    render(<AuditNote>this record</AuditNote>);
    expect(screen.getByText('Access is logged.')).toBeInTheDocument();
  });
});

describe('EstimateBadge', () => {
  const props = {
    method: 'Mean of recorded timestamps over the last 30 days',
    dataPeriod: '1–30 September 2026',
  };

  it('labels the number as an estimate without opening anything', () => {
    renderWithIntl(<EstimateBadge {...props} />);
    expect(screen.getByRole('button', { name: /Estimate/ })).toBeInTheDocument();
  });

  it('shows the method and data period on demand', async () => {
    const user = userEvent.setup();
    renderWithIntl(<EstimateBadge {...props} />);
    await user.click(screen.getByRole('button', { name: /Estimate/ }));
    expect(screen.getByText(props.method)).toBeInTheDocument();
    expect(screen.getByText(props.dataPeriod)).toBeInTheDocument();
  });

  it('shows model and version together when supplied', async () => {
    const user = userEvent.setup();
    renderWithIntl(<EstimateBadge {...props} model="queue-forecast" version="v3" />);
    await user.click(screen.getByRole('button', { name: /Estimate/ }));
    expect(screen.getByText('queue-forecast v3')).toBeInTheDocument();
  });
});
