import '@/tests/helpers/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { loginAction } from '@/lib/actions/auth';
import {
  saveBankingDetailsAction,
  saveBusinessProfileAction,
  saveDocumentSettingsAction,
  uploadLogoAction,
} from '@/lib/actions/business';
import { withContext } from '@/lib/db';
import { allocateDocumentNumber } from '@/lib/numbering';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { cookieStore } from '@/tests/helpers/next-mocks';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';
import { registerOwner, type RegisteredOwner } from '@/tests/helpers/owners';
import {
  expectRedirect,
  expectStateError,
  expectStateSuccess,
  formData,
  runAction,
} from '@/tests/helpers/actions';

/** 1x1 transparent PNG - a real image, used to exercise the upload path. */
const PNG_1X1 = Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==',
  'base64'
);

const PROFILE_FORM = {
  legalName: 'Ndlovu Electrical (Pty) Ltd',
  tradingName: 'Ndlovu Sparks',
  registrationNumber: '2019/123456/07',
  taxNumber: '4123456789',
  addressLine1: '12 Industrial Road',
  addressLine2: 'Unit 4',
  city: 'Cape Town',
  province: 'Western Cape',
  postalCode: '7550',
  country: 'South Africa',
  phone: '+27 21 555 0100',
  email: 'quotes@ndlovu-electric.co.za',
  website: 'ndlovu-electric.co.za',
  whatsapp: '+27 82 555 0100',
};

describe('business profile settings', () => {
  let owner: RegisteredOwner;

  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
    owner = await registerOwner({ businessName: 'Ndlovu Electrical' });
  });

  it('saves the business profile of the signed-in business', async () => {
    const outcome = await runAction(saveBusinessProfileAction, formData(PROFILE_FORM));
    const state = expectStateSuccess(outcome);
    expect(state.message).toMatch(/saved/i);

    const row = await withAdminClient(async (client) => {
      const { rows } = await client.query(
        `select legal_name, trading_name, tax_number, city, province, postal_code, email, website
           from public.businesses where id = $1`,
        [owner.businessId]
      );
      return rows[0];
    });

    expect(row).toMatchObject({
      legal_name: 'Ndlovu Electrical (Pty) Ltd',
      trading_name: 'Ndlovu Sparks',
      tax_number: '4123456789',
      city: 'Cape Town',
      province: 'Western Cape',
      postal_code: '7550',
      email: 'quotes@ndlovu-electric.co.za',
      website: 'ndlovu-electric.co.za',
    });
  });

  it('rejects invalid profile input without writing', async () => {
    const outcome = await runAction(
      saveBusinessProfileAction,
      formData({ ...PROFILE_FORM, email: 'not-an-email' })
    );

    const state = expectStateError(outcome);
    expect(state.fieldErrors.email).toBeTruthy();

    const row = await withAdminClient(async (client) => {
      const { rows } = await client.query(`select email from public.businesses where id = $1`, [
        owner.businessId,
      ]);
      return rows[0] as { email: string };
    });
    expect(row.email).not.toBe('not-an-email');
  });

  it('stores document settings and applies the configured prefix to new numbers', async () => {
    const outcome = await runAction(
      saveDocumentSettingsAction,
      formData({
        defaultPaymentTerms: 'Payment due within 14 days of invoice date.',
        defaultQuoteValidityDays: '14',
        defaultTaxRate: '15',
        quotePrefix: 'quot-',
        invoicePrefix: 'inv-',
        receiptPrefix: 'rec-',
        invoiceFooterNote: 'Thanks for supporting a local contractor.',
      })
    );
    expectStateSuccess(outcome);

    const settings = await withAdminClient(async (client) => {
      const { rows } = await client.query(
        `select default_quote_validity_days, default_tax_rate, quote_prefix, invoice_prefix
           from public.business_settings where business_id = $1`,
        [owner.businessId]
      );
      return rows[0] as {
        default_quote_validity_days: number;
        default_tax_rate: string;
        quote_prefix: string;
        invoice_prefix: string;
      };
    });

    expect(settings.quote_prefix).toBe('QUOT-');
    expect(settings.invoice_prefix).toBe('INV-');
    expect(settings.default_quote_validity_days).toBe(14);

    const nextNumber = await withContext(
      { userId: owner.userId, businessId: owner.businessId },
      (client) => allocateDocumentNumber(client, owner.businessId, 'QUOTE', 'QUOT-')
    );
    expect(nextNumber).toBe('QUOT-0001');
  });

  it('stores banking details on the business, not in configuration', async () => {
    const outcome = await runAction(
      saveBankingDetailsAction,
      formData({
        bankName: 'Placeholder Bank',
        bankAccountName: 'Ndlovu Electrical (Pty) Ltd',
        bankAccountNumber: '0000000000',
        bankBranchCode: '000000',
        bankAccountType: 'Cheque / Current',
        paymentInstructions: 'Use the invoice number as your reference.',
      })
    );
    expectStateSuccess(outcome);

    const settings = await withAdminClient(async (client) => {
      const { rows } = await client.query(
        `select bank_name, bank_account_number, payment_instructions
           from public.business_settings where business_id = $1`,
        [owner.businessId]
      );
      return rows[0] as {
        bank_name: string;
        bank_account_number: string;
        payment_instructions: string;
      };
    });

    expect(settings.bank_name).toBe('Placeholder Bank');
    expect(settings.bank_account_number).toBe('0000000000');
    expect(settings.payment_instructions).toMatch(/reference/i);
  });

  it('never writes to another business, even when a business id is supplied', async () => {
    // A second contractor registers (which, as in a real browser, replaces the
    // session cookie), then the first owner signs back in.
    const other = await registerOwner({ businessName: 'Zulu Electrical' });
    cookieStore.clear();
    const signIn = await runAction(
      loginAction,
      formData({ email: owner.email, password: owner.password })
    );
    expectRedirect(signIn, '/app');

    const otherBefore = await withAdminClient(async (client) => {
      const { rows } = await client.query(`select legal_name, city from public.businesses where id = $1`, [
        other.businessId,
      ]);
      return rows[0];
    });

    await runAction(
      saveBusinessProfileAction,
      formData({
        ...PROFILE_FORM,
        legalName: 'Hijacked Electrical',
        businessId: other.businessId,
        id: other.businessId,
      })
    );

    const otherAfter = await withAdminClient(async (client) => {
      const { rows } = await client.query(`select legal_name, city from public.businesses where id = $1`, [
        other.businessId,
      ]);
      return rows[0];
    });

    expect(otherAfter).toEqual(otherBefore);

    // ...and the caller's own business was updated instead.
    expect(await countRows('businesses', `legal_name = 'Hijacked Electrical'`)).toBe(1);
    expect(await countRows('businesses', `id = $1`, [other.businessId])).toBe(1);
  });

  it('accepts a real image upload and rejects disguised content', async () => {
    const good = await runAction(
      uploadLogoAction,
      formData({ logo: new File([PNG_1X1], 'logo.png', { type: 'image/png' }) })
    );
    expectStateSuccess(good);

    const logoKey = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ logo_storage_key: string | null }>(
        `select logo_storage_key from public.businesses where id = $1`,
        [owner.businessId]
      );
      return rows[0]?.logo_storage_key ?? null;
    });
    expect(logoKey).toMatch(new RegExp(`^logos/${owner.businessId}/`));

    // A script renamed to .png must be refused: validation reads the bytes.
    const disguised = await runAction(
      uploadLogoAction,
      formData({
        logo: new File([Buffer.from('<?php echo "owned"; ?>')], 'logo.png', { type: 'image/png' }),
      })
    );
    const state = expectStateError(disguised);
    expect(state.fieldErrors.logo?.[0]).toMatch(/png, jpeg or webp/i);

    // SVG is deliberately blocked as an XSS vector.
    const svg = await runAction(
      uploadLogoAction,
      formData({
        logo: new File([Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>')], 'logo.svg', {
          type: 'image/svg+xml',
        }),
      })
    );
    expectStateError(svg);
  });
});
