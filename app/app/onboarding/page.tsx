import type { Metadata } from 'next';
import Link from 'next/link';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { Alert } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/button';
import { BusinessProfileForm, BankingDetailsForm, LogoForm } from '@/components/forms/business-forms';
import { CheckIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import {
  FALLBACK_BUSINESS_SETTINGS,
  getBusinessDetail,
  getBusinessSettings,
} from '@/lib/repositories/businesses';

export const metadata: Metadata = { title: 'Set up your business' };

export default async function OnboardingPage() {
  const session = await requireSession();

  const [business, settingsRow] = await Promise.all([
    getBusinessDetail(session.businessId, session.userId),
    getBusinessSettings(session.businessId, session.userId),
  ]);

  const settings = settingsRow ?? FALLBACK_BUSINESS_SETTINGS;

  const steps = [
    { label: 'Business name and contact details', done: Boolean(business?.phone && business?.email) },
    { label: 'Address shown on documents', done: Boolean(business?.address_line1 && business?.city) },
    { label: 'Banking details for invoices', done: Boolean(settings.bank_name && settings.bank_account_number) },
    { label: 'Logo for quotes, invoices and receipts', done: Boolean(business?.logo_storage_key) },
  ];

  const completed = steps.filter((step) => step.done).length;

  return (
    <>
      <header>
        <p className="cg-eyebrow">Setup guide</p>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">
          Get your workspace ready
        </h1>
        <p className="mt-1.5 text-sm text-steel-500">
          {completed} of {steps.length} steps done · everything is editable later in Settings
        </p>
      </header>

      <Card>
        <CardHeader title="Checklist" description="What appears on your documents" />
        <CardBody>
          <ul className="grid gap-2 sm:grid-cols-2">
            {steps.map((step) => (
              <li key={step.label} className="flex items-center gap-2.5 text-sm">
                <span
                  aria-hidden
                  className={
                    step.done
                      ? 'flex h-5 w-5 items-center justify-center rounded-full bg-signal-success/20 text-signal-success'
                      : 'flex h-5 w-5 items-center justify-center rounded-full border border-ember-500/60 text-ember-400'
                  }
                >
                  {step.done ? <CheckIcon className="h-3.5 w-3.5" /> : null}
                </span>
                <span className={step.done ? 'text-steel-400' : 'text-paper'}>{step.label}</span>
              </li>
            ))}
          </ul>
          <div className="mt-5 flex flex-wrap gap-3">
            <ButtonLink href="/app" variant="secondary" size="sm">
              Skip to dashboard
            </ButtonLink>
            <Link
              href="/app/settings/documents"
              className="inline-flex items-center text-xs font-semibold uppercase tracking-wide text-ember-400 hover:text-ember-300"
            >
              Numbering & terms →
            </Link>
          </div>
        </CardBody>
      </Card>

      {!business ? (
        <Alert tone="danger" title="Business profile missing">
          <p>
            We could not load your business record. Refresh the page; if this continues, contact
            support.
          </p>
        </Alert>
      ) : (
        <>
          <Card>
            <CardHeader title="Step 1 · Business details" description="Name, address and contact information" />
            <CardBody>
              <BusinessProfileForm business={business} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Step 2 · Banking details" description="Printed on invoices so customers can pay you" />
            <CardBody>
              <BankingDetailsForm settings={settings} />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Step 3 · Logo" description="Uploaded once, used on every document" />
            <CardBody>
              <LogoForm logoUrl={business.logo_url} />
            </CardBody>
          </Card>
        </>
      )}
    </>
  );
}
