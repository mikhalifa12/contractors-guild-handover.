import { describe, expect, it } from 'vitest';
import {
  INVOICE_STATUSES,
  canTransitionInvoice,
  effectiveInvoiceStatus,
  isInvoiceEditable,
  isInvoiceOverdue,
  nextInvoiceStatuses,
} from '@/lib/invoices';
import {
  buildInvoiceDocumentModel,
  type InvoiceDocumentInput,
} from '@/lib/pdf/invoice-document';

describe('invoice status machine', () => {
  it('offers only legal transitions', () => {
    expect(nextInvoiceStatuses('DRAFT')).toEqual(['SENT', 'CANCELLED']);
    expect(nextInvoiceStatuses('SENT')).toEqual(['VIEWED', 'CANCELLED']);
    expect(nextInvoiceStatuses('VIEWED')).toEqual(['CANCELLED']);
    expect(nextInvoiceStatuses('OVERDUE')).toEqual(['CANCELLED']);
    // Paid and partially-paid invoices are moved by payments (Phase 5), and a
    // cancelled invoice is closed: nothing is offered.
    expect(nextInvoiceStatuses('PAID')).toEqual([]);
    expect(nextInvoiceStatuses('PARTIALLY_PAID')).toEqual([]);
    expect(nextInvoiceStatuses('CANCELLED')).toEqual([]);
  });

  it('refuses illegal jumps', () => {
    expect(canTransitionInvoice('DRAFT', 'PAID')).toBe(false);
    expect(canTransitionInvoice('DRAFT', 'VIEWED')).toBe(false);
    expect(canTransitionInvoice('SENT', 'PAID')).toBe(false);
    expect(canTransitionInvoice('VIEWED', 'SENT')).toBe(false);
    expect(canTransitionInvoice('CANCELLED', 'SENT')).toBe(false);
    expect(canTransitionInvoice('PAID', 'CANCELLED')).toBe(false);
    expect(canTransitionInvoice('DRAFT', 'DRAFT')).toBe(false);
  });

  it('derives OVERDUE from the due date without storing it', () => {
    const now = new Date('2026-09-29T12:00:00Z');
    expect(isInvoiceOverdue('SENT', '2026-09-28', now)).toBe(true);
    expect(isInvoiceOverdue('VIEWED', '2026-09-29', now)).toBe(false);
    expect(isInvoiceOverdue('SENT', null, now)).toBe(false);
    expect(isInvoiceOverdue('PAID', '2020-01-01', now)).toBe(false);
    expect(isInvoiceOverdue('CANCELLED', '2020-01-01', now)).toBe(false);

    expect(effectiveInvoiceStatus('SENT', '2026-09-28', now)).toBe('OVERDUE');
    expect(effectiveInvoiceStatus('SENT', '2026-09-29', now)).toBe('SENT');
    expect(effectiveInvoiceStatus('PAID', '2020-01-01', now)).toBe('PAID');
  });

  it('freezes the document once it has been sent', () => {
    expect(isInvoiceEditable('DRAFT')).toBe(true);
    for (const status of INVOICE_STATUSES.filter((s) => s !== 'DRAFT')) {
      expect(isInvoiceEditable(status)).toBe(false);
    }
  });
});

const business: InvoiceDocumentInput['business'] = {
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
};

const settings: InvoiceDocumentInput['settings'] = {
  bank_name: 'Demo Bank',
  bank_account_name: 'Vaal Electrical (Pty) Ltd',
  bank_account_number: '6265954321',
  bank_branch_code: '250655',
  bank_account_type: 'Current',
  payment_instructions: 'Use the invoice number as your reference.',
  invoice_footer_note: 'Thank you for your business.',
};

const customer: InvoiceDocumentInput['customer'] = {
  business_name: 'Harbour Point Body Corporate',
  contact_person: 'Riaan Fourie',
  phone: '+27 21 555 0110',
  email: 'riaan@example.co.za',
  billing_address_line1: '18 Dock Road',
  billing_address_line2: 'Foreshore',
  billing_city: 'Cape Town',
  billing_province: 'Western Cape',
  billing_postal_code: '8001',
};

function invoice(overrides: Partial<InvoiceDocumentInput['invoice']> = {}): InvoiceDocumentInput['invoice'] {
  return {
    invoice_number: 'INV-0003',
    status: 'SENT',
    issue_date: '2026-09-28',
    due_date: '2026-10-28',
    job_type: 'Installation',
    description: 'Replace the garage distribution board and re-label every circuit.',
    contact_person: 'Riaan Fourie',
    contact_phone: '+27 21 555 0110',
    contact_email: 'riaan@example.co.za',
    job_address_line1: '18 Dock Road',
    job_address_line2: null,
    job_city: 'Cape Town',
    job_province: 'Western Cape',
    job_postal_code: '8001',
    subtotal: '5000.00',
    discount_total: '0.00',
    tax_total: '750.00',
    total: '5750.00',
    amount_paid: '0.00',
    balance_due: '5750.00',
    payment_terms: 'Payment due within 30 days of invoice date.',
    notes: null,
    terms_and_conditions: 'Workmanship guaranteed for 12 months.',
    paid_at: null,
    cancelled_at: null,
    ...overrides,
  };
}

function items(count: number) {
  return Array.from({ length: count }, (_, index) => ({
    line_number: index + 1,
    description: `Distribution board ${index + 1}`,
    quantity: '1',
    unit: 'each',
    unit_price: '2500.00',
    discount_percent: '0',
    tax_rate: '15',
    line_subtotal: '2500.00',
    line_discount: '0.00',
    line_tax: '375.00',
    line_total: '2875.00',
  }));
}

const baseInput: InvoiceDocumentInput = {
  business,
  settings,
  customer,
  invoice: invoice(),
  items: items(2),
  preparedBy: 'Demo Contractor',
};

describe('invoice document model', () => {
  it('maps the stored record onto the printed document', () => {
    const model = buildInvoiceDocumentModel(baseInput);

    expect(model.invoice.number).toBe('INV-0003');
    expect(model.invoice.statusLabel).toBe('Issued — payment due');
    expect(model.invoice.isPaid).toBe(false);
    expect(model.customer.name).toBe('Harbour Point Body Corporate');
    expect(model.business.legalName).toBe('Vaal Electrical Contractors (Pty) Ltd');
    expect(model.business.bankName).toBe('Demo Bank');
    expect(model.business.bankAccountNumber).toBe('6265954321');
    expect(model.items).toHaveLength(2);
    // Stored values pass through untouched — the PDF never recalculates money.
    expect(model.totals.total).toBe('5750.00');
    expect(model.totals.balanceDue).toBe('5750.00');
  });

  it('labels paid and cancelled invoices', () => {
    const paid = buildInvoiceDocumentModel({
      ...baseInput,
      invoice: invoice({ status: 'PAID', amount_paid: '5750.00', balance_due: '0.00', paid_at: '2026-10-01T10:00:00.000Z' }),
    });
    expect(paid.invoice.statusLabel).toBe('Paid in full');
    expect(paid.invoice.isPaid).toBe(true);

    const cancelled = buildInvoiceDocumentModel({
      ...baseInput,
      invoice: invoice({ status: 'CANCELLED', cancelled_at: '2026-09-30T10:00:00.000Z' }),
    });
    expect(cancelled.invoice.statusLabel).toBe('Cancelled');
    expect(cancelled.invoice.isCancelled).toBe(true);

    const overdue = buildInvoiceDocumentModel({
      ...baseInput,
      invoice: invoice({ status: 'OVERDUE' }),
    });
    expect(overdue.invoice.statusLabel).toBe('Overdue');
  });

  it('carries the banking details and payment instructions', () => {
    const model = buildInvoiceDocumentModel(baseInput);
    expect(model.business.paymentInstructions).toBe('Use the invoice number as your reference.');
    // No settings rows: the sections simply do not render.
    const bare = buildInvoiceDocumentModel({ ...baseInput, settings: null });
    expect(bare.business.bankName).toBeNull();
    expect(bare.invoice.footerNote).toBeNull();
  });
});
