'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import {
  createCustomerAction,
  updateCustomerAction,
} from '@/lib/actions/customers';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { buttonClasses } from '@/components/ui/button';

export type CustomerFormValues = {
  id?: string;
  customerType: string;
  businessName: string;
  contactPerson: string | null;
  phone: string | null;
  email: string | null;
  billingAddressLine1: string | null;
  billingAddressLine2: string | null;
  billingCity: string | null;
  billingProvince: string | null;
  billingPostalCode: string | null;
  billingCountry: string | null;
  siteAddressLine1: string | null;
  siteAddressLine2: string | null;
  siteCity: string | null;
  siteProvince: string | null;
  sitePostalCode: string | null;
  notes: string | null;
};

const EMPTY: CustomerFormValues = {
  customerType: 'BUSINESS',
  businessName: '',
  contactPerson: null,
  phone: null,
  email: null,
  billingAddressLine1: null,
  billingAddressLine2: null,
  billingCity: null,
  billingProvince: null,
  billingPostalCode: null,
  billingCountry: 'South Africa',
  siteAddressLine1: null,
  siteAddressLine2: null,
  siteCity: null,
  siteProvince: null,
  sitePostalCode: null,
  notes: null,
};

/**
 * One form for creating and editing customers.
 *
 * It is deliberately short: name, one contact method, and addresses. Everything
 * else is optional, so adding a customer on a phone at a job site takes a few
 * seconds. Duplicate names are flagged by the action, and the "Save anyway"
 * button only appears in that case.
 */
export function CustomerForm({ customer }: { customer?: CustomerFormValues } = {}) {
  const values = customer ?? EMPTY;
  const isEdit = Boolean(customer?.id);

  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateCustomerAction : createCustomerAction,
    initialActionState
  );

  const duplicateWarning = state.code === 'duplicate_customer';

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {isEdit ? <input type="hidden" name="customerId" value={customer?.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field
          label="Customer type"
          htmlFor="customerType"
          hint="Businesses appear with their VAT details on documents."
        >
          <Select id="customerType" name="customerType" defaultValue={values.customerType}>
            <option value="BUSINESS">Business</option>
            <option value="INDIVIDUAL">Individual</option>
          </Select>
        </Field>

        <Field
          label="Customer name"
          htmlFor="businessName"
          error={firstError(state, 'businessName')}
          required
        >
          <TextInput
            id="businessName"
            name="businessName"
            defaultValue={values.businessName}
            autoComplete="organization"
            placeholder="Harbour Point Body Corporate"
            required
            invalid={Boolean(firstError(state, 'businessName'))}
          />
        </Field>

        <Field label="Contact person" htmlFor="contactPerson">
          <TextInput
            id="contactPerson"
            name="contactPerson"
            defaultValue={values.contactPerson ?? ''}
            autoComplete="name"
            placeholder="Who do we speak to?"
          />
        </Field>

        <Field
          label="Phone"
          htmlFor="phone"
          error={firstError(state, 'phone')}
          hint="Phone or email — at least one is needed."
        >
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            autoComplete="tel"
            defaultValue={values.phone ?? ''}
            placeholder="082 555 0142"
            invalid={Boolean(firstError(state, 'phone'))}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={firstError(state, 'email')}>
          <TextInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            defaultValue={values.email ?? ''}
            placeholder="accounts@example.co.za"
            invalid={Boolean(firstError(state, 'email'))}
          />
        </Field>
      </div>

      <fieldset className="space-y-4 rounded-lg border border-ink-700 p-4">
        <legend className="cg-eyebrow px-1">Billing address</legend>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Address line 1" htmlFor="billingAddressLine1">
            <TextInput
              id="billingAddressLine1"
              name="billingAddressLine1"
              defaultValue={values.billingAddressLine1 ?? ''}
              autoComplete="address-line1"
            />
          </Field>
          <Field label="Address line 2" htmlFor="billingAddressLine2">
            <TextInput
              id="billingAddressLine2"
              name="billingAddressLine2"
              defaultValue={values.billingAddressLine2 ?? ''}
              autoComplete="address-line2"
            />
          </Field>
          <Field label="City / suburb" htmlFor="billingCity">
            <TextInput
              id="billingCity"
              name="billingCity"
              defaultValue={values.billingCity ?? ''}
              autoComplete="address-level2"
            />
          </Field>
          <Field label="Province" htmlFor="billingProvince">
            <TextInput
              id="billingProvince"
              name="billingProvince"
              defaultValue={values.billingProvince ?? ''}
              autoComplete="address-level1"
            />
          </Field>
          <Field label="Postal code" htmlFor="billingPostalCode">
            <TextInput
              id="billingPostalCode"
              name="billingPostalCode"
              inputMode="numeric"
              defaultValue={values.billingPostalCode ?? ''}
              autoComplete="postal-code"
            />
          </Field>
          <Field label="Country" htmlFor="billingCountry">
            <TextInput
              id="billingCountry"
              name="billingCountry"
              defaultValue={values.billingCountry ?? 'South Africa'}
              autoComplete="country-name"
            />
          </Field>
        </div>
      </fieldset>

      <fieldset className="space-y-4 rounded-lg border border-ink-700 p-4">
        <legend className="cg-eyebrow px-1">Job site address</legend>
        <p className="text-xs text-steel-500">
          Leave blank when the work happens at the billing address. Jobs default to these details.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site line 1" htmlFor="siteAddressLine1">
            <TextInput
              id="siteAddressLine1"
              name="siteAddressLine1"
              defaultValue={values.siteAddressLine1 ?? ''}
            />
          </Field>
          <Field label="Site line 2" htmlFor="siteAddressLine2">
            <TextInput
              id="siteAddressLine2"
              name="siteAddressLine2"
              defaultValue={values.siteAddressLine2 ?? ''}
            />
          </Field>
          <Field label="Site city / suburb" htmlFor="siteCity">
            <TextInput id="siteCity" name="siteCity" defaultValue={values.siteCity ?? ''} />
          </Field>
          <Field label="Site province" htmlFor="siteProvince">
            <TextInput id="siteProvince" name="siteProvince" defaultValue={values.siteProvince ?? ''} />
          </Field>
          <Field label="Site postal code" htmlFor="sitePostalCode">
            <TextInput
              id="sitePostalCode"
              name="sitePostalCode"
              inputMode="numeric"
              defaultValue={values.sitePostalCode ?? ''}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" htmlFor="notes" hint="Access codes, preferred times, anything worth remembering.">
        <TextArea id="notes" name="notes" rows={3} defaultValue={values.notes ?? ''} />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pendingLabel={isEdit ? 'Saving…' : 'Creating…'}>
          {isEdit ? 'Save customer' : 'Create customer'}
        </SubmitButton>

        {duplicateWarning ? (
          <button
            type="submit"
            name="confirmDuplicate"
            value="1"
            className={buttonClasses('secondary', 'md')}
          >
            Save anyway
          </button>
        ) : null}

        <Link
          href={isEdit && customer?.id ? `/app/customers/${customer.id}` : '/app/customers'}
          className="text-sm text-steel-400 hover:text-paper"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
