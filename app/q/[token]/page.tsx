import type { Metadata } from 'next';
import { notFound } from 'next/navigation';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { QuoteResponseForm } from '@/components/quotes/quote-response-form';
import { getPublicQuote, markPublicQuoteViewed } from '@/lib/repositories/public-quotes';
import { canCustomerRespond, effectiveQuoteStatus } from '@/lib/quotes';
import { formatDate, humaniseEnum } from '@/lib/format';
import { formatCurrency } from '@/lib/money';
import { WhatsAppIcon } from '@/components/icons';
import { buildWhatsAppLink } from '@/lib/whatsapp';

/**
 * The customer's view of a quote.
 *
 * This is the only page in the product that is reachable without signing in.
 * The token in the URL is the credential: it is unguessable, it opens exactly
 * one quote, and the database function behind it returns only the fields that
 * belong on the document. There is no editable price anywhere on this page —
 * the customer can read, download and answer, and nothing else.
 */
export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Your quote',
  robots: { index: false, follow: false },
};

function compact(lines: Array<string | null | undefined>): string[] {
  return lines.map((line) => (line ?? '').trim()).filter(Boolean);
}

export default async function PublicQuotePage({
  params,
}: {
  params: Promise<{ token: string }>;
}) {
  const { token } = await params;

  // Record the first open (SENT -> VIEWED) before rendering, so the contractor's
  // list agrees with what the customer is looking at right now.
  await markPublicQuoteViewed(token);

  const payload = await getPublicQuote(token);
  if (!payload) notFound();

  const { quote, business, customer, items } = payload;
  const currency = business.currency_code;
  const money = (value: number | string) => formatCurrency(value, currency);

  const status = effectiveQuoteStatus(quote.status, quote.valid_until);
  const decision = canCustomerRespond(quote.status, quote.valid_until);
  const alreadyAnswered = quote.status === 'ACCEPTED' || quote.status === 'DECLINED';
  const businessName = business.trading_name || business.legal_name;

  const siteLines = compact([
    quote.job_address_line1,
    quote.job_address_line2,
    compact([quote.job_city, quote.job_province]).join(', '),
    quote.job_postal_code,
  ]);

  const whatsappHref = business.phone
    ? buildWhatsAppLink(
        business.phone,
        `Hello ${businessName}, about quote ${quote.quote_number}:`
      )
    : null;

  return (
    <div className="min-h-dvh bg-ink-950 pb-16">
      <div className="mx-auto w-full max-w-3xl px-4 py-6 sm:py-10">
        <header className="flex flex-wrap items-start justify-between gap-4">
          <div className="flex items-center gap-3">
            {business.has_logo ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={`/q/${token}/logo`}
                alt={`${businessName} logo`}
                className="h-12 w-auto max-w-[9rem] object-contain"
              />
            ) : (
              <span className="cg-display text-lg text-paper">{businessName}</span>
            )}
          </div>

          <div className="text-right text-xs text-steel-500">
            <p className="text-paper">{businessName}</p>
            {business.phone ? <p>{business.phone}</p> : null}
            {business.email ? <p>{business.email}</p> : null}
          </div>
        </header>

        <div className="mt-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <p className="cg-eyebrow">Quote</p>
            <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">{quote.quote_number}</h1>
          </div>
          <div className="flex items-center gap-2">
            <StatusBadge status={status} />
            <ButtonLink href={`/q/${token}/pdf`} variant="secondary" size="sm">
              Download PDF
            </ButtonLink>
          </div>
        </div>

        <article className="cg-document mt-5 rounded-xl border border-ink-700 shadow-xl">
          <div className="cg-document-rule rounded-t-xl" />

          <div className="space-y-6 p-5 sm:p-7">
            <div className="flex flex-wrap justify-between gap-4">
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] cg-document-muted">
                  Prepared for
                </p>
                <p className="mt-1 text-lg font-semibold">{customer.business_name}</p>
                {customer.contact_person ? (
                  <p className="text-sm cg-document-muted">{customer.contact_person}</p>
                ) : null}
                {compact([
                  customer.billing_address_line1,
                  customer.billing_address_line2,
                  compact([customer.billing_city, customer.billing_province]).join(', '),
                  customer.billing_postal_code,
                ]).map((line) => (
                  <p key={line} className="text-sm cg-document-muted">
                    {line}
                  </p>
                ))}
              </div>

              <dl className="text-sm">
                <div className="flex gap-3">
                  <dt className="cg-document-muted">Issued</dt>
                  <dd className="font-medium">{formatDate(quote.issue_date)}</dd>
                </div>
                {quote.valid_until ? (
                  <div className="flex gap-3">
                    <dt className="cg-document-muted">Valid until</dt>
                    <dd className="font-medium">{formatDate(quote.valid_until)}</dd>
                  </div>
                ) : null}
                {quote.job_type ? (
                  <div className="flex gap-3">
                    <dt className="cg-document-muted">Work</dt>
                    <dd className="font-medium">{quote.job_type}</dd>
                  </div>
                ) : null}
              </dl>
            </div>

            {quote.description ? (
              <p className="whitespace-pre-line text-sm leading-relaxed">{quote.description}</p>
            ) : null}

            {siteLines.length > 0 ? (
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] cg-document-muted">
                  Site
                </p>
                <p className="mt-1 whitespace-pre-line text-sm">{siteLines.join('\n')}</p>
              </div>
            ) : null}

            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead>
                  <tr className="bg-[#fdf3ec] text-[0.625rem] uppercase tracking-[0.12em]">
                    <th className="px-3 py-2 font-bold">#</th>
                    <th className="px-3 py-2 font-bold">Description</th>
                    <th className="px-3 py-2 text-right font-bold">Qty</th>
                    <th className="px-3 py-2 text-right font-bold">Unit price</th>
                    <th className="px-3 py-2 text-right font-bold">VAT</th>
                    <th className="px-3 py-2 text-right font-bold">Line total</th>
                  </tr>
                </thead>
                <tbody>
                  {items.map((item) => (
                    <tr key={item.line_number} className="border-b cg-document-line">
                      <td className="px-3 py-2 cg-document-muted">{item.line_number}</td>
                      <td className="px-3 py-2">{item.description}</td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {Number(item.quantity)} {item.unit}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {money(item.unit_price)}
                      </td>
                      <td className="px-3 py-2 text-right whitespace-nowrap">
                        {Number(item.tax_rate)}%
                      </td>
                      <td className="px-3 py-2 text-right font-medium whitespace-nowrap">
                        {money(item.line_total)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>

            <dl className="ml-auto w-full max-w-xs space-y-1 text-sm">
              <div className="flex justify-between">
                <dt className="cg-document-muted">Subtotal</dt>
                <dd>{money(quote.subtotal)}</dd>
              </div>
              {Number(quote.discount_total) > 0 ? (
                <div className="flex justify-between">
                  <dt className="cg-document-muted">Discount</dt>
                  <dd>-{money(quote.discount_total)}</dd>
                </div>
              ) : null}
              <div className="flex justify-between">
                <dt className="cg-document-muted">VAT</dt>
                <dd>{money(quote.tax_total)}</dd>
              </div>
              <div className="mt-1 flex justify-between border-t-2 border-[#f2700a] pt-2 text-lg font-bold">
                <dt>Total</dt>
                <dd>{money(quote.total)}</dd>
              </div>
            </dl>

            {quote.payment_terms ? (
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] cg-document-muted">
                  Payment terms
                </p>
                <p className="mt-1 whitespace-pre-line text-sm">{quote.payment_terms}</p>
              </div>
            ) : null}

            {quote.notes ? (
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] cg-document-muted">
                  Notes
                </p>
                <p className="mt-1 whitespace-pre-line text-sm">{quote.notes}</p>
              </div>
            ) : null}

            {quote.terms_and_conditions ? (
              <div>
                <p className="text-[0.625rem] font-bold uppercase tracking-[0.16em] cg-document-muted">
                  Terms and conditions
                </p>
                <p className="mt-1 whitespace-pre-line text-sm">{quote.terms_and_conditions}</p>
              </div>
            ) : null}

            {quote.status === 'ACCEPTED' && quote.accepted_at ? (
              <p className="rounded-lg border border-[#2f7d4f]/40 bg-[#eef8f1] px-3 py-2 text-sm text-[#1f5c39]">
                <strong>Accepted</strong>
                {quote.accepted_by_name ? ` by ${quote.accepted_by_name}` : ''} on{' '}
                {formatDate(quote.accepted_at)}
              </p>
            ) : null}

            {quote.declined_at ? (
              <p className="rounded-lg border border-[#b4534c]/40 bg-[#fdf0ef] px-3 py-2 text-sm text-[#8c3b35]">
                <strong>Declined</strong> on {formatDate(quote.declined_at)}
                {quote.declined_reason ? ` — ${quote.declined_reason}` : ''}
              </p>
            ) : null}
          </div>
        </article>

        <section className="mt-6 space-y-4">
          <QuoteResponseForm
            token={token}
            status={quote.status}
            alreadyAnswered={alreadyAnswered}
            canRespond={decision.allowed}
            blockedReason={decision.allowed ? null : decision.reason}
            acceptedByName={quote.accepted_by_name}
          />

          <div className="cg-card p-4 text-sm text-steel-400">
            <p className="font-semibold text-steel-200">Questions about this quote?</p>
            <p className="mt-1">
              {businessName}
              {business.phone ? ` · ${business.phone}` : ''}
              {business.email ? ` · ${business.email}` : ''}
            </p>
            <div className="mt-3 flex flex-wrap gap-2 cg-no-print">
              {whatsappHref ? (
                <a
                  href={whatsappHref}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="inline-flex min-h-10 items-center gap-2 rounded-lg border border-ink-600 px-3 text-xs font-semibold uppercase tracking-wide text-steel-200 hover:border-ember-500 hover:text-paper"
                >
                  <WhatsAppIcon className="h-4 w-4" /> WhatsApp
                </a>
              ) : null}
              {business.phone ? (
                <a
                  href={`tel:${business.phone}`}
                  className="inline-flex min-h-10 items-center rounded-lg border border-ink-600 px-3 text-xs font-semibold uppercase tracking-wide text-steel-200 hover:border-ember-500 hover:text-paper"
                >
                  Call
                </a>
              ) : null}
              <ButtonLink href={`/q/${token}/pdf`} variant="ghost" size="sm">
                Download PDF
              </ButtonLink>
            </div>
          </div>

          <p className="text-center text-xs text-steel-500">
            {quote.quote_number} · {humaniseEnum(quote.status)} · Prices are locked while this quote is
            valid.
          </p>
        </section>
      </div>
    </div>
  );
}
