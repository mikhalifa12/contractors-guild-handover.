import type { PoolClient } from 'pg';

/**
 * Quote rules.
 *
 * Statuses mirror the `quote_status` enum in the database. Everything the UI,
 * the Server Actions and the public acceptance page believe about a quote is
 * decided here, in one pure module, so the rules can be unit-tested and cannot
 * drift between the screen that offers a button and the code that performs the
 * change.
 *
 * A quote is a document that was shown to a customer. Once it leaves DRAFT its
 * lines are frozen: revisions are made by duplicating the quote into a new
 * draft, which keeps the copy the customer saw intact.
 */
export const QUOTE_STATUSES = [
  'DRAFT',
  'SENT',
  'VIEWED',
  'ACCEPTED',
  'DECLINED',
  'EXPIRED',
  'CONVERTED',
] as const;

export type QuoteStatus = (typeof QUOTE_STATUSES)[number];

/** Statuses a customer can still act on. */
export const OPEN_QUOTE_STATUSES: QuoteStatus[] = ['SENT', 'VIEWED'];

const TRANSITIONS: Record<QuoteStatus, QuoteStatus[]> = {
  DRAFT: ['SENT'],
  SENT: ['VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED'],
  VIEWED: ['ACCEPTED', 'DECLINED', 'EXPIRED'],
  ACCEPTED: ['CONVERTED'],
  DECLINED: [],
  EXPIRED: [],
  CONVERTED: [],
};

export function isQuoteStatus(value: unknown): value is QuoteStatus {
  return typeof value === 'string' && (QUOTE_STATUSES as readonly string[]).includes(value);
}

/** Statuses this quote can move to next, in the order the UI should offer them. */
export function nextQuoteStatuses(current: QuoteStatus): QuoteStatus[] {
  const allowed = new Set(TRANSITIONS[current]);
  return QUOTE_STATUSES.filter((status) => allowed.has(status));
}

export function canTransitionQuote(from: QuoteStatus, to: QuoteStatus): boolean {
  if (from === to) return false;
  return TRANSITIONS[from].includes(to);
}

/** Only a draft can be edited or have its lines replaced. */
export function isQuoteEditable(status: QuoteStatus): boolean {
  return status === 'DRAFT';
}

export function isQuoteOpen(status: QuoteStatus): boolean {
  return OPEN_QUOTE_STATUSES.includes(status);
}

/** Human label for buttons, e.g. "Mark as sent". */
const ACTION_LABELS: Partial<Record<QuoteStatus, string>> = {
  SENT: 'Mark as sent',
  VIEWED: 'Mark as viewed',
  ACCEPTED: 'Record acceptance',
  DECLINED: 'Record decline',
  EXPIRED: 'Mark as expired',
  CONVERTED: 'Convert to invoice',
};

export function quoteStatusActionLabel(status: QuoteStatus): string {
  return ACTION_LABELS[status] ?? `Mark as ${status.toLowerCase()}`;
}

/** Declining says why: the reason is shown to the contractor, never the customer. */
export function quoteStatusRequiresReason(status: QuoteStatus): boolean {
  return status === 'DECLINED';
}

function startOfTodayIso(now: Date): string {
  return now.toISOString().slice(0, 10);
}

/**
 * A quote past its validity date is expired in every meaningful sense, even if
 * nothing has written that status yet. Screens show `effectiveQuoteStatus()`;
 * the public acceptance function refuses to accept and records EXPIRED.
 */
export function isQuoteExpired(
  status: QuoteStatus,
  validUntil: string | null | undefined,
  now: Date = new Date()
): boolean {
  if (!isQuoteOpen(status)) return false;
  if (!validUntil) return false;
  return validUntil.slice(0, 10) < startOfTodayIso(now);
}

export function effectiveQuoteStatus(
  status: QuoteStatus,
  validUntil: string | null | undefined,
  now: Date = new Date()
): QuoteStatus {
  return isQuoteExpired(status, validUntil, now) ? 'EXPIRED' : status;
}

export type CustomerDecision =
  | { allowed: true }
  | { allowed: false; reason: 'not_open' | 'expired' };

/** Whether the customer may accept/decline from the public page right now. */
export function canCustomerRespond(
  status: QuoteStatus,
  validUntil: string | null | undefined,
  now: Date = new Date()
): CustomerDecision {
  if (!isQuoteOpen(status)) return { allowed: false, reason: 'not_open' };
  if (isQuoteExpired(status, validUntil, now)) return { allowed: false, reason: 'expired' };
  return { allowed: true };
}


/**
 * Move a quote to a new status inside the caller's transaction.
 *
 * The row is locked first, so two devices cannot both accept the same quote and
 * both write a timestamp. Returns the previous status when the move happened,
 * and null when it was refused.
 */
export async function applyQuoteStatus(
  client: PoolClient,
  businessId: string,
  quoteId: string,
  nextStatus: QuoteStatus,
  stamps: { acceptedByName?: string | null; declinedReason?: string | null; ip?: string | null } = {}
): Promise<{ updated: boolean; from: QuoteStatus | null }> {
  const { rows } = await client.query<{ status: QuoteStatus }>(
    `select status from quotes where id = $1 and business_id = $2 for update`,
    [quoteId, businessId]
  );

  const current = rows[0];
  if (!current) return { updated: false, from: null };
  if (!canTransitionQuote(current.status, nextStatus)) {
    return { updated: false, from: current.status };
  }

  await client.query(
    `update quotes
        set status = $3::public.quote_status,
            sent_at = case when $4::text = 'SENT' then coalesce(sent_at, now()) else sent_at end,
            viewed_at = case when $4::text = 'VIEWED' then coalesce(viewed_at, now()) else viewed_at end,
            accepted_at = case when $4::text = 'ACCEPTED' then coalesce(accepted_at, now()) else accepted_at end,
            accepted_by_name = case when $4::text = 'ACCEPTED' then coalesce($5::text, accepted_by_name) else accepted_by_name end,
            accepted_ip = case when $4::text = 'ACCEPTED' then coalesce($6::inet, accepted_ip) else accepted_ip end,
            declined_at = case when $4::text = 'DECLINED' then coalesce(declined_at, now()) else declined_at end,
            declined_reason = case when $4::text = 'DECLINED' then coalesce($7::text, declined_reason) else declined_reason end
      where id = $1 and business_id = $2`,
    [
      quoteId,
      businessId,
      nextStatus,
      nextStatus,
      stamps.acceptedByName ?? null,
      stamps.ip ?? null,
      stamps.declinedReason ?? null,
    ]
  );

  return { updated: true, from: current.status };
}
