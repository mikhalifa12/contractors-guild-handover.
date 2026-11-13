import type { PoolClient } from 'pg';
import { parseAmountToCents } from '@/lib/money';

/**
 * Invoice rules.
 *
 * Statuses mirror the `invoice_status` enum in the database. Everything the
 * UI, the Server Actions and the future public invoice page believe about an
 * invoice is decided here, in one pure module, so the rules can be unit-tested
 * and cannot drift between the screen that offers a button and the code that
 * performs the change.
 *
 * Payments (Phase 5) are the only writer of PARTIALLY_PAID and PAID: the
 * status follows the balance, so no staff action can set it by hand and the
 * stored status can never disagree with the money. CONVERSION-adjacent
 * statuses do not exist: an invoice records where the money stands, not which
 * document produced it.
 */
export const INVOICE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'PAID',
  'OVERDUE',
  'CANCELLED',
] as const;

export type InvoiceStatus = (typeof INVOICE_STATUSES)[number];

/** Statuses with money still outstanding. */
export const UNPAID_INVOICE_STATUSES: InvoiceStatus[] = [
  'SENT',
  'VIEWED',
  'PARTIALLY_PAID',
  'OVERDUE',
];

const TRANSITIONS: Record<InvoiceStatus, InvoiceStatus[]> = {
  DRAFT: ['SENT', 'CANCELLED'],
  SENT: ['VIEWED', 'CANCELLED'],
  VIEWED: ['CANCELLED'],
  PARTIALLY_PAID: [],
  PAID: [],
  OVERDUE: ['CANCELLED'],
  CANCELLED: [],
};

export function isInvoiceStatus(value: unknown): value is InvoiceStatus {
  return typeof value === 'string' && (INVOICE_STATUSES as readonly string[]).includes(value);
}

/** Statuses this invoice can move to next, in the order the UI should offer them. */
export function nextInvoiceStatuses(current: InvoiceStatus): InvoiceStatus[] {
  const allowed = new Set(TRANSITIONS[current]);
  return INVOICE_STATUSES.filter((status) => allowed.has(status));
}

export function canTransitionInvoice(from: InvoiceStatus, to: InvoiceStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/**
 * An invoice's amount and terms freeze when it is sent, exactly like a quote.
 * The payment phase (Phase 5) will write amount_paid, never the lines.
 */
export function isInvoiceEditable(status: InvoiceStatus): boolean {
  return status === 'DRAFT';
}

/**
 * Overdue is a *fact* derived from the due date, not a status someone has to
 * remember to set. Screens show `effectiveInvoiceStatus()`; the stored status
 * stays honest (a sent invoice that is late is still 'SENT' in the database,
 * because the payment phase writes the authoritative transitions).
 */
export function isInvoiceOverdue(
  status: InvoiceStatus,
  dueDate: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!UNPAID_INVOICE_STATUSES.includes(status)) return false;
  if (!dueDate) return false;
  return dueDate.slice(0, 10) < now.toISOString().slice(0, 10);
}

export function effectiveInvoiceStatus(
  status: InvoiceStatus,
  dueDate: string | null | undefined,
  now: Date = new Date()
): InvoiceStatus {
  return isInvoiceOverdue(status, dueDate, now) ? 'OVERDUE' : status;
}

/** A cancelled invoice can never be paid or converted; it is a closed record. */
export function isInvoiceActive(status: InvoiceStatus): boolean {
  return status !== 'CANCELLED';
}

/** True when the invoice may be answered by the customer through a public link. */
export function isOpenForViewing(status: InvoiceStatus): boolean {
  return status === 'SENT' || status === 'VIEWED';
}

/**
 * The status an invoice's balance implies, once a payment amount is (or is no
 * longer) included in `amount_paid`.
 *
 *  - balance settled -> PAID (any unpaid state can be paid in one payment)
 *  - balance outstanding on a sent invoice -> PARTIALLY_PAID
 *  - anything else (draft, cancelled, already in that state) -> null: the
 *    caller must not move the row
 */
export function paymentDrivenStatus(
  current: InvoiceStatus,
  balanceDueCents: number
): InvoiceStatus | null {
  if (current === 'DRAFT' || current === 'CANCELLED') return null;
  if (balanceDueCents <= 0) {
    return current === 'PAID' ? null : 'PAID';
  }
  if (current === 'PARTIALLY_PAID') return null;
  if (UNPAID_INVOICE_STATUSES.includes(current)) return 'PARTIALLY_PAID';
  return null;
}

/**
 * The status an invoice returns to when one of its payments is reversed.
 *
 * Each receipt remembers the status the invoice had just before its payment
 * was recorded, so undoing payments in any order walks the invoice back down
 * the path it actually took (PAID -> PARTIALLY_PAID -> SENT), instead of
 * collapsing everything to PARTIALLY_PAID.
 */
export function paymentReversalStatus(
  current: InvoiceStatus,
  previousStatus: InvoiceStatus | null,
  balanceDueCents: number
): InvoiceStatus {
  if (current === 'CANCELLED') return 'CANCELLED';
  if (balanceDueCents <= 0) return 'PAID';
  if (previousStatus && UNPAID_INVOICE_STATUSES.includes(previousStatus)) {
    return previousStatus;
  }
  if (current === 'PAID' || current === 'PARTIALLY_PAID') return 'PARTIALLY_PAID';
  return current;
}

/**
 * Move an invoice to a new status inside the caller's transaction.
 *
 * The row is locked first, so two devices cannot both cancel (or both send)
 * the same invoice. Returns the previous status when the move happened, and
 * null when it was refused. Status timestamps are stamped exactly once.
 */
export async function applyInvoiceStatus(
  client: PoolClient,
  businessId: string,
  invoiceId: string,
  nextStatus: InvoiceStatus
): Promise<{ updated: boolean; from: InvoiceStatus | null }> {
  const { rows } = await client.query<{ status: InvoiceStatus }>(
    `select status from invoices where id = $1 and business_id = $2 for update`,
    [invoiceId, businessId]
  );

  const current = rows[0];
  if (!current) return { updated: false, from: null };
  if (!canTransitionInvoice(current.status, nextStatus)) {
    return { updated: false, from: current.status };
  }

  await client.query(
    `update invoices
        set status = $3::public.invoice_status,
            sent_at = case when $4::text = 'SENT' then coalesce(sent_at, now()) else sent_at end,
            viewed_at = case when $4::text = 'VIEWED' then coalesce(viewed_at, now()) else viewed_at end,
            cancelled_at = case when $4::text = 'CANCELLED' then coalesce(cancelled_at, now()) else cancelled_at end
      where id = $1 and business_id = $2`,
    [invoiceId, businessId, nextStatus, nextStatus]
  );

  return { updated: true, from: current.status };
}

/** The outcome of a payment-driven status move (see applyInvoicePaymentStatus). */
export type InvoicePaymentStatusResult = {
  updated: boolean;
  from: InvoiceStatus | null;
  to: InvoiceStatus | null;
};

async function lockInvoiceForPayment(
  client: PoolClient,
  businessId: string,
  invoiceId: string
): Promise<{ status: InvoiceStatus; balanceDueCents: number } | null> {
  const { rows } = await client.query<{
    status: InvoiceStatus;
    total: string;
    amount_paid: string;
  }>(
    `select status::text as status, total, amount_paid
       from invoices where id = $1 and business_id = $2 for update`,
    [invoiceId, businessId]
  );

  const row = rows[0];
  if (!row) return null;

  const totalCents = parseAmountToCents(row.total) ?? 0;
  const paidCents = parseAmountToCents(row.amount_paid) ?? 0;
  return { status: row.status, balanceDueCents: totalCents - paidCents };
}

async function writePaymentStatus(
  client: PoolClient,
  businessId: string,
  invoiceId: string,
  from: InvoiceStatus,
  to: InvoiceStatus
): Promise<InvoicePaymentStatusResult> {
  await client.query(
    `update invoices
        set status = $3::public.invoice_status,
            paid_at = case when $3::text = 'PAID' then coalesce(paid_at, now()) else null end
      where id = $1 and business_id = $2`,
    [invoiceId, businessId, to]
  );

  return { updated: from !== to, from, to };
}

/**
 * Move an invoice to the status its balance implies, inside the caller's
 * transaction. Call this AFTER the payment amount has been added to
 * `amount_paid`: the row is locked, the balance is recomputed from the stored
 * money, and the status follows it (PARTIALLY_PAID, or PAID with a paid_at
 * stamp once nothing is owed).
 *
 * This is deliberately not the manual transitions table: no staff action can
 * produce PARTIALLY_PAID or PAID, and money is the only writer.
 */
export async function applyInvoicePaymentStatus(
  client: PoolClient,
  businessId: string,
  invoiceId: string
): Promise<InvoicePaymentStatusResult> {
  const locked = await lockInvoiceForPayment(client, businessId, invoiceId);
  if (!locked) return { updated: false, from: null, to: null };

  const to = paymentDrivenStatus(locked.status, locked.balanceDueCents);
  if (!to) return { updated: false, from: locked.status, to: locked.status };

  return writePaymentStatus(client, businessId, invoiceId, locked.status, to);
}

/**
 * The reversal half of applyInvoicePaymentStatus: call it AFTER a payment's
 * amount has been removed from `amount_paid`. The receipt's remembered status
 * puts the invoice back where it was before that payment (see
 * paymentReversalStatus), and paid_at is cleared when it is no longer paid.
 */
export async function applyInvoicePaymentReversal(
  client: PoolClient,
  businessId: string,
  invoiceId: string,
  previousStatus: InvoiceStatus | null
): Promise<InvoicePaymentStatusResult> {
  const locked = await lockInvoiceForPayment(client, businessId, invoiceId);
  if (!locked) return { updated: false, from: null, to: null };

  const to = paymentReversalStatus(locked.status, previousStatus, locked.balanceDueCents);
  if (to === locked.status) return { updated: false, from: locked.status, to: locked.status };

  return writePaymentStatus(client, businessId, invoiceId, locked.status, to);
}
