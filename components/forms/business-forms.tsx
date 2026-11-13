'use client';

import { useActionState } from 'react';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import {
  removeLogoAction,
  saveBankingDetailsAction,
  saveBusinessProfileAction,
  saveDocumentSettingsAction,
  uploadLogoAction,
} from '@/lib/actions/business';
import { firstError, initialActionState } from '@/lib/actions/state';
import type { BusinessDetail, BusinessSettings } from '@/lib/repositories/businesses';

export function BusinessProfileForm({ business }: { business: BusinessDetail }) {
  const [state, formAction] = useActionState(saveBusinessProfileAction, initialActionState);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="cg-eyebrow mb-2 sm:col-span-2">Identity</legend>

        <Field
          label="Business name"
          htmlFor="legalName"
          error={firstError(state, 'legalName')}
          required
        >
          <TextInput
            id="legalName"
            name="legalName"
            defaultValue={business.legal_name}
            required
            invalid={Boolean(firstError(state, 'legalName'))}
          />
        </Field>

        <Field label="Trading name" htmlFor="tradingName" error={firstError(state, 'tradingName')}>
          <TextInput
            id="tradingName"
            name="tradingName"
            defaultValue={business.trading_name ?? ''}
          />
        </Field>

        <Field
          label="Registration number"
          htmlFor="registrationNumber"
          error={firstError(state, 'registrationNumber')}
        >
          <TextInput
            id="registrationNumber"
            name="registrationNumber"
            defaultValue={business.registration_number ?? ''}
          />
        </Field>

        <Field label="Tax / VAT number" htmlFor="taxNumber" error={firstError(state, 'taxNumber')}>
          <TextInput id="taxNumber" name="taxNumber" defaultValue={business.tax_number ?? ''} />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="cg-eyebrow mb-2 sm:col-span-2">Address</legend>

        <Field
          label="Address line 1"
          htmlFor="addressLine1"
          error={firstError(state, 'addressLine1')}
          className="sm:col-span-2"
        >
          <TextInput
            id="addressLine1"
            name="addressLine1"
            defaultValue={business.address_line1 ?? ''}
            autoComplete="address-line1"
          />
        </Field>

        <Field
          label="Address line 2"
          htmlFor="addressLine2"
          error={firstError(state, 'addressLine2')}
          className="sm:col-span-2"
        >
          <TextInput
            id="addressLine2"
            name="addressLine2"
            defaultValue={business.address_line2 ?? ''}
            autoComplete="address-line2"
          />
        </Field>

        <Field label="City" htmlFor="city" error={firstError(state, 'city')}>
          <TextInput
            id="city"
            name="city"
            defaultValue={business.city ?? ''}
            autoComplete="address-level2"
          />
        </Field>

        <Field label="Province" htmlFor="province" error={firstError(state, 'province')}>
          <TextInput
            id="province"
            name="province"
            defaultValue={business.province ?? ''}
            autoComplete="address-level1"
          />
        </Field>

        <Field label="Postal code" htmlFor="postalCode" error={firstError(state, 'postalCode')}>
          <TextInput
            id="postalCode"
            name="postalCode"
            defaultValue={business.postal_code ?? ''}
            autoComplete="postal-code"
          />
        </Field>

        <Field label="Country" htmlFor="country" error={firstError(state, 'country')} required>
          <TextInput
            id="country"
            name="country"
            defaultValue={business.country}
            autoComplete="country-name"
            required
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="cg-eyebrow mb-2 sm:col-span-2">Contact</legend>

        <Field label="Phone" htmlFor="phone" error={firstError(state, 'phone')}>
          <TextInput
            id="phone"
            name="phone"
            type="tel"
            inputMode="tel"
            defaultValue={business.phone ?? ''}
          />
        </Field>

        <Field label="WhatsApp" htmlFor="whatsapp" error={firstError(state, 'whatsapp')}>
          <TextInput
            id="whatsapp"
            name="whatsapp"
            type="tel"
            inputMode="tel"
            defaultValue={business.whatsapp ?? ''}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={firstError(state, 'email')}>
          <TextInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            defaultValue={business.email ?? ''}
          />
        </Field>

        <Field label="Website" htmlFor="website" error={firstError(state, 'website')}>
          <TextInput
            id="website"
            name="website"
            defaultValue={business.website ?? ''}
            placeholder="www.example.co.za"
          />
        </Field>
      </fieldset>

      <SubmitButton pendingLabel="Saving…">Save business details</SubmitButton>
    </form>
  );
}

export function DocumentSettingsForm({ settings }: { settings: BusinessSettings }) {
  const [state, formAction] = useActionState(saveDocumentSettingsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="cg-eyebrow mb-2 sm:col-span-2">Defaults</legend>

        <Field
          label="Payment terms"
          htmlFor="defaultPaymentTerms"
          error={firstError(state, 'defaultPaymentTerms')}
          className="sm:col-span-2"
        >
          <TextArea
            id="defaultPaymentTerms"
            name="defaultPaymentTerms"
            defaultValue={settings.default_payment_terms}
            rows={3}
          />
        </Field>

        <Field
          label="Quote validity (days)"
          htmlFor="defaultQuoteValidityDays"
          error={firstError(state, 'defaultQuoteValidityDays')}
        >
          <TextInput
            id="defaultQuoteValidityDays"
            name="defaultQuoteValidityDays"
            type="number"
            min={1}
            max={365}
            defaultValue={settings.default_quote_validity_days}
          />
        </Field>

        <Field
          label="Default tax / VAT rate (%)"
          htmlFor="defaultTaxRate"
          error={firstError(state, 'defaultTaxRate')}
        >
          <TextInput
            id="defaultTaxRate"
            name="defaultTaxRate"
            type="number"
            step="0.01"
            min={0}
            max={100}
            defaultValue={settings.default_tax_rate}
          />
        </Field>
      </fieldset>

      <fieldset className="grid gap-4 sm:grid-cols-3">
        <legend className="cg-eyebrow mb-2 sm:col-span-3">Numbering prefixes</legend>

        <Field
          label="Quote prefix"
          htmlFor="quotePrefix"
          error={firstError(state, 'quotePrefix')}
          hint="e.g. QUOTE-"
        >
          <TextInput id="quotePrefix" name="quotePrefix" defaultValue={settings.quote_prefix} />
        </Field>

        <Field
          label="Invoice prefix"
          htmlFor="invoicePrefix"
          error={firstError(state, 'invoicePrefix')}
          hint="e.g. INV-"
        >
          <TextInput id="invoicePrefix" name="invoicePrefix" defaultValue={settings.invoice_prefix} />
        </Field>

        <Field
          label="Receipt prefix"
          htmlFor="receiptPrefix"
          error={firstError(state, 'receiptPrefix')}
          hint="e.g. REC-"
        >
          <TextInput id="receiptPrefix" name="receiptPrefix" defaultValue={settings.receipt_prefix} />
        </Field>
      </fieldset>

      <Field
        label="Invoice footer note"
        htmlFor="invoiceFooterNote"
        error={firstError(state, 'invoiceFooterNote')}
      >
        <TextInput
          id="invoiceFooterNote"
          name="invoiceFooterNote"
          defaultValue={settings.invoice_footer_note ?? ''}
        />
      </Field>

      <SubmitButton pendingLabel="Saving…">Save document settings</SubmitButton>
    </form>
  );
}

export function BankingDetailsForm({ settings }: { settings: BusinessSettings }) {
  const [state, formAction] = useActionState(saveBankingDetailsAction, initialActionState);

  return (
    <form action={formAction} className="space-y-6" noValidate>
      <FormMessage state={state} />

      <fieldset className="grid gap-4 sm:grid-cols-2">
        <legend className="cg-eyebrow mb-2 sm:col-span-2">Bank account</legend>

        <Field label="Bank name" htmlFor="bankName" error={firstError(state, 'bankName')}>
          <TextInput id="bankName" name="bankName" defaultValue={settings.bank_name ?? ''} />
        </Field>

        <Field
          label="Account name"
          htmlFor="bankAccountName"
          error={firstError(state, 'bankAccountName')}
        >
          <TextInput
            id="bankAccountName"
            name="bankAccountName"
            defaultValue={settings.bank_account_name ?? ''}
          />
        </Field>

        <Field
          label="Account number"
          htmlFor="bankAccountNumber"
          error={firstError(state, 'bankAccountNumber')}
        >
          <TextInput
            id="bankAccountNumber"
            name="bankAccountNumber"
            inputMode="numeric"
            defaultValue={settings.bank_account_number ?? ''}
          />
        </Field>

        <Field
          label="Branch code"
          htmlFor="bankBranchCode"
          error={firstError(state, 'bankBranchCode')}
        >
          <TextInput
            id="bankBranchCode"
            name="bankBranchCode"
            inputMode="numeric"
            defaultValue={settings.bank_branch_code ?? ''}
          />
        </Field>

        <Field
          label="Account type"
          htmlFor="bankAccountType"
          error={firstError(state, 'bankAccountType')}
        >
          <Select
            id="bankAccountType"
            name="bankAccountType"
            defaultValue={settings.bank_account_type ?? ''}
          >
            <option value="">Not set</option>
            <option value="Cheque / Current">Cheque / Current</option>
            <option value="Savings">Savings</option>
            <option value="Transmission">Transmission</option>
            <option value="Business">Business</option>
          </Select>
        </Field>
      </fieldset>

      <Field
        label="Payment instructions"
        htmlFor="paymentInstructions"
        error={firstError(state, 'paymentInstructions')}
        hint="Shown on invoices so customers know how to pay."
      >
        <TextArea
          id="paymentInstructions"
          name="paymentInstructions"
          rows={3}
          defaultValue={settings.payment_instructions ?? ''}
          placeholder="Use your invoice number as the payment reference."
        />
      </Field>

      <SubmitButton pendingLabel="Saving…">Save banking details</SubmitButton>
    </form>
  );
}

export function LogoForm({ logoUrl }: { logoUrl: string | null }) {
  const [uploadState, uploadFormAction] = useActionState(uploadLogoAction, initialActionState);
  const [removeState, removeFormAction] = useActionState(removeLogoAction, initialActionState);

  return (
    <div className="space-y-4">
      <FormMessage state={uploadState} />
      <FormMessage state={removeState} />

      <div className="flex flex-wrap items-center gap-4">
        <div className="flex h-20 w-20 items-center justify-center overflow-hidden rounded-lg border border-ink-600 bg-ink-900">
          {logoUrl ? (
            // eslint-disable-next-line @next/next/no-img-element -- logo is served from our own authenticated route
            <img src={logoUrl} alt="Business logo" className="h-full w-full object-contain" />
          ) : (
            <span className="text-xs text-steel-500">No logo</span>
          )}
        </div>

        <div className="flex-1 space-y-3">
          <form action={uploadFormAction} className="flex flex-wrap items-center gap-3" noValidate>
            <label className="cg-label sr-only" htmlFor="logo">
              Logo file
            </label>
            <input
              id="logo"
              name="logo"
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="block w-full max-w-xs cursor-pointer rounded-lg border border-ink-600 bg-ink-900 px-3 py-2.5 text-sm text-steel-300 file:mr-3 file:rounded file:border-0 file:bg-ember-500 file:px-3 file:py-1.5 file:text-xs file:font-semibold file:uppercase file:text-white"
            />
            <SubmitButton size="sm" pendingLabel="Uploading…">
              Upload logo
            </SubmitButton>
          </form>

          <p className="cg-hint">
            PNG, JPEG or WebP up to 2 MB. SVG uploads are blocked for security reasons.
          </p>

          {logoUrl ? (
            <form action={removeFormAction}>
              <SubmitButton variant="danger" size="sm" pendingLabel="Removing…">
                Remove logo
              </SubmitButton>
            </form>
          ) : null}
        </div>
      </div>
    </div>
  );
}
