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
  createInvoiceAction,
  markInvoiceSentAction,
  setInvoiceStatusAction,
} from '@/lib/actions/invoices';
import { deletePaymentAction, recordPaymentAction } from '@/lib/actions/payments';
import { getInvoice } from '@/lib/repositories/invoices';
import {
  getPayment,
  getPaymentMoneySummary,
  getReceiptDetail,
  getReceiptForPayment,
  listPayments,
  listPaymentsForInvoice,
  recordPayment,
} from '@/lib/repositories/payments';
import { renderReceiptPdfForBusiness } from '@/lib/pdf/receipt-service';
import { pdfTextJoined } from '@/tests/helpers/pdf';
import {
  expectRedirect,
  formData,
  runAction,
  runFormAction,
} from '@/tests/helpers/actions';
import { registerOwner } from '@/tests/helpers/owners';
import { resetDatabase } from '@/tests/helpers/env';

type Line = {
  description: string;
  quantity: string;
  unitPrice: string;
  discountPercent?: string;
  taxRate?: string;
};

function lines(...values: Line[]): string {
  return JSON.stringify(
    values.map((line) => ({
      productId: null,
      description: line.description,
      quantity: line.quantity,
      unit: 'each',
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
    })
  );
  expectRedirect(created, '/app/customers/');
  const customerId = created.kind === 'redirect' ? created.url.split('/')[3]?.split('?')[0] : '';
  if (!customerId) throw new Error('Customer id missing from redirect');

  return { owner, customerId };
}

/** A sent invoice of 230.00 (2 x 100.00 less 10% plus VAT). */
async function sentInvoiceFor(customerId: string) {
  const outcome = await runAction(
    createInvoiceAction,
    formData({
      customerId,
      issueDate: '2026-09-01',
      dueDate: '2026-10-01',
      items: lines({ description: 'Distribution board', quantity: '2', unitPrice: '100.00', discountPercent: '10' }),
    })
  );
  expectRedirect(outcome, '/app/invoices/');
  const invoiceId = outcome.kind === 'redirect' ? outcome.url.split('/')[3]?.split('?')[0] ?? '' : '';

  await runFormAction(markInvoiceSentAction, formData({ invoiceId, returnTo: `/app/invoices/${invoiceId}` }));
  return invoiceId;
}

function paymentForm(invoiceId: string, overrides: Record<string, string> = {}) {
  return formData({
    invoiceId,
    amount: '115.00',
    paymentDate: '2026-09-20',
    method: 'EFT',
    reference: 'ACC-44190',
    notes: 'Part payment - balance to follow.',
    ...overrides,
  });
}

async function payWithAction(invoiceId: string, overrides: Record<string, string> = {}) {
  return runAction(recordPaymentAction, paymentForm(invoiceId, overrides));
}

describe('payments', () => {
  beforeEach(async () => {
    await resetDatabase();
  });

  it('records a payment through the action: receipt, balance and PARTIALLY_PAID', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    const outcome = await payWithAction(invoiceId);
    expectRedirect(outcome, '/app/payments/');
    const paymentId = outcome.kind === 'redirect' ? outcome.url.split('/')[3]?.split('?')[0] ?? '' : '';

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.status).toBe('PARTIALLY_PAID');
    expect(invoice?.amount_paid).toBe('115.00');
    expect(invoice?.balance_due).toBe('115.00');
    expect(invoice?.paid_at).toBeNull();

    const payment = await getPayment(owner.businessId, owner.userId, paymentId);
    expect(payment?.amount).toBe('115.00');
    expect(payment?.receipt_number).toBe('REC-0001');
    expect(payment?.method).toBe('EFT');

    const receipt = await getReceiptForPayment(owner.businessId, owner.userId, paymentId);
    expect(receipt?.receipt_number).toBe('REC-0001');
    expect(receipt?.amount_received).toBe('115.00');
    expect(receipt?.previous_balance).toBe('230.00');
    expect(receipt?.remaining_balance).toBe('115.00');
    expect(receipt?.status_before).toBe('SENT');
  });

  it('settling the balance flips the invoice to PAID with a paid_at stamp', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    await payWithAction(invoiceId, { amount: '100.00' });
    await payWithAction(invoiceId, { amount: '130.00' });

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.status).toBe('PAID');
    expect(invoice?.amount_paid).toBe('230.00');
    expect(invoice?.balance_due).toBe('0.00');
    expect(invoice?.paid_at).not.toBeNull();

    // One payment in full works too, from a plain sent invoice.
    const other = await sentInvoiceFor(customerId);
    await payWithAction(other, { amount: '230.00' });
    const fullInvoice = await getInvoice(owner.businessId, owner.userId, other);
    expect(fullInvoice?.status).toBe('PAID');
    expect(fullInvoice?.paid_at).not.toBeNull();
  });

  it('allocates REC- numbers per business and increments across payments', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    await payWithAction(invoiceId, { amount: '10.00' });
    await payWithAction(invoiceId, { amount: '20.00' });
    await payWithAction(invoiceId, { amount: '200.00' });

    const { rows } = await listPayments(owner.businessId, owner.userId, {});
    const numbers = rows.map((row) => row.receipt_number).sort();
    expect(numbers).toEqual(['REC-0001', 'REC-0002', 'REC-0003']);

    // Another business starts its own sequence at REC-0001.
    const other = await newOwnerAndCustomer();
    const otherInvoiceId = await sentInvoiceFor(other.customerId);
    const otherPayment = await runAction(recordPaymentAction, paymentForm(otherInvoiceId));
    expectRedirect(otherPayment, '/app/payments/');
    const otherPaymentId =
      otherPayment.kind === 'redirect' ? otherPayment.url.split('/')[3]?.split('?')[0] ?? '' : '';
    const otherRecord = await getPayment(other.owner.businessId, other.owner.userId, otherPaymentId);
    expect(otherRecord?.receipt_number).toBe('REC-0001');
  });

  it('refuses overpayment without writing anything', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    const outcome = await payWithAction(invoiceId, { amount: '300.00' });
    if (outcome.kind !== 'state' || outcome.state.status !== 'error') {
      throw new Error('Expected overpayment to be refused');
    }
    expect(outcome.state.fieldErrors.amount?.[0]).toBeTruthy();

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(invoice?.status).toBe('SENT');
    expect(invoice?.amount_paid).toBe('0.00');

    const summary = await getPaymentMoneySummary(owner.businessId, owner.userId);
    expect(summary.payment_count).toBe(0);
  });

  it('refuses a payment on a draft and on a cancelled invoice', async () => {
    const { customerId } = await newOwnerAndCustomer();

    const draftOutcome = await runAction(
      createInvoiceAction,
      formData({
        customerId,
        issueDate: '2026-09-01',
        dueDate: '2026-10-01',
        items: lines({ description: 'Distribution board', quantity: '2', unitPrice: '100.00', discountPercent: '10' }),
      })
    );
    expectRedirect(draftOutcome, '/app/invoices/');
    const draftId =
      draftOutcome.kind === 'redirect' ? draftOutcome.url.split('/')[3]?.split('?')[0] ?? '' : '';

    const draft = await payWithAction(draftId);
    if (draft.kind !== 'state' || draft.state.status !== 'error') {
      throw new Error('Expected a draft payment to be refused');
    }

    const invoiceId = await sentInvoiceFor(customerId);
    await runFormAction(
      setInvoiceStatusAction,
      formData({ invoiceId, returnTo: `/app/invoices/${invoiceId}`, status: 'CANCELLED' })
    );

    const cancelled = await payWithAction(invoiceId);
    if (cancelled.kind !== 'state' || cancelled.state.status !== 'error') {
      throw new Error('Expected a cancelled-invoice payment to be refused');
    }
  });

  it('rejects impossible form values before touching the database', async () => {
    const { customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    const zero = await payWithAction(invoiceId, { amount: '0.00' });
    if (zero.kind !== 'state' || zero.state.status !== 'error') {
      throw new Error('Expected a zero payment to be rejected');
    }

    const junk = await payWithAction(invoiceId, { amount: 'abc' });
    if (junk.kind !== 'state' || junk.state.status !== 'error') {
      throw new Error('Expected a non-numeric payment to be rejected');
    }

    const badMethod = await payWithAction(invoiceId, { method: 'BITCOIN' });
    if (badMethod.kind !== 'state' || badMethod.state.status !== 'error') {
      throw new Error('Expected an unknown method to be rejected');
    }

    const badDate = await payWithAction(invoiceId, { paymentDate: '20/09/2026' });
    if (badDate.kind !== 'state' || badDate.state.status !== 'error') {
      throw new Error('Expected a bad date to be rejected');
    }
  });

  it('reverses a payment: balance restored, status walks back, receipt kept', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    await payWithAction(invoiceId, { amount: '100.00' });
    const settled = await payWithAction(invoiceId, { amount: '130.00' });
    expectRedirect(settled, '/app/payments/');
    const secondPaymentId =
      settled.kind === 'redirect' ? settled.url.split('/')[3]?.split('?')[0] ?? '' : '';

    const outcome = await runFormAction(
      deletePaymentAction,
      formData({ paymentId: secondPaymentId, returnTo: '/app/payments' })
    );
    expectRedirect(outcome, '/app/payments?reversed=1');

    const invoice = await getInvoice(owner.businessId, owner.userId, invoiceId);
    // The receipt remembered SENT before this payment, so the status walks
    // back past PARTIALLY_PAID to SENT, exactly the path it took up.
    expect(invoice?.status).toBe('SENT');
    expect(invoice?.amount_paid).toBe('100.00');
    expect(invoice?.balance_due).toBe('130.00');
    expect(invoice?.paid_at).toBeNull();

    // Reversing the first payment too returns the invoice to its exact
    // pre-payment state (except the numbers already allocated).
    const { rows } = await listPayments(owner.businessId, owner.userId, {});
    await runFormAction(
      deletePaymentAction,
      formData({ paymentId: rows[0]!.id, returnTo: '/app/payments' })
    );

    const emptied = await getInvoice(owner.businessId, owner.userId, invoiceId);
    expect(emptied?.status).toBe('SENT');
    expect(emptied?.amount_paid).toBe('0.00');
    expect(emptied?.balance_due).toBe('230.00');

    // Nothing was deleted: both payments and receipts remain on record.
    expect(await listPaymentsForInvoice(owner.businessId, owner.userId, invoiceId)).toHaveLength(2);
    const summary = await getPaymentMoneySummary(owner.businessId, owner.userId);
    expect(summary.payment_count).toBe(2);
  });

  it('renders the receipt PDF with the stored balances and paid stamp', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);

    await payWithAction(invoiceId, { amount: '230.00' });
    const { rows } = await listPayments(owner.businessId, owner.userId, {});

    const rendered = await renderReceiptPdfForBusiness(
      owner.businessId,
      owner.userId,
      rows[0]!.id
    );
    expect(rendered).not.toBeNull();

    const text = await pdfTextJoined(rendered!.pdf);
    expect(text).toContain('RECEIPT');
    expect(text).toContain('REC-0001');
    expect(text).toContain('Harbour Point Body Corporate');
    expect(text).toContain('230.00');
    expect(text).toContain('0.00');
    expect(text).toContain('PAID IN FULL');

    // The partial receipt shows the remaining balance instead.
    const other = await sentInvoiceFor(customerId);
    await payWithAction(other, { amount: '100.00' });
    const partialRows = await listPayments(owner.businessId, owner.userId, { invoiceId: other });
    const partial = await renderReceiptPdfForBusiness(
      owner.businessId,
      owner.userId,
      partialRows.rows[0]!.id
    );
    const partialText = await pdfTextJoined(partial!.pdf);
    expect(partialText).not.toContain('PAID IN FULL');
    expect(partialText).toContain('130.00');
  });

  it('cannot read or record payments across businesses', async () => {
    const mine = await newOwnerAndCustomer();
    const theirs = await newOwnerAndCustomer();

    const theirInvoiceId = await sentInvoiceFor(theirs.customerId);
    const created = await recordPayment(
      theirs.owner.businessId,
      theirs.owner.userId,
      {
        invoiceId: theirInvoiceId,
        amount: '115.00',
        paymentDate: '2026-09-20',
        method: 'EFT',
        reference: null,
        notes: null,
      }
    );
    if (!created.ok) throw new Error('Payment should have succeeded in its own business');

    // Their payment is invisible from my business.
    const visible = await getPayment(mine.owner.businessId, mine.owner.userId, created.paymentId);
    expect(visible).toBeNull();

    // And my business cannot pay their invoice.
    const crossed = await recordPayment(mine.owner.businessId, mine.owner.userId, {
      invoiceId: theirInvoiceId,
      amount: '10.00',
      paymentDate: '2026-09-20',
      method: 'CASH',
      reference: null,
      notes: null,
    });
    expect(crossed.ok).toBe(false);
    if (!crossed.ok) expect(crossed.reason).toBe('not_found');
  });

  it('exposes the receipt detail the PDF service renders from', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const invoiceId = await sentInvoiceFor(customerId);
    await payWithAction(invoiceId, { amount: '50.00' });
    const { rows } = await listPayments(owner.businessId, owner.userId, {});

    const detail = await getReceiptDetail(owner.businessId, owner.userId, rows[0]!.id);
    expect(detail).not.toBeNull();
    expect(detail?.invoice_number).toBe('INV-0001');
    expect(detail?.customer_name).toBe('Harbour Point Body Corporate');
    expect(detail?.previous_balance).toBe('230.00');
    expect(detail?.remaining_balance).toBe('180.00');
    expect(detail?.status_before).toBe('SENT');
  });
});
