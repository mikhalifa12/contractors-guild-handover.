import '@/tests/helpers/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import {
  createCatalogueItemAction,
  setCatalogueItemArchivedAction,
  updateCatalogueItemAction,
} from '@/lib/actions/catalogue';
import {
  countCatalogueItems,
  getCatalogueItem,
  listCatalogueItems,
  listCatalogueOptions,
} from '@/lib/repositories/catalogue';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { expectRedirect, formData, runAction, runFormAction } from '@/tests/helpers/actions';
import { registerOwner } from '@/tests/helpers/owners';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';

function itemForm(overrides: Record<string, string> = {}) {
  return formData({
    kind: 'SERVICE',
    name: 'Distribution board replacement',
    description: 'Includes labour, materials and testing.',
    category: 'Electrical',
    unit: 'job',
    sku: '',
    defaultPrice: '4850',
    costPrice: '2100.50',
    taxRate: '15',
    isActive: 'true',
    ...overrides,
  });
}

async function createItemThroughAction(overrides: Record<string, string> = {}): Promise<string> {
  const outcome = await runAction(createCatalogueItemAction, itemForm(overrides));
  expectRedirect(outcome, '/app/catalogue');
  const id = await withAdminClient(async (client) => {
    const { rows } = await client.query<{ id: string }>(
      'select id from public.products where lower(name) = lower($1) order by created_at desc limit 1',
      [overrides.name ?? 'Distribution board replacement']
    );
    return rows[0]?.id;
  });
  if (!id) throw new Error('Catalogue item was not created');
  return id;
}

describe('catalogue', () => {
  beforeEach(async () => {
    clearRateLimits();
    await resetDatabase();
  });

  it('adds a priced service with normalised money values', async () => {
    const owner = await registerOwner();

    const itemId = await createItemThroughAction();
    const item = await getCatalogueItem(owner.businessId, owner.userId, itemId);

    expect(item?.name).toBe('Distribution board replacement');
    expect(item?.kind).toBe('SERVICE');
    expect(item?.default_price).toBe('4850.00');
    expect(item?.cost_price).toBe('2100.50');
    expect(Number(item?.tax_rate)).toBe(15);
    expect(item?.unit).toBe('job');
    expect(item?.is_active).toBe(true);

    expect(
      await countRows('audit_events', `event_type = 'catalogue.item_created' and entity_id = $1`, [itemId])
    ).toBe(1);
  });

  it('accepts comma decimals and spaces, and rejects bad money', async () => {
    await registerOwner();

    const itemId = await createItemThroughAction({ name: 'Cable', defaultPrice: '1 234,5' });
    const stored = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ default_price: string }>(
        'select default_price from public.products where id = $1',
        [itemId]
      );
      return rows[0]?.default_price;
    });
    expect(stored).toBe('1234.50');

    const invalid = await runAction(
      createCatalogueItemAction,
      itemForm({ name: 'Bad price', defaultPrice: 'about R500' })
    );
    if (invalid.kind !== 'state' || invalid.state.status !== 'error') {
      throw new Error('Expected a validation error');
    }
    expect(invalid.state.fieldErrors.defaultPrice?.length).toBeGreaterThan(0);
  });

  it('refuses to guess when the tax rate is out of range', async () => {
    await registerOwner();

    const outcome = await runAction(
      createCatalogueItemAction,
      itemForm({ name: 'Weird tax', taxRate: '150' })
    );

    if (outcome.kind !== 'state' || outcome.state.status !== 'error') {
      throw new Error('Expected a validation error');
    }
    expect(outcome.state.fieldErrors.taxRate?.length).toBeGreaterThan(0);
    expect(await countRows('products')).toBe(0);
  });

  it('keeps catalogue names unique per business', async () => {
    const owner = await registerOwner();
    await createItemThroughAction();

    const duplicate = await runAction(
      createCatalogueItemAction,
      itemForm({ name: 'distribution board REPLACEMENT' })
    );

    if (duplicate.kind !== 'state' || duplicate.state.status !== 'error') {
      throw new Error('Expected a duplicate name error');
    }
    expect(duplicate.state.code).toBe('duplicate_name');
    expect(await countRows('products', 'business_id = $1', [owner.businessId])).toBe(1);
  });

  it('updates an item and archives it out of the picker', async () => {
    const owner = await registerOwner();
    const itemId = await createItemThroughAction();

    const updated = await runAction(
      updateCatalogueItemAction,
      itemForm({ itemId, defaultPrice: '4999.99', category: 'Electrical' })
    );
    expectRedirect(updated, '/app/catalogue?saved=1');
    expect((await getCatalogueItem(owner.businessId, owner.userId, itemId))?.default_price).toBe(
      '4999.99'
    );

    const archived = await runFormAction(
      setCatalogueItemArchivedAction,
      formData({ itemId, archived: '1' })
    );
    expectRedirect(archived, '/app/catalogue?archived=1');

    expect(await listCatalogueOptions(owner.businessId, owner.userId)).toHaveLength(0);
    const all = await listCatalogueItems(owner.businessId, owner.userId, { status: 'all' });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]?.is_active).toBe(false);

    await runFormAction(setCatalogueItemArchivedAction, formData({ itemId, archived: '0' }));
    expect(await listCatalogueOptions(owner.businessId, owner.userId)).toHaveLength(1);
  });

  it('filters by kind and searches name, category and SKU', async () => {
    const owner = await registerOwner();
    await createItemThroughAction();
    await createItemThroughAction({
      kind: 'PRODUCT',
      name: '20A circuit breaker',
      sku: 'CB-20A',
      category: 'Components',
      unit: 'each',
      defaultPrice: '145',
    });
    await createItemThroughAction({
      kind: 'SERVICE',
      name: 'Certificate of Compliance inspection',
      category: 'Compliance',
      defaultPrice: '1550',
    });

    const products = await listCatalogueItems(owner.businessId, owner.userId, { kind: 'PRODUCT' });
    expect(products.rows.map((row) => row.name)).toEqual(['20A circuit breaker']);

    const bySku = await listCatalogueItems(owner.businessId, owner.userId, { search: 'CB-20A' });
    expect(bySku.rows).toHaveLength(1);

    const byCategory = await listCatalogueItems(owner.businessId, owner.userId, {
      search: 'compliance',
    });
    expect(byCategory.rows).toHaveLength(1);

    const counts = await countCatalogueItems(owner.businessId, owner.userId);
    expect(counts).toEqual({ total: 3, products: 1, services: 2 });
  });

  it('cannot read or change another business\'s catalogue', async () => {
    const first = await registerOwner();
    const itemId = await createItemThroughAction({ name: 'First owner item' });

    const second = await registerOwner();

    // Reads
    expect(await getCatalogueItem(second.businessId, second.userId, itemId)).toBeNull();
    const list = await listCatalogueItems(second.businessId, second.userId, {});
    expect(list.rows).toHaveLength(0);

    // Writes: update is refused, archive affects no rows
    const update = await runAction(
      updateCatalogueItemAction,
      itemForm({ itemId, name: 'Hijacked item' })
    );
    if (update.kind !== 'state' || update.state.status !== 'error') {
      throw new Error('Expected the foreign update to be refused');
    }
    await runFormAction(setCatalogueItemArchivedAction, formData({ itemId, archived: '1' }));

    const untouched = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ name: string; is_active: boolean }>(
        'select name, is_active from public.products where id = $1',
        [itemId]
      );
      return rows[0];
    });
    expect(untouched?.name).toBe('First owner item');
    expect(untouched?.is_active).toBe(true);

    // The first owner still sees it.
    expect(await getCatalogueItem(first.businessId, first.userId, itemId)).not.toBeNull();
  });
});
