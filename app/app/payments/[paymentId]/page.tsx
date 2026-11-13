import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { StatusBadge } from '@/components/ui/badge';
import { deletePaymentAction } from '@/lib/actions/payments';
import { requireSession } from '@/lib/auth/current-user';
import { getPayment, getReceiptForPayment } from '@/lib/repositories/payments';
import { formatCurrency } from '@/lib/money';
import { formatDate, formatDateTime, humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Receipt' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ paymentId: string }>;
type SearchParams = Promise<{ recorded?: string; statusError?: string }>;

export default async function ReceiptPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const { paymentId } = await params;
  const flags = await searchParams;

  const payment = await getPayment(session.businessId, session.userId, paymentId);
  if (!payment) notFound();

  const receipt = await getReceiptForPayment(session.businessId, session.userId, paymentId);

  const currency = session.currencyCode;
  const money = (value: string) => formatCurrency(value, currency);
  const fullySettled = receipt ? Number(receipt.remaining_balance) <= 0 : false;

  return (
    <>
      <header className="space-y-3">
        <Link href="/app/payments" className="cg-eyebrow hover:text-paper">
          ← Payments
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-steel-500">
                {receipt?.receipt_number ?? 'No receipt'}
              </span>
              <span className="cg-badge">{humaniseEnum(payment.method)}</span>
            </div>
            <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">
              {money(payment.amount)} received
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Paid {formatDate(payment.payment_date)}
              {receipt ? ` · receipt issued ${formatDateTime(receipt.issued_at)}` : ''}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-steel-500">Invoice</p>
            <p className="font-mono text-lg text-paper">
              <Link href={`/app/invoices/${payment.invoice_id}`} className="hover:text-ember-300">
                {payment.invoice_number}
              </Link>
            </p>
          </div>
        </div>
      </header>

      {flags.recorded ? (
        <Alert tone="success" title="Payment recorded">
          <p>
            Receipt {receipt?.receipt_number} was issued for this payment
            {fullySettled ? ' and the invoice is now marked paid in full' : ''}. Download the PDF
            below to send it to the customer.
          </p>
        </Alert>
      ) : null}
      {flags.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>We could not reverse that payment. Please try again.</p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader title="Balance walk" description="What this payment did to the invoice" />
            <CardBody>
              {receipt ? (
                <dl className="ml-auto w-full max-w-sm space-y-1">
                  <div className="flex justify-between text-sm text-steel-300">
                    <dt>Balance before this payment</dt>
                    <dd className="font-mono">{money(receipt.previous_balance)}</dd>
                  </div>
                  <div className="flex justify-between text-sm text-steel-300">
                    <dt>This payment</dt>
                    <dd className="font-mono text-ember-300">−{money(receipt.amount_received)}</dd>
                  </div>
                  <div className="flex justify-between border-t border-ember-500/40 pt-2 text-base font-semibold">
                    <dt className="text-paper">Balance remaining</dt>
                    <dd className={`font-mono ${fullySettled ? 'text-signal-success' : 'text-paper'}`}>
                      {money(receipt.remaining_balance)}
                    </dd>
                  </div>
                </dl>
              ) : (
                <p className="text-sm text-steel-500">
                  No receipt row is attached to this payment (it may predate receipts).
                </p>
              )}

              {fullySettled && receipt ? (
                <div className="mt-4 rounded-lg border border-signal-success/40 bg-signal-success/10 px-4 py-3 text-sm">
                  <p className="font-bold uppercase tracking-wider text-paper">Paid in full</p>
                  <p className="text-steel-300">
                    This payment settled invoice {payment.invoice_number}. Thank you for your
                    business.
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Payment details" />
            <CardBody className="space-y-3 text-sm">
              <div className="grid gap-3 sm:grid-cols-2">
                <div>
                  <p className="cg-eyebrow">Method</p>
                  <p className="mt-1 text-steel-200">{humaniseEnum(payment.method)}</p>
                </div>
                <div>
                  <p className="cg-eyebrow">Reference</p>
                  <p className="mt-1 text-steel-200">{payment.reference ?? '—'}</p>
                </div>
                <div>
                  <p className="cg-eyebrow">Payment date</p>
                  <p className="mt-1 text-steel-200">{formatDate(payment.payment_date)}</p>
                </div>
                <div>
                  <p className="cg-eyebrow">Recorded</p>
                  <p className="mt-1 text-steel-200">{formatDateTime(payment.created_at)}</p>
                </div>
              </div>
              {payment.notes ? (
                <div>
                  <p className="cg-eyebrow">Notes (printed on the receipt)</p>
                  <p className="mt-1 whitespace-pre-line text-steel-200">{payment.notes}</p>
                </div>
              ) : null}
            </CardBody>
          </Card>
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" />
            <CardBody>
              <div className="space-y-4">
                <ButtonLink href={`/app/payments/${paymentId}/pdf`} variant="secondary">
                  Download receipt PDF
                </ButtonLink>

                <ButtonLink href={`/app/invoices/${payment.invoice_id}`}>Open the invoice</ButtonLink>

                <form action={deletePaymentAction}>
                  <input type="hidden" name="paymentId" value={payment.id} />
                  <input type="hidden" name="returnTo" value={`/app/payments`} />
                  <Button type="submit" variant="danger">
                    Reverse payment
                  </Button>
                </form>

                <p className="text-xs text-steel-500">
                  Reversing removes the amount from the invoice&apos;s balance and walks its status
                  back. The receipt and the audit trail are kept — money records are never deleted.
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer" />
            <CardBody className="space-y-1 text-sm">
              <Link
                href={`/app/customers/${payment.customer_id}`}
                className="font-semibold text-paper hover:text-ember-300"
              >
                {payment.customer_name}
              </Link>
              {payment.reference ? (
                <p className="text-steel-400">Reference {payment.reference}</p>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Invoice status" />
            <CardBody>
              <div className="flex items-center gap-2">
                <StatusBadge status={payment.invoice_status} />
              </div>
              <p className="mt-2 text-xs text-steel-500">
                The invoice&apos;s status follows its balance automatically: part payments mark it
                partially paid, the last payment marks it paid.
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
