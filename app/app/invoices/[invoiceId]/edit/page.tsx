import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { InvoiceForm } from '@/components/forms/invoice-forms';
import { requireSession } from '@/lib/auth/current-user';
import { getInvoice } from '@/lib/repositories/invoices';
import { listCatalogueOptions } from '@/lib/repositories/catalogue';
import { makeDraftFromPayload } from '@/lib/quote-draft';

export const metadata: Metadata = { title: 'Edit invoice' };
export const dynamic = 'force-dynamic';

export default async function EditInvoicePage({
  params,
}: {
  params: Promise<{ invoiceId: string }>;
}) {
  const session = await requireSession();
  const { invoiceId } = await params;

  const invoice = await getInvoice(session.businessId, session.userId, invoiceId);
  if (!invoice) notFound();

  if (invoice.status !== 'DRAFT') {
    return (
      <>
        <header>
          <Link href={`/app/invoices/${invoiceId}`} className="cg-eyebrow hover:text-paper">
            ← Invoice
          </Link>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Invoice locked</h1>
        </header>
        <Alert tone="warning" title="This invoice has been sent">
          <p>
            Its lines are the ones the customer owes against, so they cannot change. If something is
            wrong, cancel the invoice and create a corrected one.
          </p>
        </Alert>
      </>
    );
  }

  const catalogue = await listCatalogueOptions(session.businessId, session.userId);

  return (
    <>
      <header>
        <Link href={`/app/invoices/${invoiceId}`} className="cg-eyebrow hover:text-paper">
          ← Invoice
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">
          Edit {invoice.invoice_number}
        </h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Totals are recalculated on the server when you save.
        </p>
      </header>

      <Card>
        <CardHeader title="Invoice details" description="Who it is for, what it covers and what it costs" />
        <CardBody>
          <InvoiceForm
            customers={[
              {
                value: invoice.customer.id,
                label: invoice.customer.business_name,
                hint: invoice.customer.phone ?? undefined,
              },
            ]}
            catalogue={catalogue}
            defaultTaxRate={Number(invoice.items[0]?.tax_rate ?? 15)}
            currencyCode={session.currencyCode}
            today={invoice.issue_date}
            invoice={{
              id: invoice.id,
              customerId: invoice.customer_id,
              jobId: invoice.job_id,
              issueDate: invoice.issue_date,
              dueDate: invoice.due_date ?? '',
              preparedBy: invoice.prepared_by ?? '',
              contactPerson: invoice.contact_person ?? '',
              contactPhone: invoice.contact_phone ?? '',
              contactEmail: invoice.contact_email ?? '',
              jobType: invoice.job_type ?? '',
              jobAddressLine1: invoice.job_address_line1 ?? '',
              jobAddressLine2: invoice.job_address_line2 ?? '',
              jobCity: invoice.job_city ?? '',
              jobProvince: invoice.job_province ?? '',
              jobPostalCode: invoice.job_postal_code ?? '',
              description: invoice.description ?? '',
              paymentTerms: invoice.payment_terms ?? '',
              notes: invoice.notes ?? '',
              termsAndConditions: invoice.terms_and_conditions ?? '',
              lines: invoice.items.map((item) =>
                makeDraftFromPayload(
                  {
                    productId: item.product_id,
                    description: item.description,
                    quantity: Number(item.quantity).toString(),
                    unit: item.unit,
                    unitPrice: item.unit_price,
                    discountPercent: item.discount_percent,
                    taxRate: item.tax_rate,
                  },
                  `line-${item.line_number}`
                )
              ),
            }}
          />
        </CardBody>
      </Card>
    </>
  );
}
