import { describe, expect, it } from 'vitest';
import {
  businessBankingSchema,
  catalogueItemSchema,
  customerSchema,
  jobSchema,
  businessDocumentSettingsSchema,
  businessProfileSchema,
  changePasswordSchema,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
} from '@/lib/validation/schemas';
import { safeAppRedirectPath } from '@/lib/security/redirect';
import { quoteItemsSchema, quoteResponseSchema, quoteSchema } from '@/lib/validation/schemas';

function registration(overrides: Record<string, unknown> = {}) {
  return {
    fullName: 'Thandi Mokoena',
    email: 'Thandi@Example.co.za',
    password: 'a-strong-password',
    confirmPassword: 'a-strong-password',
    businessName: 'Mokoena Electrical',
    tradingName: '',
    phone: '+27 82 123 4567',
    ...overrides,
  };
}

describe('registration validation', () => {
  it('accepts a valid registration and normalises the email', () => {
    const parsed = registerSchema.parse(registration());
    expect(parsed.email).toBe('thandi@example.co.za');
    expect(parsed.tradingName ?? null).toBeNull();
  });

  it('rejects mismatched passwords', () => {
    const result = registerSchema.safeParse(registration({ confirmPassword: 'different-password' }));
    expect(result.success).toBe(false);
    expect(result.success === false && result.error.issues[0]?.path).toEqual(['confirmPassword']);
  });

  it('rejects short passwords and invalid emails', () => {
    expect(registerSchema.safeParse(registration({ password: 'short', confirmPassword: 'short' })).success).toBe(false);
    expect(registerSchema.safeParse(registration({ email: 'not-an-email' })).success).toBe(false);
  });

  it('requires a business name', () => {
    expect(registerSchema.safeParse(registration({ businessName: '   ' })).success).toBe(false);
  });
});

describe('login and password schemas', () => {
  it('normalises the login email', () => {
    const parsed = loginSchema.parse({ email: '  OWNER@Example.com ', password: 'secret' });
    expect(parsed.email).toBe('owner@example.com');
  });

  it('requires the current password to differ from the new one', () => {
    const result = changePasswordSchema.safeParse({
      currentPassword: 'the-same-password',
      newPassword: 'the-same-password',
      confirmPassword: 'the-same-password',
    });
    expect(result.success).toBe(false);
  });

  it('validates reset input', () => {
    expect(
      resetPasswordSchema.safeParse({
        token: 'token-value',
        password: 'a-new-secure-password',
        confirmPassword: 'a-new-secure-password',
      }).success
    ).toBe(true);
  });
});

describe('business profile and settings schemas', () => {
  it('accepts a minimal profile and normalises blanks to null', () => {
    const parsed = businessProfileSchema.parse({
      legalName: 'Guild Electrical',
      country: 'South Africa',
    });
    expect(parsed.legalName).toBe('Guild Electrical');
    expect(parsed.city ?? null).toBeNull();
  });

  it('rejects an invalid website but accepts a bare domain', () => {
    expect(businessProfileSchema.safeParse({ legalName: 'A', country: 'ZA', website: 'not a url' }).success).toBe(false);
    expect(businessProfileSchema.safeParse({ legalName: 'A', country: 'ZA', website: 'guild.co.za' }).success).toBe(true);
  });

  it('validates phone numbers loosely but rejects nonsense', () => {
    expect(businessProfileSchema.safeParse({ legalName: 'A', country: 'ZA', phone: '082 123 4567' }).success).toBe(true);
    expect(businessProfileSchema.safeParse({ legalName: 'A', country: 'ZA', phone: 'call-me-maybe' }).success).toBe(false);
  });

  it('upper-cases document prefixes and enforces the allowed characters', () => {
    const parsed = businessDocumentSettingsSchema.parse({
      defaultPaymentTerms: 'Due on receipt',
      defaultQuoteValidityDays: '30',
      defaultTaxRate: '15',
      quotePrefix: 'quote-',
      invoicePrefix: 'inv-',
      receiptPrefix: 'rec-',
      invoiceFooterNote: '',
    });
    expect(parsed.quotePrefix).toBe('QUOTE-');
    expect(parsed.defaultQuoteValidityDays).toBe(30);
    expect(
      businessDocumentSettingsSchema.safeParse({
        defaultPaymentTerms: 'Due on receipt',
        defaultQuoteValidityDays: '30',
        defaultTaxRate: '15',
        quotePrefix: 'bad prefix!',
        invoicePrefix: 'INV-',
        receiptPrefix: 'REC-',
        invoiceFooterNote: '',
      }).success
    ).toBe(false);
  });

  it('rejects out-of-range tax rates and validity windows', () => {
    const base = {
      defaultPaymentTerms: 'Due on receipt',
      quotePrefix: 'Q-',
      invoicePrefix: 'I-',
      receiptPrefix: 'R-',
      invoiceFooterNote: '',
    };
    expect(businessDocumentSettingsSchema.safeParse({ ...base, defaultQuoteValidityDays: '0', defaultTaxRate: '15' }).success).toBe(false);
    expect(businessDocumentSettingsSchema.safeParse({ ...base, defaultQuoteValidityDays: '30', defaultTaxRate: '115' }).success).toBe(false);
  });

  it('allows banking details to be blank while the owner is still setting up', () => {
    const parsed = businessBankingSchema.parse({
      bankName: '',
      bankAccountNumber: '',
      paymentInstructions: '',
    });
    expect(parsed.bankName ?? null).toBeNull();
  });
});

describe('safeAppRedirectPath', () => {
  it('accepts workspace paths, including query strings', () => {
    expect(safeAppRedirectPath('/app')).toBe('/app');
    expect(safeAppRedirectPath('/app/invoices?status=overdue')).toBe('/app/invoices?status=overdue');
  });

  it('falls back to the dashboard for anything that leaves the workspace', () => {
    expect(safeAppRedirectPath('https://evil.example.com')).toBe('/app');
    expect(safeAppRedirectPath('//evil.example.com')).toBe('/app');
    expect(safeAppRedirectPath('/\\evil.example.com')).toBe('/app');
    expect(safeAppRedirectPath('/login')).toBe('/app');
    expect(safeAppRedirectPath('')).toBe('/app');
    expect(safeAppRedirectPath('/app\u0000')).toBe('/app');
    expect(safeAppRedirectPath(undefined)).toBe('/app');
    expect(safeAppRedirectPath(`/app/${'x'.repeat(400)}`)).toBe('/app');
  });
});

describe('customer schema', () => {
  const base = {
    customerType: 'BUSINESS',
    businessName: 'Harbour Point Body Corporate',
    contactPerson: '',
    phone: '021 555 0110',
    email: '',
  };

  it('accepts a business customer with only a phone number', () => {
    const parsed = customerSchema.parse(base);
    expect(parsed.businessName).toBe('Harbour Point Body Corporate');
    expect(parsed.phone).toBe('021 555 0110');
    expect(parsed.email).toBeNull();
  });

  it('lower-cases emails so sign-in style lookups stay consistent', () => {
    const parsed = customerSchema.parse({ ...base, email: 'Riaan@Example.CO.ZA' });
    expect(parsed.email).toBe('riaan@example.co.za');
  });

  it('requires a name and at least one way to make contact', () => {
    expect(() => customerSchema.parse({ ...base, businessName: '' })).toThrow();
    const noContact = customerSchema.safeParse({ ...base, phone: '', email: '' });
    expect(noContact.success).toBe(false);
    if (!noContact.success) {
      expect(noContact.error.issues.some((issue) => issue.path.includes('phone'))).toBe(true);
    }
  });

  it('rejects malformed phone numbers and emails', () => {
    expect(customerSchema.safeParse({ ...base, phone: 'call me maybe' }).success).toBe(false);
    expect(customerSchema.safeParse({ ...base, email: 'not-an-email' }).success).toBe(false);
  });
});

describe('catalogue item schema', () => {
  const base = {
    kind: 'SERVICE',
    name: 'Distribution board replacement',
    unit: 'job',
    defaultPrice: '4850',
    taxRate: '15',
  };

  it('normalises prices to two decimals without using floats', () => {
    expect(catalogueItemSchema.parse({ ...base, defaultPrice: '1 234,5' }).defaultPrice).toBe(
      '1234.50'
    );
    expect(catalogueItemSchema.parse({ ...base, defaultPrice: '4850' }).defaultPrice).toBe(
      '4850.00'
    );
    expect(catalogueItemSchema.parse({ ...base, defaultPrice: '0.5' }).defaultPrice).toBe('0.50');
    // Three decimals would silently round money, so it is rejected instead.
    expect(catalogueItemSchema.safeParse({ ...base, defaultPrice: '0.005' }).success).toBe(false);
  });

  it('rejects non-numeric prices and negative tax rates', () => {
    expect(catalogueItemSchema.safeParse({ ...base, defaultPrice: 'about R500' }).success).toBe(false);
    expect(catalogueItemSchema.safeParse({ ...base, taxRate: '-1' }).success).toBe(false);
    expect(catalogueItemSchema.safeParse({ ...base, taxRate: '150' }).success).toBe(false);
  });

  it('defaults the unit and treats a missing cost price as empty', () => {
    const parsed = catalogueItemSchema.parse({ ...base, unit: '', costPrice: '' });
    expect(parsed.unit).toBe('each');
    expect(parsed.costPrice).toBeNull();
  });
});

describe('job schema', () => {
  const base = {
    customerId: '6b0f0f34-3f52-4a2f-bbb4-6a3c8d3a0f11',
    title: 'Kitchen plugs tripping the earth leakage',
    status: 'LEAD',
  };

  it('requires a real customer id and a title', () => {
    expect(jobSchema.safeParse(base).success).toBe(true);
    expect(jobSchema.safeParse({ ...base, customerId: 'not-a-uuid' }).success).toBe(false);
    expect(jobSchema.safeParse({ ...base, title: '  ' }).success).toBe(false);
  });

  it('accepts a blank schedule date but not a malformed one', () => {
    expect(jobSchema.parse({ ...base, scheduledDate: '' }).scheduledDate).toBeNull();
    expect(jobSchema.safeParse({ ...base, scheduledDate: 'next Tuesday' }).success).toBe(false);
    expect(jobSchema.parse({ ...base, scheduledDate: '2026-10-14' }).scheduledDate).toBe(
      '2026-10-14'
    );
  });

  it('only accepts known statuses', () => {
    expect(jobSchema.safeParse({ ...base, status: 'ARCHIVED' }).success).toBe(false);
    expect(jobSchema.parse({ ...base, status: 'IN_PROGRESS' }).status).toBe('IN_PROGRESS');
  });
});

describe('quote validation', () => {
  const token = 'kZ8pQ2mV7xR4sT1uY6wA3bC9';

  it('requires at least one line and a description on each line', () => {
    expect(quoteItemsSchema.safeParse([]).success).toBe(false);
    expect(quoteItemsSchema.safeParse([{ description: '', quantity: '1', unitPrice: '10' }]).success).toBe(false);
    // 80 lines is the ceiling; the 81st is refused rather than silently dropped.
    const tooMany = Array.from({ length: 81 }, (_, index) => ({
      description: `Line ${index + 1}`,
      quantity: '1',
      unitPrice: '10.00',
    }));
    expect(quoteItemsSchema.safeParse(tooMany.slice(0, 80)).success).toBe(true);
    expect(quoteItemsSchema.safeParse(tooMany).success).toBe(false);
  });

  it('accepts fractional quantities but rejects zero and negatives', () => {
    const parse = (quantity: string) =>
      quoteItemsSchema.safeParse([{ description: 'Cable', quantity, unitPrice: '10.00' }]);

    expect(parse('2.5').success).toBe(true);
    expect(parse('0.25').success).toBe(true);
    expect(parse('0').success).toBe(false);
    expect(parse('-1').success).toBe(false);
    // Three decimals is the database's precision for a quantity.
    expect(parse('1.2345').success).toBe(false);
  });

  it('normalises money and percentages, and rejects impossible ones', () => {
    const parsed = quoteItemsSchema.parse([
      {
        description: 'Distribution board',
        quantity: '1',
        unitPrice: '1 234,5',
        discountPercent: '7.5',
        taxRate: '15',
      },
    ]);

    expect(parsed[0]?.unitPrice).toBe('1234.50');
    expect(parsed[0]?.discountPercent).toBe(7.5);
    expect(parsed[0]?.taxRate).toBe(15);
    expect(parsed[0]?.unit).toBe('each');

    const badPrice = quoteItemsSchema.safeParse([
      { description: 'Board', quantity: '1', unitPrice: '0.005' },
    ]);
    expect(badPrice.success).toBe(false);

    const badDiscount = quoteItemsSchema.safeParse([
      { description: 'Board', quantity: '1', unitPrice: '10.00', discountPercent: '120' },
    ]);
    expect(badDiscount.success).toBe(false);
  });

  it('keeps a quote header valid without a job or a validity date', () => {
    const base = {
      customerId: '6b0f0f34-3f52-4a2f-bbb4-6a3c8d3a0f11',
      issueDate: '2026-09-01',
    };

    const parsed = quoteSchema.parse({ ...base, validUntil: '', jobId: '' });
    expect(parsed.validUntil).toBeNull();
    expect(parsed.jobId).toBeNull();

    expect(quoteSchema.safeParse({ ...base, customerId: 'nope' }).success).toBe(false);
    // A quote may not expire before it was issued.
    expect(quoteSchema.safeParse({ ...base, validUntil: '2026-08-31' }).success).toBe(false);
  });

  it('defaults the issue date to today when the form omits it', () => {
    const parsed = quoteSchema.parse({
      customerId: '6b0f0f34-3f52-4a2f-bbb4-6a3c8d3a0f11',
      issueDate: '',
    });
    expect(parsed.issueDate).toBe(new Date().toISOString().slice(0, 10));
  });

  it('requires a name before a customer can accept, and nothing else', () => {
    expect(quoteResponseSchema.safeParse({ token, decision: 'ACCEPT', name: 'Palesa' }).success).toBe(true);
    expect(quoteResponseSchema.safeParse({ token, decision: 'ACCEPT', name: '' }).success).toBe(false);
    // A decline may be anonymous; the reason is optional.
    expect(quoteResponseSchema.safeParse({ token, decision: 'DECLINE', name: '', reason: '' }).success).toBe(true);
    expect(quoteResponseSchema.safeParse({ token: 'short', decision: 'ACCEPT', name: 'P' }).success).toBe(false);
    expect(quoteResponseSchema.safeParse({ token, decision: 'MAYBE', name: 'P' }).success).toBe(false);
  });
});
