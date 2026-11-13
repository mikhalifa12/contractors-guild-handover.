'use server';

import { revalidatePath } from 'next/cache';
import { redirect } from 'next/navigation';
import { requestMetadata, requireSession } from '@/lib/auth/current-user';
import { recordPayment, reversePayment } from '@/lib/repositories/payments';
import {
  paymentSchema,
  type PaymentFormValues,
} from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Payment Server Actions.
 *
 * The same rules as every money action in this codebase:
 *  - the form is validated before it reaches the database; the database
 *    constraints are the second line of defence
 *  - the repository, not the action, owns the transaction: the invoice row is
 *    locked, the balance is recomputed from stored money and overpayment is
 *    refused there, so the browser can never talk the server into an
 *    inconsistent state
 *  - a payment reversal keeps the rows and the audit trail; nothing financial
 *    is ever deleted
 */
export async function recordPaymentAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed: ReturnType<typeof parsePaymentForm> = parsePaymentForm(formData);
  if (!parsed.success) {
    return errorState(
      'Please check the highlighted fields.',
      fieldErrorsFromZod(parsed.error)
    );
  }

  const input = toRepositoryInput(parsed.data);

  let outcome: Awaited<ReturnType<typeof recordPayment>>;
  try {
    const metadata = await requestMetadata();
    outcome = await recordPayment(session.businessId, session.userId, input, {
      ipAddress: metadata.ipAddress,
    });
  } catch (error) {
    return unexpectedError('payment.record', error);
  }

  if (!outcome.ok) {
    const message =
      outcome.reason === 'not_found'
        ? 'That invoice is not in your business.'
        : outcome.reason === 'not_payable'
          ? 'Only a sent invoice can take a payment — drafts and cancelled invoices cannot.'
          : outcome.reason === 'overpayment'
            ? 'That amount is more than the balance still owed on the invoice.'
            : outcome.reason === 'zero_or_negative'
              ? 'Enter an amount received of more than zero.'
              : 'We could not record that payment. Please try again.';
    return errorState(
      message,
      outcome.reason === 'overpayment' || outcome.reason === 'zero_or_negative'
        ? { amount: [message] }
        : {}
    );
  }

  revalidatePath('/app/payments');
  revalidatePath(`/app/invoices/${input.invoiceId}`);
  revalidatePath('/app/invoices');
  revalidatePath('/app');
  redirect(`/app/payments/${outcome.paymentId}?recorded=1`);
}

function parsePaymentForm(formData: FormData) {
  return paymentSchema.safeParse({
    invoiceId: readString(formData, 'invoiceId'),
    amount: readString(formData, 'amount'),
    paymentDate: readString(formData, 'paymentDate'),
    method: readString(formData, 'method'),
    reference: readString(formData, 'reference'),
    notes: readString(formData, 'notes'),
  });
}

function toRepositoryInput(values: PaymentFormValues) {
  return {
    invoiceId: values.invoiceId,
    amount: values.amount,
    paymentDate: values.paymentDate,
    method: values.method,
    reference: values.reference ?? null,
    notes: values.notes ?? null,
  };
}

/** Reverse a payment from the receipt screen's plain form button. */
export async function deletePaymentAction(formData: FormData): Promise<void> {
  const session = await requireSession();
  const paymentId = readString(formData, 'paymentId');
  const returnTo = readString(formData, 'returnTo') || `/app/payments/${paymentId}`;

  if (!paymentId) redirect('/app/payments?missing=1');

  let failed = false;
  try {
    const metadata = await requestMetadata();
    const result = await reversePayment(session.businessId, session.userId, paymentId, {
      ipAddress: metadata.ipAddress,
    });
    failed = !result.ok;
  } catch (error) {
    unexpectedError('payment.reverse', error);
    failed = true;
  }

  if (failed) redirect(`${returnTo}?statusError=failed`);

  revalidatePath('/app/payments');
  revalidatePath('/app/invoices');
  revalidatePath('/app');
  redirect(`/app/payments?reversed=1`);
}
