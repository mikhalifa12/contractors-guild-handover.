import { withContext } from '@/lib/db';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Customers.
 *
 * Every function takes the business id from the caller (which always resolves
 * it from the server-side session) and runs inside `withContext`, so the row
 * level security policies — not these queries — decide what is visible.
 */
export type CustomerType = 'BUSINESS' | 'INDIVIDUAL';

export type CustomerRow = {
  id: string;
  customer_type: CustomerType;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_province: string | null;
  billing_postal_code: string | null;
  billing_country: string | null;
  site_address_line1: string | null;
  site_address_line2: string | null;
  site_city: string | null;
  site_province: string | null;
  site_postal_code: string | null;
  notes: string | null;
  is_active: boolean;
  created_at: Date;
  updated_at: Date;
};

export type CustomerListItem = {
  id: string;
  customer_type: CustomerType;
  business_name: string;
  contact_person: string | null;
  phone: string | null;
  email: string | null;
  billing_city: string | null;
  is_active: boolean;
  created_at: Date;
  job_count: number;
  quote_count: number;
  invoice_count: number;
  open_job_count: number;
  outstanding: string;
};

export type CustomerListFilters = {
  search?: string | null;
  status?: 'active' | 'archived' | 'all';
  sort?: 'name' | 'recent';
  limit?: number;
  offset?: number;
};

export type CustomerDetail = CustomerRow & {
  job_count: number;
  open_job_count: number;
  quote_count: number;
  invoice_count: number;
  payment_count: number;
  outstanding: string;
  paid_total: string;
};

export type CustomerOption = {
  id: string;
  business_name: string;
  customer_type: CustomerType;
  billing_city: string | null;
  phone: string | null;
};

export type CustomerInput = {
  customerType: CustomerType;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  siteAddressLine1: string | null;
  siteAddressLine2: string | null;
  siteCity: string | null;
  siteProvince: string | null;
  sitePostalCode: string | null;
  notes: string | null;
};

const CUSTOMER_COLUMNS = `id, customer_type, business_name, contact_person, phone, email,
  billing_address_line1, billing_address_line2, billing_city, billing_province,
  billing_postal_code, billing_country, site_address_line1, site_address_line2,
  site_city, site_province, site_postal_code, notes, is_active, created_at, updated_at`;

export async function listCustomers(
  businessId: string,
  userId: string,
  filters: CustomerListFilters = {}
): Promise<{ rows: CustomerListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const activeFilter =
    filters.status === 'archived' ? false : filters.status === 'all' ? null : true;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CustomerListItem & { total_count: string }>(
      `select c.id, c.customer_type, c.business_name, c.contact_person, c.phone, c.email,
              c.billing_city, c.is_active, c.created_at,
              coalesce(j.job_count, 0)::int as job_count,
              coalesce(j.open_job_count, 0)::int as open_job_count,
              coalesce(q.quote_count, 0)::int as quote_count,
              coalesce(i.invoice_count, 0)::int as invoice_count,
              coalesce(i.outstanding, 0)::numeric(14,2) as outstanding,
              count(*) over() as total_count
         from customers c
         left join lateral (
           select count(*) as job_count,
                  count(*) filter (where j.status not in ('COMPLETED', 'CANCELLED')) as open_job_count
             from jobs j
            where j.customer_id = c.id
         ) j on true
         left join lateral (
           select count(*) as quote_count from quotes q where q.customer_id = c.id
         ) q on true
         left join lateral (
           select count(*) as invoice_count,
                  coalesce(sum(v.balance_due) filter (where v.status not in ('PAID', 'CANCELLED')), 0) as outstanding
             from invoices v
            where v.customer_id = c.id
         ) i on true
        where c.business_id = $1
          and ($2::boolean is null or c.is_active = $2)
          and ($3::text is null
               or c.business_name ilike $3
               or coalesce(c.contact_person, '') ilike $3
               or coalesce(c.phone, '') ilike $3
               or coalesce(c.email, '') ilike $3)
        order by ${filters.sort === 'recent' ? 'c.created_at desc' : 'lower(c.business_name) asc'}
        limit $4 offset $5`,
      [businessId, activeFilter, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getCustomer(
  businessId: string,
  userId: string,
  customerId: string
): Promise<CustomerDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CustomerDetail>(
      `select ${CUSTOMER_COLUMNS},
              coalesce(j.job_count, 0)::int as job_count,
              coalesce(j.open_job_count, 0)::int as open_job_count,
              coalesce(q.quote_count, 0)::int as quote_count,
              coalesce(i.invoice_count, 0)::int as invoice_count,
              coalesce(p.payment_count, 0)::int as payment_count,
              coalesce(i.outstanding, 0)::numeric(14,2) as outstanding,
              coalesce(p.paid_total, 0)::numeric(14,2) as paid_total
         from customers c
         left join lateral (
           select count(*) as job_count,
                  count(*) filter (where j.status not in ('COMPLETED', 'CANCELLED')) as open_job_count
             from jobs j where j.customer_id = c.id
         ) j on true
         left join lateral (
           select count(*) as quote_count from quotes q where q.customer_id = c.id
         ) q on true
         left join lateral (
           select count(*) as invoice_count,
                  coalesce(sum(v.balance_due) filter (where v.status not in ('PAID', 'CANCELLED')), 0) as outstanding
             from invoices v where v.customer_id = c.id
         ) i on true
         left join lateral (
           select count(*) as payment_count, coalesce(sum(pay.amount), 0) as paid_total
             from payments pay where pay.customer_id = c.id
         ) p on true
        where c.id = $1 and c.business_id = $2`,
      [customerId, businessId]
    );

    return rows[0] ?? null;
  });
}

/** Called before insert so the form can warn about an obvious duplicate. */
export async function findPossibleDuplicate(
  businessId: string,
  userId: string,
  name: string,
  phone: string | null
): Promise<{ id: string; business_name: string } | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ id: string; business_name: string }>(
      `select id, business_name
         from customers
        where business_id = $1
          and (lower(business_name) = lower($2) or ($3::text is not null and phone = $3))
        order by created_at asc
        limit 1`,
      [businessId, name, phone]
    );
    return rows[0] ?? null;
  });
}

export async function createCustomer(
  businessId: string,
  userId: string,
  input: CustomerInput,
  meta: { ipAddress?: string | null } = {}
): Promise<{ id: string }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into customers
         (business_id, customer_type, business_name, contact_person, phone, email,
          billing_address_line1, billing_address_line2, billing_city, billing_province,
          billing_postal_code, billing_country,
          site_address_line1, site_address_line2, site_city, site_province, site_postal_code,
          notes, created_by)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16, $17, $18, $19)
       returning id`,
      [
        businessId,
        input.customerType,
        input.businessName,
        input.contactPerson,
        input.phone,
        input.email,
        input.billingAddressLine1,
        input.billingAddressLine2,
        input.billingCity,
        input.billingProvince,
        input.billingPostalCode,
        input.billingCountry,
        input.siteAddressLine1,
        input.siteAddressLine2,
        input.siteCity,
        input.siteProvince,
        input.sitePostalCode,
        input.notes,
        userId,
      ]
    );

    const id = rows[0]?.id;
    if (!id) throw new Error('Customer insert returned no row');

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'customer.created',
      entityType: 'customer',
      entityId: id,
      metadata: { name: input.businessName },
      ipAddress: meta.ipAddress ?? null,
    });

    return { id };
  });
}

export async function updateCustomer(
  businessId: string,
  userId: string,
  customerId: string,
  input: CustomerInput,
  meta: { ipAddress?: string | null } = {}
): Promise<{ updated: boolean }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rowCount } = await client.query(
      `update customers
          set customer_type = $3, business_name = $4, contact_person = $5, phone = $6, email = $7,
              billing_address_line1 = $8, billing_address_line2 = $9, billing_city = $10,
              billing_province = $11, billing_postal_code = $12, billing_country = $13,
              site_address_line1 = $14, site_address_line2 = $15, site_city = $16,
              site_province = $17, site_postal_code = $18, notes = $19
        where id = $1 and business_id = $2`,
      [
        customerId,
        businessId,
        input.customerType,
        input.businessName,
        input.contactPerson,
        input.phone,
        input.email,
        input.billingAddressLine1,
        input.billingAddressLine2,
        input.billingCity,
        input.billingProvince,
        input.billingPostalCode,
        input.billingCountry,
        input.siteAddressLine1,
        input.siteAddressLine2,
        input.siteCity,
        input.siteProvince,
        input.sitePostalCode,
        input.notes,
      ]
    );

    if (!rowCount) return { updated: false };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'customer.updated',
      entityType: 'customer',
      entityId: customerId,
      metadata: { name: input.businessName },
      ipAddress: meta.ipAddress ?? null,
    });

    return { updated: true };
  });
}

/**
 * Customers are archived, never deleted: jobs, quotes and invoices reference
 * them, and the application role has no delete policy on tenant tables.
 */
export async function setCustomerArchived(
  businessId: string,
  userId: string,
  customerId: string,
  archived: boolean,
  meta: { ipAddress?: string | null } = {}
): Promise<{ updated: boolean }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rowCount } = await client.query(
      `update customers set is_active = $3 where id = $1 and business_id = $2`,
      [customerId, businessId, !archived]
    );

    if (!rowCount) return { updated: false };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: archived ? 'customer.archived' : 'customer.restored',
      entityType: 'customer',
      entityId: customerId,
      ipAddress: meta.ipAddress ?? null,
    });

    return { updated: true };
  });
}

/** Compact list for the customer picker (job and, later, quote screens). */
export async function listCustomerOptions(
  businessId: string,
  userId: string,
  search?: string | null,
  limit = 200
): Promise<CustomerOption[]> {
  const like = search?.trim() ? `%${search.trim()}%` : null;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<CustomerOption>(
      `select id, business_name, customer_type, billing_city, phone
         from customers
        where business_id = $1
          and is_active
          and ($2::text is null or business_name ilike $2 or coalesce(phone, '') ilike $2)
        order by lower(business_name) asc
        limit $3`,
      [businessId, like, Math.min(Math.max(limit, 1), 500)]
    );
    return rows;
  });
}

export type CustomerHistory = {
  jobs: Array<{
    id: string;
    job_number: string;
    title: string;
    status: string;
    scheduled_date: string | null;
    created_at: Date;
  }>;
  quotes: Array<{
    id: string;
    quote_number: string;
    status: string;
    issue_date: string;
    total: string;
  }>;
  invoices: Array<{
    id: string;
    invoice_number: string;
    status: string;
    issue_date: string;
    due_date: string | null;
    total: string;
    balance_due: string;
  }>;
  payments: Array<{
    id: string;
    amount: string;
    payment_date: string;
    method: string;
    reference: string | null;
    receipt_number: string | null;
  }>;
};

/** Recent documents and payments for the customer detail screen. */
export async function getCustomerHistory(
  businessId: string,
  userId: string,
  customerId: string,
  perSection = 8
): Promise<CustomerHistory> {
  return withContext({ userId, businessId }, async (client) => {
    const limit = Math.min(Math.max(perSection, 1), 50);

    const jobs = await client.query<CustomerHistory['jobs'][number]>(
      `select id, job_number, title, status, scheduled_date, created_at
         from jobs where customer_id = $1 and business_id = $2
        order by created_at desc limit $3`,
      [customerId, businessId, limit]
    );

    const quotes = await client.query<CustomerHistory['quotes'][number]>(
      `select id, quote_number, status, issue_date, total
         from quotes where customer_id = $1 and business_id = $2
        order by issue_date desc, created_at desc limit $3`,
      [customerId, businessId, limit]
    );

    const invoices = await client.query<CustomerHistory['invoices'][number]>(
      `select id, invoice_number, status, issue_date, due_date, total, balance_due
         from invoices where customer_id = $1 and business_id = $2
        order by issue_date desc, created_at desc limit $3`,
      [customerId, businessId, limit]
    );

    const payments = await client.query<CustomerHistory['payments'][number]>(
      `select id, amount, payment_date, method, reference, receipt_number
         from payments where customer_id = $1 and business_id = $2
        order by payment_date desc, created_at desc limit $3`,
      [customerId, businessId, limit]
    );

    return {
      jobs: jobs.rows,
      quotes: quotes.rows,
      invoices: invoices.rows,
      payments: payments.rows,
    };
  });
}

export async function countCustomers(
  businessId: string,
  userId: string
): Promise<{ total: number; active: number }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ total: string; active: string }>(
      `select count(*) as total, count(*) filter (where is_active) as active
         from customers where business_id = $1`,
      [businessId]
    );
    return {
      total: Number(rows[0]?.total ?? 0),
      active: Number(rows[0]?.active ?? 0),
    };
  });
}
