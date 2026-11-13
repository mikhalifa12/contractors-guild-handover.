'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import {
  createQuote,
  duplicateQuote,
  markQuoteSent,
  recordQuoteStatus,
  updateQuote,
  type QuoteInput,
} from '@/lib/repositories/quotes';
import {
  quoteItemsSchema,
  quoteSchema,
  type QuoteFormValues,
  type QuoteItemFormValues,
} from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Quote Server Actions.
 *
 * Two rules run through all of them:
 *  - the totals a quote is worth are computed on the server from the validated
 *    lines. Nothing the browser posts (totals, line amounts, status) is stored.
 *  - a quote that has left DRAFT is a document the customer has seen. Only a
 *    draft can be edited; revisions go through duplicateQuoteAction(), which
 *    leaves the issued document untouched.
 */
function parseItems(formData: FormData): {
  items?: QuoteItemFormValues[];
  error?: ActionState;
} {
  const raw = readString(formData, 'items');
  if (!raw.trim()) {
    return { error: errorState('Add at least one line to the quote.', { items: ['The quote has no lines'] }) };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return { error: errorState('Those quote lines could not be read. Rebuild the quote and try again.') };
  }

  const parsed = quoteItemsSchema.safeParse(parsedJson);
  if (!parsed.success) {
    const fieldErrors = fieldErrorsFromZod(parsed.error);
    return {
      error: errorState(
        'Please check the highlighted lines — every line needs a description, a quantity above zero and a price.',
        fieldErrors
      ),
    };
  }

  return { items: parsed.data };
}

function toRepositoryInput(
  header: QuoteFormValues,
  items: QuoteItemFormValues[]
): QuoteInput {
  return {
    customerId: header.customerId,
    jobId: header.jobId ?? null,
    issueDate: header.issueDate,
    validUntil: header.validUntil ?? null,
    contactPerson: header.contactPerson ?? null,
    contactPhone: header.contactPhone ?? null,
    contactEmail: header.contactEmail ?? null,
    jobType: header.jobType ?? null,
    jobAddressLine1: header.jobAddressLine1 ?? null,
    jobAddressLine2: header.jobAddressLine2 ?? null,
    jobCity: header.jobCity ?? null,
    jobProvince: header.jobProvince ?? null,
    jobPostalCode: header.jobPostalCode ?? null,
    description: header.description ?? null,
    paymentTerms: header.paymentTerms ?? null,
    notes: header.notes ?? null,
    termsAndConditions: header.termsAndConditions ?? null,
    items: items.map((item) => ({
      productId: item.productId ?? null,
      description: item.description,
      quantity: item.quantity,
      unit: item.unit,
      unitPrice: item.unitPrice,
      discountPercent: item.discountPercent,
      taxRate: item.taxRate,
    })),
  };
}

function parseHeader(formData: FormData) {
  return quoteSchema.safeParse({
    customerId: readString(formData, 'customerId'),
    jobId: readString(formData, 'jobId'),
    issueDate: readString(formData, 'issueDate'),
    validUntil: readString(formData, 'validUntil'),
    contactPerson: readString(formData, 'contactPerson'),
    contactPhone: readString(formData, 'contactPhone'),
    contactEmail: readString(formData, 'contactEmail'),
    jobType: readString(formData, 'jobType'),
    jobAddressLine1: readString(formData, 'jobAddressLine1'),
    jobAddressLine2: readString(formData, 'jobAddressLine2'),
    jobCity: readString(formData, 'jobCity'),
    jobProvince: readString(formData, 'jobProvince'),
    jobPostalCode: readString(formData, 'jobPostalCode'),
    description: readString(formData, 'description'),
    paymentTerms: readString(formData, 'paymentTerms'),
    notes: readString(formData, 'notes'),
    termsAndConditions: readString(formData, 'termsAndConditions'),
  });
}

export async function createQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const header = parseHeader(formData);
  if (!header.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(header.error));
  }

  const items = parseItems(formData);
  if (!items.items) return items.error ?? errorState('Add at least one line to the quote.');

  let quoteId: string;
  try {
    const metadata = await requestMetadata();
    const created = await createQuote(
      session.businessId,
      session.userId,
      toRepositoryInput(header.data, items.items),
      { ipAddress: metadata.ipAddress }
    );

    if (!created.ok) {
      return errorState('We could not save that quote. Please try again.');
    }
    quoteId = created.id;
  } catch (error) {
    return unexpectedError('quote.create', error);
  }

  revalidatePath('/app/quotes');
  revalidatePath('/app');
  redirect(`/app/quotes/${quoteId}?created=1`);
}

export async function updateQuoteAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const quoteId = readString(formData, 'quoteId');

  if (!quoteId) {
    return errorState('Missing quote reference. Reload the page and try again.');
  }

  const header = parseHeader(formData);
  if (!header.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(header.error));
  }

  const items = parseItems(formData);
  if (!items.items) return items.error ?? errorState('Add at least one line to the quote.');

  try {
    const metadata = await requestMetadata();
    const result = await updateQuote(
      session.businessId,
      session.userId,
      quoteId,
      toRepositoryInput(header.data, items.items),
      { ipAddress: metadata.ipAddress }
    );

    if (!result.ok) {
      return errorState(
        result.reason === 'not_draft'
          ? 'This quote has already been sent, so its lines are locked. Duplicate it to make a revised quote.'
          : 'That quote no longer exists in your business.'
      );
    }
  } catch (error) {
    return unexpectedError('quote.update', error);
  }

  revalidatePath('/app/quotes');
  revalidatePath(`/app/quotes/${quoteId}`);
  redirect(`/app/quotes/${quoteId}?saved=1`);
}

/** Mark a draft as sent: this is what creates the customer's public link. */
export async function markQuoteSentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const quoteId = readString(formData, 'quoteId');
  const returnTo = readString(formData, 'returnTo') || `/app/quotes/${quoteId}`;

  if (!quoteId) redirect('/app/quotes?missing=1');

  let failure: 'not_draft' | 'failed' | null = null;

  try {
    const metadata = await requestMetadata();
    const result = await markQuoteSent(session.businessId, session.userId, quoteId, {
      ipAddress: metadata.ipAddress,
    });
    if (!result.ok) failure = result.reason === 'not_draft' ? 'not_draft' : 'failed';
  } catch (error) {
    unexpectedError('quote.send', error);
    failure = 'failed';
  }

  if (failure) redirect(`${returnTo}?statusError=${failure}`);

  revalidatePath('/app/quotes');
  revalidatePath(`/app/quotes/${quoteId}`);
  redirect(`${returnTo}?sent=1`);
}

/**
 * Staff-recorded decisions: a contractor who took the go-ahead over the phone
 * records it here. Customer-driven acceptance writes through the public page.
 */
export async function setQuoteStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const quoteId = readString(formData, 'quoteId');
  const requested = readString(formData, 'status').toUpperCase();
  const note = readString(formData, 'note').trim();
  const returnTo = readString(formData, 'returnTo') || `/app/quotes/${quoteId}`;

  if (!quoteId || (requested !== 'ACCEPTED' && requested !== 'DECLINED' && requested !== 'EXPIRED')) {
    redirect(returnTo);
  }

  if (requested === 'DECLINED' && note.length === 0) {
    redirect(`${returnTo}?statusError=reason_required`);
  }

  let failure: 'not_allowed' | 'failed' | null = null;

  try {
    const metadata = await requestMetadata();
    const result = await recordQuoteStatus(session.businessId, session.userId, quoteId, requested, {
      acceptedByName: requested === 'ACCEPTED' ? note || `Recorded by ${session.fullName}` : null,
      declinedReason: requested === 'DECLINED' ? note : null,
      ipAddress: metadata.ipAddress,
    });

    if (!result.ok) failure = result.reason === 'not_allowed' ? 'not_allowed' : 'failed';
  } catch (error) {
    unexpectedError('quote.status', error);
    failure = 'failed';
  }

  if (failure) redirect(`${returnTo}?statusError=${failure}`);

  revalidatePath('/app/quotes');
  revalidatePath(`/app/quotes/${quoteId}`);
  revalidatePath('/app');
  redirect(`${returnTo}?statusUpdated=${requested.toLowerCase()}`);
}

/** Copy a quote (header and lines) into a fresh draft with a new number. */
export async function duplicateQuoteAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const quoteId = readString(formData, 'quoteId');

  if (!quoteId) redirect('/app/quotes?missing=1');

  let newId: string | null = null;
  try {
    const metadata = await requestMetadata();
    const result = await duplicateQuote(session.businessId, session.userId, quoteId, {
      ipAddress: metadata.ipAddress,
    });
    newId = result.ok ? result.id : null;
  } catch (error) {
    unexpectedError('quote.duplicate', error);
  }

  if (!newId) redirect(`/app/quotes/${quoteId}?statusError=failed`);

  revalidatePath('/app/quotes');
  redirect(`/app/quotes/${newId}?duplicated=1`);
}
