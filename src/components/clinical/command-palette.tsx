'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';

import { Dialog, DialogBody, DialogContent, DialogHeader } from '@/components/ui/dialog';
import { cn } from '@/lib/cn';

/**
 * CommandPalette.
 *
 * The keyboard-first launcher: type, arrow, Enter — the mouse is optional. Built
 * in-house on the existing Radix `Dialog` rather than `cmdk`, so the keyboard
 * model is the conventional one (a `combobox` + `listbox` with
 * `aria-activedescendant`) and there is no new dependency to audit.
 *
 * What the pattern demands, and what this component enforces:
 *
 *  - **The input announces what is selected and the list confirms it.** The typed
 *    field is `role="combobox"` with `aria-controls` pointing at a real
 *    `role="listbox"`. The active option is carried by `aria-activedescendant`, so
 *    a screen reader hears the selection move without a virtual focus jump.
 *  - **Arrow keys move one result at a time and never wrap.** Wrapping around the
 *    bottom of a long list silently re-sorts what the user thinks they were
 *    reading. Home/End exist for the jump.
 *  - **Enter activates the selected result only.** An Enter that runs a fuzzy
 *    first match the user never highlighted is how the wrong record opens.
 *  - **No results is said, not implied.** A silently empty box reads to a screen
 *    reader as "a list of nothing"; the palette says "No matches for …".
 *  - **Query and selection are not sticky.** If they were, the palette would
 *    reopen pre-filled from the last person's search, and the next search would
 *    start from their results. See the `open` effect below.
 *
 * This is a launcher, not an execution layer: `onSelect` is a callback and this
 * component performs no action of its own.
 */

export interface CommandPaletteOption {
  id: string;
  label: string;
  hint?: string;
  danger?: boolean;
}

export interface CommandPaletteProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  options: readonly CommandPaletteOption[];
  onSelect: (option: CommandPaletteOption) => void;
  title?: string;
  placeholder?: string;
}

export function CommandPalette({
  open,
  onOpenChange,
  options,
  onSelect,
  title = 'Commands',
  placeholder = 'Search',
}: CommandPaletteProps) {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const baseId = useId();
  const listboxId = `${baseId}-listbox`;

  const results = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter((option) =>
      `${option.label} ${option.hint ?? ''}`.toLowerCase().includes(q),
    );
  }, [query, options]);

  // Two responsibilities, one effect: focus the field when the palette opens, and
  // clear the previous session's query and selection when it closes — however it
  // closes (Escape, scrim, the X, or an activation). Relying on an explicit
  // `close()` misses the paths Radix closes for us.
  useEffect(() => {
    if (open) {
      inputRef.current?.focus();
    } else {
      setQuery('');
      setActiveIndex(0);
    }
  }, [open]);

  // Keep the active index inside the (possibly shrinking) result list.
  useEffect(() => {
    if (results.length > 0 && activeIndex >= results.length) {
      setActiveIndex(results.length - 1);
    }
  }, [results.length, activeIndex]);

  function activate() {
    const option = results[activeIndex];
    if (!option) return;
    onOpenChange(false);
    onSelect(option);
  }

  function onInputKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (results.length === 0) return;
    switch (event.key) {
      case 'ArrowDown':
        event.preventDefault();
        setActiveIndex((index) => Math.min(index + 1, results.length - 1));
        break;
      case 'ArrowUp':
        event.preventDefault();
        setActiveIndex((index) => Math.max(index - 1, 0));
        break;
      case 'Home':
        event.preventDefault();
        setActiveIndex(0);
        break;
      case 'End':
        event.preventDefault();
        setActiveIndex(results.length - 1);
        break;
      case 'Enter':
        event.preventDefault();
        activate();
        break;
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="w-[min(28rem,calc(100vw-2rem))] overflow-hidden">
        <DialogHeader title={title} description="Search, arrow to choose, Enter to run." />
        <DialogBody className="flex flex-col gap-2">
          <input
            ref={inputRef}
            type="text"
            role="combobox"
            aria-autocomplete="list"
            aria-expanded="true"
            aria-controls={listboxId}
            aria-activedescendant={
              results[activeIndex] ? `${baseId}-opt-${results[activeIndex].id}` : undefined
            }
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onInputKeyDown}
            placeholder={placeholder}
            className="w-full rounded-lg border border-border-strong bg-surface px-3 py-2 text-body text-primary placeholder:text-tertiary focus:border-brand focus:outline-none focus:ring-2 focus:ring-brand/40"
          />

          {results.length > 0 ? (
            <ul
              id={listboxId}
              role="listbox"
              aria-label="Results"
              className="flex max-h-72 flex-col overflow-y-auto"
            >
              {results.map((option, index) => {
                const active = index === activeIndex;
                return (
                  <li
                    key={option.id}
                    id={`${baseId}-opt-${option.id}`}
                    role="option"
                    aria-selected={active}
                    onMouseMove={() => {
                      // Pointer hover moves the selection like an arrow press
                      // would, so a mouse user sees the same one the Enter key
                      // would run.
                      setActiveIndex(index);
                    }}
                    onMouseDown={(event) => {
                      // mousedown, not click: activates before the input's blur
                      // bookkeeping, and avoids the palette selecting on the raw
                      // click of a keyboard-focused run.
                      event.preventDefault();
                      setActiveIndex(index);
                      activate();
                    }}
                    className={cn(
                      'flex flex-col gap-0.5 rounded-lg px-3 py-2',
                      active ? 'bg-surface-selected' : '',
                    )}
                  >
                    <span
                      className={cn(
                        'text-body',
                        option.danger ? 'text-status-critical' : 'text-primary',
                      )}
                    >
                      {option.label}
                    </span>
                    {option.hint ? (
                      <span className="text-caption text-secondary">{option.hint}</span>
                    ) : null}
                  </li>
                );
              })}
            </ul>
          ) : (
            <p className="px-3 py-2 text-meta text-secondary" role="status">
              No matches for “{query}”.
            </p>
          )}
        </DialogBody>
      </DialogContent>
    </Dialog>
  );
}
