import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { ButtonLink } from '@/components/ui/button';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { QuoteForm } from '@/components/forms/quote-forms';
import { makeDraftFromPayload } from '@/lib/quote-draft';
import { requireSession } from '@/lib/auth/current-user';
import { listCustomerOptions } from '@/lib/repositories/customers';
import { listCatalogueOptions } from '@/lib/repositories/catalogue';
import { getBusinessSettings } from '@/lib/repositories/businesses';
import { getQuote } from '@/lib/repositories/quotes';
import { isQuoteEditable } from '@/lib/quotes';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Edit quote' };
export const dynamic = 'force-dynamic';

export default async function EditQuotePage({
  params,
}: {
  params: Promise<{ quoteId: string }>;
}) {
  const session = await requireSession();
  const { quoteId } = await params;

  const quote = await getQuote(session.businessId, session.userId, quoteId);
  if (!quote) notFound();

  const [customers, catalogue, settings] = await Promise.all([
    listCustomerOptions(session.businessId, session.userId),
    listCatalogueOptions(session.businessId, session.userId),
    getBusinessSettings(session.businessId, session.userId),
  ]);

  const options = customers.map((customer) => ({
    value: customer.id,
    label: customer.business_name,
    hint: [humaniseEnum(customer.customer_type), customer.billing_city, customer.phone]
      .filter(Boolean)
      .join(' · '),
  }));

  return (
    <>
      <header>
        <Link href={`/app/quotes/${quoteId}`} className="cg-eyebrow hover:text-paper">
          ← {quote.quote_number}
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Edit quote</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Totals are recalculated on save. Only a draft can be edited.
        </p>
      </header>

      {!isQuoteEditable(quote.status) ? (
        <>
          <Alert tone="warning" title="This quote has already been sent">
            <p>
              A quote that a customer has seen is a document, so its lines are locked. Duplicate it to
              make a revised quote — the original stays exactly as it was sent.
            </p>
          </Alert>
          <div className="flex gap-2">
            <ButtonLink href={`/app/quotes/${quoteId}`}>Back to the quote</ButtonLink>
          </div>
        </>
      ) : (
        <Card>
          <CardHeader title="Quote details" description="Change the lines or the terms, then save" />
          <CardBody>
            <QuoteForm
              customers={options}
              catalogue={catalogue}
              defaultTaxRate={Number(settings?.default_tax_rate ?? 15)}
              currencyCode={session.currencyCode}
              today={quote.issue_date}
              defaultValidUntil={quote.valid_until ?? ''}
              quote={{
                id: quote.id,
                customerId: quote.customer_id,
                jobId: quote.job_id,
                issueDate: quote.issue_date,
                validUntil: quote.valid_until ?? '',
                contactPerson: quote.contact_person ?? '',
                contactPhone: quote.contact_phone ?? '',
                contactEmail: quote.contact_email ?? '',
                jobType: quote.job_type ?? '',
                jobAddressLine1: quote.job_address_line1 ?? '',
                jobAddressLine2: quote.job_address_line2 ?? '',
                jobCity: quote.job_city ?? '',
                jobProvince: quote.job_province ?? '',
                jobPostalCode: quote.job_postal_code ?? '',
                description: quote.description ?? '',
                paymentTerms: quote.payment_terms ?? '',
                notes: quote.notes ?? '',
                termsAndConditions: quote.terms_and_conditions ?? '',
                lines: quote.items.map((item) =>
                  makeDraftFromPayload({
                    productId: item.product_id,
                    description: item.description,
                    quantity: String(Number(item.quantity)),
                    unit: item.unit,
                    unitPrice: item.unit_price,
                    discountPercent: String(Number(item.discount_percent)),
                    taxRate: String(Number(item.tax_rate)),
                  })
                ),
              }}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
