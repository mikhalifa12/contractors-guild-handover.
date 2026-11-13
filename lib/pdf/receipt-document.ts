import { formatCurrency } from '@/lib/money';
import { formatDate, formatDateTime } from '@/lib/format';
import { COLORS, MARGIN, PdfCanvas } from '@/lib/pdf/pdf-canvas';
import { humaniseEnum } from '@/lib/format';

/**
 * The receipt document: A4, light background, dark headings, orange accents —
 * the same engine as the quote and invoice documents, with a proof-of-payment
 * layout instead of a lines table.
 *
 * The model builder is a pure function of the rows the repository already
 * loaded, so it is unit-tested directly without rendering a PDF. The renderer
 * only draws what the database stores: the balances on the paper are the ones
 * the receipt row remembered when the payment landed.
 */
export type ReceiptDocumentModel = {
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
  receipt: {
    number: string;
    issuedAt: string | null;
    methodLabel: string;
    reference: string | null;
    notes: string | null;
    amountReceived: string;
    previousBalance: string;
    remainingBalance: string;
    fullySettled: boolean;
    paymentDate: string;
  };
  invoice: {
    number: string;
    total: string;
    balanceDueAfter: string;
  };
  customer: {
    name: string;
    contactPerson: string | null;
    addressLines: string[];
    phone: string | null;
    email: string | null;
  };
};

export type ReceiptDocumentInput = {
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
  receipt: {
    receipt_number: string;
    issued_at: Date | string | null;
    method: string;
    reference: string | null;
    amount_received: string;
    previous_balance: string;
    remaining_balance: string;
    payment_date: string;
    notes: string | null;
  };
  invoice: {
    invoice_number: string;
    total: string;
  };
  logo?: { data: Buffer; type: 'png' | 'jpg' } | null;
};

function compact(lines: Array<string | null | undefined>): string[] {
  return lines.map((line) => (line ?? '').trim()).filter((line) => line.length > 0);
}

export function receiptAddressLines(parts: Array<string | null | undefined>): string[] {
  return compact(parts);
}

/** Rows in, document model out. No I/O, no dates other than the ones passed in. */
export function buildReceiptDocumentModel(input: ReceiptDocumentInput): ReceiptDocumentModel {
  const { business, customer, receipt, invoice } = input;

  const remaining = Number(receipt.remaining_balance);

  return {
    business: {
      legalName: business.legal_name,
      tradingName: business.trading_name,
      registrationNumber: business.registration_number,
      taxNumber: business.tax_number,
      addressLines: receiptAddressLines([
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
      // The receipt carries no bank details on purpose: it proves money the
      // business received, not how to pay it more.
    },
    receipt: {
      number: receipt.receipt_number,
      issuedAt: receipt.issued_at ? new Date(receipt.issued_at).toISOString() : null,
      methodLabel: humaniseEnum(receipt.method),
      reference: receipt.reference,
      notes: receipt.notes,
      amountReceived: receipt.amount_received,
      previousBalance: receipt.previous_balance,
      remainingBalance: receipt.remaining_balance,
      fullySettled: remaining <= 0,
      paymentDate: receipt.payment_date,
    },
    invoice: {
      number: invoice.invoice_number,
      total: invoice.total,
      balanceDueAfter: receipt.remaining_balance,
    },
    customer: {
      name: customer.business_name,
      contactPerson: customer.contact_person,
      addressLines: receiptAddressLines([
        customer.billing_address_line1,
        customer.billing_address_line2,
        compact([customer.billing_city, customer.billing_province]).join(', '),
        customer.billing_postal_code,
      ]),
      phone: customer.phone,
      email: customer.email,
    },
  } as ReceiptDocumentModel;
}

// ---------------------------------------------------------------------------
// Renderer
// ---------------------------------------------------------------------------

export async function renderReceiptPdf(model: ReceiptDocumentModel): Promise<Uint8Array> {
  const money = (value: string | number) => formatCurrency(value, model.business.currencyCode);
  const canvas = await PdfCanvas.create({
    title: `${model.receipt.number} — Receipt`,
    author: model.business.legalName,
    subject: `Receipt for ${model.customer.name}`,
    keywords: [model.receipt.number, model.invoice.number, model.customer.name, 'receipt'],
  });

  // ---- Business header (identical layout to the invoice) -------------------
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
  canvas.textAt('RECEIPT', canvas.left, canvas.y, { size: 26, bold: true, color: COLORS.ink });
  canvas.textAt(`${model.receipt.number} · Payment received with thanks`, canvas.left, canvas.y - 14, {
    size: 9.5,
    color: COLORS.muted,
  });

  const metaX = canvas.right;
  canvas.textAt(`Receipt date ${formatDate(model.receipt.paymentDate)}`, metaX, canvas.y, {
    size: 9.5,
    align: 'right',
    color: COLORS.body,
  });
  if (model.receipt.issuedAt) {
    canvas.textAt(`Issued ${formatDateTime(model.receipt.issuedAt)}`, metaX, canvas.y - 13, {
      size: 9.5,
      align: 'right',
      color: COLORS.body,
    });
  }
  canvas.moveDown(34);

  // ---- Received from -------------------------------------------------------
  const columnGap = 24;
  const columnWidth = (canvas.contentWidth - columnGap) / 2;
  const blocksTop = canvas.y;

  canvas.textAt('RECEIVED FROM', canvas.left, blocksTop, {
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
  canvas.textAt('PAYMENT', rightX, blocksTop, { size: 7.5, bold: true, color: COLORS.muted });
  let rightY = blocksTop - 14;
  const paymentLines = compact([
    `Method: ${model.receipt.methodLabel}`,
    model.receipt.reference ? `Reference: ${model.receipt.reference}` : null,
    `Date: ${formatDate(model.receipt.paymentDate)}`,
  ]);
  for (const line of paymentLines) {
    for (const wrapped of canvas.wrap(line, { size: 9, maxWidth: columnWidth })) {
      canvas.textAt(wrapped, rightX, rightY, { size: 9, color: COLORS.body });
      rightY -= 11.5;
    }
  }

  canvas.setY(Math.min(leftY, rightY) - 10);

  // ---- Amount received block ----------------------------------------------
  canvas.ensureSpace(150);
  const panelTop = canvas.y;
  const panelHeight = 46;
  canvas.rect({
    x: canvas.left,
    y: panelTop - panelHeight + 10,
    width: canvas.contentWidth,
    height: panelHeight,
    color: COLORS.emberSoft,
  });
  canvas.textAt('AMOUNT RECEIVED', canvas.left + 10, panelTop - 6, {
    size: 7.5,
    bold: true,
    color: COLORS.muted,
  });
  canvas.textAt(money(model.receipt.amountReceived), canvas.right - 10, panelTop - 8, {
    size: 20,
    bold: true,
    align: 'right',
    color: COLORS.ink,
  });
  canvas.textAt(
    `Invoice ${model.invoice.number} · Invoice total ${money(model.invoice.total)}`,
    canvas.left + 10,
    panelTop - 26,
    { size: 9, color: COLORS.body }
  );
  canvas.moveDown(panelHeight + 10);

  // ---- Balance walk --------------------------------------------------------
  const balanceWidth = 230;
  const balanceX = canvas.right - balanceWidth;
  const balanceRow = (label: string, amount: string, options: { bold?: boolean; color?: (typeof COLORS)[keyof typeof COLORS] } = {}) => {
    canvas.textAt(label, balanceX, canvas.y, {
      size: 10,
      bold: options.bold,
      color: options.color ?? COLORS.body,
    });
    canvas.textAt(amount, canvas.right, canvas.y, {
      size: 10,
      bold: options.bold,
      align: 'right',
      color: options.color ?? COLORS.body,
    });
    canvas.moveDown(15);
  };

  balanceRow('Balance before this payment', money(model.receipt.previousBalance));
  balanceRow('This payment', `−${money(model.receipt.amountReceived)}`);
  canvas.moveDown(2);
  canvas.rule({ color: COLORS.ember, thickness: 1.5, x: balanceX, width: balanceWidth });
  canvas.moveDown(7);
  if (model.receipt.fullySettled) {
    balanceRow('Balance remaining', money(0), { bold: true, color: COLORS.success });
  } else {
    balanceRow('Balance remaining', money(model.receipt.remainingBalance), { bold: true });
  }
  canvas.moveDown(6);

  // ---- Settled stamp -------------------------------------------------------
  if (model.receipt.fullySettled) {
    canvas.ensureSpace(52);
    const stampTop = canvas.y;
    const stampHeight = 40;
    canvas.rect({
      x: canvas.left,
      y: stampTop - stampHeight + 10,
      width: canvas.contentWidth,
      height: stampHeight,
      color: COLORS.successSoft,
    });
    canvas.textAt('PAID IN FULL', canvas.left + 10, stampTop - 6, {
      size: 10,
      bold: true,
      color: COLORS.success,
    });
    canvas.textAt('This invoice has been settled. Thank you for your business.', canvas.left + 10, stampTop - 21, {
      size: 8.5,
      color: COLORS.body,
    });
    canvas.moveDown(stampHeight + 4);
  }

  // ---- Notes ---------------------------------------------------------------
  if (model.receipt.notes) {
    canvas.ensureSpace(58);
    canvas.textAt('NOTES', canvas.left, canvas.y, {
      size: 7.5,
      bold: true,
      color: COLORS.muted,
    });
    canvas.moveDown(13);
    canvas.text(model.receipt.notes, { size: 9, lineHeight: 12, color: COLORS.body });
    canvas.moveDown(10);
  }

  // ---- Footer --------------------------------------------------------------
  const footerParts = compact([
    model.business.legalName,
    model.business.phone,
    model.business.email,
  ]).join('  ·  ');

  return canvas.render({
    footer: (page, pageNumber, total) => {
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
