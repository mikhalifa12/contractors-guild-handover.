import { formatCurrency } from '@/lib/money';
import { formatDate } from '@/lib/format';
import { COLORS, MARGIN, PAGE, PdfCanvas } from '@/lib/pdf/pdf-canvas';
import { humaniseEnum } from '@/lib/format';

/**
 * The invoice document: A4, light background, dark headings, orange accents —
 * the same engine as the quote PDF, with a tax-invoice header block (VAT
 * number, invoice date, due date) and an outstanding-balance block instead of
 * a validity date.
 *
 * The model builder is a pure function of the rows the repository already
 * loaded, so it is unit-tested directly without rendering a PDF. The renderer
 * only draws what the database stores; totals are never recalculated here.
 */
export type InvoiceDocumentModel = {
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
    bankName: string | null;
    bankAccountName: string | null;
    bankAccountNumber: string | null;
    bankBranchCode: string | null;
    bankAccountType: string | null;
    paymentInstructions: string | null;
  };
  invoice: {
    number: string;
    statusLabel: string;
    isPaid: boolean;
    isCancelled: boolean;
    issueDate: string;
    dueDate: string | null;
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
    amountPaid: string;
    balanceDue: string;
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
    amountPaid: string;
    balanceDue: string;
  };
};

export type InvoiceDocumentInput = {
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
  settings: {
    bank_name: string | null;
    bank_account_name: string | null;
    bank_account_number: string | null;
    bank_branch_code: string | null;
    bank_account_type: string | null;
    payment_instructions: string | null;
    invoice_footer_note: string | null;
  } | null;
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
  invoice: {
    invoice_number: string;
    status: string;
    issue_date: string;
    due_date: string | null;
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
    amount_paid: string;
    balance_due: string;
    payment_terms: string | null;
    notes: string | null;
    terms_and_conditions: string | null;
    paid_at: Date | string | null;
    cancelled_at: Date | string | null;
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
  preparedBy?: string | null;
  logo?: { data: Buffer; type: 'png' | 'jpg' } | null;
};

const STATUS_LABELS: Record<string, string> = {
  DRAFT: 'Draft — not yet issued',
  SENT: 'Issued — payment due',
  VIEWED: 'Issued — payment due',
  PARTIALLY_PAID: 'Partially paid',
  PAID: 'Paid in full',
  OVERDUE: 'Overdue',
  CANCELLED: 'Cancelled',
};

function compact(lines: Array<string | null | undefined>): string[] {
  return lines.map((line) => (line ?? '').trim()).filter((line) => line.length > 0);
}

export function invoiceAddressLines(parts: Array<string | null | undefined>): string[] {
  return compact(parts);
}

/** Rows in, document model out. No I/O, no dates other than the ones passed in. */
export function buildInvoiceDocumentModel(input: InvoiceDocumentInput): InvoiceDocumentModel {
  const { business, customer, invoice, items, settings } = input;

  return {
    business: {
      legalName: business.legal_name,
      tradingName: business.trading_name,
      registrationNumber: business.registration_number,
      taxNumber: business.tax_number,
      addressLines: invoiceAddressLines([
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
      bankName: settings?.bank_name ?? null,
      bankAccountName: settings?.bank_account_name ?? null,
      bankAccountNumber: settings?.bank_account_number ?? null,
      bankBranchCode: settings?.bank_branch_code ?? null,
      bankAccountType: settings?.bank_account_type ?? null,
      paymentInstructions: settings?.payment_instructions ?? null,
    },
    invoice: {
      number: invoice.invoice_number,
      statusLabel: STATUS_LABELS[invoice.status] ?? humaniseEnum(invoice.status),
      isPaid: invoice.status === 'PAID',
      isCancelled: invoice.status === 'CANCELLED',
      issueDate: invoice.issue_date,
      dueDate: invoice.due_date,
      jobType: invoice.job_type,
      description: invoice.description,
      preparedBy: input.preparedBy ?? null,
      contactPerson: invoice.contact_person,
      contactPhone: invoice.contact_phone,
      contactEmail: invoice.contact_email,
      siteAddressLines: invoiceAddressLines([
        invoice.job_address_line1,
        invoice.job_address_line2,
        compact([invoice.job_city, invoice.job_province]).join(', '),
        invoice.job_postal_code,
      ]),
      paymentTerms: invoice.payment_terms,
      notes: invoice.notes,
      termsAndConditions: invoice.terms_and_conditions,
      footerNote: settings?.invoice_footer_note ?? null,
      amountPaid: invoice.amount_paid,
      balanceDue: invoice.balance_due,
    },
    customer: {
      name: customer.business_name,
      contactPerson: customer.contact_person,
      addressLines: invoiceAddressLines([
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
      subtotal: invoice.subtotal,
      discountTotal: invoice.discount_total,
      taxTotal: invoice.tax_total,
      total: invoice.total,
      amountPaid: invoice.amount_paid,
      balanceDue: invoice.balance_due,
    },
  };
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

const COLUMN_WIDTHS = {
  line: 16,
  description: 237.28,
  quantity: 44,
  unit: 44,
  unitPrice: 70,
  discount: 40,
  tax: 40,
  total: 100,
} as const;

export async function renderInvoicePdf(model: InvoiceDocumentModel): Promise<Uint8Array> {
  const money = (value: string | number) => formatCurrency(value, model.business.currencyCode);
  const canvas = await PdfCanvas.create({
    title: `${model.invoice.number} — Invoice`,
    author: model.business.legalName,
    subject: `Invoice for ${model.customer.name}`,
    keywords: [model.invoice.number, model.customer.name, 'invoice'],
  });

  // ---- Business header (identical layout to the quote) ---------------------
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
  canvas.textAt('INVOICE', canvas.left, canvas.y, { size: 26, bold: true, color: COLORS.ink });
  canvas.textAt(`${model.invoice.number} · ${model.invoice.statusLabel}`, canvas.left, canvas.y - 14, {
    size: 9.5,
    color: COLORS.muted,
  });

  const metaX = canvas.right;
  canvas.textAt(`Invoice date ${formatDate(model.invoice.issueDate)}`, metaX, canvas.y, {
    size: 9.5,
    align: 'right',
    color: COLORS.body,
  });
  if (model.invoice.dueDate) {
    canvas.textAt(`Due ${formatDate(model.invoice.dueDate)}`, metaX, canvas.y - 13, {
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

  canvas.textAt('BILL TO', canvas.left, blocksTop, {
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
    model.invoice.jobType,
    ...model.invoice.siteAddressLines,
    model.invoice.contactPerson ? `On site: ${model.invoice.contactPerson}` : null,
    model.invoice.contactPhone,
  ].filter(Boolean) as string[]) {
    for (const wrapped of canvas.wrap(line, { size: 9, maxWidth: columnWidth })) {
      canvas.textAt(wrapped, rightX, rightY, { size: 9, color: COLORS.body });
      rightY -= 11.5;
    }
  }

  canvas.setY(Math.min(leftY, rightY) - 10);

  if (model.invoice.description) {
    canvas.ensureSpace(40);
    canvas.textAt('SCOPE', canvas.left, canvas.y, { size: 7.5, bold: true, color: COLORS.muted });
    canvas.moveDown(13);
    canvas.text(model.invoice.description, { size: 9.5, lineHeight: 12.5 });
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
  canvas.ensureSpace(140);
  const totalsWidth = 210;
  const totalsX = canvas.right - totalsWidth;
  const labelX = totalsX;
  const valueX = canvas.right;

  const totalRow = (label: string, amount: string, options: { bold?: boolean; size?: number; color?: (typeof COLORS)[keyof typeof COLORS] } = {}) => {
    const size = options.size ?? 10;
    canvas.textAt(label, labelX, canvas.y, {
      size,
      bold: options.bold,
      color: options.color ?? (options.bold ? COLORS.ink : COLORS.body),
    });
    canvas.textAt(amount, valueX, canvas.y, {
      size,
      bold: options.bold,
      align: 'right',
      color: options.color ?? (options.bold ? COLORS.ink : COLORS.body),
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

  // Outstanding block: only when money has been paid or is still owed.
  const hasPaidSomething = Number(model.totals.amountPaid) > 0;
  if (hasPaidSomething) {
    canvas.moveDown(4);
    totalRow('Amount paid', `−${money(model.totals.amountPaid)}`);
  }
  if (model.invoice.isPaid) {
    totalRow('Balance due', money(0), { bold: true, color: COLORS.success });
  } else if (!model.invoice.isCancelled) {
    canvas.moveDown(2);
    totalRow('Balance due', money(model.totals.balanceDue), { bold: true });
  }
  canvas.moveDown(6);

  // ---- Paid / cancelled stamp ---------------------------------------------
  if (model.invoice.isPaid) {
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
    canvas.textAt('PAID IN FULL', canvas.left + 10, panelTop - 6, {
      size: 10,
      bold: true,
      color: COLORS.success,
    });
    canvas.textAt('This invoice has been settled. Thank you for your business.', canvas.left + 10, panelTop - 21, {
      size: 8.5,
      color: COLORS.body,
    });
    canvas.moveDown(panelHeight + 4);
  }

  if (model.invoice.isCancelled) {
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
    canvas.textAt('CANCELLED', canvas.left + 10, panelTop - 6, {
      size: 10,
      bold: true,
      color: COLORS.muted,
    });
    canvas.textAt('This invoice was cancelled and is kept for your records only.', canvas.left + 10, panelTop - 21, {
      size: 8.5,
      color: COLORS.body,
    });
    canvas.moveDown(panelHeight + 4);
  }

  // ---- Banking details and conditions --------------------------------------
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

  const bankLines = compact([
    model.business.bankName,
    model.business.bankAccountName ? `Account name: ${model.business.bankAccountName}` : null,
    model.business.bankAccountNumber ? `Account number: ${model.business.bankAccountNumber}` : null,
    model.business.bankBranchCode ? `Branch code: ${model.business.bankBranchCode}` : null,
    model.business.bankAccountType ? `Account type: ${model.business.bankAccountType}` : null,
  ]);
  if (bankLines.length > 0) {
    section('Banking details', bankLines.join('\n'));
  }
  if (model.business.paymentInstructions) {
    section('Payment instructions', model.business.paymentInstructions);
  }

  section('Payment terms', model.invoice.paymentTerms);
  section('Notes', model.invoice.notes);
  section('Terms and conditions', model.invoice.termsAndConditions);
  if (model.invoice.preparedBy) {
    section('Prepared by', model.invoice.preparedBy);
  }

  // ---- Footer --------------------------------------------------------------
  const footerParts = compact([
    model.business.legalName,
    model.business.phone,
    model.business.email,
  ]).join('  ·  ');

  return canvas.render({
    footer: (page, pageNumber, total) => {
      if (model.invoice.footerNote) {
        page.textAt(model.invoice.footerNote, PAGE.width / 2, MARGIN.bottom - 8, {
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
