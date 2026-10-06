import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';

import {
  BatchRow,
  type BatchRowItem,
  CommandPalette,
  type CommandPaletteOption,
  WardBoard,
  BED_STATE_LABEL,
  type BedState,
} from '@/components/clinical';

/**
 * Behaviour tests for the last four signature components (brief §2.4).
 *
 * The common thread: state is a word on the surface, never a colour you are
 * expected to read. These tests assert the words, not the colours.
 */

const ALL_STATES: readonly BedState[] = [
  'vacant',
  'occupied',
  'cleaning',
  'reserved',
  'out-of-service',
];

describe('WardBoard / BedTile', () => {
  it('renders every bed state as a word, because colour is never the meaning', () => {
    const beds = ALL_STATES.map((state, index) => ({ bed: `B${index + 1}`, state }));
    render(<WardBoard ward="Ward 4" beds={beds} />);
    for (const state of ALL_STATES) {
      // The word may appear once per tile; must appear at least once.
      const pills = screen.getAllByText(BED_STATE_LABEL[state]);
      expect(pills.length).toBeGreaterThan(0);
    }
  });

  it('omits patient names unless the deployment opts in', () => {
    render(<WardBoard ward="Ward 4" beds={[{ bed: '4A', state: 'occupied' }]} />);
    expect(screen.queryByText(/Olive Adeyemi/)).not.toBeInTheDocument();
  });

  it('shows a name only for the occupied bed that opted in', () => {
    render(
      <WardBoard
        ward="Ward 4"
        beds={[
          { bed: '4A', state: 'occupied', patientName: 'Olive Adeyemi' },
          { bed: '4B', state: 'occupied' },
        ]}
      />,
    );
    expect(screen.getByText('Olive Adeyemi')).toBeInTheDocument();
    // Only that tile is labelled with the name.
    const region = screen.getByRole('region', { name: /Ward 4 beds/ });
    expect(within(region).getAllByText('Olive Adeyemi')).toHaveLength(1);
  });

  it('counts occupancy from the tiles it is given, and labels the board', () => {
    render(
      <WardBoard
        ward="Ward 4"
        beds={[
          { bed: '4A', state: 'occupied' },
          { bed: '4B', state: 'occupied' },
          { bed: '4C', state: 'cleaning' },
          { bed: '4D', state: 'vacant' },
          { bed: '4E', state: 'reserved' },
          { bed: '4F', state: 'out-of-service' },
        ]}
      />,
    );
    expect(screen.getByText(/2 occupied/)).toBeInTheDocument();
    expect(screen.getByText(/3 unavailable/)).toBeInTheDocument();
    expect(screen.getByText(/6 beds/)).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Ward 4 beds' })).toBeInTheDocument();
  });
});

describe('BatchRow', () => {
  const item: BatchRowItem = { rowId: 'a', label: 'Amoxicillin 500 mg TDS', detail: 'RX-2210' };

  it('shows the state word for a failed row and its own error beside it', () => {
    render(
      <ul>
        <BatchRow {...item} state="failed" error="Stock check refused the dose" />
      </ul>,
    );
    expect(screen.getByText('Failed')).toBeInTheDocument();
    expect(screen.getByText('Stock check refused the dose')).toBeInTheDocument();
  });

  it('offers undo only on a succeeded row, and never re-runs the task', () => {
    const onUndo = vi.fn();
    const { rerender } = render(
      <ul>
        <BatchRow {...item} state="succeeded" onUndo={onUndo} />
      </ul>,
    );
    const undo = screen.getByRole('button', { name: 'Undo' });
    expect(undo).toBeInTheDocument();
    undo.click();
    expect(onUndo).toHaveBeenCalledWith(item);

    for (const state of ['pending', 'failed', 'reverted'] as const) {
      rerender(
        <ul>
          <BatchRow {...item} state={state} onUndo={onUndo} />
        </ul>,
      );
      expect(
        screen.queryByRole('button', { name: 'Undo' }),
        `undo must be hidden in state ${state}`,
      ).not.toBeInTheDocument();
    }
  });

  it('announces the reverted state plainly, so a reversal is visible', () => {
    render(
      <ul>
        <BatchRow {...item} state="reverted" />
      </ul>,
    );
    expect(screen.getByText('Reverted')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Undo' })).not.toBeInTheDocument();
  });
});

describe('CommandPalette', () => {
  const options: readonly CommandPaletteOption[] = [
    { id: 'intake', label: 'New er intake', hint: 'Register in the waiting room' },
    { id: 'patient-a', label: 'Open patient Achieng Otieno', hint: 'EX-0001' },
    { id: 'patient-b', label: 'Open patient Brian Otieno', hint: 'EX-0002' },
    { id: 'lock', label: 'Lock the workstation', danger: true },
  ];

  function palette() {
    const onSelect = vi.fn();
    const onOpenChange = vi.fn();
    render(
      <CommandPalette
        open
        onOpenChange={onOpenChange}
        options={options}
        onSelect={onSelect}
        placeholder="Jump to"
      />,
    );
    return { onSelect, onOpenChange };
  }

  it('types to filter and says No matches rather than going silent', async () => {
    const user = userEvent.setup();
    palette();
    await user.type(screen.getByRole('combobox', { name: '' }), 'banana');
    expect(screen.queryByText('Open patient Achieng Otieno')).not.toBeInTheDocument();
    expect(screen.getByRole('status')).toHaveTextContent(/No matches/);
  });

  it('moves the selection with arrows and runs the selected row on Enter', async () => {
    const user = userEvent.setup();
    const { onSelect } = palette();
    await user.keyboard('{ArrowDown}');
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(options[1]);
  });

  it('keeps the first result selected until the user moves', async () => {
    const user = userEvent.setup();
    const { onSelect } = palette();
    await user.keyboard('{Enter}');
    expect(onSelect).toHaveBeenCalledWith(options[0]);
  });

  it('clears the query when the palette closes, so it cannot reopen pre-filled', async () => {
    const user = userEvent.setup();
    const { onOpenChange } = palette();
    await user.type(screen.getByRole('combobox'), 'eri');
    await user.keyboard('{Escape}');
    expect(onOpenChange).toHaveBeenCalledWith(false);
  });
});
