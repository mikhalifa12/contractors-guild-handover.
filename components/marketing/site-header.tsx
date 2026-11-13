'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Logo } from '@/components/brand/logo';
import { ButtonLink } from '@/components/ui/button';
import { cn } from '@/lib/cn';

const NAV_ITEMS = [
  { href: '/', label: 'Home' },
  { href: '/services', label: 'Services' },
  { href: '/about', label: 'About' },
  { href: '/contact', label: 'Contact' },
] as const;

export function SiteHeader({ isSignedIn }: { isSignedIn: boolean }) {
  const pathname = usePathname();
  const [menuOpen, setMenuOpen] = useState(false);

  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);

  return (
    <header className="sticky top-0 z-40 border-b border-ink-700/80 bg-ink-950/92 backdrop-blur">
      <div className="mx-auto flex w-full max-w-6xl items-center justify-between gap-3 px-4 py-3 sm:px-6">
        <Link href="/" aria-label="Contractors Guild home">
          <Logo />
        </Link>

        <nav aria-label="Main" className="hidden items-center gap-1 md:flex">
          {NAV_ITEMS.map((item) => {
            const active = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                className={cn(
                  'rounded-md px-3 py-2 text-sm font-semibold uppercase tracking-wide transition-colors',
                  active ? 'text-ember-400' : 'text-steel-300 hover:bg-ink-800 hover:text-paper'
                )}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>

        <div className="hidden items-center gap-2 md:flex">
          <ButtonLink href="/request-quote" size="sm">
            Request a quote
          </ButtonLink>
          <ButtonLink href={isSignedIn ? '/app' : '/login'} variant="secondary" size="sm">
            {isSignedIn ? 'Dashboard' : 'Login'}
          </ButtonLink>
        </div>

        <button
          type="button"
          className="inline-flex h-11 w-11 items-center justify-center rounded-lg border border-ink-600 text-paper md:hidden"
          aria-expanded={menuOpen}
          aria-controls="mobile-menu"
          aria-label={menuOpen ? 'Close menu' : 'Open menu'}
          onClick={() => setMenuOpen((open) => !open)}
        >
          <span aria-hidden className="flex flex-col gap-1.5">
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
            <span className="block h-0.5 w-5 bg-current" />
          </span>
        </button>
      </div>

      <div
        id="mobile-menu"
        hidden={!menuOpen}
        className="border-t border-ink-700 bg-ink-900 px-4 pb-4 pt-2 md:hidden"
      >
        <nav aria-label="Mobile" className="flex flex-col">
          {NAV_ITEMS.map((item) => (
            <Link
              key={item.href}
              href={item.href}
              className="border-b border-ink-800 py-3.5 text-base font-semibold uppercase tracking-wide text-steel-300 last:border-b-0"
            >
              {item.label}
            </Link>
          ))}
        </nav>
        <div className="mt-4 flex flex-col gap-2">
          <ButtonLink href="/request-quote" size="md" className="w-full">
            Request a quote
          </ButtonLink>
          <ButtonLink
            href={isSignedIn ? '/app' : '/login'}
            variant="secondary"
            size="md"
            className="w-full"
          >
            {isSignedIn ? 'Go to dashboard' : 'Contractor login'}
          </ButtonLink>
        </div>
      </div>
    </header>
  );
}
