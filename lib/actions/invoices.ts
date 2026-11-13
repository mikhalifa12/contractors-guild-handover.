'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import {
  convertInvoiceFromQuote,
  createInvoice,
  markInvoiceSent,
  recordInvoiceStatus,
  updateInvoice,
} from '@/lib/repositories/invoices';
import {
  invoiceItemsSchema,
  invoiceSchema,
  type InvoiceFormValues,
  type InvoiceItemFormValues,
} from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Invoice Server Actions.
 *
 * The same two rules as the quote actions:
 *  - the totals an invoice is worth are computed on the server from the
 *    validated lines; nothing the browser posts (totals, line amounts) is
 *    stored
 *  - an invoice that has left DRAFT is a document the customer owes against.
 *    Only a draft can be edited; conversion copies the accepted quote instead
 *    of reopening it.
 *
 * The quote -> invoice conversion NEVER accepts a quote id from the create
 * form: it goes through convertQuoteToInvoiceAction, which locks the quote,
 * requires ACCEPTED and is backed by the one-invoice-per-quote unique index.
 */
function parseItems(formData: FormData): {
  items?: InvoiceItemFormValues[];
  error?: ActionState;
} {
  const raw = readString(formData, 'items');
  if (!raw.trim()) {
    return {
      error: errorState('Add at least one line to the invoice.', {
        items: ['The invoice has no lines'],
      }),
    };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(raw);
  } catch {
    return {
      error: errorState('Those invoice lines could not be read. Rebuild them and try again.'),
    };
  }

  const parsed = invoiceItemsSchema.safeParse(parsedJson);
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

function parseHeader(formData: FormData) {
  return invoiceSchema.safeParse({
    customerId: readString(formData, 'customerId'),
    jobId: readString(formData, 'jobId'),
    issueDate: readString(formData, 'issueDate'),
    dueDate: readString(formData, 'dueDate'),
    contactPerson: readString(formData, 'contactPerson'),
    contactPhone: readString(formData, 'contactPhone'),
    contactEmail: readString(formData, 'contactEmail'),
    preparedBy: readString(formData, 'preparedBy'),
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

function toRepositoryInput(
  header: InvoiceFormValues,
  items: InvoiceItemFormValues[]
) {
  return {
    customerId: header.customerId,
    jobId: header.jobId ?? null,
    issueDate: header.issueDate,
    dueDate: header.dueDate ?? null,
    preparedBy: header.preparedBy ?? null,
    contactPerson: header.contactPerson ?? null,
    contactPhone: header.contactPhone ?? null,
    contactEmail: header.contactEmail ?? null,
    jobType: header.jobType ?? null,
    jobAddressLine1: header.jobAddressLine1 ?? null,
    jobAddressLine2: header.jobAddressLine2 ?? null,
    jobCity: header.jobCity ?? null,
    jobProvince: header.jobProvince ?? null,
    jobPostalCode: header.jobPostalCode ?? null,
    billingAddressLine1: null,
    billingAddressLine2: null,
    billingCity: null,
    billingProvince: null,
    billingPostalCode: null,
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

export async function createInvoiceAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  // A quote id posted from the browser is ignored on purpose: the only route
  // from a quote to an invoice is the conversion action below.
  void readString(formData, 'quoteId');

  const header = parseHeader(formData);
  if (!header.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(header.error));
  }

  const items = parseItems(formData);
  if (!items.items) return items.error ?? errorState('Add at least one line to the invoice.');

  let invoiceId: string;
  try {
    const metadata = await requestMetadata();
    const created = await createInvoice(
      session.businessId,
      session.userId,
      toRepositoryInput(header.data, items.items),
      { ipAddress: metadata.ipAddress }
    );

    if (!created.ok) {
      return errorState('We could not save that invoice. Please try again.');
    }
    invoiceId = created.id;
  } catch (error) {
    return unexpectedError('invoice.create', error);
  }

  revalidatePath('/app/invoices');
  revalidatePath('/app');
  redirect(`/app/invoices/${invoiceId}?created=1`);
}

export async function updateInvoiceAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();
  const invoiceId = readString(formData, 'invoiceId');

  if (!invoiceId) {
    return errorState('Missing invoice reference. Reload the page and try again.');
  }

  const header = parseHeader(formData);
  if (!header.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(header.error));
  }

  const items = parseItems(formData);
  if (!items.items) return items.error ?? errorState('Add at least one line to the invoice.');

  try {
    const metadata = await requestMetadata();
    const result = await updateInvoice(
      session.businessId,
      session.userId,
      invoiceId,
      toRepositoryInput(header.data, items.items),
      { ipAddress: metadata.ipAddress }
    );

    if (!result.ok) {
      return errorState(
        result.reason === 'not_draft'
          ? 'This invoice has already been sent, so its lines are locked.'
          : 'That invoice no longer exists in your business.'
      );
    }
  } catch (error) {
    return unexpectedError('invoice.update', error);
  }

  revalidatePath('/app/invoices');
  revalidatePath(`/app/invoices/${invoiceId}`);
  redirect(`/app/invoices/${invoiceId}?saved=1`);
}

/** Mark a draft as sent: this is what makes it a document the customer owes. */
export async function markInvoiceSentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = readString(formData, 'invoiceId');
  const returnTo = readString(formData, 'returnTo') || `/app/invoices/${invoiceId}`;

  if (!invoiceId) redirect('/app/invoices?missing=1');

  let failure: 'not_found' | 'not_draft' | 'failed' | null = null;

  try {
    const metadata = await requestMetadata();
    const result = await markInvoiceSent(session.businessId, session.userId, invoiceId, {
      ipAddress: metadata.ipAddress,
    });
    if (!result.ok) failure = result.reason;
  } catch (error) {
    unexpectedError('invoice.send', error);
    failure = 'failed';
  }

  if (failure) redirect(`${returnTo}?statusError=${failure}`);

  revalidatePath('/app/invoices');
  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath('/app');
  redirect(`${returnTo}?sent=1`);
}

/** Staff status changes after sending: cancel is the only manual move. */
export async function setInvoiceStatusAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const invoiceId = readString(formData, 'invoiceId');
  const requested = readString(formData, 'status').toUpperCase();
  const returnTo = readString(formData, 'returnTo') || `/app/invoices/${invoiceId}`;

  if (!invoiceId || (requested !== 'CANCELLED' && requested !== 'SENT')) {
    redirect(returnTo);
  }

  let failure: 'not_allowed' | 'failed' | null = null;

  try {
    const metadata = await requestMetadata();
    const result = await recordInvoiceStatus(
      session.businessId,
      session.userId,
      invoiceId,
      requested as 'SENT' | 'CANCELLED',
      { ipAddress: metadata.ipAddress }
    );

    if (!result.ok) failure = result.reason === 'not_allowed' ? 'not_allowed' : 'failed';
  } catch (error) {
    unexpectedError('invoice.status', error);
    failure = 'failed';
  }

  if (failure) redirect(`${returnTo}?statusError=${failure}`);

  revalidatePath('/app/invoices');
  revalidatePath(`/app/invoices/${invoiceId}`);
  revalidatePath('/app');
  redirect(`${returnTo}?statusUpdated=${requested.toLowerCase()}`);
}

/**
 * One-click quote -> invoice conversion.
 *
 * The quote must be ACCEPTED; the invoice is a verbatim copy of the quote's
 * stored lines and totals, the quote becomes CONVERTED, and a second click
 * cannot create a second invoice (row lock + partial unique index).
 */
export async function convertQuoteToInvoiceAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const quoteId = readString(formData, 'quoteId');
  const returnTo = readString(formData, 'returnTo') || `/app/quotes/${quoteId}`;

  if (!quoteId) redirect('/app/quotes?missing=1');

  let converted: { ok: true; id: string } | { ok: false; reason: string } | null = null;
  try {
    const metadata = await requestMetadata();
    converted = await convertInvoiceFromQuote(
      session.businessId,
      session.userId,
      quoteId,
      { ipAddress: metadata.ipAddress }
    );
  } catch (error) {
    unexpectedError('invoice.convert', error);
    redirect(`${returnTo}?statusError=failed`);
  }

  if (!converted.ok) {
    const code =
      converted.reason === 'already_converted'
        ? 'already_converted'
        : converted.reason === 'not_allowed'
          ? 'not_convertible'
          : converted.reason === 'not_found'
            ? 'missing'
            : 'failed';
    redirect(`${returnTo}?statusError=${code}`);
  }

  revalidatePath('/app/invoices');
  revalidatePath('/app/quotes');
  revalidatePath(`/app/quotes/${quoteId}`);
  revalidatePath('/app');
  redirect(`/app/invoices/${converted.id}?converted=1`);
}
