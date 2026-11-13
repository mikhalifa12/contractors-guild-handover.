'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { PlusIcon } from '@/components/icons';
import { NAV_ITEMS, CREATE_ACTIONS } from '@/components/app/nav-items';
import { cn } from '@/lib/cn';

function isActive(pathname: string, href: string): boolean {
  if (href === '/app') return pathname === '/app';
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function SidebarNav() {
  const pathname = usePathname();

  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {NAV_ITEMS.map((item) => {
        const active = isActive(pathname, item.href);
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'flex items-center gap-3 rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors',
              active
                ? 'bg-ember-500/12 text-ember-300 shadow-[inset_2px_0_0_0_var(--color-ember-500)]'
                : 'text-steel-400 hover:bg-ink-800 hover:text-paper'
            )}
          >
            <item.Icon className="h-5 w-5 shrink-0" />
            <span className="flex-1">{item.label}</span>
            {item.phase ? <span className="text-[0.625rem] text-steel-500">P{item.phase}</span> : null}
          </Link>
        );
      })}
    </nav>
  );
}

export function CreateMenu({ compact = false }: { compact?: boolean }) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        aria-expanded={open}
        aria-haspopup="menu"
        className={cn(
          'inline-flex items-center justify-center gap-2 rounded-lg bg-ember-500 font-bold uppercase tracking-[0.08em] text-white transition-colors hover:bg-ember-400',
          compact ? 'min-h-12 w-full px-4 text-xs' : 'min-h-11 w-full px-4 text-xs'
        )}
      >
        <PlusIcon className="h-4 w-4" />
        Create
      </button>

      {open ? (
        <div
          role="menu"
          className="absolute right-0 z-50 mt-2 w-56 overflow-hidden rounded-lg border border-ink-600 bg-ink-850 shadow-xl"
        >
          {CREATE_ACTIONS.map((action) => (
            <Link
              key={action.href}
              href={action.href}
              role="menuitem"
              className="flex items-center justify-between gap-2 px-4 py-3 text-sm text-steel-300 hover:bg-ink-800 hover:text-paper"
            >
              {action.label}
              {action.phase ? (
                <span className="text-[0.625rem] uppercase text-steel-500">
                  Phase {action.phase}
                </span>
              ) : null}
            </Link>
          ))}
        </div>
      ) : null}
    </div>
  );
}

export function MobileBottomNav() {
  const pathname = usePathname();
  const [drawerOpen, setDrawerOpen] = useState(false);

  useEffect(() => {
    setDrawerOpen(false);
  }, [pathname]);

  const primary = NAV_ITEMS.filter((item) => item.primaryMobile);

  return (
    <>
      {drawerOpen ? (
        <div className="fixed inset-0 z-50 bg-ink-950/80 md:hidden" role="presentation">
          <div
            role="dialog"
            aria-modal="true"
            aria-label="All sections"
            className="cg-safe-bottom absolute inset-x-0 bottom-0 max-h-[80dvh] overflow-y-auto rounded-t-2xl border-t border-ink-600 bg-ink-900 p-4"
          >
            <div className="mb-4 flex items-center justify-between">
              <p className="cg-eyebrow">All sections</p>
              <button
                type="button"
                onClick={() => setDrawerOpen(false)}
                className="rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold uppercase text-steel-300"
              >
                Close
              </button>
            </div>

            <nav aria-label="All sections" className="grid grid-cols-2 gap-2">
              {NAV_ITEMS.map((item) => (
                <Link
                  key={item.href}
                  href={item.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-lg border px-3 py-3.5 text-sm font-semibold',
                    isActive(pathname, item.href)
                      ? 'border-ember-500/60 bg-ember-500/10 text-ember-300'
                      : 'border-ink-700 bg-ink-850 text-steel-300'
                  )}
                >
                  <item.Icon className="h-5 w-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                </Link>
              ))}
            </nav>

            <div className="mt-4">
              <CreateMenu compact />
            </div>
          </div>
        </div>
      ) : null}

      <nav
        aria-label="Primary"
        className="cg-safe-bottom fixed inset-x-0 bottom-0 z-40 border-t border-ink-700 bg-ink-900/97 backdrop-blur md:hidden"
      >
        <ul className="grid grid-cols-5">
          {primary.map((item) => {
            const active = isActive(pathname, item.href);
            return (
              <li key={item.href}>
                <Link
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={cn(
                    'flex min-h-16 flex-col items-center justify-center gap-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide',
                    active ? 'text-ember-400' : 'text-steel-400'
                  )}
                >
                  <item.Icon className="h-5 w-5" />
                  {item.label}
                </Link>
              </li>
            );
          })}
          <li>
            <button
              type="button"
              onClick={() => setDrawerOpen(true)}
              aria-expanded={drawerOpen}
              className="flex min-h-16 w-full flex-col items-center justify-center gap-1 px-1 text-[0.625rem] font-semibold uppercase tracking-wide text-steel-400"
            >
              <span aria-hidden className="flex flex-col gap-1">
                <span className="block h-0.5 w-5 bg-current" />
                <span className="block h-0.5 w-5 bg-current" />
                <span className="block h-0.5 w-5 bg-current" />
              </span>
              More
            </button>
          </li>
        </ul>
      </nav>
    </>
  );
}
