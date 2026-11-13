import { isPgError, withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import {
  applyInvoicePaymentReversal,
  applyInvoicePaymentStatus,
  type InvoiceStatus,
} from '@/lib/invoices';
import { parseAmountToCents } from '@/lib/money';
import { recordAuditEvent } from '@/lib/repositories/audit';

/**
 * Payments and receipts.
 *
 * One payment, one receipt, one transaction:
 *  1. the invoice row is locked (`for update`), so two devices cannot both
 *     record a payment against the same balance at the same moment
 *  2. only a sent (unpaid) invoice accepts money — a draft has not been issued
 *     and a cancelled invoice is a closed record
 *  3. the amount is checked against the balance recomputed from the stored
 *     money; overpayment is refused, not silently clamped
 *  4. a REC- number is allocated from the row-locked document_sequences
 *     upsert, a payment row and a receipt row (which remembers the balances
 *     and the invoice status as they stood) are written together
 *  5. `amount_paid` is updated; `balance_due` is a generated column, so it
 *     cannot drift
 *  6. the invoice status follows the balance through applyInvoicePaymentStatus
 *     — the only writer of PARTIALLY_PAID and PAID in the system
 *
 * Receipt numbers are allocated even for a payment whose transaction later
 * rolls back: the document_sequences upsert is part of the same transaction,
 * so a rolled-back payment does not burn a number a customer has never seen.
 */

export const PAYMENT_METHODS = ['EFT', 'CASH', 'CARD', 'OTHER'] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export type PaymentRow = {
  id: string;
  invoice_id: string;
  customer_id: string;
  amount: string;
  payment_date: string;
  method: string;
  reference: string | null;
  notes: string | null;
  receipt_number: string | null;
  recorded_by: string | null;
  created_at: Date;
};

export type PaymentListItem = PaymentRow & {
  invoice_number: string;
  invoice_status: string;
  customer_name: string;
  customer_id: string;
};

export type ReceiptRow = {
  id: string;
  payment_id: string;
  invoice_id: string;
  receipt_number: string;
  issued_at: Date;
  amount_received: string;
  previous_balance: string;
  remaining_balance: string;
  method: string;
  reference: string | null;
  /** The invoice's status the instant before this payment landed. */
  status_before: string | null;
};

export type PaymentListFilters = {
  search?: string | null;
  method?: string | null;
  invoiceId?: string | null;
  customerId?: string | null;
  limit?: number;
  offset?: number;
};

export type RecordPaymentResult =
  | {
      ok: true;
      paymentId: string;
      receiptNumber: string;
      invoiceId: string;
      balanceDue: string;
      statusBefore: InvoiceStatus;
      statusAfter: InvoiceStatus;
      fullyPaid: boolean;
    }
  | {
      ok: false;
      reason:
        | 'not_found'
        | 'not_payable'
        | 'overpayment'
        | 'zero_or_negative'
        | 'unknown';
    };

export type PaymentDeleteResult =
  | { ok: true }
  | { ok: false; reason: 'not_found' | 'unknown' };

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

const PAYMENT_COLUMNS = `p.id, p.invoice_id, p.customer_id, p.amount, p.payment_date,
  p.method::text as method, p.reference, p.notes, p.receipt_number, p.recorded_by,
  p.created_at`;

export async function listPayments(
  businessId: string,
  userId: string,
  filters: PaymentListFilters = {}
): Promise<{ rows: PaymentListItem[]; total: number }> {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const search = filters.search?.trim() ? `%${filters.search.trim()}%` : null;
  const method = filters.method && filters.method !== 'ALL' ? filters.method : null;

  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<PaymentListItem & { total_count: string }>(
      `select ${PAYMENT_COLUMNS},
              i.invoice_number,
              i.status::text as invoice_status,
              c.business_name as customer_name,
              c.id as customer_id,
              count(*) over() as total_count
         from payments p
         join invoices i on i.id = p.invoice_id
         join customers c on c.id = p.customer_id
        where p.business_id = $1
          and ($2::text is null or p.method::text = $2)
          and ($3::uuid is null or p.invoice_id = $3)
          and ($4::uuid is null or p.customer_id = $4)
          and ($5::text is null
               or p.receipt_number ilike $5
               or coalesce(p.reference, '') ilike $5
               or coalesce(p.notes, '') ilike $5
               or i.invoice_number ilike $5
               or c.business_name ilike $5)
        order by p.payment_date desc, p.created_at desc
        limit $6 offset $7`,
      [businessId, method, filters.invoiceId ?? null, filters.customerId ?? null, search, limit, offset]
    );

    const total = rows.length > 0 ? Number(rows[0]?.total_count ?? 0) : 0;
    return { rows, total };
  });
}

export async function getPayment(
  businessId: string,
  userId: string,
  paymentId: string
): Promise<(PaymentRow & {
  invoice_number: string;
  invoice_status: string;
  customer_name: string;
}) | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<
      PaymentRow & { invoice_number: string; invoice_status: string; customer_name: string }
    >(
      `select ${PAYMENT_COLUMNS},
              i.invoice_number,
              i.status::text as invoice_status,
              c.business_name as customer_name
         from payments p
         join invoices i on i.id = p.invoice_id
         join customers c on c.id = p.customer_id
        where p.id = $1 and p.business_id = $2`,
      [paymentId, businessId]
    );

    return rows[0] ?? null;
  });
}

/** The receipt that belongs to a payment (one-to-one by design). */
export async function getReceiptForPayment(
  businessId: string,
  userId: string,
  paymentId: string
): Promise<ReceiptRow | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<ReceiptRow>(
      `select id, payment_id, invoice_id, receipt_number, issued_at, amount_received,
              previous_balance, remaining_balance, method::text as method, reference,
              status_before::text as status_before
         from receipts
        where payment_id = $1 and business_id = $2`,
      [paymentId, businessId]
    );

    return rows[0] ?? null;
  });
}

export type ReceiptDetail = ReceiptRow & {
  payment_date: string;
  notes: string | null;
  invoice_number: string;
  invoice_total: string;
  customer_name: string;
  // status_before arrives through ReceiptRow.
  customer_contact_person: string | null;
  customer_phone: string | null;
  customer_email: string | null;
  customer_billing_line1: string | null;
  customer_billing_line2: string | null;
  customer_billing_city: string | null;
  customer_billing_province: string | null;
  customer_billing_postal_code: string | null;
};

/**
 * Everything the receipt document needs about one payment, in one query: the
 * receipt's stored balances, the payment's details and the customer's billing
 * snapshot as it stands.
 */
export async function getReceiptDetail(
  businessId: string,
  userId: string,
  paymentId: string
): Promise<ReceiptDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<ReceiptDetail>(
      `select r.id, r.payment_id, r.invoice_id, r.receipt_number, r.issued_at,
              r.amount_received, r.previous_balance, r.remaining_balance,
              r.method::text as method, r.reference, r.status_before::text as status_before,
              p.payment_date, p.notes,
              i.invoice_number, i.total as invoice_total,
              c.business_name as customer_name,
              c.contact_person as customer_contact_person,
              c.phone as customer_phone, c.email as customer_email,
              c.billing_address_line1 as customer_billing_line1,
              c.billing_address_line2 as customer_billing_line2,
              c.billing_city as customer_billing_city,
              c.billing_province as customer_billing_province,
              c.billing_postal_code as customer_billing_postal_code
         from receipts r
         join payments p on p.id = r.payment_id
         join invoices i on i.id = r.invoice_id
         join customers c on c.id = r.customer_id
        where r.payment_id = $1 and r.business_id = $2`,
      [paymentId, businessId]
    );

    return rows[0] ?? null;
  });
}

export type PaymentMoneySummary = {
  total_received: string;
  this_month: string;
  payment_count: number;
};

/** Aggregate money figures for the payments index header. */
export async function getPaymentMoneySummary(
  businessId: string,
  userId: string
): Promise<PaymentMoneySummary> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<PaymentMoneySummary>(
      `select coalesce(sum(amount), 0)::text as total_received,
              coalesce(sum(amount) filter (where payment_date >= date_trunc('month', current_date)), 0)::text as this_month,
              count(*)::int as payment_count
         from payments
        where business_id = $1`,
      [businessId]
    );

    return (
      rows[0] ?? {
        total_received: '0',
        this_month: '0',
        payment_count: 0,
      }
    );
  });
}

/** Payments for one invoice (invoice detail screen). */
export async function listPaymentsForInvoice(
  businessId: string,
  userId: string,
  invoiceId: string
): Promise<PaymentRow[]> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<PaymentRow>(
      `select ${PAYMENT_COLUMNS}
         from payments p
        where p.business_id = $1 and p.invoice_id = $2
        order by p.payment_date desc, p.created_at desc`,
      [businessId, invoiceId]
    );
    return rows;
  });
}

// ---------------------------------------------------------------------------
// Writes
// ---------------------------------------------------------------------------

export type RecordPaymentInput = {
  invoiceId: string;
  amount: string;
  paymentDate: string;
  method: PaymentMethod;
  reference: string | null;
  notes: string | null;
};


/**
 * Record a payment against an invoice and issue its receipt, in one
 * transaction. See the module comment for the exact order of operations.
 */
export async function recordPayment(
  businessId: string,
  userId: string,
  input: RecordPaymentInput,
  meta: { ipAddress?: string | null } = {}
): Promise<RecordPaymentResult> {
  const amountCents = parseAmountToCents(input.amount);
  if (amountCents === null || amountCents <= 0) {
    return { ok: false, reason: 'zero_or_negative' };
  }

  try {
    return await withContext({ userId, businessId }, async (client) => {
      // 1. Lock the invoice row: the balance check and the amount_paid write
      //    must not race another device recording a payment.
      const { rows } = await client.query<{
        id: string;
        customer_id: string;
        invoice_number: string;
        status: InvoiceStatus;
        total: string;
        amount_paid: string;
      }>(
        `select id, customer_id, invoice_number, status::text as status, total, amount_paid
           from invoices
          where id = $1 and business_id = $2
          for update`,
        [input.invoiceId, businessId]
      );

      const invoice = rows[0];
      if (!invoice) return { ok: false as const, reason: 'not_found' as const };

      // 2. Only a sent invoice carries money owed to the business.
      const payableStatuses: InvoiceStatus[] = ['SENT', 'VIEWED', 'PARTIALLY_PAID', 'OVERDUE'];
      if (!payableStatuses.includes(invoice.status)) {
        return { ok: false as const, reason: 'not_payable' as const };
      }

      const totalCents = parseAmountToCents(invoice.total) ?? 0;
      const paidCents = parseAmountCents(invoice.amount_paid);
      const balanceCents = totalCents - paidCents;

      // 3. Overpayment is refused: the database check would abort the whole
      //    transaction, and the contractor should see the real balance.
      if (amountCents > balanceCents) {
        return { ok: false as const, reason: 'overpayment' as const };
      }

      // 4. Allocate the receipt number from the row-locked sequence upsert.
      const { rows: settingsRows } = await client.query<{ receipt_prefix: string | null }>(
        `select receipt_prefix from business_settings where business_id = $1`,
        [businessId]
      );
      const receiptNumber = await allocateDocumentNumber(
        client,
        businessId,
        'RECEIPT',
        settingsRows[0]?.receipt_prefix ?? undefined
      );

      const statusBefore = invoice.status;

      // 5. Payment row, then the receipt row that remembers what the balances
      //    and status were the moment the money landed.
      const { rows: paymentRows } = await client.query<{ id: string }>(
        `insert into payments
           (business_id, invoice_id, customer_id, amount, payment_date, method,
            reference, notes, recorded_by, receipt_number)
         values ($1, $2, $3, $4, $5, $6::public.payment_method, $7, $8, $9, $10)
         returning id`,
        [
          businessId,
          input.invoiceId,
          invoice.customer_id,
          input.amount,
          input.paymentDate,
          input.method,
          input.reference,
          input.notes,
          userId,
          receiptNumber,
        ]
      );
      const paymentId = paymentRows[0]?.id;
      if (!paymentId) throw new Error('Payment insert returned no row');

      await client.query(
        `insert into receipts
           (business_id, payment_id, invoice_id, customer_id, receipt_number, issued_at,
            amount_received, previous_balance, remaining_balance, method, reference,
            status_before)
         values ($1, $2, $3, $4, $5, now(), $6, $7, $8, $9::public.payment_method, $10, $11::public.invoice_status)`,
        [
          businessId,
          paymentId,
          input.invoiceId,
          invoice.customer_id,
          receiptNumber,
          input.amount,
          centsToNumeric(balanceCents),
          centsToNumeric(balanceCents - amountCents),
          input.method,
          input.reference,
          statusBefore,
        ]
      );

      // 6. amount_paid moves; balance_due follows as a generated column.
      const newPaidCents = paidCents + amountCents;
      await client.query(
        `update invoices set amount_paid = $3 where id = $1 and business_id = $2`,
        [input.invoiceId, businessId, centsToNumeric(newPaidCents)]
      );

      // 7. Status follows the balance — the only writer of PARTIALLY_PAID/PAID.
      const statusMove = await applyInvoicePaymentStatus(
        client,
        businessId,
        input.invoiceId
      );
      const statusAfter = statusMove.to ?? statusBefore;

      // Two audit rows, like the quote conversion: one on the payment, one on
      // the invoice, so each document's history tells its own side of the
      // story without either depending on the other.
      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'payment.recorded',
        entityType: 'payment',
        entityId: paymentId,
        metadata: {
          invoice_id: input.invoiceId,
          invoice_number: invoice.invoice_number,
          amount: input.amount,
          method: input.method,
          reference: input.reference,
          receipt_number: receiptNumber,
          status_before: statusBefore,
          status_after: statusAfter,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'invoice.payment_received',
        entityType: 'invoice',
        entityId: input.invoiceId,
        metadata: {
          payment_id: paymentId,
          receipt_number: receiptNumber,
          amount: input.amount,
          method: input.method,
          status_after: statusAfter,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      return {
        ok: true as const,
        paymentId,
        receiptNumber,
        invoiceId: input.invoiceId,
        balanceDue: centsToNumeric(balanceCents - amountCents),
        statusBefore,
        statusAfter,
        fullyPaid: statusAfter === 'PAID',
      };
    });
  } catch (error) {
    if (isPgError(error, '23514')) {
      // Check violations (amount > 0, amount_paid <= total) are the database
      // backstop behind the validation above.
      return { ok: false, reason: 'unknown' };
    }
    throw error;
  }
}

/**
 * Reverse a payment: remove its amount from the invoice's amount_paid, walk
 * the invoice's status back down the path its receipts remember, and keep an
 * audit trail. Nothing is deleted — the payment row keeps its audit history
 * and the receipt stays as issued.
 */
export async function reversePayment(
  businessId: string,
  userId: string,
  paymentId: string,
  meta: { ipAddress?: string | null } = {}
): Promise<PaymentDeleteResult> {
  try {
    return await withContext({ userId, businessId }, async (client) => {
      const { rows } = await client.query<{
        id: string;
        invoice_id: string;
        amount: string;
      }>(
        `select id, invoice_id, amount
           from payments
          where id = $1 and business_id = $2
          for update`,
        [paymentId, businessId]
      );

      const payment = rows[0];
      if (!payment) return { ok: false as const, reason: 'not_found' as const };

      // The invoice row is locked for the balance arithmetic below.
      const { rows: invoiceRows } = await client.query<{ amount_paid: string }>(
        `select amount_paid from invoices where id = $1 and business_id = $2 for update`,
        [payment.invoice_id, businessId]
      );
      const invoice = invoiceRows[0];
      if (!invoice) return { ok: false as const, reason: 'not_found' as const };

      const { rows: receiptRows } = await client.query<{ status_before: string | null }>(
        `select status_before from receipts where payment_id = $1 and business_id = $2`,
        [paymentId, businessId]
      );
      const statusBefore = receiptRows[0]?.status_before as InvoiceStatus | null;

      const paidCents = parseAmountCents(invoice.amount_paid);
      const paymentCents = parseAmountCents(payment.amount);

      await client.query(
        `update invoices set amount_paid = $3 where id = $1 and business_id = $2`,
        [payment.invoice_id, businessId, centsToNumeric(paidCents - paymentCents)]
      );

      await applyInvoicePaymentReversal(client, businessId, payment.invoice_id, statusBefore);

      await recordAuditEvent(client, {
        businessId,
        userId,
        eventType: 'payment.reversed',
        entityType: 'payment',
        entityId: paymentId,
        metadata: {
          invoice_id: payment.invoice_id,
          amount: payment.amount,
          status_before_payment: statusBefore,
        },
        ipAddress: meta.ipAddress ?? null,
      });

      return { ok: true as const };
    });
  } catch (error) {
    return handlePaymentPgError(error);
  }
}

function parseAmountCents(value: string): number {
  return parseAmountToCents(value) ?? 0;
}

/** NUMERIC(14,2) text from integer cents, without ever touching a float. */
function centsToNumeric(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  return `${sign}${Math.floor(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`;
}

function handlePaymentPgError(error: unknown): PaymentDeleteResult {
  if (isPgError(error, '23514')) {
    return { ok: false, reason: 'unknown' };
  }
  throw error;
}
