'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { cn } from '@/lib/cn';

/**
 * List controls shared by customers, the catalogue and jobs.
 *
 * The search box is a real GET form, so it works without JavaScript, and it
 * also updates the URL as the user types (debounced) so a contractor on a phone
 * does not have to press Enter. Filter chips are plain links: one tap, no
 * client state, and they survive going back.
 */
export function ListSearch({
  placeholder = 'Search…',
  paramName = 'q',
  label = 'Search',
}: {
  placeholder?: string;
  paramName?: string;
  label?: string;
}) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const initial = searchParams.get(paramName) ?? '';
  const [value, setValue] = useState(initial);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Keep the box in step when the URL changes (for example Clear filters).
  useEffect(() => {
    setValue(searchParams.get(paramName) ?? '');
  }, [paramName, searchParams]);

  function push(next: string) {
    const params = new URLSearchParams(searchParams.toString());
    if (next.trim()) params.set(paramName, next.trim());
    else params.delete(paramName);
    params.delete('page');
    const query = params.toString();
    router.replace(query ? `${pathname}?${query}` : pathname, { scroll: false });
  }

  return (
    <form
      method="get"
      action={pathname}
      className="flex-1"
      onSubmit={(event) => {
        event.preventDefault();
        if (timer.current) clearTimeout(timer.current);
        push(value);
      }}
    >
      <label className="sr-only" htmlFor="list-search">
        {label}
      </label>
      <input
        id="list-search"
        name={paramName}
        type="search"
        inputMode="search"
        autoComplete="off"
        className="cg-input"
        placeholder={placeholder}
        value={value}
        onChange={(event) => {
          const next = event.target.value;
          setValue(next);
          if (timer.current) clearTimeout(timer.current);
          timer.current = setTimeout(() => push(next), 300);
        }}
      />
    </form>
  );
}

export type FilterChip = {
  value: string;
  label: string;
  count?: number;
};

export function FilterChips({
  paramName,
  chips,
  active,
  basePath,
  preserve = ['q'],
}: {
  paramName: string;
  chips: FilterChip[];
  active: string;
  basePath: string;
  preserve?: string[];
}) {
  const searchParams = useSearchParams();

  function hrefFor(value: string, defaultValue: string) {
    const params = new URLSearchParams();
    for (const key of preserve) {
      const existing = searchParams.get(key);
      if (existing) params.set(key, existing);
    }
    if (value !== defaultValue) params.set(paramName, value);
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  return (
    <div className="-mx-1 flex flex-wrap gap-1.5 px-1" role="group" aria-label="Filters">
      {chips.map((chip) => {
        const isActive = chip.value === active;
        return (
          <Link
            key={chip.value}
            href={hrefFor(chip.value, chips[0]?.value ?? '')}
            aria-current={isActive ? 'true' : undefined}
            className={cn(
              'inline-flex items-center gap-1.5 rounded-md border px-3 py-1.5 text-xs font-semibold uppercase tracking-wide transition-colors',
              isActive
                ? 'border-ember-500 bg-ember-500/15 text-ember-200'
                : 'border-ink-600 text-steel-300 hover:border-ember-500 hover:text-paper'
            )}
          >
            {chip.label}
            {typeof chip.count === 'number' ? (
              <span className="text-steel-500">{chip.count}</span>
            ) : null}
          </Link>
        );
      })}
    </div>
  );
}

export function Pagination({
  basePath,
  page,
  pageSize,
  total,
  searchParams,
}: {
  basePath: string;
  page: number;
  pageSize: number;
  total: number;
  searchParams: Record<string, string | undefined>;
}) {
  if (total <= pageSize) return null;

  const lastPage = Math.max(Math.ceil(total / pageSize), 1);
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(page * pageSize, total);

  function hrefFor(target: number) {
    const params = new URLSearchParams();
    for (const [key, value] of Object.entries(searchParams)) {
      if (value && key !== 'page' && key !== 'saved') params.set(key, value);
    }
    if (target > 1) params.set('page', String(target));
    const query = params.toString();
    return query ? `${basePath}?${query}` : basePath;
  }

  const linkClass =
    'inline-flex min-h-11 items-center rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper';

  return (
    <nav
      aria-label="Pagination"
      className="flex flex-wrap items-center justify-between gap-3 pt-2 text-sm text-steel-400"
    >
      <p>
        Showing <span className="text-paper">{from}</span>–<span className="text-paper">{to}</span>{' '}
        of <span className="text-paper">{total}</span>
      </p>
      <div className="flex items-center gap-2">
        {page > 1 ? (
          <Link href={hrefFor(page - 1)} className={linkClass} rel="prev">
            Previous
          </Link>
        ) : null}
        <span className="px-1 text-xs uppercase tracking-wide text-steel-500">
          Page {page} / {lastPage}
        </span>
        {page < lastPage ? (
          <Link href={hrefFor(page + 1)} className={linkClass} rel="next">
            Next
          </Link>
        ) : null}
      </div>
    </nav>
  );
}
