import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { DocumentSettingsForm } from '@/components/forms/business-forms';
import { SETTINGS_LINKS } from '@/components/app/nav-items';
import { requireSession } from '@/lib/auth/current-user';
import {
  FALLBACK_BUSINESS_SETTINGS,
  getBusinessSettings,
} from '@/lib/repositories/businesses';

export const metadata: Metadata = { title: 'Documents & numbering' };

export default async function DocumentSettingsPage() {
  const session = await requireSession();
  const settings = (await getBusinessSettings(session.businessId, session.userId))
    ?? FALLBACK_BUSINESS_SETTINGS;

  return (
    <>
      <header>
        <p className="cg-eyebrow">Settings</p>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Documents & numbering</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Defaults applied to new quotes, invoices and receipts.
        </p>
      </header>

      <nav aria-label="Settings sections" className="flex flex-wrap gap-2">
        {SETTINGS_LINKS.map((link) => (
          <Link
            key={link.href}
            href={link.href}
            className="rounded-md border border-ink-600 px-3 py-1.5 text-xs font-semibold uppercase tracking-wide text-steel-300 hover:border-ember-500 hover:text-paper"
          >
            {link.label}
          </Link>
        ))}
      </nav>

      <Card>
        <CardHeader title="Defaults and prefixes" description="Used for every new document" />
        <CardBody>
          <DocumentSettingsForm settings={settings} />
        </CardBody>
      </Card>

      <Alert tone="info" title="How numbering works">
        <p>
          Numbers are allocated by the database at the moment a document is saved, so two
          contractors quoting at the same second can never receive the same number. Changing a
          prefix affects future documents only — existing documents keep the number they were
          issued.
        </p>
      </Alert>
    </>
  );
}
