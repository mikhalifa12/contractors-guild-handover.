'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Searchable catalogue picker for a quote line.
 *
 * The catalogue is loaded once on the server and filtered in the browser, so a
 * contractor standing on a roof types two letters and taps once — no round
 * trip per keystroke. Picking an item copies its current name, unit, price and
 * tax rate onto the line: the line is a snapshot, so a later price change in
 * the catalogue never rewrites a quote a customer already has.
 */
export type CatalogueChoice = {
  id: string;
  kind: 'PRODUCT' | 'SERVICE';
  name: string;
  description: string | null;
  unit: string;
  default_price: string;
  tax_rate: string;
};

export function CatalogueLinePicker({
  choices,
  onSelect,
  placeholder = 'Search products and services…',
  inputId,
  className,
}: {
  choices: CatalogueChoice[];
  onSelect: (choice: CatalogueChoice) => void;
  placeholder?: string;
  inputId?: string;
  className?: string;
}) {
  const generatedId = useId();
  const id = inputId ?? `${generatedId}-catalogue`;
  const listId = `${id}-list`;
  const [query, setQuery] = useState('');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    if (!needle) return choices.slice(0, 20);
    return choices
      .filter(
        (choice) =>
          choice.name.toLowerCase().includes(needle) ||
          (choice.description ?? '').toLowerCase().includes(needle)
      )
      .slice(0, 20);
  }, [choices, query]);

  useEffect(() => {
    function onDocumentPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentPointerDown);
    return () => document.removeEventListener('mousedown', onDocumentPointerDown);
  }, []);

  function choose(choice: CatalogueChoice) {
    onSelect(choice);
    setQuery('');
    setOpen(false);
    setHighlight(0);
  }

  function onKeyDown(event: React.KeyboardEvent<HTMLInputElement>) {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setOpen(true);
      setHighlight((current) => Math.min(current + 1, Math.max(filtered.length - 1, 0)));
    } else if (event.key === 'ArrowUp') {
      event.preventDefault();
      setHighlight((current) => Math.max(current - 1, 0));
    } else if (event.key === 'Enter') {
      const choice = filtered[highlight];
      if (open && choice) {
        event.preventDefault();
        choose(choice);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  return (
    <div ref={containerRef} className={cn('relative', className)}>
      <input
        id={id}
        type="search"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        autoComplete="off"
        spellCheck={false}
        className="cg-input"
        placeholder={placeholder}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setOpen(true);
          setHighlight(0);
        }}
        onFocus={() => setOpen(true)}
        onKeyDown={onKeyDown}
      />

      {open ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-xl"
        >
          {filtered.map((choice, index) => (
            <li key={choice.id} role="option" aria-selected={index === highlight}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => choose(choice)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex w-full items-baseline justify-between gap-3 px-3 py-2 text-left text-sm',
                  index === highlight ? 'bg-ember-500/15 text-paper' : 'text-steel-300'
                )}
              >
                <span className="min-w-0">
                  <span className="block truncate font-semibold">{choice.name}</span>
                  <span className="block text-xs text-steel-500">
                    {choice.kind === 'SERVICE' ? 'Service' : 'Product'} · per {choice.unit}
                  </span>
                </span>
                <span className="whitespace-nowrap font-mono text-xs text-steel-400">
                  {choice.default_price}
                </span>
              </button>
            </li>
          ))}

          {filtered.length === 0 ? (
            <li className="px-3 py-2 text-sm text-steel-400">
              Nothing in the catalogue matches “{query}”.{' '}
              <span className="text-steel-500">
                Type the line in by hand below, or add it to the catalogue later.
              </span>
            </li>
          ) : null}
        </ul>
      ) : null}
    </div>
  );
}
