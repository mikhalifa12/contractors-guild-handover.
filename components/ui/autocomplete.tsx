'use client';

import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { cn } from '@/lib/cn';

/**
 * Searchable picker used for choosing a customer (and later a catalogue item)
 * on a phone: type two or three letters, tap once.
 *
 * Options are rendered on the server and filtered in the browser, so it works
 * without extra round trips. The selected id is submitted in a hidden input —
 * free text that does not match an option submits an empty value, so a form can
 * require a real choice instead of silently storing a typo.
 */
export type AutocompleteOption = {
  value: string;
  label: string;
  hint?: string | null;
};

export function Autocomplete({
  id,
  name,
  options,
  defaultOption,
  placeholder = 'Start typing to search…',
  required,
  invalid,
  emptyHint = 'No matches. Add it first, then come back.',
  describedBy,
}: {
  id: string;
  name: string;
  options: AutocompleteOption[];
  defaultOption?: AutocompleteOption | null;
  placeholder?: string;
  required?: boolean;
  invalid?: boolean;
  emptyHint?: string;
  describedBy?: string;
}) {
  const listId = `${useId()}-list`;
  const [query, setQuery] = useState(defaultOption?.label ?? '');
  const [value, setValue] = useState(defaultOption?.value ?? '');
  const [open, setOpen] = useState(false);
  const [highlight, setHighlight] = useState(0);
  const containerRef = useRef<HTMLDivElement | null>(null);

  const filtered = useMemo(() => {
    const needle = query.trim().toLowerCase();
    const matches =
      needle.length === 0 || needle === (defaultOption?.label ?? '').toLowerCase()
        ? options
        : options.filter(
            (option) =>
              option.label.toLowerCase().includes(needle) ||
              (option.hint ?? '').toLowerCase().includes(needle)
          );
    return matches.slice(0, 40);
  }, [defaultOption?.label, options, query]);

  useEffect(() => {
    function onDocumentPointerDown(event: MouseEvent) {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    }
    document.addEventListener('mousedown', onDocumentPointerDown);
    return () => document.removeEventListener('mousedown', onDocumentPointerDown);
  }, []);

  function select(option: AutocompleteOption) {
    setValue(option.value);
    setQuery(option.label);
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
    } else if (event.key === 'Enter' && open) {
      const option = filtered[highlight];
      if (option) {
        event.preventDefault();
        select(option);
      }
    } else if (event.key === 'Escape') {
      setOpen(false);
    }
  }

  const hasSelection = value.length > 0;
  const showEmpty = open && filtered.length === 0;

  return (
    <div ref={containerRef} className="relative">
      <input type="hidden" name={name} value={value} />

      <div className="relative">
        <input
          id={id}
          type="text"
          role="combobox"
          aria-expanded={open}
          aria-controls={listId}
          aria-autocomplete="list"
          aria-invalid={invalid || undefined}
          aria-describedby={describedBy}
          autoComplete="off"
          spellCheck={false}
          className={cn('cg-input pr-16', invalid && 'border-signal-danger')}
          placeholder={placeholder}
          value={query}
          required={required && !hasSelection}
          onChange={(event) => {
            setQuery(event.target.value);
            setValue('');
            setOpen(true);
            setHighlight(0);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
        />

        {query.length > 0 ? (
          <button
            type="button"
            onClick={() => {
              setQuery('');
              setValue('');
              setOpen(true);
            }}
            className="absolute right-2 top-1/2 -translate-y-1/2 rounded-md px-2 py-1 text-xs font-semibold uppercase tracking-wide text-steel-400 hover:text-paper"
          >
            Clear
          </button>
        ) : null}
      </div>

      {open && !showEmpty ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-ink-600 bg-ink-850 py-1 shadow-xl"
        >
          {filtered.map((option, index) => (
            <li key={option.value} role="option" aria-selected={option.value === value}>
              <button
                type="button"
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => select(option)}
                onMouseEnter={() => setHighlight(index)}
                className={cn(
                  'flex w-full flex-col items-start gap-0.5 px-3 py-2 text-left text-sm',
                  index === highlight ? 'bg-ember-500/15 text-paper' : 'text-steel-300'
                )}
              >
                <span className="font-semibold">{option.label}</span>
                {option.hint ? <span className="text-xs text-steel-500">{option.hint}</span> : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}

      {showEmpty ? (
        <p className="absolute z-20 mt-1 w-full rounded-lg border border-ink-600 bg-ink-850 px-3 py-2 text-sm text-steel-400 shadow-xl">
          {emptyHint}
        </p>
      ) : null}
    </div>
  );
}
