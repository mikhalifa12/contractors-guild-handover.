'use client';

import { useActionState } from 'react';
import Link from 'next/link';
import type { ActionState } from '@/lib/actions/state';
import { firstError, initialActionState } from '@/lib/actions/state';
import { createJobAction, updateJobAction } from '@/lib/actions/jobs';
import { JOB_STATUSES } from '@/lib/jobs';
import { humaniseEnum } from '@/lib/format';
import { Field, Select, TextArea, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { Autocomplete } from '@/components/ui/autocomplete';

export type JobFormValues = {
  id?: string;
  customerId: string;
  title: string;
  description: string | null;
  jobType: string | null;
  status: string;
  scheduledDate: string | null;
  jobAddressLine1: string | null;
  jobAddressLine2: string | null;
  jobCity: string | null;
  jobProvince: string | null;
  jobPostalCode: string | null;
  notes: string | null;
};

export type CustomerChoice = {
  value: string;
  label: string;
  hint?: string | null;
};

/**
 * Create/edit a job.
 *
 * The customer is chosen through the searchable picker (type a few letters, tap
 * once). Leaving the site address blank copies the customer's site address in
 * the repository, so a phone user does not retype it.
 */
export function JobForm({
  customers,
  job,
}: {
  customers: CustomerChoice[];
  job?: JobFormValues;
}) {
  const isEdit = Boolean(job?.id);
  const [state, formAction] = useActionState<ActionState, FormData>(
    isEdit ? updateJobAction : createJobAction,
    initialActionState
  );

  const defaultCustomer = job?.customerId
    ? (customers.find((option) => option.value === job.customerId) ?? null)
    : null;

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />
      {isEdit ? <input type="hidden" name="jobId" value={job?.id} /> : null}

      <Field
        label="Customer"
        htmlFor="customerId"
        error={firstError(state, 'customerId')}
        required
        hint={
          customers.length === 0
            ? 'Add a customer first — it takes a few seconds.'
            : 'Start typing a name or phone number.'
        }
      >
        <Autocomplete
          id="customerId"
          name="customerId"
          options={customers}
          defaultOption={defaultCustomer}
          required
          invalid={Boolean(firstError(state, 'customerId'))}
          placeholder="Search customers…"
          emptyHint="No customer matches that. Add the customer first, then create the job."
        />
      </Field>

      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Job title" htmlFor="title" error={firstError(state, 'title')} required>
          <TextInput
            id="title"
            name="title"
            defaultValue={job?.title ?? ''}
            placeholder="Kitchen plugs tripping the earth leakage"
            required
            invalid={Boolean(firstError(state, 'title'))}
          />
        </Field>

        <Field label="Job type" htmlFor="jobType" hint="Fault finding, installation, compliance…">
          <TextInput
            id="jobType"
            name="jobType"
            defaultValue={job?.jobType ?? ''}
            list="job-types"
            placeholder="Fault finding"
          />
        </Field>

        <datalist id="job-types">
          <option value="Fault finding" />
          <option value="Installation" />
          <option value="Maintenance" />
          <option value="Compliance" />
          <option value="Quote request" />
        </datalist>

        {!isEdit ? (
          <Field label="Starting status" htmlFor="status" hint="New enquiries usually start as a Lead.">
            <Select id="status" name="status" defaultValue={job?.status ?? 'LEAD'}>
              {JOB_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {humaniseEnum(status)}
                </option>
              ))}
            </Select>
          </Field>
        ) : null}

        <Field label="Scheduled date" htmlFor="scheduledDate" hint="Optional until the work is booked.">
          <TextInput
            id="scheduledDate"
            name="scheduledDate"
            type="date"
            defaultValue={job?.scheduledDate ?? ''}
          />
        </Field>
      </div>

      <Field label="What needs doing" htmlFor="description">
        <TextArea
          id="description"
          name="description"
          rows={3}
          defaultValue={job?.description ?? ''}
          placeholder="Customer reports the earth leakage trips when the kettle and microwave run together."
        />
      </Field>

      <fieldset className="space-y-4 rounded-lg border border-ink-700 p-4">
        <legend className="cg-eyebrow px-1">Site address</legend>
        <p className="text-xs text-steel-500">
          Leave blank to use the customer&apos;s site address on file.
        </p>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Site line 1" htmlFor="jobAddressLine1">
            <TextInput
              id="jobAddressLine1"
              name="jobAddressLine1"
              defaultValue={job?.jobAddressLine1 ?? ''}
            />
          </Field>
          <Field label="Site line 2" htmlFor="jobAddressLine2">
            <TextInput
              id="jobAddressLine2"
              name="jobAddressLine2"
              defaultValue={job?.jobAddressLine2 ?? ''}
            />
          </Field>
          <Field label="City / suburb" htmlFor="jobCity">
            <TextInput id="jobCity" name="jobCity" defaultValue={job?.jobCity ?? ''} />
          </Field>
          <Field label="Province" htmlFor="jobProvince">
            <TextInput id="jobProvince" name="jobProvince" defaultValue={job?.jobProvince ?? ''} />
          </Field>
          <Field label="Postal code" htmlFor="jobPostalCode">
            <TextInput
              id="jobPostalCode"
              name="jobPostalCode"
              inputMode="numeric"
              defaultValue={job?.jobPostalCode ?? ''}
            />
          </Field>
        </div>
      </fieldset>

      <Field label="Notes" htmlFor="notes" hint="Gate codes, dogs, parking, who to ask for.">
        <TextArea id="notes" name="notes" rows={3} defaultValue={job?.notes ?? ''} />
      </Field>

      <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
        <SubmitButton pendingLabel={isEdit ? 'Saving…' : 'Creating…'}>
          {isEdit ? 'Save job' : 'Create job'}
        </SubmitButton>
        <Link
          href={isEdit && job?.id ? `/app/jobs/${job.id}` : '/app/jobs'}
          className="text-sm text-steel-400 hover:text-paper"
        >
          Cancel
        </Link>
      </div>
    </form>
  );
}
