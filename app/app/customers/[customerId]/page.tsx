import type { Metadata } from 'next';
import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Badge, StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { EmptyState } from '@/components/ui/section';
import { WhatsAppIcon } from '@/components/icons';
import { setCustomerArchivedAction } from '@/lib/actions/customers';
import { requireSession } from '@/lib/auth/current-user';
import { getCustomer, getCustomerHistory } from '@/lib/repositories/customers';
import { listEntityActivity } from '@/lib/repositories/audit';
import { formatCurrency } from '@/lib/money';
import { formatDate, formatDateTime, humaniseEnum, pluralise } from '@/lib/format';
import { buildWhatsAppLink } from '@/lib/whatsapp';

export const dynamic = 'force-dynamic';

export async function generateMetadata({
  params,
}: {
  params: Promise<{ customerId: string }>;
}): Promise<Metadata> {
  const { customerId } = await params;
  const session = await requireSession();
  const customer = await getCustomer(session.businessId, session.userId, customerId);
  return { title: customer?.business_name ?? 'Customer' };
}

function addressLines(parts: Array<string | null>): string[] {
  return parts.filter((part): part is string => Boolean(part && part.trim()));
}

export default async function CustomerDetailPage({
  params,
  searchParams,
}: {
  params: Promise<{ customerId: string }>;
  searchParams: Promise<{ saved?: string; archived?: string; restored?: string; error?: string }>;
}) {
  const session = await requireSession();
  const { customerId } = await params;
  const flags = await searchParams;

  const customer = await getCustomer(session.businessId, session.userId, customerId);
  if (!customer) notFound();

  const [history, activity] = await Promise.all([
    getCustomerHistory(session.businessId, session.userId, customerId),
    listEntityActivity(session.businessId, session.userId, 'customer', customerId),
  ]);

  const billing = addressLines([
    customer.billing_address_line1,
    customer.billing_address_line2,
    [customer.billing_city, customer.billing_province].filter(Boolean).join(', ') || null,
    customer.billing_postal_code,
    customer.billing_country,
  ]);

  const site = addressLines([
    customer.site_address_line1,
    customer.site_address_line2,
    [customer.site_city, customer.site_province].filter(Boolean).join(', ') || null,
    customer.site_postal_code,
  ]);

  const whatsapp = customer.phone
    ? buildWhatsAppLink(
        customer.phone,
        `Hi ${customer.contact_person ?? customer.business_name}, `
      )
    : null;

  return (
    <>
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <Link href="/app/customers" className="cg-eyebrow hover:text-paper">
            ← Customers
          </Link>
          <h1 className="cg-display mt-1 break-words text-2xl text-paper sm:text-3xl">
            {customer.business_name}
          </h1>
          <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-steel-500">
            <Badge>{customer.customer_type === 'BUSINESS' ? 'Business' : 'Individual'}</Badge>
            {customer.is_active ? null : <Badge tone="warning">Archived</Badge>}
            <span>Customer since {formatDate(customer.created_at)}</span>
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <ButtonLink href={`/app/jobs/new?customerId=${customer.id}`} size="md">
            New job
          </ButtonLink>
          <ButtonLink href={`/app/customers/${customer.id}/edit`} variant="secondary" size="md">
            Edit
          </ButtonLink>
        </div>
      </header>

      {flags.saved ? (
        <Alert tone="info" title="Saved">
          <p>Customer details updated.</p>
        </Alert>
      ) : null}
      {flags.archived ? (
        <Alert tone="warning" title="Archived">
          <p>
            This customer is archived. Their history is untouched and they can be restored at any
            time.
          </p>
        </Alert>
      ) : null}
      {flags.restored ? (
        <Alert tone="info" title="Restored">
          <p>This customer is active again and appears in pickers.</p>
        </Alert>
      ) : null}
      {flags.error ? (
        <Alert tone="danger" title="That did not work">
          <p>We could not update this customer. Refresh the page and try again.</p>
        </Alert>
      ) : null}

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        {[
          {
            label: 'Jobs',
            value: String(customer.job_count),
            hint: `${customer.open_job_count} open`,
          },
          { label: 'Quotes', value: String(customer.quote_count), hint: 'Phase 3 builds these' },
          { label: 'Invoices', value: String(customer.invoice_count), hint: `${formatCurrency(customer.paid_total, session.currencyCode)} paid` },
          {
            label: 'Outstanding',
            value: formatCurrency(customer.outstanding, session.currencyCode),
            hint: `${pluralise(customer.invoice_count, 'invoice')} issued`,
          },
        ].map((stat) => (
          <div key={stat.label} className="cg-card p-4">
            <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
              {stat.label}
            </p>
            <p className="mt-1 text-xl font-semibold text-paper">{stat.value}</p>
            <p className="text-xs text-steel-500">{stat.hint}</p>
          </div>
        ))}
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader
            title="Contact"
            description="Tap to call, email or send a WhatsApp message"
            action={
              customer.is_active ? (
                <form action={setCustomerArchivedAction}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="archived" value="1" />
                  <button
                    type="submit"
                    className="text-xs font-semibold uppercase tracking-wide text-steel-500 hover:text-signal-danger"
                  >
                    Archive
                  </button>
                </form>
              ) : (
                <form action={setCustomerArchivedAction}>
                  <input type="hidden" name="customerId" value={customer.id} />
                  <input type="hidden" name="archived" value="0" />
                  <button
                    type="submit"
                    className="text-xs font-semibold uppercase tracking-wide text-ember-300 hover:text-ember-200"
                  >
                    Restore
                  </button>
                </form>
              )
            }
          />
          <CardBody className="space-y-3 text-sm">
            {customer.contact_person ? (
              <p className="text-steel-300">
                <span className="text-steel-500">Contact: </span>
                {customer.contact_person}
              </p>
            ) : null}

            <div className="flex flex-wrap gap-2">
              {customer.phone ? (
                <a
                  href={`tel:${customer.phone.replace(/\s/g, '')}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  {customer.phone}
                </a>
              ) : null}
              {whatsapp ? (
                <a
                  href={whatsapp}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-11 items-center gap-2 rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  <WhatsAppIcon className="h-4 w-4" />
                  WhatsApp
                </a>
              ) : null}
              {customer.email ? (
                <a
                  href={`mailto:${customer.email}`}
                  className="inline-flex min-h-11 items-center rounded-md border border-ink-600 px-4 text-sm font-semibold text-steel-300 hover:border-ember-500 hover:text-paper"
                >
                  Email
                </a>
              ) : null}
            </div>

            {customer.email ? <p className="break-all text-xs text-steel-500">{customer.email}</p> : null}
            {!customer.phone && !customer.email ? (
              <p className="text-xs text-signal-warning">
                No phone number or email on file — add one so quotes and invoices can be sent.
              </p>
            ) : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Addresses" description="Billing and job site" />
          <CardBody className="grid gap-4 text-sm sm:grid-cols-2">
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
                Billing
              </p>
              {billing.length === 0 ? (
                <p className="mt-1 text-steel-500">Not captured yet</p>
              ) : (
                <address className="mt-1 not-italic text-steel-300">
                  {billing.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              )}
            </div>
            <div>
              <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] text-steel-500">
                Job site
              </p>
              {site.length === 0 ? (
                <p className="mt-1 text-steel-500">Same as billing</p>
              ) : (
                <address className="mt-1 not-italic text-steel-300">
                  {site.map((line) => (
                    <span key={line} className="block">
                      {line}
                    </span>
                  ))}
                </address>
              )}
            </div>
          </CardBody>
        </Card>
      </div>

      {customer.notes ? (
        <Card>
          <CardHeader title="Notes" description="Only your business can see this" />
          <CardBody>
            <p className="whitespace-pre-line text-sm text-steel-300">{customer.notes}</p>
          </CardBody>
        </Card>
      ) : null}

      <Card>
        <CardHeader
          title="History"
          description="Jobs, quotes, invoices and payments for this customer"
          action={
            <Link
              href={`/app/jobs?customerId=${customer.id}`}
              className="text-xs font-semibold uppercase tracking-wide text-ember-300 hover:text-ember-200"
            >
              All jobs
            </Link>
          }
        />
        <CardBody className="space-y-5">
          <section>
            <h3 className="cg-eyebrow">Jobs</h3>
            {history.jobs.length === 0 ? (
              <p className="mt-2 text-sm text-steel-500">
                No jobs yet.{' '}
                <Link href={`/app/jobs/new?customerId=${customer.id}`} className="text-ember-300">
                  Create one
                </Link>
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-800">
                {history.jobs.map((job) => (
                  <li key={job.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div className="min-w-0">
                      <Link
                        href={`/app/jobs/${job.id}`}
                        className="text-sm font-semibold text-paper hover:text-ember-300"
                      >
                        {job.title}
                      </Link>
                      <p className="text-xs text-steel-500">
                        {job.job_number}
                        {job.scheduled_date ? ` · ${formatDate(job.scheduled_date)}` : ''}
                      </p>
                    </div>
                    <StatusBadge status={job.status} />
                  </li>
                ))}
              </ul>
            )}
          </section>

          <section className="grid gap-5 sm:grid-cols-2">
            <div>
              <h3 className="cg-eyebrow">Quotes</h3>
              {history.quotes.length === 0 ? (
                <p className="mt-2 text-sm text-steel-500">
                  No quotes yet.{' '}
                  <Link
                    href={`/app/quotes/new?customerId=${customer.id}`}
                    className="underline hover:text-paper"
                  >
                    Create one
                  </Link>
                  .
                </p>
              ) : (
                <ul className="mt-2 divide-y divide-ink-800">
                  {history.quotes.map((quote) => (
                    <li key={quote.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <Link
                          href={`/app/quotes/${quote.id}`}
                          className="text-sm font-semibold text-paper hover:text-ember-300"
                        >
                          {quote.quote_number}
                        </Link>
                        <p className="text-xs text-steel-500">{formatDate(quote.issue_date)}</p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={quote.status} />
                        <p className="mt-1 text-xs text-steel-400">
                          {formatCurrency(quote.total, session.currencyCode)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>

            <div>
              <h3 className="cg-eyebrow">Invoices</h3>
              {history.invoices.length === 0 ? (
                <p className="mt-2 text-sm text-steel-500">No invoices yet.</p>
              ) : (
                <ul className="mt-2 divide-y divide-ink-800">
                  {history.invoices.map((invoice) => (
                    <li key={invoice.id} className="flex items-center justify-between gap-3 py-2.5">
                      <div>
                        <Link
                          href={`/app/invoices/${invoice.id}`}
                          className="text-sm font-semibold text-paper hover:text-ember-300"
                        >
                          {invoice.invoice_number}
                        </Link>
                        <p className="text-xs text-steel-500">
                          Due {invoice.due_date ? formatDate(invoice.due_date) : 'on receipt'}
                        </p>
                      </div>
                      <div className="text-right">
                        <StatusBadge status={invoice.status} />
                        <p className="mt-1 text-xs text-steel-400">
                          Balance {formatCurrency(invoice.balance_due, session.currencyCode)}
                        </p>
                      </div>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </section>

          <section>
            <h3 className="cg-eyebrow">Payments</h3>
            {history.payments.length === 0 ? (
              <p className="mt-2 text-sm text-steel-500">
                No payments recorded yet — record one from any sent invoice.
              </p>
            ) : (
              <ul className="mt-2 divide-y divide-ink-800">
                {history.payments.map((payment) => (
                  <li key={payment.id} className="flex items-center justify-between gap-3 py-2.5">
                    <div>
                      <Link
                        href={`/app/payments/${payment.id}`}
                        className="text-sm font-semibold text-paper hover:text-ember-300"
                      >
                        {formatCurrency(payment.amount, session.currencyCode)}
                      </Link>
                      <p className="text-xs text-steel-500">
                        {formatDate(payment.payment_date)} · {humaniseEnum(payment.method)}
                        {payment.reference ? ` · ${payment.reference}` : ''}
                      </p>
                    </div>
                    <Link
                      href={`/app/payments/${payment.id}`}
                      className="font-mono text-xs text-steel-500 hover:text-paper"
                    >
                      {payment.receipt_number ?? 'Receipt'}
                    </Link>
                  </li>
                ))}
              </ul>
            )}
          </section>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="Activity" description="Everything that happened on this customer" />
        <CardBody>
          {activity.length === 0 ? (
            <EmptyState title="Nothing recorded yet" description="Changes to this customer appear here." />
          ) : (
            <ol className="space-y-3">
              {activity.map((event) => (
                <li key={event.id} className="flex gap-3">
                  <span aria-hidden className="mt-2 h-1.5 w-1.5 shrink-0 rounded-full bg-ember-500" />
                  <div>
                    <p className="text-sm text-steel-300">
                      {humaniseEnum(event.event_type.split('.').slice(1).join(' ') || event.event_type)}
                      {event.actor_name ? ` by ${event.actor_name}` : ''}
                    </p>
                    <p className="text-xs text-steel-500">{formatDateTime(event.created_at)}</p>
                  </div>
                </li>
              ))}
            </ol>
          )}
        </CardBody>
      </Card>
    </>
  );
}
