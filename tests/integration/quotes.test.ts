import '@/tests/helpers/env';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import { createCatalogueItemAction } from '@/lib/actions/catalogue';
import { createCustomerAction } from '@/lib/actions/customers';
import { createJobAction } from '@/lib/actions/jobs';
import {
  createQuoteAction,
  duplicateQuoteAction,
  markQuoteSentAction,
  setQuoteStatusAction,
  updateQuoteAction,
} from '@/lib/actions/quotes';
import { respondToQuoteAction } from '@/lib/actions/public-quotes';
import { getJob } from '@/lib/repositories/jobs';
import { getQuote, listQuotes, markQuoteSent } from '@/lib/repositories/quotes';
import { getPublicQuote } from '@/lib/repositories/public-quotes';
import { renderQuotePdfForBusiness } from '@/lib/pdf/quote-service';
import { effectiveQuoteStatus } from '@/lib/quotes';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { expectRedirect, formData, runAction, runFormAction } from '@/tests/helpers/actions';
import { registerOwner } from '@/tests/helpers/owners';
import { resetDatabase, withAdminClient } from '@/tests/helpers/env';
import { pdfTextJoined } from '@/tests/helpers/pdf';

type Line = {
  productId?: string | null;
  description: string;
  quantity: string;
  unit?: string;
  unitPrice: string;
  discountPercent?: string;
  taxRate?: string;
};

function lines(...values: Line[]): string {
  return JSON.stringify(
    values.map((line) => ({
      productId: line.productId ?? null,
      description: line.description,
      quantity: line.quantity,
      unit: line.unit ?? 'each',
      unitPrice: line.unitPrice,
      discountPercent: line.discountPercent ?? '0',
      taxRate: line.taxRate ?? '15',
    }))
  );
}

function dateFromToday(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function quoteForm(customerId: string, overrides: Record<string, string> = {}) {
  return formData({
    customerId,
    issueDate: '2026-09-01',
    validUntil: dateFromToday(30),
    items: lines({ description: 'Distribution board', quantity: '2', unitPrice: '100.00', discountPercent: '10' }),
    ...overrides,
  });
}

async function newOwnerAndCustomer() {
  const owner = await registerOwner();
  const created = await runAction(
    createCustomerAction,
    formData({
      customerType: 'BUSINESS',
      businessName: 'Harbour Point Body Corporate',
      contactPerson: 'Palesa Dlamini',
      phone: '+27 21 555 0180',
      email: '',
    })
  );
  expectRedirect(created, '/app/customers/');
  const customerId = created.kind === 'redirect' ? created.url.split('/')[3]?.split('?')[0] : '';
  if (!customerId) throw new Error('Customer id missing from redirect');

  return { owner, customerId };
}

async function createQuoteFor(customerId: string, overrides: Record<string, string> = {}) {
  const outcome = await runAction(createQuoteAction, quoteForm(customerId, overrides));
  expectRedirect(outcome, '/app/quotes/');
  const quoteId = outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';
  if (!quoteId) throw new Error('Quote id missing from redirect');
  return quoteId;
}

describe('quotes', () => {
  beforeEach(async () => {
    await resetDatabase();
    clearRateLimits();
  });

  it('creates a quote with server-calculated totals', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId);

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote).not.toBeNull();
    expect(quote?.quote_number).toBe('QUOTE-0001');
    expect(quote?.status).toBe('DRAFT');
    // 2 x 100.00 = 200.00, less 10% = 20.00, VAT 15% on 180.00 = 27.00
    expect(quote?.subtotal).toBe('200.00');
    expect(quote?.discount_total).toBe('20.00');
    expect(quote?.tax_total).toBe('27.00');
    expect(quote?.total).toBe('207.00');
    expect(quote?.items).toHaveLength(1);
    expect(quote?.items[0]?.line_total).toBe('207.00');
    // Contact details default to the customer record.
    expect(quote?.contact_person).toBe('Palesa Dlamini');
    expect(quote?.contact_phone).toBe('+27 21 555 0180');
  });

  it('ignores totals posted by the browser and rejects impossible lines', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();

    const tampered = JSON.stringify([
      {
        productId: null,
        description: 'Distribution board',
        quantity: '1',
        unit: 'each',
        unitPrice: '100.00',
        discountPercent: '0',
        taxRate: '15',
        // Nothing below is part of the schema: these must be ignored.
        lineTotal: '0.01',
        total: '0.01',
        status: 'ACCEPTED',
      },
    ]);

    const outcome = await runAction(
      createQuoteAction,
      quoteForm(customerId, { items: tampered })
    );
    expectRedirect(outcome, '/app/quotes/');
    const quoteId = outcome.kind === 'redirect' ? (outcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote?.total).toBe('115.00');
    expect(quote?.status).toBe('DRAFT');

    const zeroQuantity = await runAction(
      createQuoteAction,
      quoteForm(customerId, {
        items: lines({ description: 'Labour', quantity: '0', unitPrice: '500.00' }),
      })
    );
    if (zeroQuantity.kind !== 'state' || zeroQuantity.state.status !== 'error') {
      throw new Error('Expected quantity zero to be rejected');
    }
    expect(zeroQuantity.state.message).toContain('highlighted lines');

    const empty = await runAction(createQuoteAction, quoteForm(customerId, { items: '[]' }));
    if (empty.kind !== 'state' || empty.state.status !== 'error') {
      throw new Error('Expected an empty quote to be rejected');
    }
  });

  it('numbers quotes per business and keeps sequences independent', async () => {
    const first = await newOwnerAndCustomer();
    await createQuoteFor(first.customerId);
    const second = await createQuoteFor(first.customerId);

    const secondQuote = await getQuote(first.owner.businessId, first.owner.userId, second);
    expect(secondQuote?.quote_number).toBe('QUOTE-0002');

    const other = await newOwnerAndCustomer();
    const otherQuoteId = await createQuoteFor(other.customerId);
    const otherQuote = await getQuote(other.owner.businessId, other.owner.userId, otherQuoteId);
    expect(otherQuote?.quote_number).toBe('QUOTE-0001');

    const sequences = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ business_id: string; next_number: number }>(
        `select business_id, next_number from public.document_sequences where doc_type = 'QUOTE'`
      );
      return rows;
    });
    // The first business issued two quotes, the other one — the sequences are
    // per business, not global.
    expect(sequences).toHaveLength(2);
    expect(sequences.map((row) => row.next_number).sort((a, b) => a - b)).toEqual([2, 3]);
  });

  it('snapshots catalogue prices so later edits cannot rewrite a quote', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();

    const catalogue = await runAction(
      createCatalogueItemAction,
      formData({
        kind: 'SERVICE',
        name: 'Distribution board replacement',
        defaultPrice: '4200.00',
        unit: 'each',
        taxRate: '15',
        isActive: 'true',
      })
    );
    expectRedirect(catalogue, '/app/catalogue');

    const catalogueItemId = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ id: string }>(
        `select id from public.products where business_id = $1 and name = $2`,
        [owner.businessId, 'Distribution board replacement']
      );
      return rows[0]?.id ?? '';
    });

    const quoteId = await createQuoteFor(customerId, {
      items: lines({
        productId: catalogueItemId,
        description: 'Distribution board replacement',
        quantity: '1',
        unitPrice: '4200.00',
      }),
    });

    const before = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(before?.items[0]?.unit_price).toBe('4200.00');

    // The catalogue price changes after the quote was written.
    await withAdminClient(async (client) => {
      await client.query(`update public.products set default_price = $2 where id = $1`, [
        catalogueItemId,
        '9999.00',
      ]);
    });

    const after = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(after?.items[0]?.unit_price).toBe('4200.00');
    expect(after?.total).toBe(before?.total);
  });

  it('replaces the lines of a draft and refuses to edit a sent quote', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId, {
      items: lines(
        { description: 'Distribution board', quantity: '1', unitPrice: '4200.00' },
        { description: 'Labour', quantity: '8', unitPrice: '650.00' }
      ),
    });

    const edited = await runAction(
      updateQuoteAction,
      quoteForm(customerId, {
        quoteId,
        items: lines({ description: 'Distribution board', quantity: '1', unitPrice: '4200.00' }),
      })
    );
    expectRedirect(edited, `/app/quotes/${quoteId}?saved=1`);

    const draft = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(draft?.items).toHaveLength(1);
    expect(draft?.subtotal).toBe('4200.00');
    expect(draft?.total).toBe('4830.00');

    // Sending locks it.
    const sentAt = await runFormAction(markQuoteSentAction, formData({ quoteId }));
    expectRedirect(sentAt, `/app/quotes/${quoteId}?sent=1`);

    const refused = await runAction(
      updateQuoteAction,
      quoteForm(customerId, { quoteId, items: lines({ description: 'Something else', quantity: '1', unitPrice: '1.00' }) })
    );
    if (refused.kind !== 'state' || refused.state.status !== 'error') {
      throw new Error('Expected editing a sent quote to be refused');
    }
    expect(refused.state.message).toContain('already been sent');

    const unchanged = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(unchanged?.items).toHaveLength(1);
    expect(unchanged?.items[0]?.description).toBe('Distribution board');
  });

  it('creates the customer link when a quote is marked sent', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId);

    const draft = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(draft?.public_token).toBeNull();

    await runFormAction(markQuoteSentAction, formData({ quoteId }));
    const sent = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(sent?.status).toBe('SENT');
    expect(sent?.sent_at).not.toBeNull();
    expect(sent?.public_token).toHaveLength(32);
  });

  it('lets the customer open the quote by token and records the acceptance', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId, {
      items: lines({ description: 'Garage DB board', quantity: '1', unitPrice: '4830.00' }),
    });

    const sent = await markQuoteSent(owner.businessId, owner.userId, quoteId);
    if (!sent.ok) throw new Error('Sending the quote failed');
    const token = sent.token;

    // What the customer sees: the document, and nothing internal.
    const publicQuote = await getPublicQuote(token);
    expect(publicQuote?.quote.quote_number).toBe('QUOTE-0001');
    expect(publicQuote?.items).toHaveLength(1);
    expect(publicQuote?.business.legal_name).toContain('Test Electrical');
    expect(JSON.stringify(publicQuote)).not.toContain(owner.businessId);
    expect(JSON.stringify(publicQuote)).not.toContain(token);

    const accepted = await runAction(
      respondToQuoteAction,
      formData({ token, decision: 'ACCEPT', name: 'Palesa Dlamini' })
    );
    if (accepted.kind !== 'state' || accepted.state.status !== 'success') {
      throw new Error('Expected the acceptance to succeed');
    }

    const after = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(after?.status).toBe('ACCEPTED');
    expect(after?.accepted_by_name).toBe('Palesa Dlamini');
    expect(after?.accepted_at).not.toBeNull();

    const ipRow = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ accepted_ip: string | null }>(
        `select host(accepted_ip) as accepted_ip from public.quotes where id = $1`,
        [quoteId]
      );
      return rows[0];
    });
    expect(ipRow?.accepted_ip).toBe('10.0.0.1');

    const audit = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ event_type: string; metadata: Record<string, unknown> }>(
        `select event_type, metadata from public.audit_events
          where business_id = $1 and entity_id = $2 order by created_at`,
        [owner.businessId, quoteId]
      );
      return rows;
    });
    expect(audit.map((row) => row.event_type)).toEqual([
      'quote.created',
      'quote.sent',
      'quote.accepted',
    ]);
    expect(audit[2]?.metadata.accepted_by).toBe('Palesa Dlamini');

    // A second answer is refused, and the quote can no longer be edited.
    const second = await runAction(
      respondToQuoteAction,
      formData({ token, decision: 'ACCEPT', name: 'Someone Else' })
    );
    if (second.kind !== 'state' || second.state.status !== 'error') {
      throw new Error('Expected a second acceptance to be refused');
    }

    const locked = await runAction(
      updateQuoteAction,
      quoteForm(customerId, { quoteId, items: lines({ description: 'Changed', quantity: '1', unitPrice: '1.00' }) })
    );
    if (locked.kind !== 'state' || locked.state.status !== 'error') {
      throw new Error('Expected an accepted quote to be locked');
    }
  });

  it('records a decline with its reason and blocks acceptance afterwards', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId);
    const sent = await markQuoteSent(owner.businessId, owner.userId, quoteId);
    if (!sent.ok) throw new Error('Sending the quote failed');

    const declined = await runAction(
      respondToQuoteAction,
      formData({
        token: sent.token,
        decision: 'DECLINE',
        reason: 'The price is above our budget this quarter.',
      })
    );
    if (declined.kind !== 'state' || declined.state.status !== 'success') {
      throw new Error('Expected the decline to be recorded');
    }

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote?.status).toBe('DECLINED');
    expect(quote?.declined_reason).toBe('The price is above our budget this quarter.');

    const lateAccept = await runAction(
      respondToQuoteAction,
      formData({ token: sent.token, decision: 'ACCEPT', name: 'Palesa Dlamini' })
    );
    if (lateAccept.kind !== 'state' || lateAccept.state.status !== 'error') {
      throw new Error('Expected acceptance of a declined quote to be refused');
    }
  });

  it('refuses acceptance of a quote past its validity date and marks it expired', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId, {
      issueDate: '2020-01-02',
      validUntil: '2020-01-31',
    });

    const sent = await markQuoteSent(owner.businessId, owner.userId, quoteId);
    if (!sent.ok) throw new Error('Sending the quote failed');

    const attempt = await runAction(
      respondToQuoteAction,
      formData({ token: sent.token, decision: 'ACCEPT', name: 'Palesa Dlamini' })
    );
    if (attempt.kind !== 'state' || attempt.state.status !== 'error') {
      throw new Error('Expected an expired quote to refuse acceptance');
    }
    expect(attempt.state.message).toContain('validity date');

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote?.status).toBe('EXPIRED');
    expect(effectiveQuoteStatus(quote?.status ?? 'DRAFT', quote?.valid_until ?? null)).toBe('EXPIRED');
  });

  it('shows a stale quote as expired even before anything writes the status', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId, {
      issueDate: '2020-01-02',
      validUntil: '2020-01-31',
    });
    await markQuoteSent(owner.businessId, owner.userId, quoteId);

    const { rows } = await listQuotes(owner.businessId, owner.userId, { status: 'ALL' });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.status).toBe('SENT');
    expect(effectiveQuoteStatus(rows[0]!.status, rows[0]!.valid_until)).toBe('EXPIRED');

    const expiredOnly = await listQuotes(owner.businessId, owner.userId, { status: 'EXPIRED' });
    expect(expiredOnly.rows).toHaveLength(1);

    const openOnly = await listQuotes(owner.businessId, owner.userId, { status: 'OPEN' });
    expect(openOnly.rows).toHaveLength(0);
  });

  it('keeps one business out of another business’s quotes', async () => {
    const first = await newOwnerAndCustomer();
    const firstQuoteId = await createQuoteFor(first.customerId);

    const second = await newOwnerAndCustomer();

    expect(await getQuote(second.owner.businessId, second.owner.userId, firstQuoteId)).toBeNull();

    const list = await listQuotes(second.owner.businessId, second.owner.userId, { status: 'ALL' });
    expect(list.rows).toHaveLength(0);

    const foreignUpdate = await runAction(
      updateQuoteAction,
      quoteForm(second.customerId, {
        quoteId: firstQuoteId,
        items: lines({ description: 'Hijacked line', quantity: '1', unitPrice: '1.00' }),
      })
    );
    if (foreignUpdate.kind !== 'state' || foreignUpdate.state.status !== 'error') {
      throw new Error('Expected a foreign quote update to be refused');
    }

    // The repository, called with the other business's context, cannot send it
    // either — the same path the Server Action uses.
    const foreignSend = await markQuoteSent(second.owner.businessId, second.owner.userId, firstQuoteId);
    expect(foreignSend.ok).toBe(false);

    const sent = await markQuoteSent(first.owner.businessId, first.owner.userId, firstQuoteId);
    expect(sent.ok).toBe(true);

    const untouched = await getQuote(first.owner.businessId, first.owner.userId, firstQuoteId);
    expect(untouched?.status).toBe('SENT');
    expect(untouched?.items[0]?.description).toBe('Distribution board');
  });

  it('duplicates a quote into a new draft without touching the original', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId);
    await markQuoteSent(owner.businessId, owner.userId, quoteId);

    const outcome = await runFormAction(duplicateQuoteAction, formData({ quoteId }));
    expectRedirect(outcome, '/app/quotes/');
    const copyUrl = outcome.kind === 'redirect' ? outcome.url : '';
    expect(copyUrl).toContain('?duplicated=1');
    const copyId = copyUrl.split('/')[3]?.split('?')[0] ?? '';

    const copy = await getQuote(owner.businessId, owner.userId, copyId);
    expect(copy?.status).toBe('DRAFT');
    expect(copy?.quote_number).toBe('QUOTE-0002');
    expect(copy?.items).toHaveLength(1);
    expect(copy?.total).toBe('207.00');
    expect(copy?.public_token).toBeNull();

    const original = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(original?.status).toBe('SENT');
    expect(original?.quote_number).toBe('QUOTE-0001');
  });

  it('records a decision taken offline, and insists on a reason for a decline', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId);
    await runFormAction(markQuoteSentAction, formData({ quoteId }));

    const withoutReason = await runFormAction(
      setQuoteStatusAction,
      formData({ quoteId, status: 'DECLINED', note: '' })
    );
    expectRedirect(withoutReason, `/app/quotes/${quoteId}?statusError=reason_required`);

    const accepted = await runFormAction(
      setQuoteStatusAction,
      formData({ quoteId, status: 'ACCEPTED', note: 'Palesa Dlamini, site foreman' })
    );
    expectRedirect(accepted, `/app/quotes/${quoteId}?statusUpdated=accepted`);

    const quote = await getQuote(owner.businessId, owner.userId, quoteId);
    expect(quote?.status).toBe('ACCEPTED');
    expect(quote?.accepted_by_name).toBe('Palesa Dlamini, site foreman');

    const events = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ metadata: Record<string, unknown> }>(
        `select metadata from public.audit_events
          where business_id = $1 and entity_id = $2 and event_type = 'quote.accepted'`,
        [owner.businessId, quoteId]
      );
      return rows;
    });
    expect(events[0]?.metadata.recorded_by).toBe('staff');
  });

  it('moves the job to Quoted when a quote is written for it', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();

    const jobOutcome = await runAction(
      createJobAction,
      formData({ customerId, title: 'Garage DB board replacement', status: 'LEAD' })
    );
    expectRedirect(jobOutcome, '/app/jobs/');
    const jobId = jobOutcome.kind === 'redirect' ? (jobOutcome.url.split('/')[3]?.split('?')[0] ?? '') : '';

    await createQuoteFor(customerId, { jobId });

    const job = await getJob(owner.businessId, owner.userId, jobId);
    expect(job?.status).toBe('QUOTED');

    const events = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ event_type: string; metadata: Record<string, unknown> }>(
        `select event_type, metadata from public.audit_events
          where business_id = $1 and entity_type = 'job' and event_type = 'job.status_changed'`,
        [owner.businessId]
      );
      return rows;
    });
    expect(events[0]?.metadata.to).toBe('QUOTED');
    expect(events[0]?.metadata.because).toBe('quote_created');
  });

  it('renders the stored quote as a PDF an office printer can handle', async () => {
    const { owner, customerId } = await newOwnerAndCustomer();
    const quoteId = await createQuoteFor(customerId, {
      items: lines({ description: 'Earth leakage relay, 63A', quantity: '2', unitPrice: '1450.00' }),
    });
    await markQuoteSent(owner.businessId, owner.userId, quoteId);

    const rendered = await renderQuotePdfForBusiness(
      owner.businessId,
      owner.userId,
      quoteId,
      'Test Contractor'
    );
    if (!rendered) throw new Error('The PDF was not rendered');

    const text = pdfTextJoined(rendered.pdf);
    expect(text).toContain('QUOTE-0001');
    expect(text).toContain('Harbour Point Body Corporate');
    expect(text).toContain('Earth leakage relay, 63A');
    expect(text).toContain('R 3 335,00');
    expect(text).toContain('Test Contractor');
    expect(pdfTextJoined(rendered.pdf)).toContain('Issued 01 Sept 2026');

    const foreign = await registerOwner();
    expect(
      await renderQuotePdfForBusiness(foreign.businessId, foreign.userId, quoteId, null)
    ).toBeNull();
  });
});
