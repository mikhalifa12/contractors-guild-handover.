import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { markInvoiceSentAction, setInvoiceStatusAction } from '@/lib/actions/invoices';
import { requireSession } from '@/lib/auth/current-user';
import { getInvoice } from '@/lib/repositories/invoices';
import { listPaymentsForInvoice } from '@/lib/repositories/payments';
import { listEntityActivity } from '@/lib/repositories/audit';
import { effectiveInvoiceStatus } from '@/lib/invoices';
import { formatDate, formatDateTime, humaniseEnum } from '@/lib/format';
import { formatCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Invoice' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ invoiceId: string }>;
type SearchParams = Promise<{
  created?: string;
  saved?: string;
  sent?: string;
  converted?: string;
  statusUpdated?: string;
  statusError?: string;
}>;

const EVENT_LABELS: Record<string, string> = {
  'invoice.created': 'Draft created',
  'invoice.updated': 'Draft updated',
  'invoice.sent': 'Sent to the customer',
  'invoice.cancelled': 'Cancelled',
  'invoice.converted_from_quote': 'Converted from a quote',
  'quote.converted': 'Quote converted to this invoice',
  'invoice.payment_received': 'Payment received',
  'invoice.status_restored': 'Payment reversed — status restored',
  'job.status_changed': 'Job status changed',
};

export default async function InvoiceDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const { invoiceId } = await params;
  const flags = await searchParams;

  const invoice = await getInvoice(session.businessId, session.userId, invoiceId);
  if (!invoice) notFound();

  const [activity, payments] = await Promise.all([
    listEntityActivity(session.businessId, session.userId, 'invoice', invoiceId, 25),
    listPaymentsForInvoice(session.businessId, session.userId, invoiceId),
  ]);

  const status = effectiveInvoiceStatus(invoice.status as never, invoice.due_date);
  const currency = session.currencyCode;
  const money = (value: string) => formatCurrency(value, currency);
  const isDraft = invoice.status === 'DRAFT';
  const canCancel = ['DRAFT', 'SENT', 'VIEWED', 'OVERDUE'].includes(invoice.status);
  const canTakePayment = ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'].includes(invoice.status);

  const siteLines = [
    invoice.job_address_line1,
    invoice.job_address_line2,
    [invoice.job_city, invoice.job_province].filter(Boolean).join(', '),
    invoice.job_postal_code,
  ].filter((line) => Boolean(line && line.trim()));

  return (
    <>
      <header className="space-y-3">
        <Link href="/app/invoices" className="cg-eyebrow hover:text-paper">
          ← Invoices
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-steel-500">{invoice.invoice_number}</span>
              <StatusBadge status={status} />
            </div>
            <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">
              <Link href={`/app/customers/${invoice.customer.id}`} className="hover:text-ember-300">
                {invoice.customer.business_name}
              </Link>
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Issued {formatDate(invoice.issue_date)}
              {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
              {invoice.job ? (
                <>
                  {' · '}
                  <Link href={`/app/jobs/${invoice.job.id}`} className="hover:text-paper">
                    {invoice.job.job_number}
                  </Link>
                </>
              ) : null}
              {invoice.quote ? (
                <>
                  {' · from '}
                  <Link href={`/app/quotes/${invoice.quote.id}`} className="hover:text-paper">
                    {invoice.quote.quote_number}
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-steel-500">Total</p>
            <p className="font-mono text-2xl text-paper">{money(invoice.total)}</p>
            <p className="mt-1 text-xs text-steel-500">
              Balance due <span className="font-mono text-steel-300">{money(invoice.balance_due)}</span>
            </p>
          </div>
        </div>
      </header>

      {flags.created ? (
        <Alert tone="success" title="Draft saved">
          <p>Check the lines below, then mark it sent when it is ready.</p>
        </Alert>
      ) : null}
      {flags.converted ? (
        <Alert tone="success" title="Converted from the accepted quote">
          <p>
            The lines and totals are copies of {invoice.quote?.quote_number ?? 'the quote'} exactly as
            the customer accepted them. Nothing was recalculated.
          </p>
        </Alert>
      ) : null}
      {flags.saved ? (
        <Alert tone="success" title="Draft updated">
          <p>The lines and totals are saved.</p>
        </Alert>
      ) : null}
      {flags.sent ? (
        <Alert tone="success" title="Marked as sent">
          <p>The invoice is now a document the customer owes against.</p>
        </Alert>
      ) : null}
      {flags.statusUpdated ? (
        <Alert tone="info" title="Invoice updated">
          <p>The invoice is now marked {humaniseEnum(flags.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {flags.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>
            {flags.statusError === 'not_allowed'
              ? 'That step is not allowed from the invoice’s current status.'
              : flags.statusError === 'not_draft'
                ? 'Only a draft can be sent — this invoice has already gone out.'
                : 'We could not update the invoice. Please try again.'}
          </p>
        </Alert>
      ) : null}

      {status === 'OVERDUE' && invoice.status !== 'OVERDUE' ? (
        <Alert tone="warning" title="Past its due date">
          <p>
            This invoice is unpaid and its due date has passed. It shows as overdue everywhere until
            it is paid — record a payment below and the status follows the balance.
          </p>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Lines"
              description={`${invoice.items.length} ${invoice.items.length === 1 ? 'line' : 'lines'} · totals calculated on the server`}
              action={
                isDraft ? (
                  <ButtonLink href={`/app/invoices/${invoiceId}/edit`} variant="secondary" size="sm">
                    Edit
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody className="space-y-3">
              <ul className="space-y-3 sm:hidden">
                {invoice.items.map((item) => (
                  <li key={item.id} className="rounded-lg border border-ink-700 p-3">
                    <p className="text-sm font-semibold text-paper">{item.description}</p>
                    <p className="mt-1 text-xs text-steel-500">
                      {Number(item.quantity)} {item.unit} × {money(item.unit_price)}
                      {Number(item.discount_percent) > 0
                        ? ` · ${Number(item.discount_percent)}% discount`
                        : ''}
                      {` · VAT ${Number(item.tax_rate)}%`}
                    </p>
                    <p className="mt-1 text-right font-mono text-sm text-paper">
                      {money(item.line_total)}
                    </p>
                  </li>
                ))}
              </ul>

              <div className="hidden overflow-x-auto sm:block">
                <table className="w-full text-left text-sm">
                  <thead>
                    <tr className="text-xs uppercase tracking-wider text-steel-500">
                      <th className="pb-2 font-semibold">#</th>
                      <th className="pb-2 font-semibold">Description</th>
                      <th className="pb-2 text-right font-semibold">Qty</th>
                      <th className="pb-2 pl-3 text-right font-semibold">Unit price</th>
                      <th className="pb-2 pl-3 text-right font-semibold">Disc</th>
                      <th className="pb-2 pl-3 text-right font-semibold">VAT</th>
                      <th className="pb-2 pl-3 text-right font-semibold">Line total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-ink-700">
                    {invoice.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 font-mono text-xs text-steel-500">{item.line_number}</td>
                        <td className="py-2 text-steel-200">{item.description}</td>
                        <td className="py-2 text-right text-steel-300">
                          {Number(item.quantity)} {item.unit}
                        </td>
                        <td className="py-2 pl-3 text-right font-mono text-steel-300">
                          {money(item.unit_price)}
                        </td>
                        <td className="py-2 pl-3 text-right text-steel-400">
                          {Number(item.discount_percent) > 0
                            ? `${Number(item.discount_percent)}%`
                            : '—'}
                        </td>
                        <td className="py-2 pl-3 text-right text-steel-400">
                          {Number(item.tax_rate)}%
                        </td>
                        <td className="py-2 pl-3 text-right font-mono text-paper">
                          {money(item.line_total)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              <dl className="ml-auto w-full max-w-sm space-y-1 border-t border-ink-700 pt-3">
                <div className="flex justify-between text-sm text-steel-300">
                  <dt>Subtotal</dt>
                  <dd className="font-mono">{money(invoice.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-sm text-steel-300">
                  <dt>Discount</dt>
                  <dd className="font-mono">{money(invoice.discount_total)}</dd>
                </div>
                <div className="flex justify-between text-sm text-steel-300">
                  <dt>VAT</dt>
                  <dd className="font-mono">{money(invoice.tax_total)}</dd>
                </div>
                <div className="flex justify-between border-t border-ember-500/40 pt-2 text-base font-semibold text-paper">
                  <dt>Total</dt>
                  <dd className="font-mono">{money(invoice.total)}</dd>
                </div>
                {Number(invoice.amount_paid) > 0 || !isDraft ? (
                  <>
                    <div className="flex justify-between text-sm text-steel-300">
                      <dt>Amount paid</dt>
                      <dd className="font-mono">{money(invoice.amount_paid)}</dd>
                    </div>
                    <div className="flex justify-between text-sm font-semibold text-paper">
                      <dt>Balance due</dt>
                      <dd className="font-mono">{money(invoice.balance_due)}</dd>
                    </div>
                  </>
                ) : null}
              </dl>
            </CardBody>
          </Card>

          <Card>
            <CardHeader
              title="Payments"
              description={
                payments.length === 0
                  ? 'Nothing received against this invoice yet'
                  : `${payments.length} ${payments.length === 1 ? 'payment' : 'payments'} · ${money(invoice.amount_paid)} received`
              }
              action={
                canTakePayment ? (
                  <ButtonLink
                    href={`/app/payments/new?invoiceId=${invoiceId}`}
                    variant="secondary"
                    size="sm"
                  >
                    Record payment
                  </ButtonLink>
                ) : null
              }
            />
            <CardBody>
              {payments.length === 0 ? (
                <p className="text-sm text-steel-500">
                  {canTakePayment
                    ? 'Record the first payment when the customer pays — in full or in part. The status above follows the balance automatically.'
                    : isDraft
                      ? 'Payments open once the invoice has been sent.'
                      : 'This invoice can no longer take payments.'}
                </p>
              ) : (
                <ul className="divide-y divide-ink-700">
                  {payments.map((payment) => (
                    <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div className="min-w-0">
                        <Link
                          href={`/app/payments/${payment.id}`}
                          className="font-mono text-xs text-steel-400 hover:text-paper"
                        >
                          {payment.receipt_number ?? 'Receipt pending'}
                        </Link>
                        <p className="text-sm text-steel-300">
                          {formatDate(payment.payment_date)} · {humaniseEnum(payment.method)}
                          {payment.reference ? ` · ${payment.reference}` : ''}
                        </p>
                      </div>
                      <p className="font-mono text-sm text-ember-300">
                        +{money(payment.amount)}
                      </p>
                    </li>
                  ))}
                </ul>
              )}
            </CardBody>
          </Card>

          {invoice.description || invoice.notes || invoice.terms_and_conditions ? (
            <Card>
              <CardHeader title="Scope, notes and terms" />
              <CardBody className="space-y-4 text-sm">
                {invoice.description ? (
                  <div>
                    <p className="cg-eyebrow">Scope</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{invoice.description}</p>
                  </div>
                ) : null}
                {invoice.payment_terms ? (
                  <div>
                    <p className="cg-eyebrow">Payment terms</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{invoice.payment_terms}</p>
                  </div>
                ) : null}
                {invoice.notes ? (
                  <div>
                    <p className="cg-eyebrow">Notes</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{invoice.notes}</p>
                  </div>
                ) : null}
                {invoice.terms_and_conditions ? (
                  <div>
                    <p className="cg-eyebrow">Terms and conditions</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">
                      {invoice.terms_and_conditions}
                    </p>
                  </div>
                ) : null}
              </CardBody>
            </Card>
          ) : null}
        </div>

        <div className="space-y-4">
          <Card>
            <CardHeader title="Actions" description="What happens next" />
            <CardBody>
              <div className="space-y-4">
                <div className="flex flex-wrap gap-2">
                  {isDraft ? (
                    <form action={markInvoiceSentAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="returnTo" value={`/app/invoices/${invoiceId}`} />
                      <Button type="submit">Mark as sent</Button>
                    </form>
                  ) : null}

                  {isDraft ? (
                    <ButtonLink href={`/app/invoices/${invoiceId}/edit`}>Edit draft</ButtonLink>
                  ) : null}

                  <ButtonLink href={`/app/invoices/${invoiceId}/pdf`} variant="secondary">
                    Download PDF
                  </ButtonLink>

                  {canTakePayment ? (
                    <ButtonLink href={`/app/payments/new?invoiceId=${invoiceId}`}>
                      Record payment
                    </ButtonLink>
                  ) : null}

                  {canCancel ? (
                    <form action={setInvoiceStatusAction}>
                      <input type="hidden" name="invoiceId" value={invoice.id} />
                      <input type="hidden" name="returnTo" value={`/app/invoices/${invoiceId}`} />
                      <input type="hidden" name="status" value="CANCELLED" />
                      <Button type="submit" variant="danger">
                        Cancel invoice
                      </Button>
                    </form>
                  ) : null}
                </div>

                {status === 'OVERDUE' ? (
                  <p className="cg-hint">
                    Record any payment as it arrives — a part payment clears the overdue flag in the
                    lists by moving the invoice to partially paid.
                  </p>
                ) : null}

                <p className="text-xs text-steel-500">
                  Invoices are never deleted: a cancelled invoice stays as the record of what was
                  billed. <Link href="/app/invoices" className="underline hover:text-paper">Back to invoices</Link>
                </p>
              </div>
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer and site" />
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="cg-eyebrow">Customer</p>
                <p className="mt-1 text-steel-200">{invoice.customer.business_name}</p>
                {invoice.customer.contact_person ? (
                  <p className="text-steel-400">{invoice.customer.contact_person}</p>
                ) : null}
                {invoice.customer.phone ? (
                  <p className="text-steel-400">
                    <a href={`tel:${invoice.customer.phone}`} className="hover:text-paper">
                      {invoice.customer.phone}
                    </a>
                  </p>
                ) : null}
                {invoice.customer.email ? (
                  <p className="text-steel-400">
                    <a href={`mailto:${invoice.customer.email}`} className="hover:text-paper">
                      {invoice.customer.email}
                    </a>
                  </p>
                ) : null}
              </div>

              {siteLines.length > 0 ? (
                <div>
                  <p className="cg-eyebrow">Site</p>
                  <p className="mt-1 whitespace-pre-line text-steel-200">{siteLines.join('\n')}</p>
                  {invoice.job_type ? <p className="text-steel-400">{invoice.job_type}</p> : null}
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Everything that happened to this invoice" />
            <CardBody>
              {activity.length === 0 ? (
                <p className="text-sm text-steel-500">Nothing recorded yet.</p>
              ) : (
                <ol className="space-y-3">
                  {activity.map((event) => (
                    <li key={event.id} className="border-l-2 border-ink-600 pl-3">
                      <p className="text-sm text-steel-200">
                        {EVENT_LABELS[event.event_type] ?? humaniseEnum(event.event_type)}
                      </p>
                      <p className="text-xs text-steel-500">
                        {formatDateTime(event.created_at)}
                        {event.actor_name ? ` · ${event.actor_name}` : ''}
                      </p>
                    </li>
                  ))}
                </ol>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
