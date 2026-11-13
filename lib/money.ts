/**
 * Money and tax arithmetic.
 *
 * Rules (documented because they must match the database and the PDFs):
 *  - Money is handled as integer cents internally; floating point is never
 *    used for a stored amount.
 *  - Percentages are 0-100 with up to two decimals.
 *  - Rounding is half-up on cents, applied per line, then summed. This is the
 *    convention South African contractors expect on a quote and it is applied
 *    identically by the database write path and the PDF renderer.
 */
export type Cents = number;

export function parseAmountToCents(value: unknown): Cents | null {
  if (value === null || value === undefined) return null;
  const normalised = String(value).replace(/\s/g, '').replace(',', '.');
  if (normalised === '') return null;
  if (!/^-?\d*(\.\d{0,2})?$/.test(normalised)) return null;

  const parsed = Number(normalised);
  if (!Number.isFinite(parsed)) return null;
  return Math.round(parsed * 100);
}

export function centsToAmount(cents: Cents): string {
  const sign = cents < 0 ? '-' : '';
  const absolute = Math.abs(Math.round(cents));
  const whole = Math.floor(absolute / 100);
  const fraction = String(absolute % 100).padStart(2, '0');
  return `${sign}${whole}.${fraction}`;
}

export function roundHalfUp(value: number): number {
  return Math.sign(value) * Math.round(Math.abs(value) + Number.EPSILON);
}

export function formatCurrency(
  value: string | number | null | undefined,
  currencyCode = 'ZAR',
  locale = 'en-ZA'
): string {
  const amount = typeof value === 'string' ? Number(value) : (value ?? 0);
  const safeAmount = Number.isFinite(amount) ? amount : 0;
  return new Intl.NumberFormat(locale, {
    style: 'currency',
    currency: currencyCode,
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(safeAmount);
}

export function sumCents(values: readonly Cents[]): Cents {
  return values.reduce((total, value) => total + Math.round(value), 0);
}

/** Subtract a discount percentage from an amount, half-up to the cent. */
export function applyDiscountPercent(amountCents: Cents, discountPercent: number): Cents {
  if (discountPercent <= 0) return 0;
  const clamped = Math.min(discountPercent, 100);
  return roundHalfUp((amountCents * clamped) / 100);
}

export function applyTaxPercent(amountCents: Cents, taxRatePercent: number): Cents {
  if (taxRatePercent <= 0) return 0;
  return roundHalfUp((amountCents * taxRatePercent) / 100);
}

export type LineInput = {
  quantity: number;
  unitPriceCents: Cents;
  discountPercent: number;
  taxRatePercent: number;
};

export type LineTotals = {
  lineSubtotalCents: Cents;
  lineDiscountCents: Cents;
  lineTaxCents: Cents;
  lineTotalCents: Cents;
};

export function calculateLine(input: LineInput): LineTotals {
  const quantity = Number.isFinite(input.quantity) ? input.quantity : 0;
  const lineSubtotalCents = roundHalfUp(quantity * input.unitPriceCents);
  const lineDiscountCents = applyDiscountPercent(lineSubtotalCents, input.discountPercent);
  const taxableCents = lineSubtotalCents - lineDiscountCents;
  const lineTaxCents = applyTaxPercent(taxableCents, input.taxRatePercent);

  return {
    lineSubtotalCents,
    lineDiscountCents,
    lineTaxCents,
    lineTotalCents: taxableCents + lineTaxCents,
  };
}

export type DocumentTotals = {
  subtotalCents: Cents;
  discountTotalCents: Cents;
  taxTotalCents: Cents;
  totalCents: Cents;
  lines: LineTotals[];
};

export function calculateDocumentTotals(lines: readonly LineInput[]): DocumentTotals {
  const lineTotals = lines.map((line) => calculateLine(line));
  const subtotalCents = sumCents(lineTotals.map((line) => line.lineSubtotalCents));
  const discountTotalCents = sumCents(lineTotals.map((line) => line.lineDiscountCents));
  const taxTotalCents = sumCents(lineTotals.map((line) => line.lineTaxCents));
  const totalCents = sumCents(lineTotals.map((line) => line.lineTotalCents));

  return { subtotalCents, discountTotalCents, taxTotalCents, totalCents, lines: lineTotals };
}

/**
 * Outstanding balance for an invoice, in cents. Used by the payment flow
 * (Phase 5) and by the dashboard aggregations.
 */
export function calculateBalance(totalCents: Cents, amountPaidCents: Cents): Cents {
  return Math.max(0, Math.round(totalCents) - Math.round(amountPaidCents));
}

export function isFullyPaid(totalCents: Cents, amountPaidCents: Cents): boolean {
  return calculateBalance(totalCents, amountPaidCents) === 0 && totalCents > 0;
}
