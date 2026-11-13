import { describe, expect, it } from 'vitest';
import { PDFDocument, StandardFonts, type PDFFont } from 'pdf-lib';
import { sanitiseForPdf, wrapText } from '@/lib/pdf/pdf-canvas';
import {
  buildQuoteDocumentModel,
  renderQuotePdf,
  type QuoteDocumentInput,
} from '@/lib/pdf/quote-document';
import { formatCurrency } from '@/lib/money';
import { pdfPageCount, pdfText, pdfTextJoined, pdfTextRuns } from '@/tests/helpers/pdf';

/**
 * Intl formats ZAR with non-breaking spaces, which is correct typography for a
 * document (money never wraps) but awkward to read in an assertion. Normalise
 * only for comparison.
 */
const plain = (value: string) => value.replace(/\u00a0/g, ' ');

const business: QuoteDocumentInput['business'] = {
  legal_name: 'Vaal Electrical Contractors (Pty) Ltd',
  trading_name: 'Vaal Electrical',
  registration_number: '2019/123456/07',
  tax_number: '4980123456',
  email: 'office@vaalelectrical.co.za',
  phone: '+27 16 555 0123',
  website: 'https://vaalelectrical.co.za',
  address_line1: 'Unit 4, 12 Steel Road',
  address_line2: 'Vanderbijlpark',
  city: 'Vanderbijlpark',
  province: 'Gauteng',
  postal_code: '1911',
  country: 'South Africa',
  currency_code: 'ZAR',
};

const customer: QuoteDocumentInput['customer'] = {
  business_name: 'Harbour Point Body Corporate',
  contact_person: 'Riaan Fourie',
  email: 'riaan@example.co.za',
  phone: '+27 21 555 0110',
  billing_address_line1: '18 Dock Road',
  billing_address_line2: 'Foreshore',
  billing_city: 'Cape Town',
  billing_province: 'Western Cape',
  billing_postal_code: '8001',
};

function quote(overrides: Partial<QuoteDocumentInput['quote']> = {}): QuoteDocumentInput['quote'] {
  return {
    quote_number: 'QUOTE-0007',
    status: 'SENT',
    issue_date: '2026-09-01',
    valid_until: '2026-09-30',
    job_type: 'Installation',
    description: 'Supply and install a replacement distribution board.',
    contact_person: 'Riaan Fourie',
    contact_phone: '+27 21 555 0110',
    contact_email: 'riaan@example.co.za',
    job_address_line1: '18 Dock Road',
    job_address_line2: null,
    job_city: 'Cape Town',
    job_province: 'Western Cape',
    job_postal_code: '8001',
    subtotal: '17575.00',
    discount_total: '0.00',
    tax_total: '2636.25',
    total: '20211.25',
    payment_terms: 'Payment due within 30 days.',
    notes: 'Site access from 07:00.',
    terms_and_conditions: 'Workmanship guaranteed for 12 months.',
    accepted_at: null,
    accepted_by_name: null,
    declined_reason: null,
    ...overrides,
  };
}

function items(count: number, longDescriptions = false) {
  return Array.from({ length: count }, (_, index) => ({
    line_number: index + 1,
    description: longDescriptions
      ? `Circuit ${index + 1}: supply, install and commission a dedicated 20A circuit including cable, conduit and labelling for the workshop extension`
      : `Distribution board ${index + 1}`,
    quantity: '1',
    unit: 'each',
    unit_price: '1450.00',
    discount_percent: '0',
    tax_rate: '15',
    line_subtotal: '1450.00',
    line_discount: '0.00',
    line_tax: '217.50',
    line_total: '1667.50',
  }));
}

const baseInput: QuoteDocumentInput = {
  business,
  customer,
  quote: quote(),
  items: items(3),
  preparedBy: 'Demo Contractor',
};

describe('quote document model', () => {
  it('maps the stored record onto the printed document', () => {
    const model = buildQuoteDocumentModel(baseInput);

    expect(model.quote.number).toBe('QUOTE-0007');
    expect(model.quote.statusLabel).toBe('Issued');
    expect(model.customer.name).toBe('Harbour Point Body Corporate');
    expect(model.business.legalName).toBe('Vaal Electrical Contractors (Pty) Ltd');
    expect(model.business.addressLines).toEqual(['Unit 4, 12 Steel Road', 'Vanderbijlpark', 'Vanderbijlpark, Gauteng', '1911, South Africa']);
    expect(model.items).toHaveLength(3);
    expect(model.items[0]?.quantity).toBe('1');
    // Stored values pass through untouched — the PDF never recalculates money.
    expect(model.totals.total).toBe('20211.25');
    // The customer's site address is used when the quote carries one.
    expect(model.quote.siteAddressLines[0]).toBe('18 Dock Road');
    expect(model.quote.preparedBy).toBe('Demo Contractor');
  });

  it('labels a sent quote "Issued" and an accepted quote "Accepted"', () => {
    expect(buildQuoteDocumentModel(baseInput).quote.statusLabel).toBe('Issued');
    expect(
      buildQuoteDocumentModel({ ...baseInput, quote: quote({ status: 'VIEWED' }) }).quote.statusLabel
    ).toBe('Issued');

    const accepted = buildQuoteDocumentModel({
      ...baseInput,
      quote: quote({
        status: 'ACCEPTED',
        accepted_at: '2026-09-05T10:15:00.000Z',
        accepted_by_name: 'Riaan Fourie',
      }),
    });
    expect(accepted.quote.statusLabel).toBe('Accepted');
    expect(accepted.quote.isAccepted).toBe(true);
    expect(accepted.quote.acceptedByName).toBe('Riaan Fourie');
    expect(accepted.quote.acceptedAt).toContain('2026');
  });

  it('falls back to the billing address when the quote has no site address', () => {
    const model = buildQuoteDocumentModel({
      ...baseInput,
      quote: quote({
        job_address_line1: null,
        job_city: null,
        job_province: null,
        job_postal_code: null,
      }),
    });
    expect(model.customer.addressLines).toEqual(['18 Dock Road', 'Foreshore', 'Cape Town, Western Cape', '8001']);
  });
});

describe('quote PDF rendering', () => {
  it('renders a single-page A4 document with the stored values', async () => {
    const pdf = await renderQuotePdf(buildQuoteDocumentModel(baseInput));

    expect(Buffer.from(pdf.subarray(0, 5)).toString('latin1')).toBe('%PDF-');
    expect(pdf.byteLength).toBeGreaterThan(2000);

    const text = plain(pdfTextJoined(pdf));
    expect(text).toContain('QUOTE-0007');
    expect(text).toContain('Vaal Electrical Contractors (Pty) Ltd');
    expect(text).toContain('Harbour Point Body Corporate');
    expect(text).toContain('Riaan Fourie');
    expect(text).toContain('Supply and install a replacement distribution board.');
    expect(text).toContain('Distribution board 1');
    // The stored totals, formatted for the document.
    expect(text).toContain(plain(formatCurrency('20211.25', 'ZAR')));
    expect(text).toContain('Payment due within 30 days.');
    expect(text).toContain('Workmanship guaranteed for 12 months.');
    expect(text).toContain('Demo Contractor');
    expect(text).toContain('Page 1 of 1');
    expect(pdfPageCount(pdf)).toBe(1);
  });

  it('keeps every text run inside the printable area', async () => {
    const pdf = await renderQuotePdf(
      buildQuoteDocumentModel({ ...baseInput, items: items(12, true) })
    );

    const runs = pdfTextRuns(pdf);
    expect(runs.length).toBeGreaterThan(50);
    for (const run of runs) {
      expect(run.x).toBeGreaterThanOrEqual(20);
      expect(run.x).toBeLessThanOrEqual(580);
      expect(run.y).toBeGreaterThanOrEqual(20);
      expect(run.y).toBeLessThanOrEqual(830);
    }
  });

  it('flows a long quote onto several pages, repeating the table header', async () => {
    const pdf = await renderQuotePdf(
      buildQuoteDocumentModel({ ...baseInput, items: items(40, true) })
    );

    const pageCount = pdfPageCount(pdf);
    expect(pageCount).toBeGreaterThanOrEqual(3);

    const runs = pdfTextRuns(pdf);
    const footers = runs.filter((run) => /^Page \d+ of \d+$/.test(run.text));
    expect(footers).toHaveLength(pageCount);
    // The table header is repeated on each page so a printed page can be read alone.
    expect(runs.filter((run) => run.text === 'DESCRIPTION').length).toBe(pageCount);
    // Totals are printed once, at the end of the document.
    expect(runs.filter((run) => run.text === 'Total').length).toBe(1);
  });

  it('marks an accepted quote with who accepted it and when', async () => {
    const pdf = await renderQuotePdf(
      buildQuoteDocumentModel({
        ...baseInput,
        quote: quote({
          status: 'ACCEPTED',
          accepted_at: '2026-09-05T10:15:00.000Z',
          accepted_by_name: 'Riaan Fourie',
        }),
      })
    );
    const text = plain(pdfTextJoined(pdf));

    expect(text).toContain('Accepted by Riaan Fourie');
    expect(text).toContain('05 September 2026');
    expect(text).toContain('QUOTE-0007 · Accepted');
  });

  it('does not include internal identifiers', async () => {
    const pdf = await renderQuotePdf(buildQuoteDocumentModel(baseInput));
    const text = pdfText(pdf);
    // No row ids or tokens reach a document a customer could forward.
    expect(text).not.toMatch(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i);
  });

  it('renders a description with unsupported characters without failing', async () => {
    const pdf = await renderQuotePdf(
      buildQuoteDocumentModel({
        ...baseInput,
        items: [{ ...items(1)[0]!, description: 'Distribution board 🙌 — 12-way “surface” mounted' }],
      })
    );
    const text = plain(pdfTextJoined(pdf));

    expect(text).toContain('Distribution board');
    expect(text).toContain('12-way');
    expect(text).toContain('"surface"');
  });
});

describe('pdf text sanitising', () => {
  it('replaces characters the base-14 fonts cannot encode', () => {
    expect(sanitiseForPdf('Discount − 20%')).toBe('Discount - 20%');
    // The superscript two is inside cp1252, so it survives — useful for m².
    expect(sanitiseForPdf('“Quoted” — 5m² cable…')).toBe('"Quoted" - 5m² cable...');
    // A middot is inside cp1252 and must survive: it is the document's separator.
    expect(sanitiseForPdf('QUOTE-0007 · Accepted')).toBe('QUOTE-0007 · Accepted');
    // Anything else is dropped rather than throwing mid-document.
    expect(sanitiseForPdf('Board 🙌 20A')).toBe('Board  20A');
  });
});

describe('pdf canvas', () => {
  it('wraps text to the available width', async () => {
    const document = await PDFDocument.create();
    const font: PDFFont = await document.embedFont(StandardFonts.Helvetica);

    const lines = wrapText(
      font,
      'Supply and install a replacement distribution board with surge protection for the workshop',
      { maxWidth: 200, size: 10 }
    );
    expect(lines.length).toBeGreaterThanOrEqual(2);
    for (const line of lines) {
      expect(font.widthOfTextAtSize(line, 10)).toBeLessThanOrEqual(200);
    }
  });

  it('formats money the same way the screens do', () => {
    expect(plain(formatCurrency('20211.25', 'ZAR'))).toBe('R 20 211,25');
    expect(plain(formatCurrency('0', 'ZAR'))).toBe('R 0,00');
    expect(formatCurrency(null, 'ZAR')).toBe(formatCurrency('0', 'ZAR'));
  });
});
