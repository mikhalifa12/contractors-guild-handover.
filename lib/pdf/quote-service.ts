import { getBusinessDetail, getBusinessSettings } from '@/lib/repositories/businesses';
import { getQuote } from '@/lib/repositories/quotes';
import { getPublicQuote, getPublicQuoteLogoKey } from '@/lib/repositories/public-quotes';
import { getStorage } from '@/lib/storage';
import { buildQuoteDocumentModel, renderQuotePdf, type QuoteDocumentModel } from '@/lib/pdf/quote-document';

/**
 * Assembly of a printable quote.
 *
 * Both the contractor's copy (behind the session) and the customer's copy
 * (behind the public token) end up in the same renderer, so the document the
 * customer accepts is the document the contractor downloads.
 */
async function logoFor(key: string | null): Promise<{ data: Buffer; type: 'png' | 'jpg' } | null> {
  if (!key) return null;

  const lower = key.toLowerCase();
  const type = lower.endsWith('.png') ? 'png' : lower.endsWith('.jpg') || lower.endsWith('.jpeg') ? 'jpg' : null;
  if (!type) return null;

  const file = await getStorage().read(key);
  if (!file) return null;

  return { data: file.data, type };
}

export function quotePdfFilename(model: QuoteDocumentModel): string {
  const safeCustomer = model.customer.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${model.quote.number}-${safeCustomer}.pdf`.slice(0, 120);
}

/** The contractor's copy: full business record, including the logo. */
export async function renderQuotePdfForBusiness(
  businessId: string,
  userId: string,
  quoteId: string,
  preparedBy: string | null
): Promise<{ pdf: Uint8Array; model: QuoteDocumentModel } | null> {
  const quote = await getQuote(businessId, userId, quoteId);
  if (!quote) return null;

  const [business, settings] = await Promise.all([
    getBusinessDetail(businessId, userId),
    getBusinessSettings(businessId, userId),
  ]);
  if (!business) return null;

  const model = buildQuoteDocumentModel({
    business: {
      legal_name: business.legal_name,
      trading_name: business.trading_name,
      registration_number: business.registration_number,
      tax_number: business.tax_number,
      address_line1: business.address_line1,
      address_line2: business.address_line2,
      city: business.city,
      province: business.province,
      postal_code: business.postal_code,
      country: business.country,
      phone: business.phone,
      email: business.email,
      website: business.website,
      currency_code: business.currency_code,
    },
    customer: quote.customer,
    quote,
    items: quote.items,
    settings,
    preparedBy,
    logo: await logoFor(business.logo_storage_key),
  });

  return { pdf: await renderQuotePdf(model), model };
}

/**
 * The customer's copy, reached through the public token. The quote is read by
 * app.public_quote(), which returns only what belongs on the document.
 */
export async function renderPublicQuotePdf(
  token: string
): Promise<{ pdf: Uint8Array; model: QuoteDocumentModel } | null> {
  const payload = await getPublicQuote(token);
  if (!payload) return null;

  const logoKey = payload.business.has_logo ? await getPublicQuoteLogoKey(token) : null;

  const model = buildQuoteDocumentModel({
    business: {
      legal_name: payload.business.legal_name,
      trading_name: payload.business.trading_name,
      registration_number: payload.business.registration_number,
      tax_number: payload.business.tax_number,
      address_line1: payload.business.address_line1,
      address_line2: payload.business.address_line2,
      city: payload.business.city,
      province: payload.business.province,
      postal_code: payload.business.postal_code,
      country: payload.business.country,
      phone: payload.business.phone,
      email: payload.business.email,
      website: payload.business.website,
      currency_code: payload.business.currency_code,
    },
    customer: {
      business_name: payload.customer.business_name,
      contact_person: payload.customer.contact_person,
      phone: null,
      email: null,
      billing_address_line1: payload.customer.billing_address_line1,
      billing_address_line2: payload.customer.billing_address_line2,
      billing_city: payload.customer.billing_city,
      billing_province: payload.customer.billing_province,
      billing_postal_code: payload.customer.billing_postal_code,
    },
    quote: {
      ...payload.quote,
      // jsonb returns NUMERIC as a JSON number; the renderer formats strings.
      subtotal: String(payload.quote.subtotal),
      discount_total: String(payload.quote.discount_total),
      tax_total: String(payload.quote.tax_total),
      total: String(payload.quote.total),
    },
    items: payload.items.map((item) => ({
      line_number: item.line_number,
      description: item.description,
      quantity: String(item.quantity),
      unit: item.unit,
      unit_price: String(item.unit_price),
      discount_percent: String(item.discount_percent),
      tax_rate: String(item.tax_rate),
      line_discount: String(item.line_discount),
      line_total: String(item.line_total),
    })),
    preparedBy: null,
    logo: await logoFor(logoKey),
  });

  return { pdf: await renderQuotePdf(model), model };
}
