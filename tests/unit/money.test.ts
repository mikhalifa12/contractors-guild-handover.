import { describe, expect, it } from 'vitest';
import {
  applyDiscountPercent,
  applyTaxPercent,
  calculateBalance,
  calculateDocumentTotals,
  calculateLine,
  centsToAmount,
  formatCurrency,
  isFullyPaid,
  parseAmountToCents,
  sumCents,
} from '@/lib/money';

describe('amount parsing and formatting', () => {
  it('parses human input into cents', () => {
    expect(parseAmountToCents('1234.56')).toBe(123456);
    expect(parseAmountToCents('1234,56')).toBe(123456);
    expect(parseAmountToCents('0.05')).toBe(5);
    expect(parseAmountToCents('')).toBeNull();
    expect(parseAmountToCents('abc')).toBeNull();
    expect(parseAmountToCents('12.345')).toBeNull();
  });

  it('formats cents back to a decimal amount', () => {
    expect(centsToAmount(123456)).toBe('1234.56');
    expect(centsToAmount(5)).toBe('0.05');
    expect(centsToAmount(-5)).toBe('-0.05');
  });

  it('formats South African currency', () => {
    const formatted = formatCurrency('16585.00', 'ZAR');
    expect(formatted).toContain('16');
    expect(formatted).toMatch(/16[\s,.]?585/);
  });

  it('sums integer cents without float drift', () => {
    expect(sumCents([1, 2, 3])).toBe(6);
    expect(sumCents([0.4, 0.5].map((value) => Math.round(value)))).toBe(1);
  });
});

describe('line and document totals', () => {
  it('calculates a simple line', () => {
    const line = calculateLine({ quantity: 2, unitPriceCents: 15000, discountPercent: 0, taxRatePercent: 15 });
    expect(line.lineSubtotalCents).toBe(30000);
    expect(line.lineDiscountCents).toBe(0);
    expect(line.lineTaxCents).toBe(4500);
    expect(line.lineTotalCents).toBe(34500);
  });

  it('applies discount before tax, rounding half-up', () => {
    const line = calculateLine({ quantity: 1, unitPriceCents: 9999, discountPercent: 12.5, taxRatePercent: 15 });
    expect(line.lineSubtotalCents).toBe(9999);
    expect(line.lineDiscountCents).toBe(1250); // 1249.875 -> 1250
    expect(line.lineTaxCents).toBe(1312); // 8749 * 0.15 = 1312.35 -> 1312
    expect(line.lineTotalCents).toBe(10061);
  });

  it('handles fractional quantities', () => {
    const line = calculateLine({ quantity: 2.5, unitPriceCents: 4000, discountPercent: 0, taxRatePercent: 0 });
    expect(line.lineSubtotalCents).toBe(10000);
  });

  it('clamps percentage helpers to sensible ranges', () => {
    expect(applyDiscountPercent(10000, 0)).toBe(0);
    expect(applyDiscountPercent(10000, 150)).toBe(10000);
    expect(applyTaxPercent(10000, -5)).toBe(0);
  });

  it('totals a multi-line document', () => {
    const totals = calculateDocumentTotals([
      { quantity: 4, unitPriceCents: 85000, discountPercent: 0, taxRatePercent: 15 }, // CCTV cameras
      { quantity: 1, unitPriceCents: 250000, discountPercent: 10, taxRatePercent: 15 }, // installation
      { quantity: 2, unitPriceCents: 12000, discountPercent: 0, taxRatePercent: 0 }, // cable
    ]);

    expect(totals.lines).toHaveLength(3);
    expect(totals.subtotalCents).toBe(340000 + 250000 + 24000);
    expect(totals.discountTotalCents).toBe(25000);
    expect(totals.taxTotalCents).toBe(51000 + 33750);
    expect(totals.totalCents).toBe(totals.subtotalCents - totals.discountTotalCents + totals.taxTotalCents);
  });
});

describe('invoice balances', () => {
  it('tracks partial payments', () => {
    const total = 1658500; // R16 585.00
    const partial = 829250; // R8 292.50

    expect(calculateBalance(total, partial)).toBe(829250);
    expect(isFullyPaid(total, partial)).toBe(false);
    expect(calculateBalance(total, total)).toBe(0);
    expect(isFullyPaid(total, total)).toBe(true);
  });

  it('never reports a negative balance', () => {
    expect(calculateBalance(1000, 1500)).toBe(0);
  });

  it('treats a zero-value invoice as unpaid', () => {
    expect(isFullyPaid(0, 0)).toBe(false);
  });
});
