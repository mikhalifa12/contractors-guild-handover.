import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { PaymentForm } from '@/components/forms/payment-forms';
import { requireSession } from '@/lib/auth/current-user';
import { listInvoices } from '@/lib/repositories/invoices';

export const metadata: Metadata = { title: 'Record payment' };
export const dynamic = 'force-dynamic';

function isoToday(): string {
  return new Date().toISOString().slice(0, 10);
}

export default async function NewPaymentPage({
  searchParams,
}: {
  searchParams: Promise<{ invoiceId?: string }>;
}) {
  const session = await requireSession();
  const params = await searchParams;

  // Only invoices that can take money right now: sent, viewed, partially paid
  // or overdue. The repository's listInvoices UNPAID filter owns that rule.
  const unpaid = await listInvoices(session.businessId, session.userId, {
    status: 'UNPAID',
    limit: 100,
  });

  if (unpaid.rows.length === 0) {
    return (
      <>
        <header>
          <Link href="/app/payments" className="cg-eyebrow hover:text-paper">
            ← Payments
          </Link>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Record payment</h1>
        </header>

        <Alert tone="info" title="Nothing to collect right now">
          <p>
            Every invoice in your business is either a draft, cancelled or already paid. Record a
            payment once an invoice has been sent and the customer has paid — in full or in part.
          </p>
        </Alert>
      </>
    );
  }

  const invoices = unpaid.rows.map((invoice) => ({
    id: invoice.id,
    label: `${invoice.invoice_number} · ${invoice.customer_name}`,
    hint: [
      invoice.description?.slice(0, 60),
      invoice.job_number ? `Job ${invoice.job_number}` : null,
    ]
      .filter(Boolean)
      .join(' · '),
    balanceDue: invoice.balance_due,
    total: invoice.total,
  }));

  const defaultInvoiceId =
    params.invoiceId && invoices.some((invoice) => invoice.id === params.invoiceId)
      ? params.invoiceId
      : null;

  // A stale ?invoiceId= (already paid or cancelled) falls back to the form
  // with nothing preselected rather than an error.
  if (params.invoiceId && !defaultInvoiceId) {
    redirect('/app/payments/new');
  }

  return (
    <>
      <header>
        <Link href="/app/payments" className="cg-eyebrow hover:text-paper">
          ← Payments
        </Link>
        <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Record payment</h1>
        <p className="mt-1.5 text-sm text-steel-500">
          Part payments are welcome — the invoice becomes partially paid until the balance reaches
          zero, then paid.
        </p>
      </header>

      <Card>
        <CardHeader
          title="Payment details"
          description="Who paid, how much, and how the money moved"
        />
        <CardBody>
          <PaymentForm
            invoices={invoices}
            currencyCode={session.currencyCode}
            today={isoToday()}
            defaultInvoiceId={defaultInvoiceId}
          />
        </CardBody>
      </Card>
    </>
  );
}
