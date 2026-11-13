import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { BusinessProfileForm, LogoForm } from '@/components/forms/business-forms';
import { SETTINGS_LINKS } from '@/components/app/nav-items';
import { requireSession } from '@/lib/auth/current-user';
import { getBusinessDetail } from '@/lib/repositories/businesses';

export const metadata: Metadata = { title: 'Business profile' };

export default async function BusinessSettingsPage() {
  const session = await requireSession();
  const business = await getBusinessDetail(session.businessId, session.userId);

  if (!business) {
    return (
      <Alert tone="danger" title="Business profile unavailable">
        <p>We could not load your business record. Refresh the page or contact support.</p>
      </Alert>
    );
  }

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Settings</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Business profile</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            These details appear on quotes, invoices and receipts.
          </p>
        </div>
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
        <CardHeader
          title="Logo"
          description="Shown on documents and in the app header"
          action={<span className="text-xs text-steel-500">PNG, JPEG or WebP · max 2 MB</span>}
        />
        <CardBody>
          <LogoForm logoUrl={business.logo_url} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Business details" description="Identity, address and contact information" />
        <CardBody>
          <BusinessProfileForm business={business} />
        </CardBody>
      </Card>

      <Alert tone="info" title="Your data stays yours">
        <p>
          Business details, banking information and customer records are isolated to your business
          at the database level. No other contractor can read them.
        </p>
      </Alert>
    </>
  );
}
