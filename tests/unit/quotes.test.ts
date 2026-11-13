import { describe, expect, it } from 'vitest';
import {
  QUOTE_STATUSES,
  canCustomerRespond,
  canTransitionQuote,
  effectiveQuoteStatus,
  isQuoteEditable,
  isQuoteExpired,
  isQuoteStatus,
  nextQuoteStatuses,
  quoteStatusActionLabel,
  quoteStatusRequiresReason,
} from '@/lib/quotes';

const today = new Date('2026-09-15T08:00:00Z');

describe('quote status rules', () => {
  it('lists the statuses the database enum defines', () => {
    expect(QUOTE_STATUSES).toEqual([
      'DRAFT',
      'SENT',
      'VIEWED',
      'ACCEPTED',
      'DECLINED',
      'EXPIRED',
      'CONVERTED',
    ]);
    expect(isQuoteStatus('ACCEPTED')).toBe(true);
    expect(isQuoteStatus('PAID')).toBe(false);
  });

  it('moves a draft to sent and then to a customer decision', () => {
    expect(nextQuoteStatuses('DRAFT')).toEqual(['SENT']);
    expect(canTransitionQuote('DRAFT', 'SENT')).toBe(true);
    // A draft cannot be accepted before it has been sent to anyone.
    expect(canTransitionQuote('DRAFT', 'ACCEPTED')).toBe(false);
    expect(nextQuoteStatuses('SENT')).toEqual(['VIEWED', 'ACCEPTED', 'DECLINED', 'EXPIRED']);
    expect(nextQuoteStatuses('VIEWED')).toEqual(['ACCEPTED', 'DECLINED', 'EXPIRED']);
  });

  it('treats an answered quote as final', () => {
    expect(nextQuoteStatuses('DECLINED')).toEqual([]);
    expect(nextQuoteStatuses('EXPIRED')).toEqual([]);
    expect(canTransitionQuote('DECLINED', 'ACCEPTED')).toBe(false);
    expect(canTransitionQuote('EXPIRED', 'SENT')).toBe(false);
    // Only the conversion into an invoice follows an acceptance (Phase 4).
    expect(nextQuoteStatuses('ACCEPTED')).toEqual(['CONVERTED']);
  });

  it('refuses a status change to the same status', () => {
    for (const status of QUOTE_STATUSES) {
      expect(canTransitionQuote(status, status)).toBe(false);
    }
  });

  it('only allows edits while a quote is a draft', () => {
    expect(isQuoteEditable('DRAFT')).toBe(true);
    expect(isQuoteEditable('SENT')).toBe(false);
    expect(isQuoteEditable('ACCEPTED')).toBe(false);
  });
});

describe('quote validity', () => {
  it('expires an open quote once its validity date has passed', () => {
    expect(isQuoteExpired('SENT', '2026-09-14', today)).toBe(true);
    expect(isQuoteExpired('VIEWED', '2026-09-15', today)).toBe(false);
    expect(isQuoteExpired('SENT', null, today)).toBe(false);
    // Closed quotes keep their own status even when the date has passed.
    expect(isQuoteExpired('ACCEPTED', '2026-09-01', today)).toBe(false);
    expect(isQuoteExpired('DECLINED', '2026-09-01', today)).toBe(false);
  });

  it('shows an expired status without writing anything', () => {
    expect(effectiveQuoteStatus('SENT', '2026-09-01', today)).toBe('EXPIRED');
    expect(effectiveQuoteStatus('SENT', '2026-12-01', today)).toBe('SENT');
    expect(effectiveQuoteStatus('ACCEPTED', '2026-09-01', today)).toBe('ACCEPTED');
  });

  it('lets the customer answer only while the quote is open and valid', () => {
    expect(canCustomerRespond('SENT', '2026-09-30', today)).toEqual({ allowed: true });
    expect(canCustomerRespond('VIEWED', null, today)).toEqual({ allowed: true });
    expect(canCustomerRespond('EXPIRED', '2026-12-01', today)).toEqual({
      allowed: false,
      reason: 'not_open',
    });
    expect(canCustomerRespond('SENT', '2026-09-01', today)).toEqual({
      allowed: false,
      reason: 'expired',
    });
    expect(canCustomerRespond('ACCEPTED', '2026-12-01', today)).toEqual({
      allowed: false,
      reason: 'not_open',
    });
  });
});

describe('quote action labels', () => {
  it('names the buttons the way a contractor talks', () => {
    expect(quoteStatusActionLabel('SENT')).toBe('Mark as sent');
    expect(quoteStatusActionLabel('ACCEPTED')).toBe('Record acceptance');
    expect(quoteStatusActionLabel('DECLINED')).toBe('Record decline');
  });

  it('insists on a reason when a quote is declined', () => {
    expect(quoteStatusRequiresReason('DECLINED')).toBe(true);
    expect(quoteStatusRequiresReason('EXPIRED')).toBe(false);
  });
});
