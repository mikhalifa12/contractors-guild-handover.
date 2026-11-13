'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import {
  createCatalogueItemAction,
  updateCatalogueItemAction,
} from '@/lib/actions/catalogue';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';

export type CatalogueFormValues = {
  id?: string;
  kind: string;
  name: string;
  description: string | null;
  category: string | null;
  unit: string;
  sku: string | null;
  default_price: string;
  cost_price: string | null;
  tax_rate: string;
  is_active: boolean;
};

const EMPTY: CatalogueFormValues = {
  kind: 'SERVICE',
  name: '',
  description: null,
  category: null,
  unit: 'each',
  sku: null,
  default_price: '',
  cost_price: null,
  tax_rate: '15.00',
  is_active: true,
};

/**
 * Catalogue entry form. Prices are entered as text and normalised to a
 * two-decimal string by the validation schema, so the value that reaches
 * PostgreSQL is exactly what was captured — never a float.
 */
export function CatalogueItemForm({ item }: { item?: CatalogueFormValues } = {}) {
  const values = item ?? EMPTY;
  const isEdit = Boolean(item?.id);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateCatalogueItemAction : createCatalogueItemAction,
    initialActionState
  );

  // Tax rates are stored as a decimal fraction (0.1500); the form shows percent.
  const taxPercent = (() => {
    const numeric = Number(values.tax_rate ?? '15');
    if (!Number.isFinite(numeric)) return '15';
    return (numeric > 1 ? numeric : numeric * 100).toFixed(2).replace(/\.00$/, '');
  })();

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {isEdit ? <input type="hidden" name="itemId" value={item?.id} /> : null}

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" htmlFor="kind" hint="Services are labour; products are parts you supply.">
          <Select id="kind" name="kind" defaultValue={values.kind}>
            <option value="SERVICE">Service</option>
            <option value="PRODUCT">Product</option>
          </Select>
        </Field>

        <Field label="Name" htmlFor="name" error={firstError(state, 'name')} required>
          <TextInput
            id="name"
            name="name"
            defaultValue={values.name}
            placeholder="Distribution board replacement"
            required
            invalid={Boolean(firstError(state, 'name'))}
          />
        </Field>

        <Field
          label="Unit price (excl. VAT)"
          htmlFor="defaultPrice"
          error={firstError(state, 'defaultPrice')}
          required
        >
          <TextInput
            id="defaultPrice"
            name="defaultPrice"
            inputMode="decimal"
            defaultValue={values.default_price}
            placeholder="4850.00"
            required
            invalid={Boolean(firstError(state, 'defaultPrice'))}
          />
        </Field>

        <Field label="Unit" htmlFor="unit" error={firstError(state, 'unit')} required>
          <TextInput
            id="unit"
            name="unit"
            defaultValue={values.unit}
            placeholder="hour, job, each, metre"
            list="catalogue-units"
            required
            invalid={Boolean(firstError(state, 'unit'))}
          />
        </Field>

        <datalist id="catalogue-units">
          <option value="hour" />
          <option value="day" />
          <option value="job" />
          <option value="each" />
          <option value="metre" />
          <option value="point" />
        </datalist>

        <Field label="VAT rate (%)" htmlFor="taxRate" error={firstError(state, 'taxRate')}>
          <TextInput
            id="taxRate"
            name="taxRate"
            inputMode="decimal"
            defaultValue={taxPercent}
            placeholder="15"
            invalid={Boolean(firstError(state, 'taxRate'))}
          />
        </Field>

        <Field label="Cost price" htmlFor="costPrice" error={firstError(state, 'costPrice')} hint="Optional. Used for margin reporting later.">
          <TextInput
            id="costPrice"
            name="costPrice"
            inputMode="decimal"
            defaultValue={values.cost_price ?? ''}
            placeholder="Optional"
            invalid={Boolean(firstError(state, 'costPrice'))}
          />
        </Field>

        <Field label="Category" htmlFor="category">
          <TextInput
            id="category"
            name="category"
            defaultValue={values.category ?? ''}
            placeholder="Electrical, Compliance, Cable"
          />
        </Field>

        <Field label="SKU / code" htmlFor="sku">
          <TextInput id="sku" name="sku" defaultValue={values.sku ?? ''} placeholder="CB-20A" />
        </Field>
      </div>

      <Field label="Description" htmlFor="description" hint="Appears on quote and invoice lines by default.">
        <TextArea
          id="description"
          name="description"
          rows={3}
          defaultValue={values.description ?? ''}
          placeholder="Includes labour, materials and testing."
        />
      </Field>

      <label className="flex min-h-11 items-center gap-3 rounded-lg border border-ink-700 px-4 py-3">
        <input
          type="checkbox"
          name="isActive"
          value="true"
          defaultChecked={values.is_active}
          className="h-5 w-5 accent-ember-500"
        />
        <span className="text-sm text-steel-300">
          Active — available when building quotes and invoices
        </span>
      </label>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pendingLabel={isEdit ? 'Saving…' : 'Adding…'}>
          {isEdit ? 'Save item' : 'Add to catalogue'}
        </SubmitButton>
        <Link href="/app/catalogue" className="text-sm text-steel-400 hover:text-paper">
          Cancel
        </Link>
      </div>
    </form>
  );
}
