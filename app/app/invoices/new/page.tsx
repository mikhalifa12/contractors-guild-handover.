import type { Metadata } from 'next';
import Link from 'next/link';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InvoiceForm } from '@/components/forms/invoice-forms';
import { requireSession } from '@/lib/auth/current-user';
import { listCustomerOptions } from '@/lib/repositories/customers';
import { listCatalogueOptions } from '@/lib/repositories/catalogue';
import { getBusinessSettings } from '@/lib/repositories/businesses';
import { getQuote } from '@/lib/repositories/quotes';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'New invoice' };
export const dynamic = 'force-dynamic';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

function isoPlusDays(days: number): string {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

export default async function NewInvoicePage({
  searchParams,
}: {
  searchParams: Promise<{ quoteId?: string; customerId?: string; jobId?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  const [customers, catalogue, settings] = await Promise.all([
    listCustomerOptions(session.businessId, session.userId),
    listCatalogueOptions(session.businessId, session.userId),
    getBusinessSettings(session.businessId, session.userId),
  ]);

  // The accepted quote prefills everything: the contractor sees exactly what
  // the customer agreed to and can adjust the draft before sending.
  const sourceQuote =
    params.quoteId && params.quoteId.trim()
      ? await getQuote(session.businessId, session.userId, params.quoteId)
      : null;

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
        <Link href="/app/invoices" className="cg-eyebrow hover:text-paper">
          ← Invoices
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">New invoice</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Invoice numbers are allocated automatically. Nothing reaches the customer until you mark
          it sent.
        </p>
      </header>

      {params.quoteId && !sourceQuote ? (
        <Alert tone="warning" title="Quote not found">
          <p>
            That quote is not in your business. Build the invoice from scratch below, or open the
            accepted quote and use its Convert button.
          </p>
        </Alert>
      ) : null}

      {sourceQuote && sourceQuote.status !== 'ACCEPTED' ? (
        <Alert tone="warning" title={`Quote is ${humaniseEnum(sourceQuote.status)}`}>
          <p>
            Only an accepted quote can be converted. This prefill copies its lines for a manual
            invoice; for the one-click conversion with the audit trail, get the quote accepted
            first.
          </p>
        </Alert>
      ) : null}

      {sourceQuote ? (
        <Alert tone="info" title={`Prefilled from ${sourceQuote.quote_number}`}>
          <p>
            The lines below are the quote&apos;s stored lines and prices. Saving creates a
            <strong> separate draft invoice</strong>; the quote itself is untouched. To convert with
            the quote marked as converted, open the accepted quote and press{' '}
            <strong>Convert to invoice</strong> there.
          </p>
        </Alert>
      ) : null}

      {customers.length === 0 ? (
        <Alert tone="warning" title="Add a customer first">
          <p>
            An invoice belongs to a customer.{' '}
            <Link href="/app/customers/new" className="font-semibold underline">
              Add a customer
            </Link>{' '}
            — it takes a few seconds — then come back.
          </p>
        </Alert>
      ) : (
        <Card>
          <CardHeader
            title="Invoice details"
            description="Who it is for, what it covers and what it costs"
          />
          <CardBody>
            <InvoiceForm
              customers={options}
              catalogue={catalogue}
              defaultTaxRate={Number(settings?.default_tax_rate ?? 15)}
              currencyCode={session.currencyCode}
              today={isoToday()}
              invoice={{
                customerId: sourceQuote?.customer.id ?? params.customerId ?? '',
                jobId: sourceQuote?.job?.id ?? params.jobId ?? null,
                issueDate: isoToday(),
                dueDate: isoPlusDays(30),
                preparedBy: session.fullName,
                contactPerson: sourceQuote?.contact_person ?? '',
                contactPhone: sourceQuote?.contact_phone ?? '',
                contactEmail: sourceQuote?.contact_email ?? '',
                jobType: sourceQuote?.job_type ?? '',
                jobAddressLine1: sourceQuote?.job_address_line1 ?? '',
                jobAddressLine2: sourceQuote?.job_address_line2 ?? '',
                jobCity: sourceQuote?.job_city ?? '',
                jobProvince: sourceQuote?.job_province ?? '',
                jobPostalCode: sourceQuote?.job_postal_code ?? '',
                description: sourceQuote?.description ?? '',
                paymentTerms: sourceQuote?.payment_terms ?? settings?.default_payment_terms ?? '',
                notes: sourceQuote?.notes ?? '',
                termsAndConditions: sourceQuote?.terms_and_conditions ?? '',
                lines: (sourceQuote?.items ?? []).map((item) => ({
                  key: `line-${item.line_number}`,
                  productId: item.product_id ?? '',
                  description: item.description,
                  quantity: Number(item.quantity).toString(),
                  unit: item.unit,
                  unitPrice: item.unit_price,
                  discountPercent: item.discount_percent,
                  taxRate: item.tax_rate,
                })),
              }}
            />
          </CardBody>
        </Card>
      )}
    </>
  );
}
