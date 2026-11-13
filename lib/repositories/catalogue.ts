import { isPgError, withContext } from '@/lib/db';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Catalogue: products and services in one table with a `kind` discriminator.
 * A quote or invoice line can point at a catalogue item, but the line itself is
 * always a copy, so editing a price later never changes an issued document.
 */
export type CatalogueKind = 'PRODUCT' | 'SERVICE';

export type CatalogueItem = {
  id: string;
  kind: CatalogueKind;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  sku: string | null;
  default_price: string;
  cost_price: string | null;
  tax_rate: string;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type CatalogueListFilters = {
  search?: string | null;
  kind?: CatalogueKind | 'ALL';
  status?: 'active' | 'archived' | 'all';
  limit?: number;
  offset?: number;
};

export type CatalogueInput = {
  kind: CatalogueKind;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  sku: string | null;
  defaultPrice: string;
  costPrice: string | null;
  taxRate: number;
  isActive: boolean;
};

export type CatalogueOption = {
  id: string;
  kind: CatalogueKind;
  name: string;
  description: string | null;
  unit: string;
  default_price: string;
  tax_rate: string;
};

const ITEM_COLUMNS = `id, kind, name, description, category, unit, sku, default_price,
  cost_price, tax_rate, is_active, created_at, updated_at`;

export async function listCatalogueItems(
  businessId: string,
  userId: string,
  filters: CatalogueListFilters = {}
): Promise<{ rows: CatalogueItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const kind = filters.kind && filters.kind !== 'ALL' ? filters.kind : null;
  const activeFilter =
    filters.status === 'archived' ? false : filters.status === 'all' ? null : true;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CatalogueItem & { total_count: string }>(
      `select ${ITEM_COLUMNS}, count(*) over() as total_count
         from products
        where business_id = $1
          and ($2::boolean is null or is_active = $2)
          and ($3::product_kind is null or kind = $3)
          and ($4::text is null
               or name ilike $4
               or coalesce(description, '') ilike $4
               or coalesce(category, '') ilike $4
               or coalesce(sku, '') ilike $4)
        order by is_active desc, kind asc, lower(name) asc
        limit $5 offset $6`,
      [businessId, activeFilter, kind, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getCatalogueItem(
  businessId: string,
  userId: string,
  itemId: string
): Promise<CatalogueItem | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CatalogueItem>(
      `select ${ITEM_COLUMNS} from products where id = $1 and business_id = $2`,
      [itemId, businessId]
    );
    return rows[0] ?? null;
  });
}

export type CatalogueWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'duplicate_name' | 'not_found' | 'unknown'; message?: string };

export async function createCatalogueItem(
  businessId: string,
  userId: string,
  input: CatalogueInput,
  meta: { ipAddress?: string | null } = {}
): Promise<CatalogueWriteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `insert into products
           (business_id, kind, name, description, category, unit, sku,
            default_price, cost_price, tax_rate, is_active, created_by)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12)
         returning id`,
        [
          businessId,
          input.kind,
          input.name,
          input.description,
          input.category,
          input.unit,
          input.sku,
          input.defaultPrice,
          input.costPrice,
          input.taxRate,
          input.isActive,
          userId,
        ]
      );

      const id = rows[0]?.id;
      if (!id) throw new Error('Catalogue insert returned no row');

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'catalogue.item_created',
        entityType: 'product',
        entityId: id,
        metadata: { name: input.name, kind: input.kind },
        ipAddress: meta.ipAddress ?? null,
      });

      return { ok: true as const, id };
    });
  } catch (error) {
    // A unique index on (business_id, lower(name)) keeps the catalogue clean.
    if (isPgError(error, '23505')) {
      return { ok: false, reason: 'duplicate_name' };
    }
    throw error;
  }
}

export async function updateCatalogueItem(
  businessId: string,
  userId: string,
  itemId: string,
  input: CatalogueInput,
  meta: { ipAddress?: string | null } = {}
): Promise<CatalogueWriteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const { rowCount } = await client.query(
        `update products
            set kind = $3, name = $4, description = $5, category = $6, unit = $7, sku = $8,
                default_price = $9, cost_price = $10, tax_rate = $11, is_active = $12
          where id = $1 and business_id = $2`,
        [
          itemId,
          businessId,
          input.kind,
          input.name,
          input.description,
          input.category,
          input.unit,
          input.sku,
          input.defaultPrice,
          input.costPrice,
          input.taxRate,
          input.isActive,
        ]
      );

      if (!rowCount) return { ok: false as const, reason: 'not_found' as const };

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'catalogue.item_updated',
        entityType: 'product',
        entityId: itemId,
        metadata: { name: input.name, kind: input.kind },
        ipAddress: meta.ipAddress ?? null,
      });

      return { ok: true as const, id: itemId };
    });
  } catch (error) {
    if (isPgError(error, '23505')) {
      return { ok: false, reason: 'duplicate_name' };
    }
    throw error;
  }
}

export async function setCatalogueItemArchived(
  businessId: string,
  userId: string,
  itemId: string,
  archived: boolean,
  meta: { ipAddress?: string | null } = {}
): Promise<{ updated: boolean }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rowCount } = await client.query(
      `update products set is_active = $3 where id = $1 and business_id = $2`,
      [itemId, businessId, !archived]
    );

    if (!rowCount) return { updated: false };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: archived ? 'catalogue.item_archived' : 'catalogue.item_restored',
      entityType: 'product',
      entityId: itemId,
      ipAddress: meta.ipAddress ?? null,
    });

    return { updated: true };
  });
}

/** Active items for the quote builder picker (Phase 3 consumes this). */
export async function listCatalogueOptions(
  businessId: string,
  userId: string,
  search?: string | null,
  limit = 300
): Promise<CatalogueOption[]> {
  const like = search?.trim() ? `%${search.trim()}%` : null;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CatalogueOption>(
      `select id, kind, name, description, unit, default_price, tax_rate
         from products
        where business_id = $1
          and is_active
          and ($2::text is null or name ilike $2 or coalesce(sku, '') ilike $2)
        order by kind asc, lower(name) asc
        limit $3`,
      [businessId, like, Math.min(Math.max(limit, 1), 500)]
    );
    return rows;
  });
}

export async function countCatalogueItems(
  businessId: string,
  userId: string
): Promise<{ total: number; products: number; services: number }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ total: string; products: string; services: string }>(
      `select count(*) as total,
              count(*) filter (where kind = 'PRODUCT') as products,
              count(*) filter (where kind = 'SERVICE') as services
         from products where business_id = $1 and is_active`,
      [businessId]
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      products: Number(rows[0]?.products ?? 0),
      services: Number(rows[0]?.services ?? 0),
    };
  });
}
