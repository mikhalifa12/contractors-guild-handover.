'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import { createQuoteAction, updateQuoteAction } from '@/lib/actions/quotes';
import { Field, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { Autocomplete, type AutocompleteOption } from '@/components/ui/autocomplete';
import { LineItemsEditor } from '@/components/quotes/line-items-editor';
import { makeBlankLine, type QuoteLineDraft } from '@/lib/quote-draft';
import type { CatalogueChoice } from '@/components/quotes/catalogue-line-picker';

export type QuoteFormValues = {
  id?: string;
  customerId: string;
  jobId: string | null;
  issueDate: string;
  validUntil: string;
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

export type JobContext = {
  id: string;
  jobNumber: string;
  title: string;
};

/**
 * Create or edit a quote.
 *
 * The customer is picked with the searchable picker, the lines come from the
 * catalogue or are typed by hand, and the totals are recalculated on the server
 * when the form is submitted. Nothing here decides what a quote is worth.
 */
export function QuoteForm({
  customers,
  catalogue,
  defaultTaxRate,
  currencyCode,
  defaultValidUntil,
  today,
  jobContext,
  quote,
}: {
  customers: AutocompleteOption[];
  catalogue: CatalogueChoice[];
  defaultTaxRate: number;
  currencyCode: string;
  defaultValidUntil: string;
  today: string;
  jobContext?: JobContext | null;
  quote?: QuoteFormValues;
}) {
  const isEdit = Boolean(quote?.id);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateQuoteAction : createQuoteAction,
    initialActionState
  );

  const defaultCustomer = quote?.customerId
    ? (customers.find((option) => option.value === quote.customerId) ?? null)
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
      {isEdit ? <input type="hidden" name="quoteId" value={quote?.id} /> : null}

      {jobContext ? (
        <>
          <input type="hidden" name="jobId" value={jobContext.id} />
          <p className="rounded-lg border border-ember-500/40 bg-ember-500/10 px-3 py-2 text-sm text-ember-200">
            This quote is for job <span className="font-mono">{jobContext.jobNumber}</span> —{' '}
            {jobContext.title}. The job will move to <strong>Quoted</strong> when you save.
          </p>
        </>
      ) : (
        <input type="hidden" name="jobId" value={quote?.jobId ?? ''} />
      )}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Customer"
          htmlFor="customerId"
          error={firstError(state, 'customerId')}
          required
          hint={customers.length === 0 ? 'Add a customer first.' : 'Start typing a name or phone number.'}
        >
          <Autocomplete
            id="customerId"
            name="customerId"
            options={customers}
            defaultOption={defaultCustomer}
            required
            invalid={Boolean(firstError(state, 'customerId'))}
            placeholder="Search customers…"
            emptyHint="No customer matches that. Add the customer first, then quote them."
          />
        </Field>

        <Field label="Job type" htmlFor="jobType" hint="Installation, repairs, compliance…">
          <TextInput
            id="jobType"
            name="jobType"
            defaultValue={quote?.jobType ?? ''}
            list="quote-job-types"
            placeholder="Installation"
          />
        </Field>

        <datalist id="quote-job-types">
          <option value="Installation" />
          <option value="Fault finding" />
          <option value="Maintenance" />
          <option value="Compliance" />
          <option value="Supply only" />
        </datalist>

        <Field label="Issue date" htmlFor="issueDate" error={firstError(state, 'issueDate')} required>
          <TextInput
            id="issueDate"
            name="issueDate"
            type="date"
            defaultValue={quote?.issueDate ?? today}
            required
          />
        </Field>

        <Field
          label="Valid until"
          htmlFor="validUntil"
          error={firstError(state, 'validUntil')}
          hint="Customers can accept until this date. Past it, the quote shows as expired."
        >
          <TextInput
            id="validUntil"
            name="validUntil"
            type="date"
            defaultValue={quote?.validUntil ?? defaultValidUntil}
          />
        </Field>
      </div>

      <Field label="Scope summary" htmlFor="description" hint="One or two lines that lead the quote.">
        <TextArea
          id="description"
          name="description"
          rows={2}
          maxLength={2000}
          defaultValue={quote?.description ?? ''}
          placeholder="Replace the garage distribution board and issue a certificate of compliance."
        />
      </Field>

      <section className="space-y-4">
        <div>
          <h2 className="cg-display text-lg text-paper">Line items</h2>
          <p className="mt-1 text-sm text-steel-500">
            Prices are copied onto the quote, so changing the catalogue later never rewrites this
            document.
          </p>
        </div>

        <LineItemsEditor
          choices={catalogue}
          defaultTaxRate={defaultTaxRate}
          currencyCode={currencyCode}
          initialLines={
            quote?.lines && quote.lines.length > 0
              ? quote.lines
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
                defaultValue={quote?.contactPerson ?? ''}
              />
            </Field>
            <Field label="Contact phone" htmlFor="contactPhone">
              <TextInput
                id="contactPhone"
                name="contactPhone"
                inputMode="tel"
                defaultValue={quote?.contactPhone ?? ''}
              />
            </Field>
            <Field label="Contact email" htmlFor="contactEmail">
              <TextInput
                id="contactEmail"
                name="contactEmail"
                type="email"
                defaultValue={quote?.contactEmail ?? ''}
              />
            </Field>
          </div>
          <p className="cg-hint">
            Leave these blank to use the customer&apos;s details on file.
          </p>

          <fieldset className="space-y-4">
            <legend className="cg-eyebrow px-1">Site address</legend>
            <p className="text-xs text-steel-500">
              Leave blank to use the customer&apos;s site address on file.
            </p>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Site line 1" htmlFor="jobAddressLine1">
                <TextInput
                  id="jobAddressLine1"
                  name="jobAddressLine1"
                  defaultValue={quote?.jobAddressLine1 ?? ''}
                />
              </Field>
              <Field label="Site line 2" htmlFor="jobAddressLine2">
                <TextInput
                  id="jobAddressLine2"
                  name="jobAddressLine2"
                  defaultValue={quote?.jobAddressLine2 ?? ''}
                />
              </Field>
              <Field label="City / suburb" htmlFor="jobCity">
                <TextInput id="jobCity" name="jobCity" defaultValue={quote?.jobCity ?? ''} />
              </Field>
              <Field label="Province" htmlFor="jobProvince">
                <TextInput
                  id="jobProvince"
                  name="jobProvince"
                  defaultValue={quote?.jobProvince ?? ''}
                />
              </Field>
              <Field label="Postal code" htmlFor="jobPostalCode">
                <TextInput
                  id="jobPostalCode"
                  name="jobPostalCode"
                  inputMode="numeric"
                  defaultValue={quote?.jobPostalCode ?? ''}
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
              defaultValue={quote?.paymentTerms ?? ''}
              placeholder="50% deposit on acceptance, balance on completion."
            />
          </Field>

          <Field label="Terms and conditions" htmlFor="termsAndConditions">
            <TextArea
              id="termsAndConditions"
              name="termsAndConditions"
              rows={3}
              maxLength={3000}
              defaultValue={quote?.termsAndConditions ?? ''}
            />
          </Field>

          <Field label="Notes for the customer" htmlFor="notes">
            <TextArea
              id="notes"
              name="notes"
              rows={2}
              maxLength={2000}
              defaultValue={quote?.notes ?? ''}
            />
          </Field>
        </div>
      </details>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pendingLabel={isEdit ? 'Saving…' : 'Creating…'}>
          {isEdit ? 'Save quote' : 'Save draft quote'}
        </SubmitButton>
        <p className="text-xs text-steel-500">
          Saved as a draft. Nothing is visible to the customer until you mark it sent.
        </p>
        <Link
          href={isEdit && quote?.id ? `/app/quotes/${quote.id}` : '/app/quotes'}
          className="text-sm text-steel-400 hover:text-paper sm:ml-auto"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
