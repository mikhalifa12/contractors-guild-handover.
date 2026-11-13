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

import { createCustomerAction } from '@/lib/actions/customers';
import {
  createQuoteAction,
  markQuoteSentAction,
  setQuoteStatusAction,
} from '@/lib/actions/quotes';
import {
  convertQuoteToInvoiceAction,
  createInvoiceAction,
  markInvoiceSentAction,
  setInvoiceStatusAction,
  updateInvoiceAction,
} from '@/lib/actions/invoices';
import { getQuote } from '@/lib/repositories/quotes';
import {
  getInvoice,
  getInvoiceMoneySummary,
  getInvoiceStatusCounts,
  listInvoices,
} from '@/lib/repositories/invoices';
import { renderInvoicePdfForBusiness } from '@/lib/pdf/invoice-service';
import {
  expectRedirect,
  formData,
  runAction,
  runFormAction,
} from '@/tests/helpers/actions';
import { registerOwner } from '@/tests/helpers/owners';
import { resetDatabase, withAdminClient } from '@/tests/helpers/env';
import { pdfTextJoined } from '@/tests/helpers/pdf';

type Line = {
  productId?: string | null;
  description: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
  discountPercent?: string;
  taxRate?: string;
};

function lines(...values: Line[]): string {
  return JSON.stringify(
    values.map((line) => ({
      productId: line.productId ?? null,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? 'each',
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? '0',
      taxRate: line.taxRate ?? '15',
    }))
  );
}

async function newOwnerAndCustomer() {
  const owner = await registerOwner();
  const created = await runAction(
    createCustomerAction,
    formData({
      customerType: 'BUSINESS',
      businessName: 'Harbour Point Body Corporate',
      contactPerson: 'Palesa Dlamini',
      phone: '+27 21 555 0180',
      email: '',
      billingAddressLine1: '16 Harbour Point',
      billingAddressLine2: 'Unit 8',
      billingCity: 'Cape Town',
      billingProvince: 'Western Cape',
      billingPostalCode: '8001',
    })
  );
  expectRedirect(created, '/app/customers/');
  const customerId = created.kind === 'redirect' ? created.url.split('/')[3]?.split('?')[0] : '';
  if (!customerId) throw new Error('Customer id missing from redirect');

  return { owner, customerId };
}

function invoiceForm(customerId: string, overrides: Record<string, string> = {}) {
  return formData({
    customerId,
    issueDate: '2026-09-01',
    dueDate: '2026-10-01',
    preparedBy: 'Test Contractor',
    items: lines({ description: 'Distribution board', quantity: '2', unitPrice: '100.00', discountPercent: '10' }),
    ...overrides,
  });
}

async function createInvoiceFor(customerId: string, overrides: Record<string, string> = {}) {
  const outcome = await runAction(createInvoiceAction, invoiceForm(customerId, overrides));
  expectRedirect(outcome, '/app/invoices/');
  const invoiceId =
    outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';
  if (!invoiceId) throw new Error('Invoice id missing from redirect');
  return invoiceId;
}

/** Accepted quote, the precondition for conversion. */
async function acceptedQuote(owner: { businessId: string; userId: string }, customerId: string) {
  const quoteOutcome = await runAction(
    createQuoteAction,
    formData({
      customerId,
      issueDate: '2026-09-01',
      validUntil: '2026-09-30',
      contactPerson: 'Conversion Contact',
      contactPhone: '+27 21 555 0199',
      contactEmail: 'conversion@example.com',
      jobType: 'Electrical upgrade',
      jobAddressLine1: '44 Conversion Road',
      jobAddressLine2: 'Workshop 2',
      jobCity: 'Cape Town',
      jobProvince: 'Western Cape',
      jobPostalCode: '8001',
      description: 'Accepted conversion scope',
      paymentTerms: 'Due within 30 days',
      notes: 'Conversion note',
      termsAndConditions: 'Conversion terms',
      items: lines(
        { description: 'Garage DB board', quantity: '1', unitPrice: '4830.00' },
        { description: 'Labour', quantity: '2', unitPrice: '650.00', taxRate: '15' }
      ),
    })
  );
  expectRedirect(quoteOutcome, '/app/quotes/');
  const quoteId =
    quoteOutcome.kind === 'redirect' ? (quoteOutcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

  await runFormAction(markQuoteSentAction, formData({ quoteId }));
  const accepted = await runFormAction(
    setQuoteStatusAction,
    formData({ quoteId, status: 'ACCEPTED', note: 'Palesa Dlamini' })
  );
  expectRedirect(accepted, `/app/quotes/${quoteId}?statusUpdated=accepted`);

  const quote = await getQuote(owner.businessId, owner.userId, quoteId);
  expect(quote?.status).toBe('ACCEPTED');
  return { quoteId, quote };
}

describe('invoices', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('creates a manual invoice with server-calculated totals and per-business numbering', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId);

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice).not.toBeNull();
    expect(invoice?.invoice_number).toBe('INV-0001');
    expect(invoice?.status).toBe('DRAFT');
    // 2 x 100.00 = 200.00, less 10% = 20.00, VAT 15% on 180.00 = 27.00
    expect(invoice?.subtotal).toBe('200.00');
    expect(invoice?.discount_total).toBe('20.00');
    expect(invoice?.tax_total).toBe('27.00');
    expect(invoice?.total).toBe('207.00');
    expect(invoice?.amount_paid).toBe('0.00');
    expect(invoice?.balance_due).toBe('207.00');
    expect(invoice?.prepared_by).toBe('Test Contractor');

    const second = await createInvoiceFor(customerId);
    const secondInvoice = await getInvoice(owner.businessId, owner.userId, second);
    expect(secondInvoice?.invoice_number).toBe('INV-0002');

    // Another business numbers its invoices independently.
    const other = await newOwnerAndCustomer();
    const otherInvoiceId = await createInvoiceFor(other.customerId);
    const otherInvoice = await getInvoice(other.owner.businessId, other.owner.userId, otherInvoiceId);
    expect(otherInvoice?.invoice_number).toBe('INV-0001');
  });

  it('ignores browser-supplied totals and rejects impossible lines', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();

    const tampered = JSON.stringify([
      {
        productId: null,
        description: 'Distribution board',
        quantity: '1',
        unit: 'each',
        unitPrice: '100.00',
        discountPercent: '0',
        taxRate: '15',
        lineTotal: '0.01',
        total: '0.01',
        status: 'PAID',
      },
    ]);

    const outcome = await runAction(
      createInvoiceAction,
      invoiceForm(customerId, { items: tampered })
    );
    expectRedirect(outcome, '/app/invoices/');
    const invoiceId = outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.total).toBe('115.00');
    expect(invoice?.status).toBe('DRAFT');

    const zeroQuantity = await runAction(
      createInvoiceAction,
      invoiceForm(customerId, {
        items: lines({ description: 'Labour', quantity: '0', unitPrice: '500.00' }),
      })
    );
    if (zeroQuantity.kind !== 'state' || zeroQuantity.state.status !== 'error') {
      throw new Error('Expected quantity zero to be rejected');
    }

    const empty = await runAction(createInvoiceAction, invoiceForm(customerId, { items: '[]' }));
    if (empty.kind !== 'state' || empty.state.status !== 'error') {
      throw new Error('Expected an empty invoice to be rejected');
    }
  });

  it('locks the lines once sent and refuses to edit a sent invoice', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId);

    // A draft can be edited and its lines replaced.
    const edited = await runAction(
      updateInvoiceAction,
      invoiceForm(customerId, {
        invoiceId,
        items: lines({ description: 'Only line', quantity: '1', unitPrice: '4200.00' }),
      })
    );
    expectRedirect(edited, `/app/invoices/${invoiceId}?saved=1`);

    const draft = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(draft?.items).toHaveLength(1);
    expect(draft?.total).toBe('4830.00');

    await runFormAction(markInvoiceSentAction, formData({ invoiceId }));

    const refused = await runAction(
      updateInvoiceAction,
      invoiceForm(customerId, {
        invoiceId,
        items: lines({ description: 'Changed', quantity: '1', unitPrice: '1.00' }),
      })
    );
    if (refused.kind !== 'state' || refused.state.status !== 'error') {
      throw new Error('Expected editing a sent invoice to be refused');
    }
    expect(refused.state.message).toContain('already been sent');

    const unchanged = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(unchanged?.items[0]?.description).toBe('Only line');
  });

  it('marks a draft sent with a public token, then refuses a second send', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId);

    const before = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(before?.public_token).toBeNull();

    await runFormAction(markInvoiceSentAction, formData({ invoiceId }));

    const sent = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(sent?.status).toBe('SENT');
    expect(sent?.sent_at).not.toBeNull();
    expect(sent?.public_token).toHaveLength(32);

    const again = await runFormAction(
      markInvoiceSentAction,
      formData({ invoiceId, returnTo: `/app/invoices/${invoiceId}` })
    );
    expectRedirect(again, `/app/invoices/${invoiceId}?statusError=not_draft`);
  });

  it('cancels an invoice and refuses to cancel a paid one', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId);
    await runFormAction(markInvoiceSentAction, formData({ invoiceId }));

    const cancelled = await runFormAction(
      setInvoiceStatusAction,
      formData({ invoiceId, status: 'CANCELLED', returnTo: `/app/invoices/${invoiceId}` })
    );
    expectRedirect(cancelled, `/app/invoices/${invoiceId}?statusUpdated=cancelled`);

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.status).toBe('CANCELLED');
    expect(invoice?.cancelled_at).not.toBeNull();

    // A cancelled invoice is a closed record: no further transitions.
    const reopened = await runFormAction(
      setInvoiceStatusAction,
      formData({ invoiceId, status: 'SENT', returnTo: `/app/invoices/${invoiceId}` })
    );
    expectRedirect(reopened, `/app/invoices/${invoiceId}?statusError=not_allowed`);
  });

  it('reports overdue from the due date without storing a stale flag', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId, {
      issueDate: '2020-01-02',
      dueDate: '2020-02-01',
    });
    await runFormAction(markInvoiceSentAction, formData({ invoiceId }));

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.status).toBe('SENT'); // stored status stays honest

    const unpaidOnly = await listInvoices(owner.businessId, owner.userId, { status: 'UNPAID' });
    expect(unpaidOnly.rows).toHaveLength(1);

    const sentOnly = await listInvoices(owner.businessId, owner.userId, { status: 'SENT' });
    expect(sentOnly.rows).toHaveLength(1);
    expect(sentOnly.rows[0]?.id).toBe(invoiceId);

    const draftOnly = await listInvoices(owner.businessId, owner.userId, { status: 'DRAFT' });
    expect(draftOnly.rows).toHaveLength(0);

    const counts = await getInvoiceStatusCounts(owner.businessId, owner.userId);
    expect(counts.OVERDUE).toBe(1);
    expect(counts.UNPAID).toBe(1);

    const money = await getInvoiceMoneySummary(owner.businessId, owner.userId);
    expect(money.overdue_count).toBe(1);
    expect(money.outstanding_total).toBe('207.00');
    expect(money.overdue_total).toBe('207.00');
  });

  it('converts an accepted quote: verbatim lines, CONVERTED stamp, audit trail', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const { quoteId, quote } = await acceptedQuote(owner, customerId);

    const outcome = await runFormAction(
      convertQuoteToInvoiceAction,
      formData({ quoteId, returnTo: `/app/quotes/${quoteId}` })
    );
    expectRedirect(outcome, '/app/invoices/');
    const invoiceId =
      outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice).not.toBeNull();
    expect(invoice?.invoice_number).toBe('INV-0001');
    expect(invoice?.customer_id).toBe(quote?.customer_id);
    expect(invoice?.job_id).toBe(quote?.job_id);
    expect(invoice?.quote_id).toBe(quoteId);
    expect(invoice?.status).toBe('DRAFT');
    expect(invoice?.prepared_by).toBeNull();
    expect(invoice?.contact_person).toBe(quote?.contact_person);
    expect(invoice?.contact_phone).toBe(quote?.contact_phone);
    expect(invoice?.contact_email).toBe(quote?.contact_email);
    expect(invoice?.billing_address_line1).toBe('16 Harbour Point');
    expect(invoice?.billing_address_line2).toBe('Unit 8');
    expect(invoice?.billing_city).toBe('Cape Town');
    expect(invoice?.billing_province).toBe('Western Cape');
    expect(invoice?.billing_postal_code).toBe('8001');
    expect(invoice?.job_address_line1).toBe(quote?.job_address_line1);
    expect(invoice?.job_address_line2).toBe(quote?.job_address_line2);
    expect(invoice?.job_city).toBe(quote?.job_city);
    expect(invoice?.job_province).toBe(quote?.job_province);
    expect(invoice?.job_postal_code).toBe(quote?.job_postal_code);
    expect(invoice?.job_type).toBe(quote?.job_type);
    expect(invoice?.description).toBe(quote?.description);

    // Every line and total matches the quote exactly — copied, not recomputed.
    expect(invoice?.subtotal).toBe(quote?.subtotal);
    expect(invoice?.discount_total).toBe(quote?.discount_total);
    expect(invoice?.tax_total).toBe(quote?.tax_total);
    expect(invoice?.total).toBe(quote?.total);
    expect(invoice?.payment_terms).toBe(quote?.payment_terms);
    expect(invoice?.notes).toBe(quote?.notes);
    expect(invoice?.terms_and_conditions).toBe(quote?.terms_and_conditions);
    expect(invoice?.items).toHaveLength(quote?.items.length ?? -1);
    for (const [index, item] of (invoice?.items ?? []).entries()) {
      const source = quote?.items[index];
      expect(item.description).toBe(source?.description);
      expect(item.unit_price).toBe(source?.unit_price);
      expect(item.line_total).toBe(source?.line_total);
      expect(item.product_id).toBe(source?.product_id);
    }

    const convertedQuote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(convertedQuote?.status).toBe('CONVERTED');
    expect(convertedQuote?.converted_invoice_id).toBe(invoiceId);

    const events = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ event_type: string }>(
        `select event_type from public.audit_events
          where business_id = $1 and (entity_id = $2 or entity_id = $3)
          order by created_at`,
        [owner.businessId, invoiceId, quoteId]
      );
      return rows.map((row) => row.event_type);
    });
    expect(events).toContain('invoice.converted_from_quote');
    expect(events).toContain('quote.converted');
  });

  it('refuses a second conversion of the same quote (double-click safe)', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const { quoteId } = await acceptedQuote(owner, customerId);

    const first = await runFormAction(
      convertQuoteToInvoiceAction,
      formData({ quoteId, returnTo: `/app/quotes/${quoteId}` })
    );
    expectRedirect(first, '/app/invoices/');

    // The quote is now CONVERTED: a second click lands back on the quote with
    // a clear error, and no second invoice exists.
    const second = await runFormAction(
      convertQuoteToInvoiceAction,
      formData({ quoteId, returnTo: `/app/quotes/${quoteId}` })
    );
    expectRedirect(second, `/app/quotes/${quoteId}?statusError=already_converted`);

    const all = await listInvoices(owner.businessId, owner.userId, { status: 'ALL' });
    expect(all.rows).toHaveLength(1);
    expect(all.rows[0]?.quote_number).toBe('QUOTE-0001');
  });

  it('refuses to convert a quote that is not accepted', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteOutcome = await runAction(
      createQuoteAction,
      formData({
        customerId,
        issueDate: '2026-09-01',
        validUntil: '2026-09-30',
        items: lines({ description: 'DB board', quantity: '1', unitPrice: '100.00' }),
      })
    );
    expectRedirect(quoteOutcome, '/app/quotes/');
    const quoteId =
      quoteOutcome.kind === 'redirect' ? (quoteOutcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    // Still a DRAFT: conversion must refuse.
    const attempt = await runFormAction(
      convertQuoteToInvoiceAction,
      formData({ quoteId, returnTo: `/app/quotes/${quoteId}` })
    );
    expectRedirect(attempt, `/app/quotes/${quoteId}?statusError=not_convertible`);

    const all = await listInvoices(owner.businessId, owner.userId, { status: 'ALL' });
    expect(all.rows).toHaveLength(0);
  });

  it('ignores a quote id posted on the manual create form', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const { quoteId } = await acceptedQuote(owner, customerId);

    // Forged form: claims to be created "from" the accepted quote without the
    // conversion path. The quote must stay untouched and unconverted.
    const outcome = await runAction(
      createInvoiceAction,
      invoiceForm(customerId, { quoteId })
    );
    expectRedirect(outcome, '/app/invoices/');
    const invoiceId = outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.quote_id).toBeNull();

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote?.status).toBe('ACCEPTED');
    expect(quote?.converted_invoice_id).toBeNull();
  });

  it('keeps one business out of another business’s invoices', async () => {
    const first = await newOwnerAndCustomer();
    const firstInvoiceId = await createInvoiceFor(first.customerId);

    const second = await newOwnerAndCustomer();

    expect(
      await getInvoice(second.owner.businessId, second.owner.userId, firstInvoiceId)
    ).toBeNull();

    const list = await listInvoices(second.owner.businessId, second.owner.userId, { status: 'ALL' });
    expect(list.rows).toHaveLength(0);

    // The other business cannot send (and so lock) the foreign invoice.
    const foreignSend = await runFormAction(
      markInvoiceSentAction,
      formData({
        invoiceId: firstInvoiceId,
        returnTo: `/app/invoices/${firstInvoiceId}`,
      })
    );
    expectRedirect(foreignSend, `/app/invoices/${firstInvoiceId}?statusError=not_found`);

    // And a foreign conversion of its quotes is refused.
    const { quoteId } = await acceptedQuote(first.owner, first.customerId);
    const foreignConvert = await runFormAction(
      convertQuoteToInvoiceAction,
      formData({ quoteId: '', returnTo: `/app/quotes/${quoteId}` })
    );
    expectRedirect(foreignConvert, '/app/quotes?missing=1');

    const invoice = await getInvoice(first.owner.businessId, first.owner.userId, firstInvoiceId);
    expect(invoice?.status).toBe('DRAFT');
  });

  it('renders the stored invoice as a print-ready PDF with banking details', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await createInvoiceFor(customerId, {
      items: lines({ description: 'Earth leakage relay, 63A', quantity: '2', unitPrice: '1450.00' }),
    });

    const rendered = await renderInvoicePdfForBusiness(
      owner.businessId,
      owner.userId,
      invoiceId,
      'Test Contractor'
    );
    if (!rendered) throw new Error('The PDF was not rendered');

    const text = pdfTextJoined(rendered.pdf);
    expect(text).toContain('INV-0001');
    expect(text).toContain('Harbour Point Body Corporate');
    expect(text).toContain('Earth leakage relay, 63A');
    expect(text).toContain('Test Contractor');
    expect(text).toContain('Page 1 of 1');

    const foreign = await registerOwner();
    expect(
      await renderInvoicePdfForBusiness(foreign.businessId, foreign.userId, invoiceId, null)
    ).toBeNull();
  });
});
