/**
 * Quote line drafts — the pure half of the line item editor.
 *
 * These helpers live outside the client component on purpose: the quote builder
 * (client) and the "edit a draft" page (server) must agree on how a stored line
 * becomes an editable draft, and a server component cannot call a function that
 * is exported from a `'use client'` module.
 */
import type { CatalogueChoice } from '@/components/quotes/catalogue-line-picker';
import { calculateDocumentTotals, parseAmountToCents } from '@/lib/money';

export type QuoteLineDraft = {
  key: string;
  productId: string;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
};

export type QuoteLinePayload = {
  productId: string | null;
  description: string;
  quantity: string;
  unit: string;
  unitPrice: string;
  discountPercent: string;
  taxRate: string;
};

let lineCounter = 0;
function nextKey(): string {
  lineCounter += 1;
  return `line-${lineCounter}`;
}

export function makeBlankLine(defaultTaxRate: number, unit = 'each'): QuoteLineDraft {
  return {
    key: nextKey(),
    productId: '',
    description: '',
    quantity: '1',
    unit,
    unitPrice: '',
    discountPercent: '0',
    taxRate: String(defaultTaxRate),
  };
}

export function lineFromCatalogue(choice: CatalogueChoice, defaultTaxRate: number): QuoteLineDraft {
  return {
    key: nextKey(),
    productId: choice.id,
    description: choice.name,
    quantity: '1',
    unit: choice.unit || 'each',
    unitPrice: choice.default_price,
    discountPercent: '0',
    taxRate: String(Number(choice.tax_rate) || defaultTaxRate),
  };
}

export function makeDraftFromPayload(payload: QuoteLinePayload, key?: string): QuoteLineDraft {
  return {
    key: key ?? nextKey(),
    productId: payload.productId ?? '',
    description: payload.description,
    quantity: payload.quantity,
    unit: payload.unit,
    unitPrice: payload.unitPrice,
    discountPercent: payload.discountPercent,
    taxRate: payload.taxRate,
  };
}

/** Lines are submitted with their alignment intact, and nothing else. */
export function serialiseLines(lines: readonly QuoteLineDraft[]): string {
  return JSON.stringify(
    lines.map<QuoteLinePayload>((line) => ({
      productId: line.productId || null,
      description: line.description.trim(),
      quantity: line.quantity.trim(),
      unit: line.unit.trim() || 'each',
      unitPrice: line.unitPrice.trim(),
      discountPercent: line.discountPercent.trim() || '0',
      taxRate: line.taxRate.trim() || '0',
    }))
  );
}

export type LineTotalsSummary = {
  subtotalCents: number;
  discountCents: number;
  taxCents: number;
  totalCents: number;
};

export function summariseDraft(lines: readonly QuoteLineDraft[]): LineTotalsSummary {
  const totals = calculateDocumentTotals(
    lines.map((line) => ({
      quantity: Number(line.quantity) || 0,
      unitPriceCents: parseAmountToCents(line.unitPrice) ?? 0,
      discountPercent: Number(line.discountPercent) || 0,
      taxRatePercent: Number(line.taxRate) || 0,
    }))
  );

  return {
    subtotalCents: totals.subtotalCents,
    discountCents: totals.discountTotalCents,
    taxCents: totals.taxTotalCents,
    totalCents: totals.totalCents,
  };
}

export function lineTotalCents(line: QuoteLineDraft): number {
  const totals = summariseDraft([line]);
  return totals.totalCents;
}
