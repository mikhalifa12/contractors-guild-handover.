import { getBusinessDetail, getBusinessSettings } from '@/lib/repositories/businesses';
import { getInvoice } from '@/lib/repositories/invoices';
import { getStorage } from '@/lib/storage';
import {
  buildInvoiceDocumentModel,
  renderInvoicePdf,
  type InvoiceDocumentModel,
} from '@/lib/pdf/invoice-document';

/**
 * Assembly of a printable invoice (the contractor's copy, behind the session).
 *
 * Rendered on demand from the stored rows, never recalculated: the totals on
 * the paper are the totals in the database. A public, token-keyed variant can
 * reuse this module in Phase 5 alongside the public invoice page.
 */
async function logoFor(key: string | null): Promise<{ data: Buffer; type: 'png' | 'jpg' } | null> {
  if (!key) return null;

  const lower = key.toLowerCase();
  const type = lower.endsWith('.png')
    ? 'png'
    : lower.endsWith('.jpg') || lower.endsWith('.jpeg')
      ? 'jpg'
      : null;
  if (!type) return null;

  const file = await getStorage().read(key);
  if (!file) return null;

  return { data: file.data, type };
}

export function invoicePdfFilename(model: InvoiceDocumentModel): string {
  const safeCustomer = model.customer.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${model.invoice.number}-${safeCustomer}.pdf`.slice(0, 120);
}

/** The contractor's copy: full business record, banking details and the logo. */
export async function renderInvoicePdfForBusiness(
  businessId: string,
  userId: string,
  invoiceId: string,
  preparedBy: string | null
): Promise<{ pdf: Uint8Array; model: InvoiceDocumentModel } | null> {
  const invoice = await getInvoice(businessId, userId, invoiceId);
  if (!invoice) return null;

  const [business, settings] = await Promise.all([
    getBusinessDetail(businessId, userId),
    getBusinessSettings(businessId, userId),
  ]);
  if (!business) return null;

  const model = buildInvoiceDocumentModel({
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
    settings,
    customer: {
      business_name: invoice.customer.business_name,
      contact_person: invoice.customer.contact_person,
      phone: invoice.customer.phone,
      email: invoice.customer.email,
      billing_address_line1: invoice.billing_address_line1,
      billing_address_line2: invoice.billing_address_line2,
      billing_city: invoice.billing_city,
      billing_province: invoice.billing_province,
      billing_postal_code: invoice.billing_postal_code,
    },
    invoice: {
      invoice_number: invoice.invoice_number,
      status: invoice.status,
      issue_date: invoice.issue_date,
      due_date: invoice.due_date,
      job_type: invoice.job_type,
      description: invoice.description,
      contact_person: invoice.contact_person,
      contact_phone: invoice.contact_phone,
      contact_email: invoice.contact_email,
      job_address_line1: invoice.job_address_line1,
      job_address_line2: invoice.job_address_line2,
      job_city: invoice.job_city,
      job_province: invoice.job_province,
      job_postal_code: invoice.job_postal_code,
      subtotal: invoice.subtotal,
      discount_total: invoice.discount_total,
      tax_total: invoice.tax_total,
      total: invoice.total,
      amount_paid: invoice.amount_paid,
      balance_due: invoice.balance_due,
      payment_terms: invoice.payment_terms,
      notes: invoice.notes,
      terms_and_conditions: invoice.terms_and_conditions,
      paid_at: invoice.paid_at,
      cancelled_at: invoice.cancelled_at,
    },
    items: invoice.items,
    preparedBy,
    logo: await logoFor(business.logo_storage_key),
  });

  return { pdf: await renderInvoicePdf(model), model };
}
