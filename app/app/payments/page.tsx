import type { Metadata } from 'next';
import Link from 'next/link';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/section';
import { Alert } from '@/components/ui/feedback';
import { CashIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { getPaymentMoneySummary, listPayments } from '@/lib/repositories/payments';
import { formatCurrency } from '@/lib/money';
import { formatDate, humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Payments' };
export const dynamic = 'force-dynamic';

type SearchParams = Promise<{
  reversed?: string;
  missing?: string;
  statusError?: string;
}>;

export default async function PaymentsPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const [{ rows, total }, summary] = await Promise.all([
    listPayments(session.businessId, session.userId, { limit: 100 }),
    getPaymentMoneySummary(session.businessId, session.userId),
  ]);

  const currency = session.currencyCode;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Payments</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Payments</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {formatCurrency(summary.total_received, currency)} received all-time ·{' '}
            {formatCurrency(summary.this_month, currency)} this month · {summary.payment_count}{' '}
            {summary.payment_count === 1 ? 'payment' : 'payments'}
          </p>
        </div>
        <ButtonLink href="/app/payments/new" size="md">
          Record payment
        </ButtonLink>
      </header>

      {params.reversed ? (
        <Alert tone="success" title="Payment reversed">
          <p>
            The amount has been removed from the invoice&apos;s balance and its status walked back.
            The payment and receipt stay on record for the audit trail.
          </p>
        </Alert>
      ) : null}
      {params.missing ? (
        <Alert tone="warning" title="Payment not found">
          <p>That payment is not in your business (it may have been the wrong link).</p>
        </Alert>
      ) : null}
      {params.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>We could not reverse that payment. Please try again.</p>
        </Alert>
      ) : null}

      {rows.length === 0 ? (
        <EmptyState
          icon={<CashIcon className="h-8 w-8" />}
          title={total === 0 ? 'No payments recorded yet' : 'No payments match that'}
          description={
            total === 0
              ? 'When a customer pays — the full invoice or a part payment — record it here. The invoice status updates itself and a numbered receipt is issued instantly.'
              : 'Try another search term or switch back to All.'
          }
          action={
            total === 0 ? <ButtonLink href="/app/payments/new">Record a payment</ButtonLink> : null
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((payment) => (
            <li key={payment.id} className="cg-card p-4">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-mono text-xs text-steel-500">
                      {payment.receipt_number ?? '—'}
                    </span>
                    <span className="cg-badge">{humaniseEnum(payment.method)}</span>
                  </div>
                  <Link
                    href={`/app/payments/${payment.id}`}
                    className="mt-1 block text-base font-semibold text-paper hover:text-ember-300"
                  >
                    {payment.customer_name}
                  </Link>
                  <p className="mt-0.5 text-sm text-steel-400">
                    Against{' '}
                    <Link
                      href={`/app/invoices/${payment.invoice_id}`}
                      className="hover:text-paper"
                    >
                      {payment.invoice_number}
                    </Link>
                    {payment.reference ? ` · ref ${payment.reference}` : ''}
                  </p>
                </div>

                <div className="text-right text-xs text-steel-500">
                  <p className="font-mono text-base text-ember-300">
                    +{formatCurrency(payment.amount, currency)}
                  </p>
                  <p>
                    Paid {formatDate(payment.payment_date)}
                  </p>
                  <p>
                    Invoice{' '}
                    <span className="font-mono text-steel-300">
                      {humaniseEnum(payment.invoice_status)}
                    </span>
                  </p>
                </div>
              </div>
            </li>
          ))}
        </ul>
      )}

      <p className="text-xs text-steel-500">
        Showing {rows.length} of {total} {total === 1 ? 'payment' : 'payments'}. Reversing a
        payment never deletes it — the receipt and the audit trail stay.
      </p>
    </>
  );
}
