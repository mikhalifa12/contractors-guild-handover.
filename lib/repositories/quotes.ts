import type { PoolClient } from 'pg';
import { isPgError, withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import { applyJobStatus, canTransitionJob, type JobStatus } from '@/lib/jobs';
import { applyQuoteStatus, type QuoteStatus } from '@/lib/quotes';
import { calculateDocumentTotals, centsToAmount, parseAmountToCents } from '@/lib/money';
import { generatePublicToken } from '@/lib/auth/tokens';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Quotes.
 *
 * Money rules (identical to lib/money.ts and the database):
 *  - amounts are parsed to integer cents, rounded half-up per line, then summed
 *  - the server always recomputes the totals from the lines it validated; a
 *    total posted by the browser is ignored, so a tampered form cannot change
 *    what a quote is worth
 *  - a quote line copies the catalogue values, so later catalogue edits never
 *    rewrite an issued document
 *
 * Quote numbers come from the row-locked `document_sequences` upsert inside the
 * same transaction as the insert. `unique (business_id, quote_number)` is the
 * database backstop.
 */
export type QuoteRow = {
  id: string;
  customer_id: string;
  job_id: string | null;
  quote_number: string;
  status: QuoteStatus;
  issue_date: string;
  valid_until: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  job_address_line1: string | null;
  job_address_line2: string | null;
  job_city: string | null;
  job_province: string | null;
  job_postal_code: string | null;
  job_type: string | null;
  description: string | null;
  subtotal: string;
  discount_total: string;
  tax_total: string;
  total: string;
  payment_terms: string | null;
  notes: string | null;
  terms_and_conditions: string | null;
  public_token: string | null;
  sent_at: Date | null;
  viewed_at: Date | null;
  accepted_at: Date | null;
  accepted_by_name: string | null;
  declined_at: Date | null;
  declined_reason: string | null;
  converted_invoice_id: string | null;
  created_at: Date;
  updated_at: Date;
};

export type QuoteItemRow = {
  id: string;
  product_id: string | null;
  line_number: number;
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_percent: string;
  tax_rate: string;
  line_subtotal: string;
  line_discount: string;
  line_tax: string;
  line_total: string;
};

export type QuoteListItem = QuoteRow & {
  customer_name: string;
  customer_type: 'BUSINESS' | 'INDIVIDUAL';
  item_count: number;
  job_number: string | null;
  job_title: string | null;
};

export type QuoteDetail = QuoteRow & {
  items: QuoteItemRow[];
  customer: {
    id: string;
    business_name: string;
    customer_type: 'BUSINESS' | 'INDIVIDUAL';
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_province: string | null;
    billing_postal_code: string | null;
  };
  job: { id: string; job_number: string; title: string; status: JobStatus } | null;
};

export type QuoteItemInput = {
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  discountPercent: number;
  taxRate: number;
};

export type QuoteInput = {
  customerId: string;
  jobId: string | null;
  issueDate: string;
  validUntil: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  jobType: string | null;
  jobAddressLine1: string | null;
  jobAddressLine2: string | null;
  jobCity: string | null;
  jobProvince: string | null;
  jobPostalCode: string | null;
  description: string | null;
  paymentTerms: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  items: QuoteItemInput[];
};

export type QuoteFilterStatus = QuoteStatus | 'ALL' | 'OPEN';

export type QuoteListFilters = {
  search?: string | null;
  status?: QuoteFilterStatus;
  customerId?: string | null;
  jobId?: string | null;
  limit?: number;
  offset?: number;
};

export type QuoteWriteResult =
  | { ok: true; id: string }
  | { ok: false; reason: 'not_found' | 'not_draft' | 'not_allowed' | 'unknown' };

export type QuoteStatusCounts = Record<QuoteStatus | 'ALL' | 'OPEN', number>;

const QUOTE_COLUMNS = `id, customer_id, job_id, quote_number, status, issue_date, valid_until,
  contact_person, contact_phone, contact_email, job_address_line1, job_address_line2, job_city,
  job_province, job_postal_code, job_type, description, subtotal, discount_total, tax_total,
  total, payment_terms, notes, terms_and_conditions, public_token, sent_at, viewed_at,
  accepted_at, accepted_by_name, declined_at, declined_reason, converted_invoice_id,
  created_at, updated_at`;

const ITEM_COLUMNS = `id, product_id, line_number, description, quantity, unit, unit_price,
  discount_percent, tax_rate, line_subtotal, line_discount, line_tax, line_total`;

/** The same columns, qualified for queries that join other tables. */
const Q = (columns: string) =>
  columns
    .split(',')
    .map((column) => `q.${column.trim()}`)
    .join(', ');

/**
 * A quote is "stale" when it is still open but its validity date has passed.
 * Screens show it as EXPIRED, so the filters and counts must agree.
 */
function effectiveStatusSql(prefix = ''): string {
  return `
  case
    when ${prefix}status in ('SENT', 'VIEWED')
      and ${prefix}valid_until is not null
      and ${prefix}valid_until < current_date
    then 'EXPIRED'::text
    else ${prefix}status::text
  end`;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listQuotes(
  businessId: string,
  userId: string,
  filters: QuoteListFilters = {}
): Promise<{ rows: QuoteListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;

  // 'OPEN' means still actionable today, so a quote past its validity date is
  // not counted as open even before anything writes the EXPIRED status.
  const status =
    filters.status && filters.status !== 'ALL' && filters.status !== 'OPEN'
      ? filters.status
      : null;
  const openOnly = filters.status === 'OPEN';

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<QuoteListItem & { total_count: string }>(
      `select ${Q(QUOTE_COLUMNS)},
              c.business_name as customer_name,
              c.customer_type,
              coalesce(i.item_count, 0)::int as item_count,
              j.job_number,
              j.title as job_title,
              count(*) over() as total_count
         from quotes q
         join customers c on c.id = q.customer_id
         left join jobs j on j.id = q.job_id
         left join lateral (
           select count(*) as item_count from quote_items qi where qi.quote_id = q.id
         ) i on true
        where q.business_id = $1
          and ($2::text is null or ${effectiveStatusSql('q.')} = $2)
          and (not $3::boolean
               or (q.status in ('SENT', 'VIEWED')
                   and (q.valid_until is null or q.valid_until >= current_date)))
          and ($4::uuid is null or q.customer_id = $4)
          and ($5::text is null
               or q.quote_number ilike $5
               or coalesce(q.description, '') ilike $5
               or coalesce(j.title, '') ilike $5
               or c.business_name ilike $5)
        order by q.created_at desc
        limit $6 offset $7`,
      [businessId, status, openOnly, filters.customerId ?? null, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getQuoteStatusCounts(
  businessId: string,
  userId: string
): Promise<QuoteStatusCounts> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<Record<string, string>>(
      `select count(*) as all_count,
              count(*) filter (where ${effectiveStatusSql()} in ('SENT', 'VIEWED')) as open_count,
              count(*) filter (where ${effectiveStatusSql()} = 'DRAFT') as draft_count,
              count(*) filter (where ${effectiveStatusSql()} = 'SENT') as sent_count,
              count(*) filter (where ${effectiveStatusSql()} = 'VIEWED') as viewed_count,
              count(*) filter (where ${effectiveStatusSql()} = 'ACCEPTED') as accepted_count,
              count(*) filter (where ${effectiveStatusSql()} = 'DECLINED') as declined_count,
              count(*) filter (where ${effectiveStatusSql()} = 'EXPIRED') as expired_count,
              count(*) filter (where ${effectiveStatusSql()} = 'CONVERTED') as converted_count
         from quotes
        where business_id = $1`,
      [businessId]
    );

    const row = rows[0] ?? {};
    const number = (key: string) => Number(row[key] ?? 0);

    return {
      ALL: number('all_count'),
      OPEN: number('open_count'),
      DRAFT: number('draft_count'),
      SENT: number('sent_count'),
      VIEWED: number('viewed_count'),
      ACCEPTED: number('accepted_count'),
      DECLINED: number('declined_count'),
      EXPIRED: number('expired_count'),
      CONVERTED: number('converted_count'),
    };
  });
}

export async function getQuote(
  businessId: string,
  userId: string,
  quoteId: string
): Promise<QuoteDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<
      QuoteRow & {
        customer_business_name: string;
        customer_type: 'BUSINESS' | 'INDIVIDUAL';
        customer_contact_person: string | null;
        customer_phone: string | null;
        customer_email: string | null;
        billing_address_line1: string | null;
        billing_address_line2: string | null;
        billing_city: string | null;
        billing_province: string | null;
        billing_postal_code: string | null;
        job_number: string | null;
        job_title: string | null;
        job_status: JobStatus | null;
      }
    >(
      `select ${Q(QUOTE_COLUMNS)},
              c.business_name as customer_business_name,
              c.customer_type,
              c.contact_person as customer_contact_person,
              c.phone as customer_phone,
              c.email as customer_email,
              c.billing_address_line1, c.billing_address_line2, c.billing_city,
              c.billing_province, c.billing_postal_code,
              j.job_number, j.title as job_title, j.status as job_status
         from quotes q
         join customers c on c.id = q.customer_id
         left join jobs j on j.id = q.job_id
        where q.id = $1 and q.business_id = $2`,
      [quoteId, businessId]
    );

    const row = rows[0];
    if (!row) return null;

    const { rows: items } = await client.query<QuoteItemRow>(
      `select ${ITEM_COLUMNS} from quote_items where quote_id = $1 order by line_number`,
      [quoteId]
    );

    const {
      customer_business_name,
      customer_type,
      customer_contact_person,
      customer_phone,
      customer_email,
      billing_address_line1,
      billing_address_line2,
      billing_city,
      billing_province,
      billing_postal_code,
      job_number,
      job_title,
      job_status,
      ...quote
    } = row;

    return {
      ...quote,
      items,
      customer: {
        id: quote.customer_id,
        business_name: customer_business_name,
        customer_type,
        contact_person: customer_contact_person,
        phone: customer_phone,
        email: customer_email,
        billing_address_line1,
        billing_address_line2,
        billing_city,
        billing_province,
        billing_postal_code,
      },
      job:
        quote.job_id && job_number && job_title && job_status
          ? { id: quote.job_id, job_number, title: job_title, status: job_status }
          : null,
    };
  });
}

/** Quotes attached to one job (used by the job detail screen). */
export async function listQuotesForJob(
  businessId: string,
  userId: string,
  jobId: string
): Promise<QuoteListItem[]> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<QuoteListItem>(
      `select ${Q(QUOTE_COLUMNS)},
              c.business_name as customer_name,
              c.customer_type,
              coalesce(i.item_count, 0)::int as item_count,
              j.job_number,
              j.title as job_title
         from quotes q
         join customers c on c.id = q.customer_id
         left join jobs j on j.id = q.job_id
         left join lateral (
           select count(*) as item_count from quote_items qi where qi.quote_id = q.id
         ) i on true
        where q.business_id = $1 and q.job_id = $2
        order by q.created_at desc`,
      [businessId, jobId]
    );
    return rows;
  });
}

/** The business's own document defaults, used when a form leaves a field blank. */
async function loadDocumentDefaults(
  client: PoolClient,
  businessId: string
): Promise<{
  quote_prefix: string | null;
  default_payment_terms: string | null;
  default_quote_validity_days: number | null;
}> {
  const { rows } = await client.query<{
    quote_prefix: string | null;
    default_payment_terms: string | null;
    default_quote_validity_days: number | null;
  }>(
    `select quote_prefix, default_payment_terms, default_quote_validity_days
       from business_settings where business_id = $1`,
    [businessId]
  );

  return (
    rows[0] ?? {
      quote_prefix: null,
      default_payment_terms: null,
      default_quote_validity_days: null,
    }
  );
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

/** Server-side totals: the browser's arithmetic is never trusted or stored. */
export function totalsFromItems(items: readonly QuoteItemInput[]) {
  const cents = items.map((item) => ({
    quantity: item.quantity,
    unitPriceCents: parseAmountToCents(item.unitPrice) ?? 0,
    discountPercent: item.discountPercent,
    taxRatePercent: item.taxRate,
  }));

  const totals = calculateDocumentTotals(cents);

  return {
    subtotal: centsToAmount(totals.subtotalCents),
    discountTotal: centsToAmount(totals.discountTotalCents),
    taxTotal: centsToAmount(totals.taxTotalCents),
    total: centsToAmount(totals.totalCents),
    lines: totals.lines.map((line) => ({
      lineSubtotal: centsToAmount(line.lineSubtotalCents),
      lineDiscount: centsToAmount(line.lineDiscountCents),
      lineTax: centsToAmount(line.lineTaxCents),
      lineTotal: centsToAmount(line.lineTotalCents),
    })),
  };
}

async function insertItems(
  client: PoolClient,
  businessId: string,
  quoteId: string,
  items: readonly QuoteItemInput[]
): Promise<void> {
  const totals = totalsFromItems(items);

  for (const [index, item] of items.entries()) {
    const line = totals.lines[index];
    if (!line) continue;

    await client.query(
      `insert into quote_items
         (business_id, quote_id, product_id, line_number, description, quantity, unit,
          unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
          line_total)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        businessId,
        quoteId,
        item.productId,
        index + 1,
        item.description,
        item.quantity,
        item.unit,
        item.unitPrice,
        item.discountPercent,
        item.taxRate,
        line.lineSubtotal,
        line.lineDiscount,
        line.lineTax,
        line.lineTotal,
      ]
    );
  }

}

/**
 * Copy the customer's site address (falling back to the billing address) when
 * the quote does not carry its own, so a contractor on site types less.
 */
async function resolveJobAddress(
  client: PoolClient,
  businessId: string,
  customerId: string,
  input: QuoteInput
): Promise<Pick<QuoteInput, 'jobAddressLine1' | 'jobAddressLine2' | 'jobCity' | 'jobProvince' | 'jobPostalCode'>> {
  const provided = [input.jobAddressLine1, input.jobAddressLine2, input.jobCity].some(Boolean);
  if (provided) {
    return {
      jobAddressLine1: input.jobAddressLine1,
      jobAddressLine2: input.jobAddressLine2,
      jobCity: input.jobCity,
      jobProvince: input.jobProvince,
      jobPostalCode: input.jobPostalCode,
    };
  }

  const { rows } = await client.query<{
    site_address_line1: string | null;
    site_address_line2: string | null;
    site_city: string | null;
    site_province: string | null;
    site_postal_code: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_province: string | null;
    billing_postal_code: string | null;
  }>(
    `select site_address_line1, site_address_line2, site_city, site_province, site_postal_code,
            billing_address_line1, billing_address_line2, billing_city, billing_province,
            billing_postal_code
       from customers where id = $1 and business_id = $2`,
    [customerId, businessId]
  );

  const customer = rows[0];
  if (!customer) {
    return {
      jobAddressLine1: null,
      jobAddressLine2: null,
      jobCity: null,
      jobProvince: null,
      jobPostalCode: null,
    };
  }

  const useSite = Boolean(customer.site_address_line1 ?? customer.site_city);

  return useSite
    ? {
        jobAddressLine1: customer.site_address_line1,
        jobAddressLine2: customer.site_address_line2,
        jobCity: customer.site_city,
        jobProvince: customer.site_province,
        jobPostalCode: customer.site_postal_code,
      }
    : {
        jobAddressLine1: customer.billing_address_line1,
        jobAddressLine2: customer.billing_address_line2,
        jobCity: customer.billing_city,
        jobProvince: customer.billing_province,
        jobPostalCode: customer.billing_postal_code,
      };
}

/** Contact details default to the customer record when the form is left blank. */
async function resolveContact(
  client: PoolClient,
  businessId: string,
  customerId: string,
  input: QuoteInput
): Promise<{ contact_person: string | null; contact_phone: string | null; contact_email: string | null }> {
  if (input.contactPerson || input.contactPhone || input.contactEmail) {
    return {
      contact_person: input.contactPerson,
      contact_phone: input.contactPhone,
      contact_email: input.contactEmail,
    };
  }

  const { rows } = await client.query<{
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  }>(`select contact_person, phone, email from customers where id = $1 and business_id = $2`, [
    customerId,
    businessId,
  ]);

  const customer = rows[0];
  return {
    contact_person: customer?.contact_person ?? null,
    contact_phone: customer?.phone ?? null,
    contact_email: customer?.email ?? null,
  };
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export async function createQuote(
  businessId: string,
  userId: string,
  input: QuoteInput,
  meta: { ipAddress?: string | null; advanceJob?: boolean } = {}
): Promise<QuoteWriteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const defaults = await loadDocumentDefaults(client, businessId);
      const quoteNumber = await allocateDocumentNumber(
        client,
        businessId,
        'QUOTE',
        defaults.quote_prefix ?? undefined
      );

      const validUntil =
        input.validUntil ??
        (defaults.default_quote_validity_days
          ? addDaysIso(input.issueDate, defaults.default_quote_validity_days)
          : null);

      const contact = await resolveContact(client, businessId, input.customerId, input);
      const address = await resolveJobAddress(client, businessId, input.customerId, input);
      const totals = totalsFromItems(input.items);

      const { rows } = await client.query<{ id: string }>(
        `insert into quotes
           (business_id, customer_id, job_id, quote_number, status, issue_date, valid_until,
            contact_person, contact_phone, contact_email, job_address_line1, job_address_line2,
            job_city, job_province, job_postal_code, job_type, description, subtotal,
            discount_total, tax_total, total, payment_terms, notes, terms_and_conditions,
            created_by)
         values ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24)
         returning id`,
        [
          businessId,
          input.customerId,
          input.jobId,
          quoteNumber,
          input.issueDate,
          validUntil,
          contact.contact_person,
          contact.contact_phone,
          contact.contact_email,
          address.jobAddressLine1,
          address.jobAddressLine2,
          address.jobCity,
          address.jobProvince,
          address.jobPostalCode,
          input.jobType,
          input.description,
          totals.subtotal,
          totals.discountTotal,
          totals.taxTotal,
          totals.total,
          input.paymentTerms ?? defaults.default_payment_terms,
          input.notes,
          input.termsAndConditions,
          userId,
        ]
      );

      const quoteId = rows[0]?.id;
      if (!quoteId) throw new Error('Quote insert returned no row');

      await insertItems(client, businessId, quoteId, input.items);

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'quote.created',
        entityType: 'quote',
        entityId: quoteId,
        metadata: {
          quote_number: quoteNumber,
          total: totals.total,
          lines: input.items.length,
          customer_id: input.customerId,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      // A quote usually means the job has been priced: move a lead to Quoted.
      if (input.jobId && meta.advanceJob !== false) {
        const job = await client.query<{ status: JobStatus }>(
          `select status from jobs where id = $1 and business_id = $2 for update`,
          [input.jobId, businessId]
        );
        const current = job.rows[0]?.status;
        if (current && canTransitionJob(current, 'QUOTED')) {
          const moved = await applyJobStatus(client, businessId, input.jobId, 'QUOTED');
          if (moved.updated) {
            await recordAuditEvent(client, {
              businessId,
              userId,
              eventType: 'job.status_changed',
              entityType: 'job',
              entityId: input.jobId,
              metadata: { from: moved.from, to: 'QUOTED', because: 'quote_created' },
              ipAddress: meta.ipAddress ?? null,
            });
          }
        }
      }

      return { ok: true as const, id: quoteId };
    });
  } catch (error) {
    if (isPgError(error, '23505')) {
      return { ok: false, reason: 'unknown' };
    }
    throw error;
  }
}

/**
 * Replace a draft quote's header and lines.
 *
 * Only a DRAFT can be edited: once a quote has been sent its lines are the ones
 * the customer saw, and revision happens by duplicating into a new draft. The
 * DELETE policy added in migration 0006 enforces this in the database too.
 */
export async function updateQuote(
  businessId: string,
  userId: string,
  quoteId: string,
  input: QuoteInput,
  meta: { ipAddress?: string | null } = {}
): Promise<QuoteWriteResult> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ status: QuoteStatus }>(
      `select status from quotes where id = $1 and business_id = $2 for update`,
      [quoteId, businessId]
    );

    const current = rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (current.status !== 'DRAFT') return { ok: false as const, reason: 'not_draft' as const };

    const contact = await resolveContact(client, businessId, input.customerId, input);
    const address = await resolveJobAddress(client, businessId, input.customerId, input);
    const totals = totalsFromItems(input.items);

    const { rowCount } = await client.query(
      `update quotes
          set customer_id = $3, job_id = $4, issue_date = $5, valid_until = $6,
              contact_person = $7, contact_phone = $8, contact_email = $9,
              job_address_line1 = $10, job_address_line2 = $11, job_city = $12,
              job_province = $13, job_postal_code = $14, job_type = $15, description = $16,
              subtotal = $17, discount_total = $18, tax_total = $19, total = $20,
              payment_terms = $21, notes = $22, terms_and_conditions = $23
        where id = $1 and business_id = $2`,
      [
        quoteId,
        businessId,
        input.customerId,
        input.jobId,
        input.issueDate,
        input.validUntil,
        contact.contact_person,
        contact.contact_phone,
        contact.contact_email,
        address.jobAddressLine1,
        address.jobAddressLine2,
        address.jobCity,
        address.jobProvince,
        address.jobPostalCode,
        input.jobType,
        input.description,
        totals.subtotal,
        totals.discountTotal,
        totals.taxTotal,
        totals.total,
        input.paymentTerms,
        input.notes,
        input.termsAndConditions,
      ]
    );

    if (!rowCount) return { ok: false as const, reason: 'not_found' as const };

    await client.query(`delete from quote_items where quote_id = $1 and business_id = $2`, [
      quoteId,
      businessId,
    ]);
    await insertItems(client, businessId, quoteId, input.items);

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'quote.updated',
      entityType: 'quote',
      entityId: quoteId,
      metadata: { total: totals.total, lines: input.items.length },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, id: quoteId };
  });
}

/**
 * Copy a quote into a new draft, including its lines. This is how a contractor
 * revises a quote (or re-quotes a declined one) without touching the document
 * the customer already has.
 */
export async function duplicateQuote(
  businessId: string,
  userId: string,
  quoteId: string,
  meta: { ipAddress?: string | null } = {}
): Promise<QuoteWriteResult> {
  return withContext({ userId, businessId }, async (client) => {
    const source = await client.query<QuoteRow>(
      `select ${QUOTE_COLUMNS} from quotes where id = $1 and business_id = $2`,
      [quoteId, businessId]
    );

    const quote = source.rows[0];
    if (!quote) return { ok: false as const, reason: 'not_found' as const };

    const { rows: items } = await client.query<QuoteItemRow>(
      `select ${ITEM_COLUMNS} from quote_items where quote_id = $1 order by line_number`,
      [quoteId]
    );

    const defaults = await loadDocumentDefaults(client, businessId);
    const quoteNumber = await allocateDocumentNumber(
      client,
      businessId,
      'QUOTE',
      defaults.quote_prefix ?? undefined
    );

    const issueDate = new Date().toISOString().slice(0, 10);
    const { rows } = await client.query<{ id: string }>(
      `insert into quotes
         (business_id, customer_id, job_id, quote_number, status, issue_date, valid_until,
          contact_person, contact_phone, contact_email, job_address_line1, job_address_line2,
          job_city, job_province, job_postal_code, job_type, description, subtotal,
          discount_total, tax_total, total, payment_terms, notes, terms_and_conditions, created_by)
       values ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15, $16,
               $17, $18, $19, $20, $21, $22, $23, $24)
       returning id`,
      [
        businessId,
        quote.customer_id,
        quote.job_id,
        quoteNumber,
        issueDate,
        defaults.default_quote_validity_days
          ? addDaysIso(issueDate, defaults.default_quote_validity_days)
          : quote.valid_until,
        quote.contact_person,
        quote.contact_phone,
        quote.contact_email,
        quote.job_address_line1,
        quote.job_address_line2,
        quote.job_city,
        quote.job_province,
        quote.job_postal_code,
        quote.job_type,
        quote.description,
        quote.subtotal,
        quote.discount_total,
        quote.tax_total,
        quote.total,
        quote.payment_terms,
        quote.notes,
        quote.terms_and_conditions,
        userId,
      ]
    );

    const newId = rows[0]?.id;
    if (!newId) throw new Error('Quote duplicate returned no row');

    for (const item of items) {
      await client.query(
        `insert into quote_items
           (business_id, quote_id, product_id, line_number, description, quantity, unit,
            unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
            line_total)
         values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
        [
          businessId,
          newId,
          item.product_id,
          item.line_number,
          item.description,
          item.quantity,
          item.unit,
          item.unit_price,
          item.discount_percent,
          item.tax_rate,
          item.line_subtotal,
          item.line_discount,
          item.line_tax,
          item.line_total,
        ]
      );
    }

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'quote.duplicated',
      entityType: 'quote',
      entityId: newId,
      metadata: { quote_number: quoteNumber, copied_from: quote.quote_number },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, id: newId };
  });
}

/**
 * Mark a draft as sent and make sure it has a public link. Marking a quote sent
 * is what makes it visible to the customer, so the token is created here.
 */
export async function markQuoteSent(
  businessId: string,
  userId: string,
  quoteId: string,
  meta: { ipAddress?: string | null } = {}
): Promise<{ ok: true; token: string } | { ok: false; reason: 'not_found' | 'not_draft' }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{
      status: QuoteStatus;
      public_token: string | null;
      quote_number: string;
    }>(
      `select status, public_token, quote_number from quotes where id = $1 and business_id = $2 for update`,
      [quoteId, businessId]
    );

    const quote = rows[0];
    if (!quote) return { ok: false as const, reason: 'not_found' as const };
    if (quote.status !== 'DRAFT') return { ok: false as const, reason: 'not_draft' as const };

    const token = quote.public_token ?? generatePublicToken();

    await client.query(
      `update quotes set public_token = coalesce(public_token, $3) where id = $1 and business_id = $2`,
      [quoteId, businessId, token]
    );

    const moved = await applyQuoteStatus(client, businessId, quoteId, 'SENT');
    if (!moved.updated) return { ok: false as const, reason: 'not_draft' as const };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'quote.sent',
      entityType: 'quote',
      entityId: quoteId,
      metadata: { quote_number: quote.quote_number, from: moved.from, to: 'SENT' },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, token };
  });
}

/**
 * Staff-recorded status changes (mark sent / accepted / declined / expired).
 * Customer-driven acceptance goes through app.public_quote_respond() instead.
 */
export async function recordQuoteStatus(
  businessId: string,
  userId: string,
  quoteId: string,
  nextStatus: Extract<QuoteStatus, 'ACCEPTED' | 'DECLINED' | 'EXPIRED'>,
  options: { acceptedByName?: string | null; declinedReason?: string | null; ipAddress?: string | null } = {}
): Promise<{ ok: true; from: QuoteStatus } | { ok: false; reason: 'not_found' | 'not_allowed' }> {
  return withContext({ userId, businessId }, async (client) => {
    const moved = await applyQuoteStatus(client, businessId, quoteId, nextStatus, {
      acceptedByName: options.acceptedByName ?? null,
      declinedReason: options.declinedReason ?? null,
    });

    if (!moved.updated) {
      return { ok: false as const, reason: moved.from ? ('not_allowed' as const) : ('not_found' as const) };
    }

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: `quote.${nextStatus.toLowerCase()}`,
      entityType: 'quote',
      entityId: quoteId,
      metadata: {
        from: moved.from,
        to: nextStatus,
        recorded_by: 'staff',
        ...(options.declinedReason ? { reason: options.declinedReason } : {}),
      },
      ipAddress: options.ipAddress ?? null,
    });

    return { ok: true as const, from: moved.from as QuoteStatus };
  });
}
