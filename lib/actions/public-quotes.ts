'use server';

import { revalidatePath } from 'next/cache';
import { requestMetadata } from '@/lib/auth/current-user';
import { respondToPublicQuote } from '@/lib/repositories/public-quotes';
import { quoteResponseSchema } from '@/lib/validation/schemas';
import { checkRateLimit } from '@/lib/security/rate-limit';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  successState,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * The customer's side of a quote.
 *
 * This is the only unauthenticated write in the product. What a visitor may
 * send is deliberately tiny: a decision, a name and an optional note. There is
 * no field for a price, a line, a total or a status, and the database function
 * behind it re-checks that the quote is still open and within its validity
 * period. Acceptance is recorded with the timestamp, the name and the IP.
 *
 * It is rate limited per IP because, unlike the rest of the app, there is no
 * account to throttle.
 */
export async function respondToQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = quoteResponseSchema.safeParse({
    token: readString(formData, 'token'),
    decision: readString(formData, 'decision').toUpperCase(),
    name: readString(formData, 'name'),
    reason: readString(formData, 'reason'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const { token, decision, name, reason } = parsed.data;

  let metadata: { ipAddress: string | null; userAgent: string | null };
  try {
    metadata = await requestMetadata();
  } catch {
    metadata = { ipAddress: null, userAgent: null };
  }

  const limit = checkRateLimit(`public-quote:${metadata.ipAddress ?? 'unknown'}`, {
    limit: 12,
    windowMs: 15 * 60 * 1000,
  });

  if (!limit.allowed) {
    return errorState(
      'That is a lot of attempts in a short time. Please try again in a few minutes.'
    );
  }

  try {
    const result = await respondToPublicQuote(token, decision, {
      name,
      reason,
      ipAddress: metadata.ipAddress,
      userAgent: metadata.userAgent,
    });

    if (result.ok) {
      revalidatePath(`/q/${token}`);
      return successState(
        result.code === 'accepted'
          ? 'Thank you — the quote is accepted. The contractor has been notified and a copy of the accepted quote is available below.'
          : 'Thank you — we have recorded that the quote was not accepted.'
      );
    }

    switch (result.code) {
      case 'expired':
        return errorState(
          'This quote has passed its validity date, so it can no longer be accepted online. Ask the contractor for an updated quote.'
        );
      case 'not_open':
        return errorState(
          'This quote has already been answered. If something has changed, contact the contractor directly.'
        );
      case 'name_required':
        return errorState('Please enter your name so the acceptance can be recorded.', {
          name: ['Enter your name'],
        });
      case 'not_found':
        return errorState('That quote link is not valid any more.');
      default:
        return errorState('We could not record your answer. Please try again.');
    }
  } catch (error) {
    return unexpectedError('public-quote.respond', error);
  }
}
