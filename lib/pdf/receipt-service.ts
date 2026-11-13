import { getBusinessDetail } from '@/lib/repositories/businesses';
import { getReceiptDetail } from '@/lib/repositories/payments';
import { getStorage } from '@/lib/storage';
import {
  buildReceiptDocumentModel,
  renderReceiptPdf,
  type ReceiptDocumentModel,
} from '@/lib/pdf/receipt-document';

/**
 * Assembly of a printable receipt (the contractor's copy, behind the session).
 *
 * Rendered on demand from the stored rows, never recalculated: the balances on
 * the paper are the ones the receipt row remembered when the payment landed.
 * A public, token-keyed variant can reuse this module later alongside the
 * public invoice page.
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

export function receiptPdfFilename(model: ReceiptDocumentModel): string {
  const safeCustomer = model.customer.name.replace(/[^a-z0-9]+/gi, '-').replace(/^-+|-+$/g, '');
  return `${model.receipt.number}-${safeCustomer}.pdf`.slice(0, 120);
}

export async function renderReceiptPdfForBusiness(
  businessId: string,
  userId: string,
  paymentId: string
): Promise<{ pdf: Uint8Array; model: ReceiptDocumentModel } | null> {
  const receipt = await getReceiptDetail(businessId, userId, paymentId);
  if (!receipt) return null;

  const business = await getBusinessDetail(businessId, userId);
  if (!business) return null;

  const model = buildReceiptDocumentModel({
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
    customer: {
      business_name: receipt.customer_name,
      contact_person: receipt.customer_contact_person,
      phone: receipt.customer_phone,
      email: receipt.customer_email,
      billing_address_line1: receipt.customer_billing_line1,
      billing_address_line2: receipt.customer_billing_line2,
      billing_city: receipt.customer_billing_city,
      billing_province: receipt.customer_billing_province,
      billing_postal_code: receipt.customer_billing_postal_code,
    },
    receipt: {
      receipt_number: receipt.receipt_number,
      issued_at: receipt.issued_at,
      method: receipt.method,
      reference: receipt.reference,
      amount_received: receipt.amount_received,
      previous_balance: receipt.previous_balance,
      remaining_balance: receipt.remaining_balance,
      payment_date: receipt.payment_date,
      notes: receipt.notes,
    },
    invoice: {
      invoice_number: receipt.invoice_number,
      total: receipt.invoice_total,
    },
    logo: await logoFor(business.logo_storage_key),
  });

  return { pdf: await renderReceiptPdf(model), model };
}
