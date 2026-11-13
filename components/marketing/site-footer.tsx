import Link from 'next/link';
import { Logo } from '@/components/brand/logo';
import { getServerConfig } from '@/lib/config';

export function SiteFooter() {
  const config = getServerConfig();
  const year = new Date().getFullYear();

  return (
    <footer className="border-t border-ink-700 bg-ink-900 px-4 py-10 sm:px-6">
      <div className="mx-auto flex w-full max-w-6xl flex-col gap-8 sm:flex-row sm:justify-between">
        <div className="max-w-sm">
          <Logo showTagline />
          <p className="mt-4 text-sm leading-relaxed text-steel-500">
            Powered by contractors. Built on trust. Electrical fault finding, installations,
            repairs and maintenance for homes and small businesses.
          </p>
        </div>

        <div className="grid grid-cols-2 gap-8 text-sm sm:gap-12">
          <div>
            <h2 className="cg-eyebrow">Company</h2>
            <ul className="mt-3 space-y-2 text-steel-400">
              <li>
                <Link className="hover:text-paper" href="/services">
                  Services
                </Link>
              </li>
              <li>
                <Link className="hover:text-paper" href="/about">
                  About
                </Link>
              </li>
              <li>
                <Link className="hover:text-paper" href="/contact">
                  Contact
                </Link>
              </li>
              <li>
                <Link className="hover:text-paper" href="/request-quote">
                  Request a quote
                </Link>
              </li>
            </ul>
          </div>

          <div>
            <h2 className="cg-eyebrow">Contact</h2>
            <ul className="mt-3 space-y-2 text-steel-400">
              <li>
                <a className="hover:text-paper" href={`tel:${config.PUBLIC_CONTACT_PHONE.replace(/\s/g, '')}`}>
                  {config.PUBLIC_CONTACT_PHONE}
                </a>
              </li>
              <li>
                <a className="hover:text-paper" href={`mailto:${config.PUBLIC_CONTACT_EMAIL}`}>
                  {config.PUBLIC_CONTACT_EMAIL}
                </a>
              </li>
              <li className="text-steel-500">{config.PUBLIC_CONTACT_ADDRESS}</li>
              <li>
                <Link className="hover:text-paper" href="/login">
                  Contractor login
                </Link>
              </li>
            </ul>
          </div>
        </div>
      </div>

      <div className="mx-auto mt-8 w-full max-w-6xl border-t border-ink-800 pt-5 text-xs text-steel-500">
        © {year} Contractors Guild. All rights reserved.
      </div>
    </footer>
  );
}
