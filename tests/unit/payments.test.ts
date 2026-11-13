import { describe, expect, it } from 'vitest';
import {
  paymentDrivenStatus,
  paymentReversalStatus,
} from '@/lib/invoices';
import {
  buildReceiptDocumentModel,
  type ReceiptDocumentInput,
} from '@/lib/pdf/receipt-document';

describe('payment-driven invoice statuses', () => {
  it('a settled balance means PAID from any unpaid state', () => {
    expect(paymentDrivenStatus('SENT', 0)).toBe('PAID');
    expect(paymentDrivenStatus('VIEWED', 0)).toBe('PAID');
    expect(paymentDrivenStatus('PARTIALLY_PAID', 0)).toBe('PAID');
    expect(paymentDrivenStatus('OVERDUE', 0)).toBe('PAID');
  });

  it('a positive balance on an unpaid invoice means PARTIALLY_PAID', () => {
    expect(paymentDrivenStatus('SENT', 12500)).toBe('PARTIALLY_PAID');
    expect(paymentDrivenStatus('VIEWED', 1)).toBe('PARTIALLY_PAID');
    expect(paymentDrivenStatus('OVERDUE', 99900)).toBe('PARTIALLY_PAID');
  });

  it('does not move a row that is already in the implied state', () => {
    expect(paymentDrivenStatus('PARTIALLY_PAID', 5000)).toBeNull();
    expect(paymentDrivenStatus('PAID', 0)).toBeNull();
  });

  it('never moves a draft, paid or cancelled row by money', () => {
    expect(paymentDrivenStatus('DRAFT', 0)).toBeNull();
    expect(paymentDrivenStatus('DRAFT', 5000)).toBeNull();
    expect(paymentDrivenStatus('CANCELLED', 0)).toBeNull();
    expect(paymentDrivenStatus('CANCELLED', 5000)).toBeNull();
  });
});

describe('payment reversal statuses', () => {
  it('walks back down the path the receipts remember', () => {
    expect(paymentReversalStatus('PAID', 'SENT', 15000)).toBe('SENT');
    expect(paymentReversalStatus('PAID', 'PARTIALLY_PAID', 15000)).toBe('PARTIALLY_PAID');
    expect(paymentReversalStatus('PARTIALLY_PAID', 'SENT', 15000)).toBe('SENT');
  });

  it('stays PAID when the balance is still zero after reversal', () => {
    expect(paymentReversalStatus('PAID', 'SENT', 0)).toBe('PAID');
  });

  it('falls back sanely when no receipt status was remembered', () => {
    // A paid state with forgotten history falls back to the balance; an
    // already-valid unpaid state remains unchanged.
    expect(paymentReversalStatus('PAID', null, 15000)).toBe('PARTIALLY_PAID');
    expect(paymentReversalStatus('PARTIALLY_PAID', null, 5000)).toBe('PARTIALLY_PAID');
    expect(paymentReversalStatus('SENT', null, 5000)).toBe('SENT');
  });

  it('preserves a cancelled invoice regardless of balance or remembered status', () => {
    expect(paymentReversalStatus('CANCELLED', 'SENT', 0)).toBe('CANCELLED');
    expect(paymentReversalStatus('CANCELLED', 'PARTIALLY_PAID', 5000)).toBe('CANCELLED');
  });
});

const receiptInput: ReceiptDocumentInput = {
  business: {
    legal_name: 'Vaal Electrical Contractors (Pty) Ltd',
    trading_name: 'Vaal Electrical',
    registration_number: '2019/123456/07',
    tax_number: '4980123456',
    email: 'office@vaalelectrical.co.za',
    phone: '+27 16 555 0123',
    website: null,
    address_line1: 'Unit 4, 12 Steel Road',
    address_line2: null,
    city: 'Vanderbijlpark',
    province: 'Gauteng',
    postal_code: '1911',
    country: 'South Africa',
    currency_code: 'ZAR',
  },
  customer: {
    business_name: 'Harbour Point Body Corporate',
    contact_person: 'Palesa Dlamini',
    phone: '+27 21 555 0180',
    email: 'accounts@example.co.za',
    billing_address_line1: '16 Harbour Point',
    billing_address_line2: null,
    billing_city: 'Cape Town',
    billing_province: 'Western Cape',
    billing_postal_code: '8001',
  },
  receipt: {
    receipt_number: 'REC-0003',
    issued_at: new Date('2026-10-01T09:30:00Z'),
    method: 'EFT',
    reference: 'ACC-44190',
    amount_received: '2500.00',
    previous_balance: '18400.00',
    remaining_balance: '15900.00',
    payment_date: '2026-10-01',
    notes: 'Part payment - balance to follow.',
  },
  invoice: {
    invoice_number: 'INV-0001',
    total: '18400.00',
  },
};

describe('receipt document model', () => {
  it('carries the stored balances verbatim', () => {
    const model = buildReceiptDocumentModel(receiptInput);

    expect(model.receipt.number).toBe('REC-0003');
    expect(model.receipt.amountReceived).toBe('2500.00');
    expect(model.receipt.previousBalance).toBe('18400.00');
    expect(model.receipt.remainingBalance).toBe('15900.00');
    expect(model.receipt.fullySettled).toBe(false);
    expect(model.receipt.methodLabel).toBe('Eft');
  });

  it('marks the settled receipt paid in full', () => {
    const model = buildReceiptDocumentModel({
      ...receiptInput,
      receipt: {
        ...receiptInput.receipt,
        amount_received: '18400.00',
        previous_balance: '18400.00',
        remaining_balance: '0.00',
      },
    });

    expect(model.receipt.fullySettled).toBe(true);
  });

  it('keeps the customer address as compact lines', () => {
    const model = buildReceiptDocumentModel(receiptInput);

    expect(model.customer.addressLines).toEqual([
      '16 Harbour Point',
      'Cape Town, Western Cape',
      '8001',
    ]);
  });
});
