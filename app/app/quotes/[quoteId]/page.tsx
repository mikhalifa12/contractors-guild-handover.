import type { Metadata } from 'next';
import Link from 'next/link';
import { headers } from 'next/headers';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { Button, ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { Card, CardBody, CardHeader } from '@/components/ui/card';
import { QuoteActions } from '@/components/quotes/quote-actions';
import { setJobStatusAction } from '@/lib/actions/jobs';
import { requireSession } from '@/lib/auth/current-user';
import { getQuote } from '@/lib/repositories/quotes';
import { listEntityActivity } from '@/lib/repositories/audit';
import { effectiveQuoteStatus, isQuoteEditable } from '@/lib/quotes';
import { canTransitionJob } from '@/lib/jobs';
import { formatDate, formatDateTime, humaniseEnum } from '@/lib/format';
import { formatCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Quote' };
export const dynamic = 'force-dynamic';

type Params = Promise<{ quoteId: string }>;
type SearchParams = Promise<{
  created?: string;
  saved?: string;
  sent?: string;
  duplicated?: string;
  statusUpdated?: string;
  statusError?: string;
}>;

const EVENT_LABELS: Record<string, string> = {
  'quote.created': 'Draft created',
  'quote.updated': 'Draft updated',
  'quote.sent': 'Sent to the customer',
  'quote.viewed': 'Opened by the customer',
  'quote.accepted': 'Accepted',
  'quote.declined': 'Declined',
  'quote.expired': 'Expired',
  'quote.duplicated': 'Duplicated from another quote',
  'quote.converted': 'Converted to an invoice',
  'job.status_changed': 'Job status changed',
};

export default async function QuoteDetailPage({
  params,
  searchParams,
}: {
  params: Params;
  searchParams: SearchParams;
}) {
  const session = await requireSession();
  const { quoteId } = await params;
  const flags = await searchParams;

  const quote = await getQuote(session.businessId, session.userId, quoteId);
  if (!quote) notFound();

  const activity = await listEntityActivity(session.businessId, session.userId, 'quote', quoteId, 25);

  // The share link has to be absolute: a contractor copies it into WhatsApp or
  // an email. Behind a proxy the forwarded headers describe the public origin.
  const headerList = await headers();
  const host = headerList.get('host') ?? 'localhost:3000';
  const protocol = headerList.get('x-forwarded-proto') ?? (host.startsWith('localhost') ? 'http' : 'https');
  const origin = `${protocol}://${host}`;
  const status = effectiveQuoteStatus(quote.status, quote.valid_until);
  const currency = session.currencyCode;
  const money = (value: string) => formatCurrency(value, currency);

  const siteLines = [
    quote.job_address_line1,
    quote.job_address_line2,
    [quote.job_city, quote.job_province].filter(Boolean).join(', '),
    quote.job_postal_code,
  ].filter((line) => Boolean(line && line.trim()));

  return (
    <>
      <header className="space-y-3">
        <Link href="/app/quotes" className="cg-eyebrow hover:text-paper">
          ← Quotes
        </Link>

        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <div className="flex flex-wrap items-center gap-2">
              <span className="font-mono text-sm text-steel-500">{quote.quote_number}</span>
              <StatusBadge status={status} />
            </div>
            <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">
              <Link
                href={`/app/customers/${quote.customer.id}`}
                className="hover:text-ember-300"
              >
                {quote.customer.business_name}
              </Link>
            </h1>
            <p className="mt-1 text-sm text-steel-500">
              Issued {formatDate(quote.issue_date)}
              {quote.valid_until ? ` · valid until ${formatDate(quote.valid_until)}` : ''}
              {quote.job ? (
                <>
                  {' · '}
                  <Link href={`/app/jobs/${quote.job.id}`} className="hover:text-paper">
                    {quote.job.job_number}
                  </Link>
                </>
              ) : null}
            </p>
          </div>

          <div className="text-right">
            <p className="text-xs uppercase tracking-wider text-steel-500">Total</p>
            <p className="font-mono text-2xl text-paper">{money(quote.total)}</p>
          </div>
        </div>
      </header>

      {flags.created ? (
        <Alert tone="success" title="Draft saved">
          <p>Check the lines below, then mark it sent to create the customer link.</p>
        </Alert>
      ) : null}
      {flags.saved ? (
        <Alert tone="success" title="Draft updated">
          <p>The lines and totals are saved.</p>
        </Alert>
      ) : null}
      {flags.sent ? (
        <Alert tone="success" title="Marked as sent">
          <p>Send the customer link below. The quote now shows as issued in your list.</p>
        </Alert>
      ) : null}
      {flags.duplicated ? (
        <Alert tone="info" title="Duplicated">
          <p>
            This is a new draft copied from {quote.items.length} lines. Edit anything you need, then
            send it when it is right.
          </p>
        </Alert>
      ) : null}
      {flags.statusUpdated ? (
        <Alert tone="info" title="Quote updated">
          <p>The quote is now marked {humaniseEnum(flags.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {flags.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>
            {flags.statusError === 'not_allowed'
              ? 'That step is not allowed from the quote’s current status.'
              : flags.statusError === 'reason_required'
                ? 'Add a short reason so the trail says why the quote was declined.'
                : flags.statusError === 'not_draft'
                  ? 'Only a draft can be sent — this quote has already gone out.'
                  : 'We could not update the quote. Please try again.'}
          </p>
        </Alert>
      ) : null}

      {quote.status === 'ACCEPTED' && quote.job && canTransitionJob(quote.job.status, 'APPROVED') ? (
        <Alert tone="success" title="The customer accepted">
          <p>
            Move job {quote.job.job_number} to <strong>Approved</strong> so the schedule reflects it.
          </p>
          <form action={setJobStatusAction}>
            <input type="hidden" name="jobId" value={quote.job.id} />
            <input type="hidden" name="status" value="APPROVED" />
            <input type="hidden" name="returnTo" value={`/app/quotes/${quoteId}`} />
            <Button type="submit" size="sm" variant="secondary">
              Approve the job
            </Button>
          </form>
        </Alert>
      ) : null}

      <div className="grid gap-4 lg:grid-cols-[2fr_1fr]">
        <div className="space-y-4">
          <Card>
            <CardHeader
              title="Lines"
              description={`${quote.items.length} ${quote.items.length === 1 ? 'line' : 'lines'} · totals calculated on the server`}
              action={isQuoteEditable(quote.status) ? (
                <ButtonLink href={`/app/quotes/${quoteId}/edit`} variant="secondary" size="sm">
                  Edit
                </ButtonLink>
              ) : null}
            />
            <CardBody className="space-y-3">
              <ul className="space-y-3 sm:hidden">
                {quote.items.map((item) => (
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
                    {quote.items.map((item) => (
                      <tr key={item.id}>
                        <td className="py-2 font-mono text-xs text-steel-500">
                          {item.line_number}
                        </td>
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
                  <dd className="font-mono">{money(quote.subtotal)}</dd>
                </div>
                <div className="flex justify-between text-sm text-steel-300">
                  <dt>Discount</dt>
                  <dd className="font-mono">{money(quote.discount_total)}</dd>
                </div>
                <div className="flex justify-between text-sm text-steel-300">
                  <dt>VAT</dt>
                  <dd className="font-mono">{money(quote.tax_total)}</dd>
                </div>
                <div className="flex justify-between border-t border-ember-500/40 pt-2 text-base font-semibold text-paper">
                  <dt>Total</dt>
                  <dd className="font-mono">{money(quote.total)}</dd>
                </div>
              </dl>
            </CardBody>
          </Card>

          {quote.description || quote.notes || quote.terms_and_conditions ? (
            <Card>
              <CardHeader title="Scope, notes and terms" />
              <CardBody className="space-y-4 text-sm">
                {quote.description ? (
                  <div>
                    <p className="cg-eyebrow">Scope</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{quote.description}</p>
                  </div>
                ) : null}
                {quote.payment_terms ? (
                  <div>
                    <p className="cg-eyebrow">Payment terms</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{quote.payment_terms}</p>
                  </div>
                ) : null}
                {quote.notes ? (
                  <div>
                    <p className="cg-eyebrow">Notes</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">{quote.notes}</p>
                  </div>
                ) : null}
                {quote.terms_and_conditions ? (
                  <div>
                    <p className="cg-eyebrow">Terms and conditions</p>
                    <p className="mt-1 whitespace-pre-line text-steel-200">
                      {quote.terms_and_conditions}
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
              <QuoteActions
                quoteId={quote.id}
                status={quote.status}
                validUntil={quote.valid_until}
                publicToken={quote.public_token}
                publicUrlBase={origin}
                canEdit={isQuoteEditable(quote.status)}
              />
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="Customer and site" />
            <CardBody className="space-y-3 text-sm">
              <div>
                <p className="cg-eyebrow">Customer</p>
                <p className="mt-1 text-steel-200">{quote.customer.business_name}</p>
                {quote.customer.contact_person ? (
                  <p className="text-steel-400">{quote.customer.contact_person}</p>
                ) : null}
                {quote.customer.phone ? (
                  <p className="text-steel-400">
                    <a href={`tel:${quote.customer.phone}`} className="hover:text-paper">
                      {quote.customer.phone}
                    </a>
                  </p>
                ) : null}
                {quote.customer.email ? (
                  <p className="text-steel-400">
                    <a href={`mailto:${quote.customer.email}`} className="hover:text-paper">
                      {quote.customer.email}
                    </a>
                  </p>
                ) : null}
              </div>

              {siteLines.length > 0 ? (
                <div>
                  <p className="cg-eyebrow">Site</p>
                  <p className="mt-1 whitespace-pre-line text-steel-200">{siteLines.join('\n')}</p>
                  {quote.job_type ? <p className="text-steel-400">{quote.job_type}</p> : null}
                </div>
              ) : null}

              {quote.accepted_at ? (
                <div>
                  <p className="cg-eyebrow">Accepted</p>
                  <p className="mt-1 text-steel-200">
                    {quote.accepted_by_name ?? 'Customer'} · {formatDateTime(quote.accepted_at)}
                  </p>
                </div>
              ) : null}

              {quote.declined_at ? (
                <div>
                  <p className="cg-eyebrow">Declined</p>
                  <p className="mt-1 text-steel-200">
                    {formatDateTime(quote.declined_at)}
                    {quote.declined_reason ? ` — ${quote.declined_reason}` : ''}
                  </p>
                </div>
              ) : null}
            </CardBody>
          </Card>

          <Card>
            <CardHeader title="History" description="Everything that happened to this quote" />
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
                        {typeof event.metadata?.accepted_by === 'string'
                          ? ` · ${event.metadata.accepted_by}`
                          : ''}
                        {typeof event.metadata?.reason === 'string'
                          ? ` · ${event.metadata.reason}`
                          : ''}
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
