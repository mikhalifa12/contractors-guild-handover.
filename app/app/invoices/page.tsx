import type { Metadata } from 'next';
import Link from 'next/link';
import { StatusBadge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/section';
import { FilterChips, ListSearch, Pagination } from '@/components/app/list-controls';
import { DocumentIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { getInvoiceMoneySummary, getInvoiceStatusCounts, listInvoices } from '@/lib/repositories/invoices';
import { effectiveInvoiceStatus } from '@/lib/invoices';
import { formatDate, humaniseEnum } from '@/lib/format';
import { formatCurrency } from '@/lib/money';

export const metadata: Metadata = { title: 'Invoices' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

const STATUS_CHIPS = [
  'DRAFT',
  'UNPAID',
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

type SearchParams = Promise<{
  q?: string;
  status?: string;
  customerId?: string;
  page?: string;
  created?: string;
  saved?: string;
  sent?: string;
  converted?: string;
  missing?: string;
  statusUpdated?: string;
  statusError?: string;
}>;

function resolveStatus(value: string | undefined): string {
  if (value && (STATUS_CHIPS as readonly string[]).includes(value)) return value;
  return 'ALL';
}

export default async function InvoicesPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const search = params.q?.trim() || null;
  const status = resolveStatus(params.status);
  const page = Math.max(Number(params.page ?? '1') || 1, 1);

  const [{ rows, total }, counts, money] = await Promise.all([
    listInvoices(session.businessId, session.userId, {
      search,
      status,
      customerId: params.customerId ?? null,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    getInvoiceStatusCounts(session.businessId, session.userId),
    getInvoiceMoneySummary(session.businessId, session.userId),
  ]);

  const currency = session.currencyCode;

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Invoices</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Invoices</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {counts.UNPAID} awaiting payment ·{' '}
            {formatCurrency(money.outstanding_total, currency)} outstanding ·{' '}
            {counts.OVERDUE} overdue
          </p>
        </div>
        <ButtonLink href="/app/invoices/new" size="md">
          New invoice
        </ButtonLink>
      </header>

      {params.created ? (
        <Alert tone="success" title="Draft invoice saved">
          <p>Check the lines below, then mark it sent when it is ready for the customer.</p>
        </Alert>
      ) : null}
      {params.converted ? (
        <Alert tone="success" title="Invoice created from the quote">
          <p>
            Every line and total is a copy of the accepted quote. Send it when you are ready — the
            quote is now marked converted.
          </p>
        </Alert>
      ) : null}
      {params.saved ? (
        <Alert tone="success" title="Draft updated">
          <p>The lines and totals are saved.</p>
        </Alert>
      ) : null}
      {params.sent ? (
        <Alert tone="success" title="Invoice marked as sent">
          <p>The clock on the payment terms starts now. Record the payment when it lands.</p>
        </Alert>
      ) : null}
      {params.statusUpdated ? (
        <Alert tone="info" title="Invoice updated">
          <p>The invoice is now marked {humaniseEnum(params.statusUpdated)}.</p>
        </Alert>
      ) : null}
      {params.statusError ? (
        <Alert tone="danger" title="That did not work">
          <p>
            {params.statusError === 'not_allowed'
              ? 'That step is not allowed from the invoice’s current status.'
              : params.statusError === 'not_draft'
                ? 'Only a draft can be sent — this invoice has already gone out.'
                : params.statusError === 'already_converted'
                  ? 'That quote has already been converted — the invoice exists in your list.'
                  : params.statusError === 'not_convertible'
                    ? 'Only an accepted quote can be converted to an invoice.'
                    : params.statusError === 'missing'
                      ? 'That quote is not in your business.'
                      : 'We could not update the invoice. Please try again.'}
          </p>
        </Alert>
      ) : null}
      {params.missing ? (
        <Alert tone="warning" title="Invoice not found">
          <p>That invoice is not in your business (it may have been removed, or the link was wrong).</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3">
        <ListSearch placeholder="Search invoice number, customer or scope…" label="Search invoices" />
        <FilterChips
          paramName="status"
          active={status}
          basePath="/app/invoices"
          preserve={['q']}
          chips={STATUS_CHIPS.map((value) => ({
            value,
            label: value === 'UNPAID' ? 'Unpaid' : humaniseEnum(value),
            count: counts[value] ?? 0,
          }))}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon className="h-8 w-8" />}
          title={search || status !== 'ALL' ? 'No invoices match that' : 'No invoices yet'}
          description={
            search || status !== 'ALL'
              ? 'Try another search term or switch back to All.'
              : 'An invoice is what you send after the work is done. Convert an accepted quote in one click, or build one from scratch — either way the customer sees the same document.'
          }
          action={
            search || status !== 'ALL' ? null : (
              <ButtonLink href="/app/invoices/new">Create an invoice</ButtonLink>
            )
          }
        />
      ) : (
        <ul className="space-y-3">
          {rows.map((invoice) => {
            const status = effectiveInvoiceStatus(
              invoice.status as never,
              invoice.due_date
            );
            const isStale = status !== invoice.status;
            return (
              <li key={invoice.id} className="cg-card p-4">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-xs text-steel-500">{invoice.invoice_number}</span>
                      <StatusBadge status={status} />
                      {isStale ? <span className="text-xs text-steel-500">past due date</span> : null}
                    </div>
                    <Link
                      href={`/app/invoices/${invoice.id}`}
                      className="mt-1 block text-base font-semibold text-paper hover:text-ember-300"
                    >
                      {invoice.customer_name}
                    </Link>
                    <p className="mt-0.5 text-sm text-steel-400">
                      {invoice.description ? invoice.description.slice(0, 80) : 'No scope summary'}
                      {invoice.quote_number ? ` · from ${invoice.quote_number}` : ''}
                      {invoice.job_number ? ` · ${invoice.job_number}` : ''}
                    </p>
                  </div>

                  <div className="text-right text-xs text-steel-500">
                    <p className="font-mono text-base text-paper">
                      {formatCurrency(invoice.total, currency)}
                    </p>
                    <p>
                      Balance{' '}
                      <span className="font-mono text-steel-300">
                        {formatCurrency(invoice.balance_due, currency)}
                      </span>
                    </p>
                    <p>
                      Issued {formatDate(invoice.issue_date)}
                      {invoice.due_date ? ` · due ${formatDate(invoice.due_date)}` : ''}
                    </p>
                  </div>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        basePath="/app/invoices"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchParams={{ q: search ?? undefined, status, customerId: params.customerId }}
      />
    </>
  );
}
