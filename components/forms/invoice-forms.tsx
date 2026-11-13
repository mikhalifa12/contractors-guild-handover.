'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import { createInvoiceAction, updateInvoiceAction } from '@/lib/actions/invoices';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/autocomplete';
import { LineItemsEditor } from '@/components/quotes/line-items-editor';
import { makeBlankLine, type QuoteLineDraft } from '@/lib/quote-draft';
import type { CatalogueChoice } from '@/components/quotes/catalogue-line-picker';

export type InvoiceFormValues = {
  id?: string;
  customerId: string;
  jobId: string | null;
  issueDate: string;
  dueDate: string;
  preparedBy: string;
  contactPerson: string;
  contactPhone: string;
  contactEmail: string;
  jobType: string;
  jobAddressLine1: string;
  jobAddressLine2: string;
  jobCity: string;
  jobProvince: string;
  jobPostalCode: string;
  description: string;
  paymentTerms: string;
  notes: string;
  termsAndConditions: string;
  lines: QuoteLineDraft[];
};

/**
 * Create or edit a draft invoice.
 *
 * Shares the LineItemsEditor with the quote builder: same catalogue picker,
 * same live totals from the shared money engine, and the same server-side
 * recomputation on submit. The browser's totals are display-only.
 */
export function InvoiceForm({
  customers,
  catalogue,
  defaultTaxRate,
  currencyCode,
  today,
  invoice,
}: {
  customers: AutocompleteOption[];
  catalogue: CatalogueChoice[];
  defaultTaxRate: number;
  currencyCode: string;
  today: string;
  invoice?: InvoiceFormValues;
}) {
  const isEdit = Boolean(invoice?.id);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateInvoiceAction : createInvoiceAction,
    initialActionState
  );

  const defaultCustomer = invoice?.customerId
    ? (customers.find((option) => option.value === invoice.customerId) ?? null)
    : null;

  const itemErrors = state.fieldErrors.items ?? [];
  const lineErrors = Object.entries(state.fieldErrors)
    .filter(([field]) => field !== 'items' && field.startsWith('items.'))
    .map(([field, messages]) => {
      const index = Number(field.split('.')[1]);
      return `Line ${Number.isFinite(index) ? index + 1 : '?'}: ${messages[0]}`;
    });

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {isEdit ? <input type="hidden" name="invoiceId" value={invoice?.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Customer"
          htmlFor="customerId"
          error={firstError(state, 'customerId')}
          required
          hint="Start typing a name or phone number."
        >
          <Autocomplete
            id="customerId"
            name="customerId"
            options={customers}
            defaultOption={defaultCustomer}
            required
            invalid={Boolean(firstError(state, 'customerId'))}
            placeholder="Search customers…"
            emptyHint="No customer matches that. Add the customer first, then invoice them."
          />
        </Field>

        <Field label="Prepared by" htmlFor="preparedBy" hint="Printed on the invoice.">
          <TextInput id="preparedBy" name="preparedBy" defaultValue={invoice?.preparedBy ?? ''} />
        </Field>

        <Field label="Issue date" htmlFor="issueDate" error={firstError(state, 'issueDate')} required>
          <TextInput
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={invoice?.issueDate ?? today}
            required
          />
        </Field>

        <Field
          label="Due date"
          htmlFor="dueDate"
          error={firstError(state, 'dueDate')}
          hint="Past this date an unpaid invoice shows as overdue."
        >
          <TextInput id="dueDate" name="dueDate" type="date" defaultValue={invoice?.dueDate ?? ''} />
        </Field>
      </div>

      <Field label="Scope summary" htmlFor="description" hint="One or two lines that lead the invoice.">
        <TextArea
          id="description"
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={invoice?.description ?? ''}
          placeholder="Replacement of the garage distribution board, including certification."
        />
      </Field>

      <section className="space-y-4">
        <div>
          <h2 className="cg-display text-lg text-paper">Line items</h2>
          <p className="mt-1 text-sm text-steel-500">
            Totals are recalculated on the server when you save.
          </p>
        </div>

        <LineItemsEditor
          choices={catalogue}
          defaultTaxRate={defaultTaxRate}
          currencyCode={currencyCode}
          initialLines={
            invoice?.lines && invoice.lines.length > 0
              ? invoice.lines
              : [makeBlankLine(defaultTaxRate)]
          }
          errors={[...itemErrors, ...lineErrors]}
        />
      </section>

      <details className="rounded-lg border border-ink-700 p-4">
        <summary className="cursor-pointer text-sm font-semibold text-steel-200">
          Contact, site address and terms (optional)
        </summary>

        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-3">
            <Field label="Contact person" htmlFor="contactPerson">
              <TextInput
                id="contactPerson"
                name="contactPerson"
                defaultValue={invoice?.contactPerson ?? ''}
              />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <TextInput
                id="contactPhone"
                name="contactPhone"
                inputMode="tel"
                defaultValue={invoice?.contactPhone ?? ''}
              />
            </Field>
            <Field label="Contact email" htmlFor="contactEmail">
              <TextInput
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={invoice?.contactEmail ?? ''}
              />
            </Field>
          </div>

          <fieldset className="space-y-4">
            <legend className="cg-eyebrow px-1">Site address</legend>
            <p className="text-xs text-steel-500">
              Leave blank to use the job&apos;s address, then the customer&apos;s site address on file.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Site line 1" htmlFor="jobAddressLine1">
                <TextInput
                  id="jobAddressLine1"
                  name="jobAddressLine1"
                  defaultValue={invoice?.jobAddressLine1 ?? ''}
                />
              </Field>
              <Field label="Site line 2" htmlFor="jobAddressLine2">
                <TextInput
                  id="jobAddressLine2"
                  name="jobAddressLine2"
                  defaultValue={invoice?.jobAddressLine2 ?? ''}
                />
              </Field>
              <Field label="City / suburb" htmlFor="jobCity">
                <TextInput id="jobCity" name="jobCity" defaultValue={invoice?.jobCity ?? ''} />
              </Field>
              <Field label="Province" htmlFor="jobProvince">
                <TextInput
                  id="jobProvince"
                  name="jobProvince"
                  defaultValue={invoice?.jobProvince ?? ''}
                />
              </Field>
              <Field label="Postal code" htmlFor="jobPostalCode">
                <TextInput
                  id="jobPostalCode"
                  name="jobPostalCode"
                  inputMode="numeric"
                  defaultValue={invoice?.jobPostalCode ?? ''}
                />
              </Field>
            </div>
          </fieldset>

          <Field label="Payment terms" htmlFor="paymentTerms">
            <TextArea
              id="paymentTerms"
              name="paymentTerms"
              rows={2}
              maxLength={400}
              defaultValue={invoice?.paymentTerms ?? ''}
              placeholder="Payment due within 30 days of invoice date."
            />
          </Field>

          <Field label="Terms and conditions" htmlFor="termsAndConditions">
            <TextArea
              id="termsAndConditions"
              name="termsAndConditions"
              rows={3}
              maxLength={3000}
              defaultValue={invoice?.termsAndConditions ?? ''}
            />
          </Field>

          <Field label="Notes for the customer" htmlFor="notes">
            <TextArea id="notes" name="notes" rows={2} maxLength={2000} defaultValue={invoice?.notes ?? ''} />
          </Field>
        </div>
      </details>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pendingLabel={isEdit ? 'Saving…' : 'Creating…'}>
          {isEdit ? 'Save invoice' : 'Save draft invoice'}
        </SubmitButton>
        <p className="text-xs text-steel-500">
          Saved as a draft. Nothing is visible to the customer until you mark it sent.
        </p>
        <Link
          href={isEdit && invoice?.id ? `/app/invoices/${invoice.id}` : '/app/invoices'}
          className="text-sm text-steel-400 hover:text-paper sm:ml-auto"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
