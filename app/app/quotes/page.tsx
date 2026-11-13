import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/section';
import { FilterChips, ListSearch, Pagination } from '@/components/app/list-controls';
import { DocumentIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { getQuoteStatusCounts, listQuotes, type QuoteFilterStatus } from '@/lib/repositories/quotes';
import { QUOTE_STATUSES, effectiveQuoteStatus } from '@/lib/quotes';
import { formatDate, humaniseEnum } from '@/lib/format';
import { formatCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Quotes' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  customerId?: string;
  page?: string;
  created?: string;
  saved?: string;
  sent?: string;
  duplicated?: string;
  missing?: string;
  statusUpdated?: string;
  statusError?: string;
}>;

function resolveStatus(value: string | undefined): QuoteFilterStatus {
  if (value === 'OPEN') return 'OPEN';
  if (value && (QUOTE_STATUSES as readonly string[]).includes(value)) {
    return value as QuoteFilterStatus;
  }
  return 'ALL';
}

export default async function QuotesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const search = params.q?.trim() || null;
  const status = resolveStatus(params.status);
  const page = Math.max(Number(params.page ?? '1') || 1, 1);

  const [{ rows, total }, counts] = await Promise.all([
    listQuotes(session.businessId, session.userId, {
      search,
      status,
      customerId: params.customerId ?? null,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getQuoteStatusCounts(session.businessId, session.userId),
  ]);

  const currency = session.currencyCode;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Quotes</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Quotes</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {counts.OPEN} awaiting an answer · {counts.ACCEPTED} accepted · {counts.DRAFT} draft
          </p>
        </div>
        <ButtonLink href="/app/quotes/new" size="md">
          New quote
        </ButtonLink>
      </header>

      {params.created ? (
        <Alert tone="success" title="Draft quote saved">
          <p>Add the lines, check the totals, then mark it as sent to create the customer link.</p>
        </Alert>
      ) : null}
      {params.saved ? (
        <Alert tone="success" title="Quote updated">
          <p>The revised lines and totals are saved.</p>
        </Alert>
      ) : null}
      {params.sent ? (
        <Alert tone="success" title="Quote marked as sent">
          <p>
            The customer link is on the quote. Send it by WhatsApp or email — the customer can accept
            it online.
          </p>
        </Alert>
      ) : null}
      {params.duplicated ? (
        <Alert tone="info" title="Duplicated as a new draft">
          <p>
            You are looking at the copy. The original quote is untouched, so the customer still has
            exactly what was sent to them.
          </p>
        </Alert>
      ) : null}
      {params.statusUpdated ? (
        <Alert tone="info" title="Quote updated">
          <p>The quote is now marked {humaniseEnum(params.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {params.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>
            {params.statusError === 'not_allowed'
              ? 'That step is not allowed from the quote’s current status. Refresh the page to see what is available.'
              : params.statusError === 'reason_required'
                ? 'Add a short reason so the trail says why the quote was declined.'
                : params.statusError === 'not_draft'
                  ? 'Only a draft can be sent. This quote has already been sent.'
                  : 'We could not update the quote. Please try again.'}
          </p>
        </Alert>
      ) : null}
      {params.missing ? (
        <Alert tone="warning" title="Quote not found">
          <p>That quote is not in your business (it may have been removed, or the link was wrong).</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        <ListSearch placeholder="Search quote number, customer or scope…" label="Search quotes" />
        <FilterChips
          paramName="status"
          active={status}
          basePath="/app/quotes"
          preserve={['q']}
          chips={[
            { value: 'ALL', label: 'All', count: counts.ALL },
            { value: 'OPEN', label: 'Awaiting answer', count: counts.OPEN },
            ...QUOTE_STATUSES.map((value) => ({
              value,
              label: humaniseEnum(value),
              count: counts[value],
            })),
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon className="h-8 w-8" />}
          title={search || status !== 'ALL' ? 'No quotes match that' : 'No quotes yet'}
          description={
            search || status !== 'ALL'
              ? 'Try another search term or switch back to All.'
              : 'A quote is what you send before the work starts: priced lines, a validity date and a link the customer can accept online. Accepting a quote records who accepted it and when.'
          }
          action={search || status !== 'ALL' ? null : <ButtonLink href="/app/quotes/new">Create a quote</ButtonLink>}
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((quote) => {
            const status = effectiveQuoteStatus(quote.status, quote.valid_until);
            const isStale = status !== quote.status;
            return (
              <li key={quote.id} className="cg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-steel-500">{quote.quote_number}</span>
                      <StatusBadge status={status} />
                      {isStale ? (
                        <span className="text-xs text-steel-500">
                          validity date passed
                        </span>
                      ) : null}
                    </div>
                    <Link
                      href={`/app/quotes/${quote.id}`}
                      className="mt-1 block text-base font-semibold text-paper hover:text-ember-300"
                    >
                      {quote.customer_name}
                    </Link>
                    <p className="mt-0.5 text-sm text-steel-400">
                      {quote.description ? `${quote.description.slice(0, 80)}` : 'No scope summary'}
                      {quote.job_id ? ' · linked to a job' : ''}
                    </p>
                  </div>

                  <div className="text-right text-xs text-steel-500">
                    <p className="font-mono text-base text-paper">
                      {formatCurrency(quote.total, currency)}
                    </p>
                    <p>
                      {quote.item_count} {quote.item_count === 1 ? 'line' : 'lines'} · issued{' '}
                      {formatDate(quote.issue_date)}
                    </p>
                    {quote.valid_until ? <p>Valid until {formatDate(quote.valid_until)}</p> : null}
                    {quote.accepted_at ? <p>Accepted {formatDate(quote.accepted_at)}</p> : null}
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        basePath="/app/quotes"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchParams={{ q: search ?? undefined, status, customerId: params.customerId }}
      />
    </>
  );
}
