import type { Metadata } from 'next';
import Link from 'next/link';
import { Badge } from '@/components/ui/badge';
import { ButtonLink } from '@/components/ui/button';
import { Alert } from '@/components/ui/feedback';
import { EmptyState } from '@/components/ui/section';
import { FilterChips, ListSearch, Pagination } from '@/components/app/list-controls';
import { DocumentIcon } from '@/components/icons';
import { setCatalogueItemArchivedAction } from '@/lib/actions/catalogue';
import { requireSession } from '@/lib/auth/current-user';
import { countCatalogueItems, listCatalogueItems } from '@/lib/repositories/catalogue';
import { formatCurrency } from '@/lib/money';
import { humaniseEnum } from '@/lib/format';

export const metadata: Metadata = { title: 'Products & services' };
export const dynamic = 'force-dynamic';

const PAGE_SIZE = 25;

type SearchParams = Promise<{
  q?: string;
  kind?: string;
  status?: string;
  page?: string;
  saved?: string;
  archived?: string;
  restored?: string;
  error?: string;
}>;

export default async function CataloguePage({ searchParams }: { searchParams: SearchParams }) {
  const session = await requireSession();
  const params = await searchParams;

  const search = params.q?.trim() || null;
  const kind = params.kind === 'PRODUCT' || params.kind === 'SERVICE' ? params.kind : 'ALL';
  const status =
    params.status === 'archived' ? 'archived' : params.status === 'all' ? 'all' : 'active';
  const page = Math.max(Number(params.page ?? '1') || 1, 1);

  const [{ rows, total }, counts] = await Promise.all([
    listCatalogueItems(session.businessId, session.userId, {
      search,
      kind,
      status,
      limit: PAGE_SIZE,
      offset: (page - 1) * PAGE_SIZE,
    }),
    countCatalogueItems(session.businessId, session.userId),
  ]);

  return (
    <>
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="cg-eyebrow">Catalogue</p>
          <h1 className="cg-display mt-1 text-2xl text-paper sm:text-3xl">Products &amp; services</h1>
          <p className="mt-1.5 text-sm text-steel-500">
            {counts.services} services · {counts.products} products · used by the quote builder in
            Phase 3
          </p>
        </div>
        <ButtonLink href="/app/catalogue/new" size="md">
          New item
        </ButtonLink>
      </header>

      {params.saved ? (
        <Alert tone="info" title="Saved">
          <p>The catalogue item was updated.</p>
        </Alert>
      ) : null}
      {params.archived ? (
        <Alert tone="warning" title="Archived">
          <p>Archived items stay on historical documents but no longer appear in pickers.</p>
        </Alert>
      ) : null}
      {params.restored ? (
        <Alert tone="info" title="Restored">
          <p>The item is available again.</p>
        </Alert>
      ) : null}
      {params.error ? (
        <Alert tone="danger" title="That did not work">
          <p>We could not update the item. Refresh the page and try again.</p>
        </Alert>
      ) : null}

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <ListSearch placeholder="Search name, category or SKU…" label="Search catalogue" />
        <div className="flex flex-wrap items-center gap-2">
          <FilterChips
            paramName="kind"
            active={kind}
            basePath="/app/catalogue"
            preserve={['q', 'status']}
            chips={[
              { value: 'ALL', label: 'All types' },
              { value: 'SERVICE', label: 'Services', count: counts.services },
              { value: 'PRODUCT', label: 'Products', count: counts.products },
            ]}
          />
          <FilterChips
            paramName="status"
            active={status}
            basePath="/app/catalogue"
            preserve={['q', 'kind']}
            chips={[
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
              { value: 'all', label: 'Everything' },
            ]}
          />
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<DocumentIcon className="h-8 w-8" />}
          title={search ? 'Nothing matches that search' : 'Your catalogue is empty'}
          description={
            search
              ? 'Try a different word, or clear the filters.'
              : 'Add the services you sell (fault finding, DB board replacement) and the parts you use most, with prices excluding VAT. Building a quote then becomes a few taps.'
          }
          action={search ? null : <ButtonLink href="/app/catalogue/new">Add an item</ButtonLink>}
        />
      ) : (
        <ul className="grid gap-3 xl:grid-cols-2">
          {rows.map((item) => (
            <li key={item.id} className="cg-card p-4">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      href={`/app/catalogue/${item.id}/edit`}
                      className="text-base font-semibold text-paper hover:text-ember-300"
                    >
                      {item.name}
                    </Link>
                    <Badge tone={item.kind === 'SERVICE' ? 'info' : 'ember'}>
                      {humaniseEnum(item.kind)}
                    </Badge>
                    {item.is_active ? null : <Badge tone="warning">Archived</Badge>}
                  </div>
                  {item.description ? (
                    <p className="mt-1 line-clamp-2 text-sm text-steel-400">{item.description}</p>
                  ) : null}
                </div>
                <div className="text-right">
                  <p className="text-base font-semibold text-paper">
                    {formatCurrency(item.default_price, session.currencyCode)}
                  </p>
                  <p className="text-xs text-steel-500">per {item.unit}</p>
                </div>
              </div>

              <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-ink-800 pt-3 text-xs text-steel-500">
                <span>
                  {item.category ?? 'Uncategorised'}
                  {item.sku ? ` · ${item.sku}` : ''} · VAT {Number(item.tax_rate)}%
                </span>
                <span className="flex items-center gap-3">
                  <Link
                    href={`/app/catalogue/${item.id}/edit`}
                    className="font-semibold uppercase tracking-wide text-steel-400 hover:text-paper"
                  >
                    Edit
                  </Link>
                  <form action={setCatalogueItemArchivedAction}>
                    <input type="hidden" name="itemId" value={item.id} />
                    <input type="hidden" name="archived" value={item.is_active ? '1' : '0'} />
                    <button
                      type="submit"
                      className={
                        item.is_active
                          ? 'font-semibold uppercase tracking-wide text-steel-500 hover:text-signal-danger'
                          : 'font-semibold uppercase tracking-wide text-ember-300 hover:text-ember-200'
                      }
                    >
                      {item.is_active ? 'Archive' : 'Restore'}
                    </button>
                  </form>
                </span>
              </div>
            </li>
          ))}
        </ul>
      )}

      <Pagination
        basePath="/app/catalogue"
        page={page}
        pageSize={PAGE_SIZE}
        total={total}
        searchParams={{ q: search ?? undefined, kind, status }}
      />
    </>
  );
}
