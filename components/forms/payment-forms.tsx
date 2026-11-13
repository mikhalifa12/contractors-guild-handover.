'use client';

import { useActionState } from 'react';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import { recordPaymentAction } from '@/lib/actions/payments';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { formatCurrency } from '@/lib/money';

export type PayableInvoiceOption = {
  id: string;
  label: string;
  hint: string;
  balanceDue: string;
  total: string;
};

const METHOD_OPTIONS = [
  { value: 'EFT', label: 'EFT / bank transfer' },
  { value: 'CASH', label: 'Cash' },
  { value: 'CARD', label: 'Card' },
  { value: 'OTHER', label: 'Other' },
] as const;

/**
 * Record a payment against an unpaid invoice.
 *
 * The balances shown come from the server (the generated balance_due column);
 * the server recomputes everything on submit, so the form cannot talk its way
 * into an overpayment — the repository refuses it.
 */
export function PaymentForm({
  invoices,
  currencyCode,
  today,
  defaultInvoiceId,
}: {
  invoices: PayableInvoiceOption[];
  currencyCode: string;
  today: string;
  defaultInvoiceId?: string | null;
}) {
  const [state, formAction] = useActionState<ActionState, FormData>(
    recordPaymentAction,
    initialActionState
  );

  const selected =
    invoices.find((invoice) => invoice.id === defaultInvoiceId) ?? null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />

      <Field
        label="Invoice"
        htmlFor="invoiceId"
        error={firstError(state, 'invoiceId')}
        required
        hint="Only invoices that have been sent and still have a balance are listed."
      >
        <Select
          id="invoiceId"
          name="invoiceId"
          defaultValue={defaultInvoiceId ?? ''}
          required
          invalid={Boolean(firstError(state, 'invoiceId'))}
        >
          <option value="" disabled>
            Choose the invoice being paid…
          </option>
          {invoices.map((invoice) => (
            <option key={invoice.id} value={invoice.id}>
              {invoice.label}
            </option>
          ))}
        </Select>
      </Field>

      {selected ? (
        <p className="cg-hint -mt-3">
          {selected.hint} · balance due{' '}
          <span className="font-mono">{formatCurrency(selected.balanceDue, currencyCode)}</span> of{' '}
          <span className="font-mono">{formatCurrency(selected.total, currencyCode)}</span>
        </p>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Amount received"
          htmlFor="amount"
          error={firstError(state, 'amount')}
          required
          hint={
            selected
              ? `Balance outstanding: ${formatCurrency(selected.balanceDue, currencyCode)}. A part payment is fine — the invoice becomes partially paid.`
              : 'Full or partial amount, e.g. 1250 or 1250.50.'
          }
        >
          <TextInput
            id="amount"
            name="amount"
            inputMode="decimal"
            autoComplete="off"
            defaultValue={selected?.balanceDue ?? ''}
            required
            invalid={Boolean(firstError(state, 'amount'))}
            placeholder="0.00"
          />
        </Field>

        <Field
          label="Payment date"
          htmlFor="paymentDate"
          error={firstError(state, 'paymentDate')}
          required
        >
          <TextInput
            id="paymentDate"
            name="paymentDate"
            type="date"
            defaultValue={today}
            required
          />
        </Field>

        <Field label="Method" htmlFor="method" error={firstError(state, 'method')}>
          <Select id="method" name="method" defaultValue="EFT">
            {METHOD_OPTIONS.map((method) => (
              <option key={method.value} value={method.value}>
                {method.label}
              </option>
            ))}
          </Select>
        </Field>

        <Field
          label="Reference"
          htmlFor="reference"
          error={firstError(state, 'reference')}
          hint="Bank reference, receipt slip or cheque number."
        >
          <TextInput
            id="reference"
            name="reference"
            autoComplete="off"
            maxLength={120}
            placeholder="e.g. ACC-88123"
          />
        </Field>
      </div>

      <Field label="Notes" htmlFor="notes" error={firstError(state, 'notes')}>
        <TextArea
          id="notes"
          name="notes"
          rows={3}
          maxLength={500}
          placeholder="Shown on the receipt (optional)."
        />
      </Field>

      <div className="flex items-center gap-3">
        <SubmitButton pendingLabel="Recording…">Record payment</SubmitButton>
        <p className="text-xs text-steel-500">
          A numbered receipt is issued the moment the payment is saved.
        </p>
      </div>
    </form>
  );
}
