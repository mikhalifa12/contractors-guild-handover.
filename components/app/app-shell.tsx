import type { ReactNode } from 'react';
import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { CreateMenu, MobileBottomNav, SidebarNav } from '@/components/app/app-nav';
import { SETTINGS_LINKS } from '@/components/app/nav-items';
import { logoutAction } from '@/lib/actions/auth';
import { initialsOf } from '@/lib/format';
import type { CurrentSession } from '@/lib/auth/current-user';

/**
 * Application shell: fixed sidebar on desktop, bottom bar + drawer on mobile.
 * The primary create action is always one tap away.
 */
export function AppShell({
  session,
  children,
}: {
  session: CurrentSession;
  children: ReactNode;
}) {
  const businessLabel = session.tradingName ?? session.legalName;

  return (
    <div className="min-h-dvh bg-ink-950">
      <div className="mx-auto flex w-full max-w-[100rem]">
        {/* Desktop sidebar */}
        <aside className="sticky top-0 hidden h-dvh w-64 shrink-0 flex-col border-r border-ink-800 bg-ink-900 px-4 py-5 md:flex">
          <Link href="/app" aria-label="Contractors Guild dashboard">
            <Logo size="sm" />
          </Link>

          <div className="mt-6 rounded-lg border border-ink-700 bg-ink-850 px-3 py-3">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
              Business
            </p>
            <p className="mt-1 truncate text-sm font-semibold text-paper">{businessLabel}</p>
            <p className="mt-0.5 text-xs text-steel-500">
              {session.businessRole.charAt(0) + session.businessRole.slice(1).toLowerCase()}
            </p>
          </div>

          <div className="mt-4">
            <CreateMenu />
          </div>

          <div className="mt-5 flex-1 overflow-y-auto">
            <SidebarNav />
          </div>

          <div className="mt-4 border-t border-ink-800 pt-4">
            <div className="flex items-center gap-3">
              <span
                aria-hidden
                className="flex h-9 w-9 items-center justify-center rounded-full bg-ember-500/15 text-xs font-bold text-ember-300"
              >
                {initialsOf(session.fullName)}
              </span>
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-semibold text-paper">{session.fullName}</p>
                <p className="truncate text-xs text-steel-500">{session.email}</p>
              </div>
            </div>

            <form action={logoutAction} className="mt-3">
              <button
                type="submit"
                className="w-full rounded-lg border border-ink-600 px-3 py-2 text-xs font-semibold uppercase tracking-wide text-steel-300 transition-colors hover:border-signal-danger/60 hover:text-signal-danger"
              >
                Sign out
              </button>
            </form>
          </div>
        </aside>

        {/* Main column */}
        <div className="flex min-w-0 flex-1 flex-col">
          <header className="sticky top-0 z-30 border-b border-ink-800 bg-ink-950/95 px-4 py-3 backdrop-blur md:hidden">
            <div className="flex items-center justify-between gap-3">
              <Link href="/app" aria-label="Contractors Guild dashboard">
                <Logo size="sm" />
              </Link>
              <div className="min-w-0 text-right">
                <p className="truncate text-xs font-semibold text-paper">{businessLabel}</p>
                <p className="truncate text-[0.6875rem] text-steel-500">{session.fullName}</p>
              </div>
            </div>
          </header>

          <main className="flex-1 px-4 pb-28 pt-5 sm:px-6 md:pb-10 md:pt-6">
            <div className="w-full space-y-5">{children}</div>
          </main>

          <footer className="hidden border-t border-ink-800 px-6 py-4 text-xs text-steel-500 md:block">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <span>
                Contractors Guild · customers, catalogue, jobs, quotes, invoices and payments are
                live; reports are next (see ROADMAP.md)
              </span>
              <span className="flex gap-3">
                {SETTINGS_LINKS.map((link) => (
                  <Link key={link.href} href={link.href} className="hover:text-paper">
                    {link.label}
                  </Link>
                ))}
              </span>
            </div>
          </footer>
        </div>
      </div>

      <MobileBottomNav />
    </div>
  );
}
