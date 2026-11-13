import { describe, expect, it } from 'vitest';
import {
  DEFAULT_PREFIXES,
  NUMBER_PADDING,
  formatDocumentNumber,
} from '@/lib/numbering';

describe('document numbering format', () => {
  it('pads numbers to four digits', () => {
    expect(formatDocumentNumber('QUOTE-', 1)).toBe('QUOTE-0001');
    expect(formatDocumentNumber('INV-', 42)).toBe('INV-0042');
    expect(formatDocumentNumber('REC-', 7)).toBe('REC-0007');
    expect(NUMBER_PADDING).toBe(4);
  });

  it('does not truncate numbers beyond the padding width', () => {
    expect(formatDocumentNumber('INV-', 12345)).toBe('INV-12345');
  });

  it('supports custom prefixes, including empty ones', () => {
    expect(formatDocumentNumber('', 5)).toBe('0005');
    expect(formatDocumentNumber('CG/', 12)).toBe('CG/0012');
  });

  it('ships sensible default prefixes for every document type', () => {
    expect(DEFAULT_PREFIXES).toEqual({
      JOB: 'JOB-',
      QUOTE: 'QUOTE-',
      INVOICE: 'INV-',
      RECEIPT: 'REC-',
    });
  });
});
