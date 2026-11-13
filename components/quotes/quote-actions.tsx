import Link from 'next/link';
import { convertQuoteToInvoiceAction } from '@/lib/actions/invoices';
import {
  duplicateQuoteAction,
  markQuoteSentAction,
  setQuoteStatusAction,
} from '@/lib/actions/quotes';
import { effectiveQuoteStatus, quoteStatusActionLabel } from '@/lib/quotes';
import type { QuoteStatus } from '@/lib/quotes';
import { Button, ButtonLink } from '@/components/ui/button';
import { CopyField } from '@/components/quotes/copy-field';

/**
 * The actions a contractor can take on a quote.
 *
 * Only the transitions the status machine allows are rendered, and the Server
 * Actions re-check them: a form crafted in the browser cannot accept a quote
 * that was already declined, or convert a quote that was not accepted.
 * Conversion is the one action that lives with the invoice actions: it is the
 * bridge between the two documents.
 */
export function QuoteActions({
  quoteId,
  status,
  validUntil,
  publicToken,
  publicUrlBase,
  canEdit,
}: {
  quoteId: string;
  status: QuoteStatus;
  validUntil: string | null;
  publicToken: string | null;
  publicUrlBase: string;
  canEdit: boolean;
}) {
  const effective = effectiveQuoteStatus(status, validUntil);
  const returnTo = `/app/quotes/${quoteId}`;

  const isOpen = status === 'SENT' || status === 'VIEWED';

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {status === 'DRAFT' ? (
          <form action={markQuoteSentAction}>
            <input type="hidden" name="quoteId" value={quoteId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit">Mark as sent</Button>
          </form>
        ) : null}

        {canEdit ? <ButtonLink href={`/app/quotes/${quoteId}/edit`}>Edit draft</ButtonLink> : null}

        <ButtonLink href={`/app/quotes/${quoteId}/pdf`} variant="secondary">
          Download PDF
        </ButtonLink>

        <form action={duplicateQuoteAction}>
          <input type="hidden" name="quoteId" value={quoteId} />
          <Button type="submit" variant="secondary">
            Duplicate
          </Button>
        </form>

        {status === 'ACCEPTED' ? (
          <form action={convertQuoteToInvoiceAction}>
            <input type="hidden" name="quoteId" value={quoteId} />
            <input type="hidden" name="returnTo" value={returnTo} />
            <Button type="submit">Convert to invoice</Button>
          </form>
        ) : null}
      </div>

      {isOpen ? (
        <details className="rounded-lg border border-ink-700 p-3">
          <summary className="cursor-pointer text-sm font-semibold text-steel-200">
            Record a decision taken offline
          </summary>
          <p className="cg-hint">
            For a go-ahead given on site or over the phone. The customer can also accept through the
            link below, which records their name, the time and their IP address.
          </p>

          <div className="mt-3 grid gap-3 sm:grid-cols-2">
            <form action={setQuoteStatusAction} className="space-y-2">
              <input type="hidden" name="quoteId" value={quoteId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="status" value="ACCEPTED" />
              <label className="cg-label" htmlFor="accepted-note">
                Who gave the go-ahead (optional)
              </label>
              <input
                id="accepted-note"
                name="note"
                className="cg-input"
                maxLength={120}
                placeholder="Palesa Dlamini, site foreman"
              />
              <Button type="submit" variant="secondary" size="sm">
                {quoteStatusActionLabel('ACCEPTED')}
              </Button>
            </form>

            <form action={setQuoteStatusAction} className="space-y-2">
              <input type="hidden" name="quoteId" value={quoteId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="status" value="DECLINED" />
              <label className="cg-label" htmlFor="declined-reason">
                Why it was declined (required)
              </label>
              <input
                id="declined-reason"
                name="note"
                className="cg-input"
                maxLength={400}
                placeholder="Went with another contractor"
                required
              />
              <Button type="submit" variant="danger" size="sm">
                {quoteStatusActionLabel('DECLINED')}
              </Button>
            </form>
          </div>

          {status === 'SENT' || status === 'VIEWED' ? (
            <form action={setQuoteStatusAction} className="mt-3">
              <input type="hidden" name="quoteId" value={quoteId} />
              <input type="hidden" name="returnTo" value={returnTo} />
              <input type="hidden" name="status" value="EXPIRED" />
              <Button type="submit" variant="ghost" size="sm">
                {quoteStatusActionLabel('EXPIRED')}
              </Button>
            </form>
          ) : null}
        </details>
      ) : null}

      {effective === 'EXPIRED' && status !== 'EXPIRED' ? (
        <p className="rounded-lg border border-signal-danger/40 bg-signal-danger/10 px-3 py-2 text-sm text-signal-danger">
          This quote passed its validity date, so the customer can no longer accept it online. Record
          a decision or duplicate it into a new quote.
        </p>
      ) : null}

      {publicToken && isOpen ? (
        <CopyField
          value={`${publicUrlBase}/q/${publicToken}`}
          label="Customer link"
          hint="Send this to the customer. They can read the quote, download the PDF and accept or decline it — they cannot change a price."
        />
      ) : null}

      {!publicToken && status === 'DRAFT' ? (
        <p className="cg-hint">
          The customer link is created when you mark the quote as sent. Nothing is visible to the
          customer before that.
        </p>
      ) : null}

      {status === 'ACCEPTED' ? (
        <p className="rounded-lg border border-signal-success/40 bg-signal-success/10 px-3 py-2 text-sm text-signal-success">
          This quote is accepted. <strong>Convert to invoice</strong> above copies every line and
          total into a new draft invoice and marks this quote converted — the accepted quote stays
          exactly as the customer saw it.
        </p>
      ) : null}

      {status === 'CONVERTED' ? (
        <p className="rounded-lg border border-signal-info/40 bg-signal-info/10 px-3 py-2 text-sm text-steel-300">
          This quote has been converted to an invoice. The document the customer accepted is frozen
          here for your records.{' '}
          <Link href="/app/invoices" className="underline hover:text-paper">
            Open invoices
          </Link>
        </p>
      ) : null}

      <p className="text-xs text-steel-500">
        Quotes are never deleted: an issued quote is the record of what the customer was offered.{' '}
        <Link href="/app/quotes" className="underline hover:text-paper">
          Back to quotes
        </Link>
      </p>
    </div>
  );
}
