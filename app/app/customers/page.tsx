import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { EmptyState } from '@/components/ui/section';
import { FilterChips, ListSearch, Pagination } from '@/components/app/list-controls';
import { UsersIcon } from '@/components/icons';
import { requireSession } from '@/lib/auth/current-user';
import { countCustomers, listCustomers } from '@/lib/repositories/customers';
import { formatCurrency } from '@/lib/money';
import { pluralise } from '@/lib/format';

export const metadata: Metadata = { title: 'Customers' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = Promise<{ q?: string; status?: string; page?: string }>;

export default async function CustomersPage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const search = params.q?.trim() || null;
  const status =
    params.status === 'archived' ? 'archived' : params.status === 'all' ? 'all' : 'active';
  const page = Math.max(Number(params.page ?? '1') || 1, 1);

  const [{ rows, total }, counts] = await Promise.all([
    listCustomers(session.businessId, session.userId, {
      search,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    countCustomers(session.businessId, session.userId),
  ]);

  const hasFilters = Boolean(search) || status !== 'active';

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Customers</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Customers</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {counts.active} active
            {counts.total !== counts.active ? ` · ${counts.total - counts.active} archived` : ''} ·
            quotes and invoices attach here
          </p>
        </div>
        <ButtonLink href="/app/customers/new" size="md">
          New customer
        </ButtonLink>
      </header>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ListSearch placeholder="Search name, phone or email…" label="Search customers" />
        <FilterChips
          paramName="status"
          active={status}
          basePath="/app/customers"
          chips={[
            { value: 'active', label: 'Active', count: counts.active },
            { value: 'archived', label: 'Archived', count: counts.total - counts.active },
            { value: 'all', label: 'All', count: counts.total },
          ]}
        />
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<UsersIcon className="h-8 w-8" />}
          title={hasFilters ? 'No customers match that' : 'No customers yet'}
          description={
            hasFilters
              ? 'Try a different search, or switch to All to include archived customers.'
              : 'Add your first customer and their job sites. It takes a few seconds on a phone, and jobs, quotes and invoices hang off it.'
          }
          action={
            hasFilters ? null : (
              <ButtonLink href="/app/customers/new">Add your first customer</ButtonLink>
            )
          }
        />
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {rows.map((customer) => {
            const contact = customer.contact_person ?? null;
            return (
              <li key={customer.id} className="cg-card p-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <Link
                      href={`/app/customers/${customer.id}`}
                      className="text-base font-semibold text-paper hover:text-ember-300"
                    >
                      {customer.business_name}
                    </Link>
                    <p className="mt-1 text-xs uppercase tracking-wide text-steel-500">
                      {customer.customer_type === 'BUSINESS' ? 'Business' : 'Individual'}
                      {customer.billing_city ? ` · ${customer.billing_city}` : ''}
                      {contact ? ` · ${contact}` : ''}
                    </p>
                  </div>
                  {!customer.is_active ? <Badge tone="warning">Archived</Badge> : null}
                </div>

                <div className="mt-3 flex flex-wrap items-center gap-x-4 gap-y-1.5 text-sm">
                  {customer.phone ? (
                    <a
                      href={`tel:${customer.phone.replace(/\s/g, '')}`}
                      className="text-steel-300 hover:text-paper"
                    >
                      {customer.phone}
                    </a>
                  ) : null}
                  {customer.email ? (
                    <a
                      href={`mailto:${customer.email}`}
                      className="truncate text-steel-300 hover:text-paper"
                    >
                      {customer.email}
                    </a>
                  ) : null}
                </div>

                <dl className="mt-3 grid grid-cols-3 gap-2 border-t border-ink-800 pt-3 text-center">
                  <div>
                    <dt className="text-[0.625rem] uppercase tracking-wider text-steel-500">Jobs</dt>
                    <dd className="text-sm font-semibold text-paper">
                      {customer.job_count}
                      {customer.open_job_count > 0 ? (
                        <span className="text-ember-400"> · {customer.open_job_count} open</span>
                      ) : null}
                    </dd>
                  </div>
                  <div>
                    <dt className="text-[0.625rem] uppercase tracking-wider text-steel-500">
                      Quotes
                    </dt>
                    <dd className="text-sm font-semibold text-paper">{customer.quote_count}</dd>
                  </div>
                  <div>
                    <dt className="text-[0.625rem] uppercase tracking-wider text-steel-500">
                      Outstanding
                    </dt>
                    <dd className="text-sm font-semibold text-paper">
                      {formatCurrency(customer.outstanding, session.currencyCode)}
                    </dd>
                  </div>
                </dl>

                <p className="mt-2 text-xs text-steel-500">
                  {pluralise(customer.invoice_count, 'invoice')} on record
                </p>
              </li>
            );
          })}
        </ul>
      )}

      <Pagination
        basePath="/app/customers"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchParams={{ q: search ?? undefined, status }}
      />
    </>
  );
}
