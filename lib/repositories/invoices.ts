import { isPgError, withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import {
  applyInvoiceStatus,
  canTransitionInvoice,
  type InvoiceStatus,
} from '@/lib/invoices';
import { calculateDocumentTotals, centsToAmount, parseAmountToCents } from '@/lib/money';
import { generatePublicToken } from '@/lib/auth/tokens';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Invoices.
 *
 * Money rules (identical to lib/money.ts, the quote repository and the PDFs):
 *  - amounts are parsed to integer cents, rounded half-up per line, then summed
 *  - the server always recomputes the totals from the lines it validated; a
 *    total posted by the browser is ignored
 *
 * An invoice created from a quote is a *copy* of the quote at conversion time:
 * lines, customer snapshot and totals are cloned from stored rows, so the
 * invoice always agrees with what the customer accepted. Later quote edits are
 * impossible anyway (only drafts are editable), but the copy also survives a
 * customer record changing after the fact.
 *
 * Invoice numbers come from the row-locked `document_sequences` upsert inside
 * the same transaction as the insert. `unique (business_id, invoice_number)`
 * is the database backstop, and `invoices_quote_unique_idx` guarantees at most
 * one invoice per quote, so a double-click cannot duplicate a document.
 */

export type InvoiceRow = {
  id: string;
  customer_id: string;
  job_id: string | null;
  quote_id: string | null;
  invoice_number: string;
  status: string;
  issue_date: string;
  due_date: string | null;
  prepared_by: string | null;
  contact_person: string | null;
  contact_phone: string | null;
  contact_email: string | null;
  billing_address_line1: string | null;
  billing_address_line2: string | null;
  billing_city: string | null;
  billing_province: string | null;
  billing_postal_code: string | null;
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
  amount_paid: string;
  balance_due: string;
  payment_terms: string | null;
  notes: string | null;
  terms_and_conditions: string | null;
  public_token: string | null;
  sent_at: Date | null;
  viewed_at: Date | null;
  paid_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
};

export type InvoiceItemRow = {
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

export type InvoiceListItem = InvoiceRow & {
  customer_name: string;
  customer_type: string;
  item_count: number;
  job_number: string | null;
  job_title: string | null;
  quote_number: string | null;
};

export type InvoiceDetail = InvoiceRow & {
  items: InvoiceItemRow[];
  customer: {
    id: string;
    business_name: string;
    customer_type: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
  };
  job: { id: string; job_number: string; title: string; status: string } | null;
  quote: { id: string; quote_number: string; status: string } | null;
};

export type InvoiceItemInput = {
  productId: string | null;
  description: string;
  quantity: number;
  unit: string;
  unitPrice: string;
  discountPercent: number;
  taxRate: number;
};

export type InvoiceInput = {
  customerId: string;
  jobId: string | null;
  issueDate: string;
  dueDate: string | null;
  preparedBy: string | null;
  contactPerson: string | null;
  contactPhone: string | null;
  contactEmail: string | null;
  jobType: string | null;
  jobAddressLine1: string | null;
  jobAddressLine2: string | null;
  jobCity: string | null;
  jobProvince: string | null;
  jobPostalCode: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
  description: string | null;
  paymentTerms: string | null;
  notes: string | null;
  termsAndConditions: string | null;
  items: InvoiceItemInput[];
};

export type InvoiceFilterStatus = string;

export type InvoiceListFilters = {
  search?: string | null;
  status?: InvoiceFilterStatus;
  customerId?: string | null;
  jobId?: string | null;
  limit?: number;
  offset?: number;
};

export type InvoiceWriteResult =
  | { ok: true; id: string }
  | {
      ok: false;
      reason: 'not_found' | 'not_draft' | 'not_allowed' | 'already_converted' | 'unknown';
    };

const INVOICE_COLUMNS = `id, customer_id, job_id, quote_id, invoice_number, status, issue_date,
  due_date, prepared_by, contact_person, contact_phone, contact_email,
  billing_address_line1, billing_address_line2, billing_city, billing_province,
  billing_postal_code, job_address_line1, job_address_line2, job_city, job_province,
  job_postal_code, job_type, description, subtotal, discount_total, tax_total, total,
  amount_paid, balance_due, payment_terms, notes, terms_and_conditions, public_token,
  sent_at, viewed_at, paid_at, cancelled_at, created_at, updated_at`;

const ITEM_COLUMNS = `id, product_id, line_number, description, quantity, unit, unit_price,
  discount_percent, tax_rate, line_subtotal, line_discount, line_tax, line_total`;

/** The same columns, qualified for queries that join other tables. */
const I = (columns: string) =>
  columns
    .split(',')
    .map((column) => `i.${column.trim()}`)
    .join(', ');

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listInvoices(
  businessId: string,
  userId: string,
  filters: InvoiceListFilters = {}
): Promise<{ rows: InvoiceListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const unpaidOnly = filters.status === 'UNPAID';
  const status = filters.status && filters.status !== 'ALL' && !unpaidOnly ? filters.status : null;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<InvoiceListItem & { total_count: string }>(
      `select ${I(INVOICE_COLUMNS)},
              c.business_name as customer_name,
              c.customer_type,
              coalesce(it.item_count, 0)::int as item_count,
              j.job_number,
              j.title as job_title,
              q.quote_number,
              count(*) over() as total_count
         from invoices i
         join customers c on c.id = i.customer_id
         left join jobs j on j.id = i.job_id
         left join quotes q on q.id = i.quote_id
         left join lateral (
           select count(*) as item_count from invoice_items ii where ii.invoice_id = i.id
         ) it on true
        where i.business_id = $1
          and ($2::text is null or i.status::text = $2)
          and (not $3::boolean
               or i.status::text in ('SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'))
          and ($4::uuid is null or i.customer_id = $4)
          and ($5::text is null
               or i.invoice_number ilike $5
               or coalesce(i.description, '') ilike $5
               or coalesce(j.title, '') ilike $5
               or c.business_name ilike $5)
        order by i.created_at desc
        limit $6 offset $7`,
      [businessId, status, unpaidOnly, filters.customerId ?? null, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getInvoiceStatusCounts(
  businessId: string,
  userId: string
): Promise<Record<string, number>> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<Record<string, string>>(
      `select count(*) as all_count,
              count(*) filter (where status::text in ('SENT','VIEWED','PARTIALLY_PAID','OVERDUE'))
                as unpaid_count,
              count(*) filter (where status = 'DRAFT') as draft_count,
              count(*) filter (where status = 'SENT') as sent_count,
              count(*) filter (where status = 'VIEWED') as viewed_count,
              count(*) filter (where status = 'PARTIALLY_PAID') as partially_paid_count,
              count(*) filter (where status = 'PAID') as paid_count,
              count(*) filter (where (status in ('SENT','VIEWED','PARTIALLY_PAID')
                                        and due_date is not null and due_date < current_date)
                                  or status = 'OVERDUE') as overdue_count,
              count(*) filter (where status = 'CANCELLED') as cancelled_count
         from invoices
        where business_id = $1`,
      [businessId]
    );

    const row = rows[0] ?? {};
    const number = (key: string) => Number(row[key] ?? 0);

    return {
      ALL: number('all_count'),
      UNPAID: number('unpaid_count'),
      DRAFT: number('draft_count'),
      SENT: number('sent_count'),
      VIEWED: number('viewed_count'),
      PARTIALLY_PAID: number('partially_paid_count'),
      PAID: number('paid_count'),
      OVERDUE: number('overdue_count'),
      CANCELLED: number('cancelled_count'),
    };
  });
}

export async function getInvoice(
  businessId: string,
  userId: string,
  invoiceId: string
): Promise<InvoiceDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<
      InvoiceRow & {
        customer_business_name: string;
        customer_type: string;
        customer_contact_person: string | null;
        customer_phone: string | null;
        customer_email: string | null;
        job_number: string | null;
        job_title: string | null;
        job_status: string | null;
        quote_number: string | null;
        quote_status: string | null;
      }
    >(
      `select ${I(INVOICE_COLUMNS)},
              c.business_name as customer_business_name,
              c.customer_type,
              c.contact_person as customer_contact_person,
              c.phone as customer_phone,
              c.email as customer_email,
              j.job_number, j.title as job_title, j.status::text as job_status,
              q.quote_number, q.status::text as quote_status
         from invoices i
         join customers c on c.id = i.customer_id
         left join jobs j on j.id = i.job_id
         left join quotes q on q.id = i.quote_id
        where i.id = $1 and i.business_id = $2`,
      [invoiceId, businessId]
    );

    const row = rows[0];
    if (!row) return null;

    const { rows: items } = await client.query<InvoiceItemRow>(
      `select ${ITEM_COLUMNS} from invoice_items where invoice_id = $1 order by line_number`,
      [invoiceId]
    );

    const {
      customer_business_name,
      customer_type,
      customer_contact_person,
      customer_phone,
      customer_email,
      job_number,
      job_title,
      job_status,
      quote_number,
      quote_status,
      ...invoice
    } = row;

    return {
      ...invoice,
      items,
      customer: {
        id: invoice.customer_id,
        business_name: customer_business_name,
        customer_type,
        contact_person: customer_contact_person,
        phone: customer_phone,
        email: customer_email,
      },
      job:
        invoice.job_id && job_number && job_title && job_status
          ? { id: invoice.job_id, job_number, title: job_title, status: job_status }
          : null,
      quote:
        invoice.quote_id && quote_number && quote_status
          ? { id: invoice.quote_id, quote_number, status: quote_status }
          : null,
    };
  });
}

/** Documents belonging to one invoice's customer (customer detail screen). */
export async function listInvoicesForCustomer(
  businessId: string,
  userId: string,
  customerId: string,
  limit = 8
): Promise<InvoiceListItem[]> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<InvoiceListItem>(
      `select ${I(INVOICE_COLUMNS)},
              c.business_name as customer_name,
              c.customer_type,
              coalesce(it.item_count, 0)::int as item_count,
              j.job_number,
              j.title as job_title,
              q.quote_number
         from invoices i
         join customers c on c.id = i.customer_id
         left join jobs j on j.id = i.job_id
         left join quotes q on q.id = i.quote_id
         left join lateral (
           select count(*) as item_count from invoice_items ii where ii.invoice_id = i.id
         ) it on true
        where i.business_id = $1 and i.customer_id = $2
        order by i.created_at desc
        limit $3`,
      [businessId, customerId, limit]
    );
    return rows;
  });
}

/** The business's own document defaults, used when a form leaves a field blank. */
async function loadInvoiceDefaults(
  client: import('pg').PoolClient,
  businessId: string
): Promise<{ invoice_prefix: string | null; default_payment_terms: string | null }> {
  const { rows } = await client.query<{
    invoice_prefix: string | null;
    default_payment_terms: string | null;
  }>(
    `select invoice_prefix, default_payment_terms
       from business_settings where business_id = $1`,
    [businessId]
  );

  return rows[0] ?? { invoice_prefix: null, default_payment_terms: null };
}

function addDaysIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** Server-side totals: the browser's arithmetic is never trusted or stored. */
export function invoiceTotalsFromItems(items: readonly InvoiceItemInput[]) {
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
  client: import('pg').PoolClient,
  businessId: string,
  invoiceId: string,
  items: readonly InvoiceItemInput[]
): Promise<void> {
  const totals = invoiceTotalsFromItems(items);

  for (const [index, item] of items.entries()) {
    const line = totals.lines[index];
    if (!line) continue;

    await client.query(
      `insert into invoice_items
         (business_id, invoice_id, product_id, line_number, description, quantity, unit,
          unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
          line_total)
       values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
      [
        businessId,
        invoiceId,
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

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

/**
 * Create an invoice from a form. The header is assembled server-side from the
 * validated input plus the customer snapshot; the totals come from the lines
 * the server validated, never from the browser.
 */
export async function createInvoice(
  businessId: string,
  userId: string,
  input: InvoiceInput,
  meta: { ipAddress?: string | null } = {}
): Promise<InvoiceWriteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const defaults = await loadInvoiceDefaults(client, businessId);
      const invoiceNumber = await allocateDocumentNumber(
        client,
        businessId,
        'INVOICE',
        defaults.invoice_prefix ?? undefined
      );

      const dueDate = input.dueDate ?? addDaysIso(input.issueDate, 30);

      const totals = invoiceTotalsFromItems(input.items);

      const { rows } = await client.query<{ id: string }>(
        `insert into invoices
           (business_id, customer_id, job_id, invoice_number, status, issue_date, due_date,
            prepared_by, contact_person, contact_phone, contact_email,
            billing_address_line1, billing_address_line2, billing_city, billing_province,
            billing_postal_code, job_address_line1, job_address_line2, job_city, job_province,
            job_postal_code, job_type, description, subtotal, discount_total, tax_total, total,
            payment_terms, notes, terms_and_conditions, created_by)
         values ($1, $2, $3, $4, 'DRAFT', $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
         returning id`,
        [
          businessId,
          input.customerId,
          input.jobId,
          invoiceNumber,
          input.issueDate,
          dueDate,
          input.preparedBy,
          input.contactPerson,
          input.contactPhone,
          input.contactEmail,
          input.billingAddressLine1,
          input.billingAddressLine2,
          input.billingCity,
          input.billingProvince,
          input.billingPostalCode,
          input.jobAddressLine1,
          input.jobAddressLine2,
          input.jobCity,
          input.jobProvince,
          input.jobPostalCode,
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

      const invoiceId = rows[0]?.id;
      if (!invoiceId) throw new Error('Invoice insert returned no row');

      await insertItems(client, businessId, invoiceId, input.items);

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'invoice.created',
        entityType: 'invoice',
        entityId: invoiceId,
        metadata: {
          invoice_number: invoiceNumber,
          total: totals.total,
          lines: input.items.length,
          customer_id: input.customerId,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      return { ok: true as const, id: invoiceId };
    });
  } catch (error) {
    if (isPgError(error, '23505')) {
      return { ok: false, reason: 'unknown' };
    }
    throw error;
  }
}

class AlreadyConvertedError extends Error {
  constructor() {
    super('Quote was already converted');
    this.name = 'AlreadyConvertedError';
  }
}

/**
 * One-click quote → invoice conversion.
 *
 * Runs inside one transaction:
 *  1. lock the quote row; only ACCEPTED can convert (CONVERTED means it
 *     already did — the partial unique index is the hard backstop)
 *  2. clone the quote's lines and header snapshot onto a new invoice
 *  3. allocate INV-0001 from the per-business sequence
 *  4. mark the quote CONVERTED and stamp converted_invoice_id
 *
 * Every line and total is copied verbatim from stored quote values, so the
 * invoice cannot disagree with what the customer accepted. A second call — a
 * double-click, a retry, a forged form — is refused, never merged.
 */
export async function convertInvoiceFromQuote(
  businessId: string,
  userId: string,
  quoteId: string,
  meta: { ipAddress?: string | null } = {}
): Promise<InvoiceWriteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const { rows: quoteRows } = await client.query<{
        id: string;
        customer_id: string;
        job_id: string | null;
        quote_number: string;
        status: string;
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
      }>(
        `select id, customer_id, job_id, quote_number, status::text as status,
                contact_person, contact_phone, contact_email,
                job_address_line1, job_address_line2, job_city, job_province, job_postal_code,
                job_type, description, subtotal, discount_total, tax_total, total,
                payment_terms, notes, terms_and_conditions
           from quotes
          where id = $1 and business_id = $2
          for update`,
        [quoteId, businessId]
      );

      const quote = quoteRows[0];
      if (!quote) return { ok: false as const, reason: 'not_found' as const };
      if (quote.status !== 'ACCEPTED') {
        return { ok: false as const, reason: 'not_allowed' as const };
      }

      const { rows: itemRows } = await client.query<InvoiceItemRow>(
        `select ${ITEM_COLUMNS} from quote_items where quote_id = $1 order by line_number`,
        [quoteId]
      );

      const defaults = await loadInvoiceDefaults(client, businessId);
      const invoiceNumber = await allocateDocumentNumber(
        client,
        businessId,
        'INVOICE',
        defaults.invoice_prefix ?? undefined
      );

      const issueDate = todayIso();
      const dueDate = addDaysIso(issueDate, 30);

      // Billing address snapshot from the customer record as it stands now
      // (a quote does not carry the customer's billing address).
      const { rows: customerRows } = await client.query<{
        billing_address_line1: string | null;
        billing_address_line2: string | null;
        billing_city: string | null;
        billing_province: string | null;
        billing_postal_code: string | null;
      }>(
        `select billing_address_line1, billing_address_line2, billing_city, billing_province,
                billing_postal_code
           from customers where id = $1 and business_id = $2`,
        [quote.customer_id, businessId]
      );
      const customer = customerRows[0];

      const { rows: invoiceRows } = await client.query<{ id: string }>(
        `insert into invoices
           (business_id, customer_id, job_id, quote_id, invoice_number, status, issue_date,
            due_date, contact_person, contact_phone, contact_email,
            billing_address_line1, billing_address_line2, billing_city, billing_province,
            billing_postal_code, job_address_line1, job_address_line2, job_city, job_province,
            job_postal_code, job_type, description, subtotal, discount_total, tax_total, total,
            payment_terms, notes, terms_and_conditions, created_by)
         values ($1, $2, $3, $4, $5, 'DRAFT', $6, $7, $8, $9, $10, $11, $12, $13, $14, $15,
                 $16, $17, $18, $19, $20, $21, $22, $23, $24, $25, $26, $27, $28, $29, $30)
         returning id`,
        [
          businessId,
          quote.customer_id,
          quote.job_id,
          quote.id,
          invoiceNumber,
          issueDate,
          dueDate,
          quote.contact_person,
          quote.contact_phone,
          quote.contact_email,
          customer?.billing_address_line1 ?? null,
          customer?.billing_address_line2 ?? null,
          customer?.billing_city ?? null,
          customer?.billing_province ?? null,
          customer?.billing_postal_code ?? null,
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
          quote.payment_terms ?? defaults.default_payment_terms,
          quote.notes,
          quote.terms_and_conditions,
          userId,
        ]
      );

      const invoiceId = invoiceRows[0]?.id;
      if (!invoiceId) throw new Error('Converted invoice insert returned no row');

      // Lines are cloned with their stored per-line amounts: never recomputed.
      for (const item of itemRows) {
        await client.query(
          `insert into invoice_items
             (business_id, invoice_id, product_id, line_number, description, quantity, unit,
              unit_price, discount_percent, tax_rate, line_subtotal, line_discount, line_tax,
              line_total)
           values ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)`,
          [
            businessId,
            invoiceId,
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

      // Mark the quote converted. The status check inside the update makes
      // this race-safe against a concurrent conversion.
      const { rowCount: convertedCount } = await client.query(
        `update quotes
            set status = 'CONVERTED'::public.quote_status,
                converted_invoice_id = $3
          where id = $1
            and business_id = $2
            and status = 'ACCEPTED'
            and converted_invoice_id is null`,
        [quoteId, businessId, invoiceId]
      );
      if (!convertedCount) {
        throw new AlreadyConvertedError();
      }

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'invoice.converted_from_quote',
        entityType: 'invoice',
        entityId: invoiceId,
        metadata: {
          invoice_number: invoiceNumber,
          quote_number: quote.quote_number,
          quote_id: quoteId,
          total: quote.total,
          lines: itemRows.length,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'quote.converted',
        entityType: 'quote',
        entityId: quoteId,
        metadata: {
          quote_number: quote.quote_number,
          invoice_number: invoiceNumber,
          invoice_id: invoiceId,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      return { ok: true as const, id: invoiceId };
    });
  } catch (error) {
    if (error instanceof AlreadyConvertedError) {
      return { ok: false as const, reason: 'already_converted' as const };
    }
    if (isPgError(error, '23505')) {
      // The partial unique index on invoices(quote_id): a concurrent
      // conversion won the race. Nothing was committed.
      return { ok: false, reason: 'already_converted' };
    }
    throw error;
  }
}

/**
 * Replace a draft invoice's header and lines. Like quotes: only a DRAFT can be
 * edited, because a sent invoice is the document the customer owes against.
 */
export async function updateInvoice(
  businessId: string,
  userId: string,
  invoiceId: string,
  input: InvoiceInput,
  meta: { ipAddress?: string | null } = {}
): Promise<InvoiceWriteResult> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ status: InvoiceStatus | string }>(
      `select status::text as status from invoices where id = $1 and business_id = $2 for update`,
      [invoiceId, businessId]
    );

    const current = rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (current.status !== 'DRAFT') return { ok: false as const, reason: 'not_draft' as const };

    const defaults = await loadInvoiceDefaults(client, businessId);
    const dueDate = input.dueDate ?? addDaysIso(input.issueDate, 30);
    const totals = invoiceTotalsFromItems(input.items);

    const { rowCount } = await client.query(
      `update invoices
          set customer_id = $3, job_id = $4, issue_date = $5, due_date = $6,
              prepared_by = $7, contact_person = $8, contact_phone = $9, contact_email = $10,
              billing_address_line1 = $11, billing_address_line2 = $12, billing_city = $13,
              billing_province = $14, billing_postal_code = $15,
              job_address_line1 = $16, job_address_line2 = $17, job_city = $18,
              job_province = $19, job_postal_code = $20, job_type = $21, description = $22,
              subtotal = $23, discount_total = $24, tax_total = $25, total = $26,
              payment_terms = $27, notes = $28, terms_and_conditions = $29
        where id = $1 and business_id = $2`,
      [
        invoiceId,
        businessId,
        input.customerId,
        input.jobId,
        input.issueDate,
        dueDate,
        input.preparedBy,
        input.contactPerson,
        input.contactPhone,
        input.contactEmail,
        input.billingAddressLine1,
        input.billingAddressLine2,
        input.billingCity,
        input.billingProvince,
        input.billingPostalCode,
        input.jobAddressLine1,
        input.jobAddressLine2,
        input.jobCity,
        input.jobProvince,
        input.jobPostalCode,
        input.jobType,
        input.description,
        totals.subtotal,
        totals.discountTotal,
        totals.taxTotal,
        totals.total,
        input.paymentTerms ?? defaults.default_payment_terms,
        input.notes,
        input.termsAndConditions,
      ]
    );

    if (!rowCount) return { ok: false as const, reason: 'not_found' as const };

    await client.query(`delete from invoice_items where invoice_id = $1 and business_id = $2`, [
      invoiceId,
      businessId,
    ]);
    await insertItems(client, businessId, invoiceId, input.items);

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'invoice.updated',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { total: totals.total, lines: input.items.length },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, id: invoiceId };
  });
}

/**
 * Mark a draft as sent and create its public token. Phase 5 builds the public
 * invoice page; the token seam exists from day one.
 */
export async function markInvoiceSent(
  businessId: string,
  userId: string,
  invoiceId: string,
  meta: { ipAddress?: string | null } = {}
): Promise<{ ok: true; token: string } | { ok: false; reason: 'not_found' | 'not_draft' }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{
      status: string;
      public_token: string | null;
      invoice_number: string;
    }>(
      `select status::text as status, public_token, invoice_number from invoices
        where id = $1 and business_id = $2 for update`,
      [invoiceId, businessId]
    );

    const invoice = rows[0];
    if (!invoice) return { ok: false as const, reason: 'not_found' as const };
    if (invoice.status !== 'DRAFT') return { ok: false as const, reason: 'not_draft' as const };

    const token = invoice.public_token ?? generatePublicToken();

    await client.query(
      `update invoices set public_token = coalesce(public_token, $3) where id = $1 and business_id = $2`,
      [invoiceId, businessId, token]
    );

    const moved = await applyInvoiceStatus(
      client,
      businessId,
      invoiceId,
      'SENT' as never
    );
    if (!moved.updated) return { ok: false as const, reason: 'not_draft' as const };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: 'invoice.sent',
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { invoice_number: invoice.invoice_number, from: moved.from, to: 'SENT' },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, token };
  });
}

/** Staff-recorded status changes (mark sent / cancel). */
export async function recordInvoiceStatus(
  businessId: string,
  userId: string,
  invoiceId: string,
  nextStatus: 'SENT' | 'CANCELLED',
  meta: { ipAddress?: string | null } = {}
): Promise<{ ok: true; from: string } | { ok: false; reason: 'not_found' | 'not_allowed' }> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ status: string }>(
      `select status::text as status from invoices where id = $1 and business_id = $2 for update`,
      [invoiceId, businessId]
    );

    const current = rows[0];
    if (!current) return { ok: false as const, reason: 'not_found' as const };
    if (!canTransitionInvoice(current.status as never, nextStatus as never)) {
      return { ok: false as const, reason: 'not_allowed' as const };
    }

    const moved = await applyInvoiceStatus(client, businessId, invoiceId, nextStatus as never);
    if (!moved.updated) return { ok: false as const, reason: 'not_allowed' as const };

    await recordAuditEvent(client, {
      businessId,
      userId,
      eventType: `invoice.${nextStatus.toLowerCase()}`,
      entityType: 'invoice',
      entityId: invoiceId,
      metadata: { from: moved.from, to: nextStatus, recorded_by: 'staff' },
      ipAddress: meta.ipAddress ?? null,
    });

    return { ok: true as const, from: String(moved.from) };
  });
}

export type InvoiceMoneySummary = {
  invoiced_total: string;
  outstanding_total: string;
  overdue_total: string;
  overdue_count: number;
};

/** Aggregate money figures for the invoices index header. */
export async function getInvoiceMoneySummary(
  businessId: string,
  userId: string
): Promise<InvoiceMoneySummary> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<InvoiceMoneySummary>(
      `select coalesce(sum(total), 0)::text as invoiced_total,
              coalesce(sum(case when status::text in ('SENT','VIEWED','PARTIALLY_PAID','OVERDUE')
                                then balance_due else 0 end), 0)::text as outstanding_total,
              coalesce(sum(case when (status in ('SENT','VIEWED','PARTIALLY_PAID')
                                        and due_date is not null and due_date < current_date)
                                   or status = 'OVERDUE'
                                then balance_due else 0 end), 0)::text as overdue_total,
              count(*) filter (where (status in ('SENT','VIEWED','PARTIALLY_PAID')
                                        and due_date is not null and due_date < current_date)
                                  or status = 'OVERDUE')::int as overdue_count
         from invoices
        where business_id = $1 and status <> 'CANCELLED'`,
      [businessId]
    );

    return (
      rows[0] ?? {
        invoiced_total: '0',
        outstanding_total: '0',
        overdue_total: '0',
        overdue_count: 0,
      }
    );
  });
}
