import { z } from 'zod';
import { QUOTE_STATUSES } from '@/lib/quotes';
import { INVOICE_STATUSES } from '@/lib/invoices';

/**
 * Every Server Action validates its input with one of these schemas BEFORE it
 * reaches the database. Database constraints are the second line of defence.
 */
const optionalText = (max = 200) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
    z.string().trim().max(max, `Must be ${max} characters or fewer`).nullable().optional()
  );

const requiredText = (max = 200, label = 'This field') =>
  z
    .string()
    .trim()
    .min(1, `${label} is required`)
    .max(max, `${label} must be ${max} characters or fewer`);

/** Empty form values fall back to the default instead of failing validation. */
const withDefault = <T extends z.ZodTypeAny>(schema: T) =>
  z.preprocess(
    (value) => (typeof value === 'string' && value.trim() === '' ? undefined : value),
    schema
  );


export const emailSchema = z
  .string()
  .trim()
  .min(3, 'Email is required')
  .max(254, 'Email is too long')
  .email('Enter a valid email address')
  .transform((value) => value.toLowerCase());

export const passwordSchema = z
  .string()
  .min(10, 'Use at least 10 characters')
  .max(200, 'Use 200 characters or fewer');

/** Permissive phone validation: international formats vary widely. */
const phoneSchema = optionalText(32).refine(
  (value) => value === null || value === undefined || /^[+()\d\s.-]{6,32}$/.test(value),
  { message: 'Enter a valid phone number' }
);

// ---------------------------------------------------------------------------
// Authentication
// ---------------------------------------------------------------------------

export const registerSchema = z
  .object({
    fullName: requiredText(120, 'Your name'),
    email: emailSchema,
    password: passwordSchema,
    confirmPassword: z.string(),
    businessName: requiredText(160, 'Business name'),
    tradingName: optionalText(160),
    phone: phoneSchema,
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export type RegisterInput = z.infer<typeof registerSchema>;

export const loginSchema = z.object({
  email: emailSchema,
  password: z.string().min(1, 'Enter your password').max(200),
  // Where to land after sign-in. Validated by safeAppRedirectPath().
  next: z.string().max(300).optional(),
});

export type LoginInput = z.infer<typeof loginSchema>;

export const forgotPasswordSchema = z.object({
  email: emailSchema,
});

export const resetPasswordSchema = z
  .object({
    token: requiredText(400, 'Reset token'),
    password: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.password === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  });

export const updateProfileSchema = z.object({
  fullName: requiredText(120, 'Your name'),
  phone: phoneSchema,
});

export const changePasswordSchema = z
  .object({
    currentPassword: z.string().min(1, 'Enter your current password').max(200),
    newPassword: passwordSchema,
    confirmPassword: z.string(),
  })
  .refine((data) => data.newPassword === data.confirmPassword, {
    path: ['confirmPassword'],
    message: 'Passwords do not match',
  })
  .refine((data) => data.currentPassword !== data.newPassword, {
    path: ['newPassword'],
    message: 'Choose a password you have not used here before',
  });

// ---------------------------------------------------------------------------
// Business profile, document settings and banking details
// ---------------------------------------------------------------------------

const prefixSchema = z
  .string()
  .trim()
  .max(12, 'Use 12 characters or fewer')
  .regex(/^[A-Za-z0-9/-]*$/, 'Use letters, numbers, dash or slash only')
  .transform((value) => value.toUpperCase());

export const businessProfileSchema = z.object({
  legalName: requiredText(160, 'Business name'),
  tradingName: optionalText(160),
  registrationNumber: optionalText(60),
  taxNumber: optionalText(60),
  addressLine1: optionalText(160),
  addressLine2: optionalText(160),
  city: optionalText(80),
  province: optionalText(80),
  postalCode: optionalText(16),
  country: requiredText(80, 'Country').default('South Africa'),
  phone: phoneSchema,
  email: optionalText(254).refine(
    (value) => value === null || value === undefined || z.string().email().safeParse(value).success,
    { message: 'Enter a valid email address' }
  ),
  website: optionalText(200).refine(
    (value) =>
      value === null ||
      value === undefined ||
      /^https?:\/\/[^\s]+$/i.test(value) ||
      /^[a-z0-9.-]+\.[a-z]{2,}$/i.test(value),
    { message: 'Enter a valid website address' }
  ),
  whatsapp: phoneSchema,
});

export type BusinessProfileInput = z.infer<typeof businessProfileSchema>;

export const businessDocumentSettingsSchema = z.object({
  defaultPaymentTerms: requiredText(400, 'Payment terms'),
  defaultQuoteValidityDays: z.coerce
    .number()
    .int('Use whole days')
    .min(1, 'At least 1 day')
    .max(365, 'At most 365 days'),
  defaultTaxRate: z.coerce
    .number()
    .min(0, 'Cannot be negative')
    .max(100, 'Cannot exceed 100%'),
  quotePrefix: prefixSchema,
  invoicePrefix: prefixSchema,
  receiptPrefix: prefixSchema,
  invoiceFooterNote: optionalText(300),
});

export type BusinessDocumentSettingsInput = z.infer<typeof businessDocumentSettingsSchema>;

/**
 * Banking details are per-business data, stored in the database and never in
 * source code or environment files. See SECURITY.md.
 */
export const businessBankingSchema = z.object({
  bankName: optionalText(120),
  bankAccountName: optionalText(160),
  bankAccountNumber: optionalText(40),
  bankBranchCode: optionalText(20),
  bankAccountType: optionalText(40),
  paymentInstructions: optionalText(400),
});

export type BusinessBankingInput = z.infer<typeof businessBankingSchema>;

// ---------------------------------------------------------------------------
// Customers (Phase 2)
// ---------------------------------------------------------------------------

export const customerTypeSchema = z.enum(['BUSINESS', 'INDIVIDUAL']);

const optionalEmail = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  emailSchema.nullable().optional()
);


/**
 * A customer must be contactable: a phone number or an email address, so a
 * contractor can always reach them about a quote or an invoice.
 */
export const customerSchema = z
  .object({
    customerType: withDefault(customerTypeSchema.default('BUSINESS')),
    businessName: requiredText(160, 'Customer name'),
    contactPerson: optionalText(120),
    phone: phoneSchema,
    email: optionalEmail,
    billingAddressLine1: optionalText(160),
    billingAddressLine2: optionalText(160),
    billingCity: optionalText(80),
    billingProvince: optionalText(80),
    billingPostalCode: optionalText(16),
    billingCountry: optionalText(80),
    siteAddressLine1: optionalText(160),
    siteAddressLine2: optionalText(160),
    siteCity: optionalText(80),
    siteProvince: optionalText(80),
    sitePostalCode: optionalText(16),
    notes: optionalText(2000),
  })
  .refine((value) => Boolean(value.phone ?? value.email), {
    message: 'Add a phone number or an email address',
    path: ['phone'],
  });

export type CustomerInput = z.infer<typeof customerSchema>;

// ---------------------------------------------------------------------------
// Catalogue: products and services (Phase 2)
// ---------------------------------------------------------------------------

/**
 * Money arrives as text from a form. Accept "1 234,56", "1234.5" and "1234"
 * and normalise to a two-decimal string so it can be stored in NUMERIC(14,2)
 * without ever passing through a float.
 */
export const moneyInputSchema = z
  .string()
  .trim()
  .min(1, 'Enter an amount')
  .transform((value) => value.replace(/\s/g, '').replace(/,/g, '.'))
  .refine((value) => /^\d{1,9}(\.\d{1,2})?$/.test(value), {
    message: 'Use a number like 1250 or 1250.50',
  })
  .transform((value) => {
    const [whole, fraction = ''] = value.split('.');
    return `${whole}.${fraction.padEnd(2, '0')}`;
  });

const optionalMoneyInputSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  moneyInputSchema.nullable().optional()
);

export const catalogueItemSchema = z.object({
  kind: withDefault(z.enum(['PRODUCT', 'SERVICE']).default('SERVICE')),
  name: requiredText(160, 'Name'),
  description: optionalText(600),
  category: optionalText(60),
  unit: withDefault(requiredText(24, 'Unit').default('each')),
  sku: optionalText(40),
  defaultPrice: moneyInputSchema,
  costPrice: optionalMoneyInputSchema,
  taxRate: z.coerce
    .number()
    .min(0, 'Tax rate cannot be negative')
    .max(100, 'Tax rate cannot exceed 100')
    .default(15),
  isActive: z.coerce.boolean().default(true),
});

export type CatalogueItemInput = z.infer<typeof catalogueItemSchema>;

// ---------------------------------------------------------------------------
// Jobs (Phase 2)
// ---------------------------------------------------------------------------

export const JOB_STATUSES = [
  'LEAD',
  'QUOTED',
  'APPROVED',
  'SCHEDULED',
  'IN_PROGRESS',
  'COMPLETED',
  'CANCELLED',
] as const;

export const jobStatusSchema = z.enum(JOB_STATUSES);

export type JobStatusValue = (typeof JOB_STATUSES)[number];

const optionalDateSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z
    .string()
    .trim()
    .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker or YYYY-MM-DD')
    .nullable()
    .optional()
);

export const jobSchema = z.object({
  customerId: z.string().uuid('Choose a customer'),
  title: requiredText(160, 'Job title'),
  description: optionalText(2000),
  jobType: optionalText(60),
  status: withDefault(jobStatusSchema.default('LEAD')),
  scheduledDate: optionalDateSchema,
  jobAddressLine1: optionalText(160),
  jobAddressLine2: optionalText(160),
  jobCity: optionalText(80),
  jobProvince: optionalText(80),
  jobPostalCode: optionalText(16),
  notes: optionalText(2000),
});

export type JobInput = z.infer<typeof jobSchema>;

// ---------------------------------------------------------------------------
// Quotes (Phase 3)
// ---------------------------------------------------------------------------

/**
 * The status list lives in lib/quotes.ts so the UI, the actions and the public
 * page all read the same source of truth. It is pure TypeScript with no
 * runtime imports, so it is safe to import from anywhere.
 */
export const quoteStatusSchema = z.enum(QUOTE_STATUSES);

/** Quantities may carry three decimals (0.5 m of cable, 2.25 hours). */
const quantityInputSchema = z
  .string()
  .trim()
  .min(1, 'Enter a quantity')
  .transform((value) => value.replace(/\s/g, '').replace(/,/g, '.'))
  .refine((value) => /^\d{1,7}(\.\d{1,3})?$/.test(value), {
    message: 'Use a number like 2 or 2.5',
  })
  .transform((value) => Number(value))
  .refine((value) => value > 0, { message: 'Quantity must be more than zero' })
  .refine((value) => value <= 1_000_000, { message: 'That quantity is too large' });

const percentInputSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? '0' : value),
  z
    .string()
    .trim()
    .transform((value) => value.replace(/\s/g, '').replace(/,/g, '.'))
    .refine((value) => /^\d{1,3}(\.\d{1,2})?$/.test(value), {
      message: 'Use a percentage like 15 or 7.5',
    })
    .transform((value) => Number(value))
    .refine((value) => value >= 0 && value <= 100, { message: 'Use a value between 0 and 100' })
);

const optionalUuidSchema = z.preprocess(
  (value) => (typeof value === 'string' && value.trim() === '' ? null : value),
  z.string().uuid('Choose a valid record').nullable().optional()
);

/**
 * One quote line. The line is always a copy of the catalogue item at the
 * moment it was added: changing a catalogue price later never rewrites a quote
 * a customer has already seen.
 */
export const quoteItemSchema = z.object({
  productId: optionalUuidSchema,
  description: requiredText(300, 'Line description'),
  quantity: quantityInputSchema,
  unit: withDefault(requiredText(24, 'Unit').default('each')),
  unitPrice: moneyInputSchema,
  // Defaults are strings on purpose: the input schema parses form values, so a
  // numeric default would be rejected as "expected string, received number".
  discountPercent: withDefault(percentInputSchema.default('0')),
  taxRate: withDefault(percentInputSchema.default('15')),
});

export const quoteItemsSchema = z
  .array(quoteItemSchema)
  .min(1, 'Add at least one line to the quote')
  .max(80, 'A quote can hold 80 lines — split it into two documents');

export type QuoteItemFormValues = z.infer<typeof quoteItemSchema>;

export const quoteSchema = z
  .object({
    customerId: z.string().uuid('Choose a customer'),
    jobId: optionalUuidSchema,
    issueDate: withDefault(
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker or YYYY-MM-DD')
        .default(() => new Date().toISOString().slice(0, 10))
    ),
    validUntil: optionalDateSchema,
    contactPerson: optionalText(120),
    contactPhone: phoneSchema,
    contactEmail: optionalEmail,
    jobType: optionalText(60),
    jobAddressLine1: optionalText(160),
    jobAddressLine2: optionalText(160),
    jobCity: optionalText(80),
    jobProvince: optionalText(80),
    jobPostalCode: optionalText(16),
    description: optionalText(2000),
    paymentTerms: optionalText(400),
    notes: optionalText(2000),
    termsAndConditions: optionalText(3000),
  })
  .refine(
    (value) => !value.validUntil || value.validUntil >= value.issueDate,
    { path: ['validUntil'], message: 'The validity date cannot be before the issue date' }
  );

export type QuoteFormValues = z.infer<typeof quoteSchema>;

// ---------------------------------------------------------------------------
// Invoices (Phase 4)
// ---------------------------------------------------------------------------

/**
 * The status list lives in lib/invoices.ts so the UI, the actions and any
 * public surface read the same source of truth.
 */
export const invoiceStatusSchema = z.enum(INVOICE_STATUSES);

export const invoiceItemSchema = z.object({
  productId: optionalUuidSchema,
  description: requiredText(300, 'Line description'),
  quantity: quantityInputSchema,
  unit: withDefault(requiredText(24, 'Unit').default('each')),
  unitPrice: moneyInputSchema,
  discountPercent: withDefault(percentInputSchema.default('0')),
  taxRate: withDefault(percentInputSchema.default('15')),
});

export const invoiceItemsSchema = z
  .array(invoiceItemSchema)
  .min(1, 'Add at least one line to the invoice')
  .max(80, 'An invoice can hold 80 lines — split it into two documents');

export type InvoiceItemFormValues = z.infer<typeof invoiceItemSchema>;

export const invoiceSchema = z
  .object({
    customerId: z.string().uuid('Choose a customer'),
    jobId: optionalUuidSchema,
    issueDate: withDefault(
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker or YYYY-MM-DD')
        .default(() => new Date().toISOString().slice(0, 10))
    ),
    dueDate: optionalDateSchema,
    contactPerson: optionalText(120),
    contactPhone: phoneSchema,
    contactEmail: optionalEmail,
    preparedBy: optionalText(120),
    jobType: optionalText(60),
    jobAddressLine1: optionalText(160),
    jobAddressLine2: optionalText(160),
    jobCity: optionalText(80),
    jobProvince: optionalText(80),
    jobPostalCode: optionalText(16),
    description: optionalText(2000),
    paymentTerms: optionalText(400),
    notes: optionalText(2000),
    termsAndConditions: optionalText(3000),
  })
  .refine(
    (value) => !value.dueDate || value.dueDate >= value.issueDate,
    { path: ['dueDate'], message: 'The due date cannot be before the issue date' }
  );

export type InvoiceFormValues = z.infer<typeof invoiceSchema>;

// ---------------------------------------------------------------------------
// Payments (Phase 5)
// ---------------------------------------------------------------------------

/**
 * Mirrors the `payment_method` enum in the database. The method is what the
 * contractor saw happen: money moved, or it did not.
 */
export const paymentMethodSchema = z.enum(['EFT', 'CASH', 'CARD', 'OTHER']);

export type PaymentMethodValue = z.infer<typeof paymentMethodSchema>;

export const paymentSchema = z
  .object({
    invoiceId: z.string().uuid('Choose an invoice'),
    amount: moneyInputSchema.refine(
      (value) => Number(value) > 0,
      { message: 'The amount must be more than zero' }
    ),
    paymentDate: withDefault(
      z
        .string()
        .trim()
        .regex(/^\d{4}-\d{2}-\d{2}$/, 'Use the date picker or YYYY-MM-DD')
        .default(() => new Date().toISOString().slice(0, 10))
    ),
    method: withDefault(paymentMethodSchema.default('EFT')),
    reference: optionalText(120),
    notes: optionalText(500),
  });

export type PaymentFormValues = z.infer<typeof paymentSchema>;

/**
 * The customer's decision on the public quote page. There is no price, amount
 * or line data in this schema on purpose: the only things a customer can send
 * are a decision, their name and an optional note.
 */
export const quoteResponseSchema = z
  .object({
    token: z.string().trim().min(16, 'That quote link is not valid').max(200),
    decision: z.enum(['ACCEPT', 'DECLINE']),
    name: optionalText(120),
    reason: optionalText(400),
  })
  .refine((value) => value.decision !== 'ACCEPT' || Boolean(value.name), {
    path: ['name'],
    message: 'Please enter your name so we can record who accepted the quote',
  });

export type QuoteResponseInput = z.infer<typeof quoteResponseSchema>;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Turn a validated object into parameter-friendly values (undefined -> null). */
export function nullish(value: string | null | undefined): string | null {
  return value === undefined || value === null || value === '' ? null : value;
}
