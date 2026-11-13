import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { BankingDetailsForm } from '@/components/forms/business-forms';
import { SETTINGS_LINKS } from '@/components/app/nav-items';
import { requireSession } from '@/lib/auth/current-user';
import {
  FALLBACK_BUSINESS_SETTINGS,
  getBusinessSettings,
} from '@/lib/repositories/businesses';

export const metadata: Metadata = { title: 'Banking details' };

export default async function BankingSettingsPage() {
  const session = await requireSession();
  const settings = (await getBusinessSettings(session.businessId, session.userId))
    ?? FALLBACK_BUSINESS_SETTINGS;

  return (
    <>
      <header>
        <p className="cg-eyebrow">Settings</p>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Banking details</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Printed on your invoices so customers can pay you directly.
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

      <Alert tone="warning" title="How we handle banking details">
        <p>
          Your banking details belong to your business record and are stored in the database — they
          are never hard-coded in the application or kept in configuration files. They are shown on
          your invoices and receipts, and never on a public page a customer could reach by guessing
          a link.
        </p>
      </Alert>

      <Card>
        <CardHeader title="Bank account" description="Used on invoices and payment instructions" />
        <CardBody>
          <BankingDetailsForm settings={settings} />
        </CardBody>
      </Card>
    </>
  );
}
