import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { COLORS, MARGIN, PAGE, PdfCanvas } from '@/lib/pdf/pdf-canvas';

/**
 * The quote document: A4, light background, dark headings, orange accents.
 *
 * The model builder is a pure function of the rows the repository already
 * loaded, so it is unit-tested directly (names, addresses, totals and status
 * wording) without having to render a PDF. The renderer only draws.
 */
export type QuoteDocumentModel = {
  business: {
    legalName: string;
    tradingName: string | null;
    registrationNumber: string | null;
    taxNumber: string | null;
    addressLines: string[];
    phone: string | null;
    email: string | null;
    website: string | null;
    currencyCode: string;
    logo: { data: Buffer; type: 'png' | 'jpg' } | null;
  };
  quote: {
    number: string;
    statusLabel: string;
    isAccepted: boolean;
    acceptedAt: string | null;
    acceptedByName: string | null;
    declinedReason: string | null;
    issueDate: string;
    validUntil: string | null;
    jobType: string | null;
    description: string | null;
    preparedBy: string | null;
    contactPerson: string | null;
    contactPhone: string | null;
    contactEmail: string | null;
    siteAddressLines: string[];
    paymentTerms: string | null;
    notes: string | null;
    termsAndConditions: string | null;
    footerNote: string | null;
  };
  customer: {
    name: string;
    contactPerson: string | null;
    addressLines: string[];
    phone: string | null;
    email: string | null;
  };
  items: Array<{
    lineNumber: number;
    description: string;
    quantity: string;
    unit: string;
    unitPrice: string;
    discountPercent: string;
    taxRate: string;
    lineDiscount: string;
    lineTotal: string;
  }>;
  totals: {
    subtotal: string;
    discountTotal: string;
    taxTotal: string;
    total: string;
  };
};

export type QuoteDocumentInput = {
  business: {
    legal_name: string;
    trading_name: string | null;
    registration_number: string | null;
    tax_number: string | null;
    address_line1: string | null;
    address_line2: string | null;
    city: string | null;
    province: string | null;
    postal_code: string | null;
    country: string | null;
    phone: string | null;
    email: string | null;
    website: string | null;
    currency_code: string;
  };
  customer: {
    business_name: string;
    contact_person: string | null;
    phone: string | null;
    email: string | null;
    billing_address_line1: string | null;
    billing_address_line2: string | null;
    billing_city: string | null;
    billing_province: string | null;
    billing_postal_code: string | null;
  };
  quote: {
    quote_number: string;
    status: string;
    issue_date: string;
    valid_until: string | null;
    job_type: string | null;
    description: string | null;
    contact_person: string | null;
    contact_phone: string | null;
    contact_email: string | null;
    job_address_line1: string | null;
    job_address_line2: string | null;
    job_city: string | null;
    job_province: string | null;
    job_postal_code: string | null;
    subtotal: string;
    discount_total: string;
    tax_total: string;
    total: string;
    payment_terms: string | null;
    notes: string | null;
    terms_and_conditions: string | null;
    accepted_at: Date | string | null;
    accepted_by_name: string | null;
    declined_reason: string | null;
  };
  items: Array<{
    line_number: number;
    description: string;
    quantity: string;
    unit: string;
    unit_price: string;
    discount_percent: string;
    tax_rate: string;
    line_discount: string;
    line_total: string;
  }>;
  settings?: {
    invoice_footer_note?: string | null;
  } | null;
  preparedBy?: string | null;
  logo?: { data: Buffer; type: 'png' | 'jpg' } | null;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft — not yet issued',
  SENT: 'Issued',
  VIEWED: 'Issued',
  ACCEPTED: 'Accepted',
  DECLINED: 'Declined',
  EXPIRED: 'Expired',
  CONVERTED: 'Accepted — invoiced',
};

function compact(lines: Array<string | null | undefined>): string[] {
  return lines.map((line) => (line ?? '').trim()).filter((line) => line.length > 0);
}

export function addressLines(parts: Array<string | null | undefined>): string[] {
  return compact(parts);
}

function formatStamp(value: Date | string | null): string | null {
  if (!value) return null;
  const date = typeof value === 'string' ? new Date(value) : value;
  if (Number.isNaN(date.getTime())) return null;
  return new Intl.DateTimeFormat('en-ZA', {
    day: '2-digit',
    month: 'long',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

/** Rows in, document model out. No I/O, no dates other than the ones passed in. */
export function buildQuoteDocumentModel(input: QuoteDocumentInput): QuoteDocumentModel {
  const { business, customer, quote, items } = input;

  return {
    business: {
      legalName: business.legal_name,
      tradingName: business.trading_name,
      registrationNumber: business.registration_number,
      taxNumber: business.tax_number,
      addressLines: addressLines([
        business.address_line1,
        business.address_line2,
        compact([business.city, business.province]).join(', '),
        compact([business.postal_code, business.country]).join(', '),
      ]),
      phone: business.phone,
      email: business.email,
      website: business.website,
      currencyCode: business.currency_code,
      logo: input.logo ?? null,
    },
    quote: {
      number: quote.quote_number,
      statusLabel: STATUS_LABELS[quote.status] ?? quote.status,
      isAccepted: quote.status === 'ACCEPTED' || quote.status === 'CONVERTED',
      acceptedAt: formatStamp(quote.accepted_at),
      acceptedByName: quote.accepted_by_name,
      declinedReason: quote.declined_reason,
      issueDate: quote.issue_date,
      validUntil: quote.valid_until,
      jobType: quote.job_type,
      description: quote.description,
      preparedBy: input.preparedBy ?? null,
      contactPerson: quote.contact_person,
      contactPhone: quote.contact_phone,
      contactEmail: quote.contact_email,
      siteAddressLines: addressLines([
        quote.job_address_line1,
        quote.job_address_line2,
        compact([quote.job_city, quote.job_province]).join(', '),
        quote.job_postal_code,
      ]),
      paymentTerms: quote.payment_terms,
      notes: quote.notes,
      termsAndConditions: quote.terms_and_conditions,
      footerNote: input.settings?.invoice_footer_note ?? null,
    },
    customer: {
      name: customer.business_name,
      contactPerson: customer.contact_person,
      addressLines: addressLines([
        customer.billing_address_line1,
        customer.billing_address_line2,
        compact([customer.billing_city, customer.billing_province]).join(', '),
        customer.billing_postal_code,
      ]),
      phone: customer.phone,
      email: customer.email,
    },
    items: items.map((item) => ({
      lineNumber: item.line_number,
      description: item.description,
      quantity: Number(item.quantity).toString(),
      unit: item.unit,
      unitPrice: item.unit_price,
      discountPercent: item.discount_percent,
      taxRate: item.tax_rate,
      lineDiscount: item.line_discount,
      lineTotal: item.line_total,
    })),
    totals: {
      subtotal: quote.subtotal,
      discountTotal: quote.discount_total,
      taxTotal: quote.tax_total,
      total: quote.total,
    },
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const COLUMN_WIDTHS = {
  line: 16,
  description: 199.28,
  quantity: 38,
  unit: 38,
  unitPrice: 60,
  discount: 34,
  tax: 34,
  total: 88,
} as const;

export async function renderQuotePdf(model: QuoteDocumentModel): Promise<Uint8Array> {
  const money = (value: string | number) => formatCurrency(value, model.business.currencyCode);
  const canvas = await PdfCanvas.create({
    title: `${model.quote.number} — Quote`,
    author: model.business.legalName,
    subject: `Quote for ${model.customer.name}`,
    keywords: [model.quote.number, model.customer.name, 'quote'],
  });

  // ---- Business header -----------------------------------------------------
  // The logo sits on the right and the business details on the left; the accent
  // rule goes under whichever is taller.
  const headerTop = canvas.y;
  let logoBottom = headerTop;

  if (model.business.logo) {
    const image = await canvas.embedImage(model.business.logo.data, model.business.logo.type);
    if (image) {
      canvas.drawImage(image, {
        x: canvas.right - 150,
        y: headerTop - 54,
        maxWidth: 150,
        maxHeight: 54,
      });
      logoBottom = headerTop - 54;
    }
  }

  canvas.textAt(model.business.legalName, canvas.left, canvas.y, {
    size: 17,
    bold: true,
    color: COLORS.ink,
  });
  canvas.moveDown(22);

  if (model.business.tradingName && model.business.tradingName !== model.business.legalName) {
    canvas.textAt(model.business.tradingName, canvas.left, canvas.y, { size: 10, color: COLORS.muted });
    canvas.moveDown(13);
  }

  for (const line of model.business.addressLines) {
    canvas.textAt(line, canvas.left, canvas.y, { size: 9, color: COLORS.body });
    canvas.moveDown(11.5);
  }

  const contactLine = compact([
    model.business.phone,
    model.business.email,
    model.business.website,
  ]).join('  ·  ');
  if (contactLine) {
    canvas.textAt(contactLine, canvas.left, canvas.y, { size: 9, color: COLORS.body });
    canvas.moveDown(11.5);
  }

  const identifierLine = compact([
    model.business.registrationNumber ? `Reg ${model.business.registrationNumber}` : null,
    model.business.taxNumber ? `VAT ${model.business.taxNumber}` : null,
  ]).join('  ·  ');
  if (identifierLine) {
    canvas.textAt(identifierLine, canvas.left, canvas.y, { size: 9, color: COLORS.muted });
    canvas.moveDown(11.5);
  }

  canvas.setY(Math.min(canvas.y, logoBottom) - 4);
  canvas.rule({ color: COLORS.ember, thickness: 2.5 });
  canvas.moveDown(22);

  // ---- Document title ------------------------------------------------------
  canvas.textAt('QUOTE', canvas.left, canvas.y, { size: 26, bold: true, color: COLORS.ink });
  canvas.textAt(`${model.quote.number} · ${model.quote.statusLabel}`, canvas.left, canvas.y - 14, {
    size: 9.5,
    color: COLORS.muted,
  });

  const metaX = canvas.right;
  canvas.textAt(`Issued ${formatDate(model.quote.issueDate)}`, metaX, canvas.y, {
    size: 9.5,
    align: 'right',
    color: COLORS.body,
  });
  if (model.quote.validUntil) {
    canvas.textAt(`Valid until ${formatDate(model.quote.validUntil)}`, metaX, canvas.y - 13, {
      size: 9.5,
      align: 'right',
      color: COLORS.body,
    });
  }
  canvas.moveDown(34);

  // ---- Customer and site ---------------------------------------------------
  const columnGap = 24;
  const columnWidth = (canvas.contentWidth - columnGap) / 2;
  const blocksTop = canvas.y;

  canvas.textAt('PREPARED FOR', canvas.left, blocksTop, {
    size: 7.5,
    bold: true,
    color: COLORS.muted,
  });
  let leftY = blocksTop - 14;
  canvas.textAt(model.customer.name, canvas.left, leftY, { size: 11, bold: true, color: COLORS.ink });
  leftY -= 13;
  for (const line of [
    model.customer.contactPerson,
    ...model.customer.addressLines,
    model.customer.phone,
    model.customer.email,
  ].filter(Boolean) as string[]) {
    for (const wrapped of canvas.wrap(line, { size: 9, maxWidth: columnWidth })) {
      canvas.textAt(wrapped, canvas.left, leftY, { size: 9, color: COLORS.body });
      leftY -= 11.5;
    }
  }

  const rightX = canvas.left + columnWidth + columnGap;
  canvas.textAt('SITE / JOB', rightX, blocksTop, { size: 7.5, bold: true, color: COLORS.muted });
  let rightY = blocksTop - 14;
  for (const line of [
    model.quote.jobType,
    ...model.quote.siteAddressLines,
    model.quote.contactPerson ? `On site: ${model.quote.contactPerson}` : null,
    model.quote.contactPhone,
  ].filter(Boolean) as string[]) {
    for (const wrapped of canvas.wrap(line, { size: 9, maxWidth: columnWidth })) {
      canvas.textAt(wrapped, rightX, rightY, { size: 9, color: COLORS.body });
      rightY -= 11.5;
    }
  }

  canvas.setY(Math.min(leftY, rightY) - 10);

  if (model.quote.description) {
    canvas.ensureSpace(40);
    canvas.textAt('SCOPE', canvas.left, canvas.y, { size: 7.5, bold: true, color: COLORS.muted });
    canvas.moveDown(13);
    canvas.text(model.quote.description, { size: 9.5, lineHeight: 12.5 });
    canvas.moveDown(6);
  }

  // ---- Items table ---------------------------------------------------------
  const tableHeader = (continued: boolean) => {
    canvas.ensureSpace(60);
    const top = canvas.y;
    canvas.rect({
      x: canvas.left,
      y: top - 4,
      width: canvas.contentWidth,
      height: 20,
      color: COLORS.emberSoft,
    });

    let x = canvas.left;
    const header = (label: string, width: number, align: 'left' | 'right' = 'left') => {
      canvas.textAt(label.toUpperCase(), align === 'right' ? x + width - 6 : x + 6, top + 2.5, {
        size: 7.5,
        bold: true,
        color: COLORS.ink,
        align,
      });
      x += width;
    };

    header('#', COLUMN_WIDTHS.line);
    header('Description', COLUMN_WIDTHS.description);
    header('Qty', COLUMN_WIDTHS.quantity, 'right');
    header('Unit', COLUMN_WIDTHS.unit);
    header('Unit price', COLUMN_WIDTHS.unitPrice, 'right');
    header('Disc', COLUMN_WIDTHS.discount, 'right');
    header('VAT', COLUMN_WIDTHS.tax, 'right');
    header('Line total', COLUMN_WIDTHS.total, 'right');

    canvas.setY(top - 22);
    if (continued) {
      canvas.moveDown(2);
    }
  };

  tableHeader(false);

  for (const [index, item] of model.items.entries()) {
    const descriptionLines = canvas.wrap(item.description, {
      size: 9,
      maxWidth: COLUMN_WIDTHS.description - 12,
    });
    const rowHeight = Math.max(19, descriptionLines.length * 11.5 + 7);

    if (canvas.remainingHeight - rowHeight < 60) {
      canvas.newPage();
      tableHeader(true);
    }

    const rowTop = canvas.y + 4;
    let x = canvas.left;

    canvas.textAt(String(item.lineNumber ?? index + 1), x + 6, rowTop - 3, {
      size: 9,
      color: COLORS.faint,
    });
    x += COLUMN_WIDTHS.line;

    let textY = rowTop;
    for (const line of descriptionLines) {
      canvas.textAt(line, x + 6, textY, { size: 9, color: COLORS.ink });
      textY -= 11.5;
    }
    x += COLUMN_WIDTHS.description;

    const value = (text: string, width: number, align: 'left' | 'right' = 'right') => {
      canvas.textAt(text, align === 'right' ? x + width - 6 : x + 6, rowTop - 3, {
        size: 9,
        color: COLORS.body,
        align,
      });
      x += width;
    };

    value(item.quantity, COLUMN_WIDTHS.quantity);
    value(item.unit, COLUMN_WIDTHS.unit, 'left');
    value(money(item.unitPrice), COLUMN_WIDTHS.unitPrice);
    value(Number(item.discountPercent) > 0 ? `${Number(item.discountPercent)}%` : '—', COLUMN_WIDTHS.discount);
    value(`${Number(item.taxRate)}%`, COLUMN_WIDTHS.tax);
    value(money(item.lineTotal), COLUMN_WIDTHS.total);

    canvas.moveDown(rowHeight);
    canvas.rule({ color: COLORS.rule, thickness: 0.5 });
    canvas.moveDown(3);
  }

  canvas.moveDown(8);

  // ---- Totals --------------------------------------------------------------
  canvas.ensureSpace(120);
  const totalsWidth = 210;
  const totalsX = canvas.right - totalsWidth;
  const labelX = totalsX;
  const valueX = canvas.right;

  const totalRow = (label: string, amount: string, options: { bold?: boolean; size?: number } = {}) => {
    const size = options.size ?? 10;
    canvas.textAt(label, labelX, canvas.y, {
      size,
      bold: options.bold,
      color: options.bold ? COLORS.ink : COLORS.body,
    });
    canvas.textAt(amount, valueX, canvas.y, {
      size,
      bold: options.bold,
      align: 'right',
      color: options.bold ? COLORS.ink : COLORS.body,
    });
    canvas.moveDown(size + 5);
  };

  totalRow('Subtotal', money(model.totals.subtotal));
  if (Number(model.totals.discountTotal) > 0) {
    totalRow('Discount', `−${money(model.totals.discountTotal)}`);
  }
  totalRow('VAT', money(model.totals.taxTotal));

  canvas.moveDown(2);
  canvas.rule({ color: COLORS.ember, thickness: 1.5, x: totalsX, width: totalsWidth });
  canvas.moveDown(7);
  totalRow('Total', money(model.totals.total), { bold: true, size: 13 });
  canvas.moveDown(6);

  // ---- Conditions and notes ------------------------------------------------
  const section = (title: string, body: string | null) => {
    if (!body) return;
    canvas.ensureSpace(58);
    canvas.textAt(title.toUpperCase(), canvas.left, canvas.y, {
      size: 7.5,
      bold: true,
      color: COLORS.muted,
    });
    canvas.moveDown(13);
    canvas.text(body, { size: 9, lineHeight: 12, color: COLORS.body });
    canvas.moveDown(10);
  };

  if (model.quote.isAccepted && model.quote.acceptedByName) {
    canvas.ensureSpace(52);
    const panelTop = canvas.y;
    const panelHeight = 40;
    canvas.rect({
      x: canvas.left,
      y: panelTop - panelHeight + 10,
      width: canvas.contentWidth,
      height: panelHeight,
      color: COLORS.successSoft,
    });
    canvas.textAt(
      `Accepted by ${model.quote.acceptedByName}${model.quote.acceptedAt ? ` on ${model.quote.acceptedAt}` : ''}`,
      canvas.left + 10,
      panelTop - 6,
      { size: 10, bold: true, color: COLORS.success }
    );
    canvas.textAt(
      'This quote was accepted electronically, together with the price and scope above.',
      canvas.left + 10,
      panelTop - 21,
      { size: 8.5, color: COLORS.body }
    );
    canvas.moveDown(panelHeight + 4);
  }

  if (model.quote.declinedReason) {
    canvas.ensureSpace(30);
    canvas.textAt(`Declined: ${model.quote.declinedReason}`, canvas.left, canvas.y, {
      size: 9,
      color: COLORS.muted,
    });
    canvas.moveDown(16);
  }

  section('Payment terms', model.quote.paymentTerms);
  section('Notes', model.quote.notes);
  section('Terms and conditions', model.quote.termsAndConditions);
  if (model.quote.preparedBy) {
    section('Prepared by', model.quote.preparedBy);
  }

  // ---- Footer --------------------------------------------------------------
  const footerParts = compact([
    model.business.legalName,
    model.business.phone,
    model.business.email,
  ]).join('  ·  ');

  return canvas.render({
    footer: (page, pageNumber, total) => {
      if (model.quote.footerNote) {
        page.textAt(model.quote.footerNote, PAGE.width / 2, MARGIN.bottom - 8, {
          size: 7.5,
          align: 'center',
          color: COLORS.faint,
          maxWidth: page.contentWidth,
        });
      }
      page.setY(MARGIN.bottom - 16);
      page.rule({ color: COLORS.rule, thickness: 0.5 });
      page.textAt(footerParts, page.left, MARGIN.bottom - 28, { size: 7.5, color: COLORS.muted });
      page.textAt(`Page ${pageNumber} of ${total}`, page.right, MARGIN.bottom - 28, {
        size: 7.5,
        align: 'right',
        color: COLORS.muted,
      });
    },
  });
}
