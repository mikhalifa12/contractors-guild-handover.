import { withContext } from '@/lib/db';

/**
 * Anonymous access to a single quote, through the SECURITY DEFINER functions in
 * migration 0006.
 *
 * The visitor has no session, so there is no tenant context to set: the public
 * token in the URL *is* the credential. The functions return one document built
 * from an explicit column list and never expose internal identifiers, the token
 * itself or any other business's rows.
 *
 * Every response is validated at the database: the application never decides
 * whether a quote may still be accepted.
 */
export type PublicQuoteItem = {
  line_number: number;
  description: string;
  quantity: number;
  unit: string;
  unit_price: number;
  discount_percent: number;
  tax_rate: number;
  line_subtotal: number;
  line_discount: number;
  line_tax: number;
  line_total: number;
};

export type PublicQuote = {
  quote: {
    quote_number: string;
    status: 'DRAFT' | 'SENT' | 'VIEWED' | 'ACCEPTED' | 'DECLINED' | 'EXPIRED' | 'CONVERTED';
    issue_date: string;
    valid_until: string | null;
    job_type: string | null;
    description: string | null;
    contact_person: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    job_address_line1: string | null;
    job_address_line2: string | null;
    job_city: string | null;
    job_province: string | null;
    job_postal_code: string | null;
    subtotal: number;
    discount_total: number;
    tax_total: number;
    total: number;
    payment_terms: string | null;
    notes: string | null;
    terms_and_conditions: string | null;
    sent_at: string | null;
    viewed_at: string | null;
    accepted_at: string | null;
    accepted_by_name: string | null;
    declined_at: string | null;
    declined_reason: string | null;
  };
  business: {
    legal_name: string;
    trading_name: string | null;
    registration_number: string | null;
    tax_number: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    currency_code: string;
    has_logo: boolean;
  };
  customer: {
    business_name: string;
    contact_person: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_province: string | null;
    billing_postal_code: string | null;
  };
  items: PublicQuoteItem[];
};

export type PublicQuoteResponseResult =
  | { ok: true; code: 'accepted' | 'declined'; acceptedByName?: string }
  | {
      ok: false;
      code: 'not_found' | 'not_open' | 'expired' | 'name_required' | 'invalid_decision' | 'unknown';
    };

/** Read one quote by its public token. Returns null for an unknown token. */
export async function getPublicQuote(token: string): Promise<PublicQuote | null> {
  if (!token || token.length < 16) return null;

  return withContext({}, async (client) => {
    const { rows } = await client.query<{ quote: PublicQuote | null }>(
      `select app.public_quote($1) as quote`,
      [token]
    );
    return rows[0]?.quote ?? null;
  });
}

/** The logo storage key for the business behind this token, if it has one. */
export async function getPublicQuoteLogoKey(token: string): Promise<string | null> {
  if (!token || token.length < 16) return null;

  return withContext({}, async (client) => {
    const { rows } = await client.query<{ key: string | null }>(
      `select app.public_quote_logo_key($1) as key`,
      [token]
    );
    return rows[0]?.key ?? null;
  });
}

/**
 * Stamp the first customer view (SENT -> VIEWED) and return the current state.
 * Loading the page and marking it viewed are separate calls so a failed write
 * can never hide the quote from the customer.
 */
export async function markPublicQuoteViewed(token: string): Promise<boolean> {
  if (!token || token.length < 16) return false;

  return withContext({}, async (client) => {
    const { rows } = await client.query<{ viewed: boolean }>(
      `select app.public_quote_mark_viewed($1) as viewed`,
      [token]
    );
    return rows[0]?.viewed ?? false;
  });
}

/**
 * Record the customer's decision.
 *
 * The caller sends a decision, a name and an optional note. It cannot send an
 * amount, a line item or a status: acceptance is written by the database
 * function, so the pricing a customer sees can never be changed by them.
 */
export async function respondToPublicQuote(
  token: string,
  decision: 'ACCEPT' | 'DECLINE',
  options: {
    name?: string | null;
    reason?: string | null;
    ipAddress?: string | null;
    userAgent?: string | null;
  } = {}
): Promise<PublicQuoteResponseResult> {
  if (!token || token.length < 16) return { ok: false, code: 'not_found' };

  return withContext({}, async (client) => {
    const { rows } = await client.query<{ result: PublicQuoteResponseResult }>(
      `select app.public_quote_respond($1, $2, $3, $4, $5::inet, $6) as result`,
      [
        token,
        decision,
        options.name ?? null,
        options.reason ?? null,
        options.ipAddress ?? null,
        options.userAgent ?? null,
      ]
    );

    const result = rows[0]?.result;
    if (!result) return { ok: false as const, code: 'unknown' as const };
    return result;
  });
}
