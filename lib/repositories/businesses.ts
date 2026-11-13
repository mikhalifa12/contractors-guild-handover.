import type { PoolClient } from 'pg';
import { withContext } from '@/lib/db';
import {
  DEFAULT_PREFIXES,
  type DocumentType,
  type DocumentType as DocType,
} from '@/lib/numbering';

/**
 * Business (tenant) data access.
 *
 * IMPORTANT: every function here takes the business id from the caller's
 * server-side session - never from a form field or URL parameter. The RLS
 * policies then re-check the id against the authenticated membership.
 */
export type BusinessMembership = {
  business_id: string;
  role: 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER';
  status: 'INVITED' | 'ACTIVE' | 'DISABLED';
  legal_name: string;
  trading_name: string | null;
  currency_code: string;
  logo_storage_key: string | null;
  created_at: string;
};

export type BusinessDetail = {
  id: string;
  legal_name: string;
  trading_name: string | null;
  logo_url: string | null;
  logo_storage_key: string | null;
  registration_number: string | null;
  tax_number: string | null;
  address_line1: string | null;
  address_line2: string | null;
  city: string | null;
  province: string | null;
  postal_code: string | null;
  country: string;
  phone: string | null;
  email: string | null;
  website: string | null;
  whatsapp: string | null;
  currency_code: string;
  created_at: string;
};

export type BusinessSettings = {
  business_id: string;
  default_payment_terms: string;
  default_quote_validity_days: number;
  default_tax_rate: string;
  quote_prefix: string;
  invoice_prefix: string;
  receipt_prefix: string;
  bank_name: string | null;
  bank_account_name: string | null;
  bank_account_number: string | null;
  bank_branch_code: string | null;
  bank_account_type: string | null;
  payment_instructions: string | null;
  invoice_footer_note: string | null;
};

/**
 * Fallback used only when rendering settings before a row exists (defensive:
 * registration always creates one). Saving the form upserts the row.
 */
export const FALLBACK_BUSINESS_SETTINGS: BusinessSettings = {
  business_id: '',
  default_payment_terms: 'Payment due within 7 days of invoice date unless otherwise agreed.',
  default_quote_validity_days: 30,
  default_tax_rate: '15.00',
  quote_prefix: DEFAULT_PREFIXES.QUOTE,
  invoice_prefix: DEFAULT_PREFIXES.INVOICE,
  receipt_prefix: DEFAULT_PREFIXES.RECEIPT,
  bank_name: null,
  bank_account_name: null,
  bank_account_number: null,
  bank_branch_code: null,
  bank_account_type: null,
  payment_instructions: null,
  invoice_footer_note: 'Thank you for your business.',
};

export async function listMembershipsForUser(userId: string): Promise<BusinessMembership[]> {
  return withContext({ userId }, async (client) => {
    const { rows } = await client.query<BusinessMembership>(
      `select bu.business_id, bu.role, bu.status,
              b.legal_name, b.trading_name, b.currency_code, b.logo_storage_key, b.created_at
         from business_users bu
         join businesses b on b.id = bu.business_id
        where bu.status = 'ACTIVE'
        order by bu.created_at asc`,
      []
    );
    return rows;
  });
}

export async function getBusinessDetail(
  businessId: string,
  userId: string
): Promise<BusinessDetail | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<BusinessDetail>(
      `select id, legal_name, trading_name, logo_url, logo_storage_key, registration_number,
              tax_number, address_line1, address_line2, city, province, postal_code, country,
              phone, email, website, whatsapp, currency_code, created_at
         from businesses
        where id = $1`,
      [businessId]
    );
    return rows[0] ?? null;
  });
}

export async function getBusinessSettings(
  businessId: string,
  userId: string
): Promise<BusinessSettings | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<BusinessSettings>(
      `select business_id, default_payment_terms, default_quote_validity_days, default_tax_rate,
              quote_prefix, invoice_prefix, receipt_prefix,
              bank_name, bank_account_name, bank_account_number, bank_branch_code,
              bank_account_type, payment_instructions, invoice_footer_note
         from business_settings
        where business_id = $1`,
      [businessId]
    );
    return rows[0] ?? null;
  });
}

export async function updateBusinessProfile(
  businessId: string,
  userId: string,
  profile: {
    legalName: string;
    tradingName: string | null;
    registrationNumber: string | null;
    taxNumber: string | null;
    addressLine1: string | null;
    addressLine2: string | null;
    city: string | null;
    province: string | null;
    postalCode: string | null;
    country: string;
    phone: string | null;
    email: string | null;
    website: string | null;
    whatsapp: string | null;
  }
): Promise<void> {
  await withContext({ userId, businessId }, async (client) => {
    await client.query(
      `update businesses
          set legal_name = $2,
              trading_name = $3,
              registration_number = $4,
              tax_number = $5,
              address_line1 = $6,
              address_line2 = $7,
              city = $8,
              province = $9,
              postal_code = $10,
              country = $11,
              phone = $12,
              email = $13,
              website = $14,
              whatsapp = $15
        where id = $1`,
      [
        businessId,
        profile.legalName,
        profile.tradingName,
        profile.registrationNumber,
        profile.taxNumber,
        profile.addressLine1,
        profile.addressLine2,
        profile.city,
        profile.province,
        profile.postalCode,
        profile.country,
        profile.phone,
        profile.email,
        profile.website,
        profile.whatsapp,
      ]
    );
  });
}

export async function updateBusinessSettings(
  businessId: string,
  userId: string,
  settings: {
    defaultPaymentTerms: string;
    defaultQuoteValidityDays: number;
    defaultTaxRate: number;
    quotePrefix: string;
    invoicePrefix: string;
    receiptPrefix: string;
    invoiceFooterNote: string | null;
  }
): Promise<void> {
  await withContext({ userId, businessId }, async (client) => {
    await client.query(
      `insert into business_settings (business_id)
       values ($1)
       on conflict (business_id) do nothing`,
      [businessId]
    );

    await client.query(
      `update business_settings
          set default_payment_terms = $2,
              default_quote_validity_days = $3,
              default_tax_rate = $4,
              quote_prefix = $5,
              invoice_prefix = $6,
              receipt_prefix = $7,
              invoice_footer_note = $8
        where business_id = $1`,
      [
        businessId,
        settings.defaultPaymentTerms,
        settings.defaultQuoteValidityDays,
        settings.defaultTaxRate,
        settings.quotePrefix,
        settings.invoicePrefix,
        settings.receiptPrefix,
        settings.invoiceFooterNote,
      ]
    );

    // Keep future document numbers aligned with the configured prefixes.
    for (const [docType, prefix] of [
      ['QUOTE', settings.quotePrefix],
      ['INVOICE', settings.invoicePrefix],
      ['RECEIPT', settings.receiptPrefix],
    ] as Array<[DocType, string]>) {
      await client.query(
        `insert into document_sequences (business_id, doc_type, prefix)
         values ($1, $2, $3)
         on conflict (business_id, doc_type) do update set prefix = excluded.prefix`,
        [businessId, docType, prefix]
      );
    }
  });
}

export async function updateBusinessBanking(
  businessId: string,
  userId: string,
  banking: {
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    bankBranchCode: string | null;
    bankAccountType: string | null;
    paymentInstructions: string | null;
  }
): Promise<void> {
  await withContext({ userId, businessId }, async (client) => {
    await client.query(
      `insert into business_settings (business_id)
       values ($1)
       on conflict (business_id) do nothing`,
      [businessId]
    );

    await client.query(
      `update business_settings
          set bank_name = $2,
              bank_account_name = $3,
              bank_account_number = $4,
              bank_branch_code = $5,
              bank_account_type = $6,
              payment_instructions = $7
        where business_id = $1`,
      [
        businessId,
        banking.bankName,
        banking.bankAccountName,
        banking.bankAccountNumber,
        banking.bankBranchCode,
        banking.bankAccountType,
        banking.paymentInstructions,
      ]
    );
  });
}

export async function setBusinessLogo(
  businessId: string,
  userId: string,
  logo: { storageKey: string; contentType: string } | null
): Promise<void> {
  await withContext({ userId, businessId }, async (client) => {
    await client.query(
      `update businesses set logo_storage_key = $2, logo_url = $3 where id = $1`,
      [
        businessId,
        logo?.storageKey ?? null,
        logo ? `/api/businesses/${businessId}/logo` : null,
      ]
    );
  });
}

export async function getBusinessLogoKey(
  businessId: string,
  userId: string
): Promise<string | null> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ logo_storage_key: string | null }>(
      `select logo_storage_key from businesses where id = $1`,
      [businessId]
    );
    return rows[0]?.logo_storage_key ?? null;
  });
}

// ---------------------------------------------------------------------------
// Registration transaction
// ---------------------------------------------------------------------------

/**
 * Create the business, the owner membership, default settings and the document
 * sequences inside the caller's transaction.
 *
 * Ordering matters: the membership row is inserted before business_settings and
 * document_sequences so that the RLS policies (which require an ACTIVE
 * membership) allow the inserts.
 */
export async function provisionBusiness(
  client: PoolClient,
  businessId: string,
  input: {
    legalName: string;
    tradingName: string | null;
    phone: string | null;
    email: string;
    currencyCode?: string;
  }
): Promise<void> {
  await client.query(
    `insert into businesses (id, legal_name, trading_name, phone, email, currency_code)
     values ($1, $2, $3, $4, $5, $6)`,
    [
      businessId,
      input.legalName,
      input.tradingName,
      input.phone,
      input.email,
      input.currencyCode ?? 'ZAR',
    ]
  );
}

export async function provisionBusinessDefaults(
  client: PoolClient,
  businessId: string
): Promise<void> {
  await client.query(
    `insert into business_settings (
       business_id, quote_prefix, invoice_prefix, receipt_prefix,
       default_payment_terms, default_quote_validity_days, default_tax_rate
     ) values ($1, $2, $3, $4, $5, $6, $7)
     on conflict (business_id) do nothing`,
    [
      businessId,
      DEFAULT_PREFIXES.QUOTE,
      DEFAULT_PREFIXES.INVOICE,
      DEFAULT_PREFIXES.RECEIPT,
      'Payment due within 7 days of invoice date unless otherwise agreed.',
      30,
      15.0,
    ]
  );

  for (const docType of ['JOB', 'QUOTE', 'INVOICE', 'RECEIPT'] as DocumentType[]) {
    await client.query(
      `insert into document_sequences (business_id, doc_type, prefix, next_number)
       values ($1, $2, $3, 1)
       on conflict (business_id, doc_type) do nothing`,
      [businessId, docType, DEFAULT_PREFIXES[docType]]
    );
  }
}

export async function provisionMembership(
  client: PoolClient,
  businessId: string,
  userId: string,
  role: 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER'
): Promise<void> {
  await client.query(
    `insert into business_users (business_id, user_id, role, status)
     values ($1, $2, $3, 'ACTIVE')`,
    [businessId, userId, role]
  );
}
