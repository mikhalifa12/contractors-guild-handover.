'use client';

import { useActionState } from 'react';
import { respondToQuoteAction } from '@/lib/actions/public-quotes';
import { firstError, initialActionState, type ActionState } from '@/lib/actions/state';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';

/**
 * The customer's accept / decline form.
 *
 * There is deliberately no price, quantity or total field anywhere in this
 * component: the customer can reply, and nothing else. The acceptance record
 * (name, timestamp, IP) is written by the database function, so the document
 * the customer accepted is the document that stays on file.
 */
export function QuoteResponseForm({
  token,
  status,
  alreadyAnswered,
  canRespond,
  blockedReason,
  acceptedByName,
}: {
  token: string;
  status: string;
  alreadyAnswered: boolean;
  canRespond: boolean;
  blockedReason: 'expired' | 'not_open' | null;
  acceptedByName: string | null;
}) {
  const [acceptState, acceptAction] = useActionState<ActionState, FormData>(
    respondToQuoteAction,
    initialActionState
  );
  const [declineState, declineAction] = useActionState<ActionState, FormData>(
    respondToQuoteAction,
    initialActionState
  );

  if (alreadyAnswered) {
    return (
      <div className="rounded-xl border border-signal-success/40 bg-signal-success/10 p-4">
        <p className="cg-eyebrow text-signal-success">Answered</p>
        <p className="mt-1 text-sm text-steel-200">
          {status === 'ACCEPTED'
            ? `This quote was accepted${acceptedByName ? ` by ${acceptedByName}` : ''}. The contractor has been notified.`
            : 'This quote was previously declined. Contact the contractor if you would like a revised quote.'}
        </p>
      </div>
    );
  }

  if (!canRespond) {
    return (
      <div className="rounded-xl border border-signal-warning/40 bg-signal-warning/10 p-4 text-sm text-signal-warning">
        {blockedReason === 'expired'
          ? 'This quote has passed its validity date. Ask the contractor for an updated quote.'
          : 'This quote can no longer be answered online. Please contact the contractor directly.'}
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <form action={acceptAction} className="space-y-3 rounded-xl border border-ember-500/40 bg-ember-500/5 p-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="decision" value="ACCEPT" />

        <div>
          <h2 className="cg-display text-lg text-paper">Accept this quote</h2>
          <p className="mt-1 text-sm text-steel-400">
            Your acceptance is recorded with your name, the date and time, and the network address
            the quote was opened from. The prices above are locked at that moment.
          </p>
        </div>

        <FormMessage state={acceptState} />

        <div>
          <label className="cg-label" htmlFor="accept-name">
            Your full name <span className="text-ember-400">*</span>
          </label>
          <input
            id="accept-name"
            name="name"
            className="cg-input"
            required
            maxLength={120}
            autoComplete="name"
            aria-invalid={Boolean(firstError(acceptState, 'name')) || undefined}
            placeholder="Palesa Dlamini"
          />
          {firstError(acceptState, 'name') ? (
            <p className="cg-error" role="alert">
              {firstError(acceptState, 'name')}
            </p>
          ) : null}
        </div>

        <SubmitButton pendingLabel="Recording…">Accept quote</SubmitButton>
      </form>

      <form action={declineAction} className="space-y-3 rounded-xl border border-ink-700 p-4">
        <input type="hidden" name="token" value={token} />
        <input type="hidden" name="decision" value="DECLINE" />

        <div>
          <h2 className="text-sm font-semibold text-steel-200">Not going ahead?</h2>
          <p className="mt-1 text-sm text-steel-500">
            Tell the contractor why, if you would like to. They may be able to revise the quote.
          </p>
        </div>

        <FormMessage state={declineState} />

        <div>
          <label className="cg-label" htmlFor="decline-reason">
            Reason (optional)
          </label>
          <textarea
            id="decline-reason"
            name="reason"
            rows={2}
            maxLength={400}
            className="cg-textarea"
            placeholder="The price is above our budget this quarter."
          />
        </div>

        <SubmitButton variant="secondary" pendingLabel="Recording…">
          Decline quote
        </SubmitButton>
      </form>
    </div>
  );
}
