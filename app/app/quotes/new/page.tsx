import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { QuoteForm } from '@/components/forms/quote-forms';
import { requireSession } from '@/lib/auth/current-user';
import { listCustomerOptions } from '@/lib/repositories/customers';
import { listCatalogueOptions } from '@/lib/repositories/catalogue';
import { getBusinessSettings } from '@/lib/repositories/businesses';
import { getJob } from '@/lib/repositories/jobs';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'New quote' };
export const dynamic = 'force-dynamic';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function NewQuotePage({
  searchParams,
}: {
  searchParams: Promise<{ customerId?: string; jobId?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const [customers, catalogue, settings] = await Promise.all([
    listCustomerOptions(session.businessId, session.userId),
    listCatalogueOptions(session.businessId, session.userId),
    getBusinessSettings(session.businessId, session.userId),
  ]);

  // Coming from a job: prefill the customer, site address and job type so a
  // contractor quoting on site types the least possible.
  const job = params.jobId ? await getJob(session.businessId, session.userId, params.jobId) : null;

  const options = customers.map((customer) => ({
    value: customer.id,
    label: customer.business_name,
    hint: [humaniseEnum(customer.customer_type), customer.billing_city, customer.phone]
      .filter(Boolean)
      .join(' · '),
  }));

  const defaultTaxRate = Number(settings?.default_tax_rate ?? 15);
  const validityDays = settings?.default_quote_validity_days ?? 30;

  return (
    <>
      <header>
        <Link href="/app/quotes" className="cg-eyebrow hover:text-paper">
          ← Quotes
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">New quote</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Quote numbers are allocated automatically. Nothing reaches the customer until you mark it
          as sent.
        </p>
      </header>

      {customers.length === 0 ? (
        <Alert tone="warning" title="Add a customer first">
          <p>
            A quote belongs to a customer.{' '}
            <Link href="/app/customers/new" className="font-semibold underline">
              Add a customer
            </Link>{' '}
            — it takes a few seconds — then come back.
          </p>
        </Alert>
      ) : (
        <Card>
          <CardHeader
            title="Quote details"
            description="Who it is for, what it covers and what it costs"
          />
          <CardBody>
            <QuoteForm
              customers={options}
              catalogue={catalogue}
              defaultTaxRate={defaultTaxRate}
              currencyCode={session.currencyCode}
              today={isoToday()}
              defaultValidUntil={isoPlusDays(validityDays)}
              jobContext={
                job ? { id: job.id, jobNumber: job.job_number, title: job.title } : null
              }
              quote={{
                customerId: job?.customer_id ?? params.customerId ?? '',
                jobId: job?.id ?? null,
                issueDate: isoToday(),
                validUntil: isoPlusDays(validityDays),
                contactPerson: job?.customer_contact_person ?? '',
                contactPhone: job?.customer_phone ?? '',
                contactEmail: job?.customer_email ?? '',
                jobType: job?.job_type ?? '',
                jobAddressLine1: job?.job_address_line1 ?? '',
                jobAddressLine2: job?.job_address_line2 ?? '',
                jobCity: job?.job_city ?? '',
                jobProvince: job?.job_province ?? '',
                jobPostalCode: job?.job_postal_code ?? '',
                description: job?.description ?? '',
                paymentTerms: settings?.default_payment_terms ?? '',
                notes: '',
                termsAndConditions: '',
                lines: [],
              }}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
