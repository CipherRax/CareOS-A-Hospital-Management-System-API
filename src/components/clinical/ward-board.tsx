import { cn } from '@/lib/cn';

/**
 * BedTile and WardBoard.
 *
 * Brief §2.4: the ward board. A real ward board is read across a room, in motion,
 * and by people who are not looking at it carefully — a porter scanning for a
 * cleaning bed, a clinician finding their patient, a charge nurse checking the
 * whole ward at a glance.
 *
 * So the tiles never rely on colour. Each state is a word, on the tile, always.
 * Red alone is invisible to deuteranopia and washed out on a bright ward monitor;
 * a tile that says "cleaning" is neither.
 *
 * Patient names are a prop, not a default. A board at distance is read by whoever
 * is in the room, and a name on a bed that is visible for two hours is a privacy
 * decision nobody has signed. The component renders the bed and the state without
 * one, and callers opt in where the deployment says names are safe.
 *
 * Occupancy summary counts are derived from the given tiles, never from a separate
 * source that could disagree with the board it accompanies.
 *
 * The board is a real `<ul>`, so the tiles are list items with a meaningful
 * structure rather than a pile of positioned divs.
 */

export type BedState = 'vacant' | 'occupied' | 'cleaning' | 'reserved' | 'out-of-service';

export const BED_STATE_LABEL: Record<BedState, string> = {
  vacant: 'Vacant',
  occupied: 'Occupied',
  cleaning: 'Cleaning',
  reserved: 'Reserved',
  'out-of-service': 'Out of service',
};

export interface BedTileProps {
  /** Bed identifier exactly as displayed, e.g. "4A". */
  bed: string;
  state: BedState;
  /**
   * Patient name, shown only where the deployment decided names are safe on a
   * distance board. Omitted by default.
   */
  patientName?: string;
  /** The bed's flag word, e.g. "O2". Not a colour cue. */
  flag?: string;
  className?: string;
}

const STATE_TONE: Record<BedState, string> = {
  // Neutral borders, not fills: a wall of coloured tiles is the exact
  // colour-only-status failure the product forbids.
  vacant: 'border-border bg-surface',
  occupied: 'border-brand bg-surface-selected',
  cleaning: 'border-border-strong bg-surface-sunken',
  reserved: 'border-border-strong bg-warning-subtle',
  'out-of-service': 'border-border bg-surface',
};

const STATE_TEXT: Record<BedState, string> = {
  vacant: 'text-primary',
  occupied: 'text-primary',
  cleaning: 'text-meta text-secondary',
  reserved: 'text-warning',
  'out-of-service': 'text-caption text-tertiary line-through',
};

export function BedTile({ bed, state, patientName, flag, className }: BedTileProps) {
  return (
    <li
      className={cn(
        'flex min-h-24 flex-col justify-between rounded-lg border p-3',
        STATE_TONE[state],
        className,
      )}
      aria-label={`Bed ${bed}, ${BED_STATE_LABEL[state].toLowerCase()}${patientName ? `, ${patientName}` : ''}`}
    >
      <div className="flex items-start justify-between gap-2">
        <span className="font-mono text-heading-xs font-semibold tabular-nums text-primary">
          {bed}
        </span>
        {flag ? (
          <span className="rounded-md border border-border px-1.5 py-0.5 font-mono text-caption text-tertiary">
            {flag}
          </span>
        ) : null}
      </div>

      <div className="flex flex-col gap-0.5">
        {/* The state word is the meaning; the tone classes above only back it. */}
        <span className={cn('text-caption font-medium', STATE_TEXT[state])}>
          {BED_STATE_LABEL[state]}
        </span>
        {patientName ? (
          <span className="truncate text-caption text-primary">{patientName}</span>
        ) : null}
      </div>
    </li>
  );
}

export interface WardBoardProps {
  ward: string;
  beds: readonly BedTileProps[];
  className?: string;
}

export function WardBoard({ ward, beds, className }: WardBoardProps) {
  const occupied = beds.filter((bed) => bed.state === 'occupied').length;
  const unavailable = beds.filter(
    (bed) => bed.state === 'cleaning' || bed.state === 'reserved' || bed.state === 'out-of-service',
  ).length;

  return (
    <section aria-label={`${ward} beds`} className={cn('flex flex-col gap-3', className)}>
      <header className="flex flex-wrap items-baseline justify-between gap-x-4 gap-y-1">
        <h2 className="text-body font-semibold text-primary">{ward}</h2>
        <p className="text-caption text-secondary">
          {occupied} occupied · {unavailable} unavailable · {beds.length} beds
        </p>
      </header>
      <ul className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-6">
        {beds.map((bed) => (
          <BedTile key={bed.bed} {...bed} />
        ))}
      </ul>
    </section>
  );
}
