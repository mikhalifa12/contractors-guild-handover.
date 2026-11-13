'use client';

import { useActionState } from 'react';
import { Field, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import { changePasswordAction, updateProfileAction } from '@/lib/actions/auth';
import { firstError, initialActionState } from '@/lib/actions/state';

export function ProfileForm({
  fullName,
  phone,
  email,
}: {
  fullName: string;
  phone: string | null;
  email: string;
}) {
  const [state, formAction] = useActionState(updateProfileAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <Field label="Email" htmlFor="emailDisplay" hint="Email changes need support verification.">
        <TextInput id="emailDisplay" name="emailDisplay" value={email} readOnly disabled />
      </Field>

      <Field label="Your name" htmlFor="fullName" error={firstError(state, 'fullName')} required>
        <TextInput
          id="fullName"
          name="fullName"
          defaultValue={fullName}
          autoComplete="name"
          required
          invalid={Boolean(firstError(state, 'fullName'))}
        />
      </Field>

      <Field label="Mobile number" htmlFor="phone" error={firstError(state, 'phone')}>
        <TextInput
          id="phone"
          name="phone"
          type="tel"
          inputMode="tel"
          autoComplete="tel"
          defaultValue={phone ?? ''}
        />
      </Field>

      <SubmitButton pendingLabel="Saving…">Save profile</SubmitButton>
    </form>
  );
}

export function ChangePasswordForm() {
  const [state, formAction] = useActionState(changePasswordAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <Field
        label="Current password"
        htmlFor="currentPassword"
        error={firstError(state, 'currentPassword')}
        required
      >
        <TextInput
          id="currentPassword"
          name="currentPassword"
          type="password"
          autoComplete="current-password"
          required
          invalid={Boolean(firstError(state, 'currentPassword'))}
        />
      </Field>

      <Field
        label="New password"
        htmlFor="newPassword"
        error={firstError(state, 'newPassword')}
        hint="At least 10 characters. Other devices are signed out automatically."
        required
      >
        <TextInput
          id="newPassword"
          name="newPassword"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(firstError(state, 'newPassword'))}
        />
      </Field>

      <Field
        label="Confirm new password"
        htmlFor="confirmPassword"
        error={firstError(state, 'confirmPassword')}
        required
      >
        <TextInput
          id="confirmPassword"
          name="confirmPassword"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(firstError(state, 'confirmPassword'))}
        />
      </Field>

      <SubmitButton pendingLabel="Updating…">Change password</SubmitButton>
    </form>
  );
}
