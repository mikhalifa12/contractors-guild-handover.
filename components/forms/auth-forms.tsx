'use client';

import Link from 'next/link';
import { useActionState } from 'react';
import { Field, TextInput } from '@/components/ui/field';
import { FormMessage, SubmitButton } from '@/components/ui/feedback';
import {
  loginAction,
  registerAction,
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/lib/actions/auth';
import { firstError, initialActionState } from '@/lib/actions/state';

const loginDefaults = initialActionState;

export function LoginForm({ next }: { next?: string } = {}) {
  const [state, formAction] = useActionState(loginAction, loginDefaults);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      {next ? <input type="hidden" name="next" value={next} /> : null}

      <Field label="Email" htmlFor="email" error={firstError(state, 'email')} required>
        <TextInput
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          placeholder="you@example.co.za"
          required
          invalid={Boolean(firstError(state, 'email'))}
        />
      </Field>

      <Field label="Password" htmlFor="password" error={firstError(state, 'password')} required>
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          invalid={Boolean(firstError(state, 'password'))}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Signing in…">
        Sign in
      </SubmitButton>

      <div className="flex items-center justify-between text-sm">
        <Link href="/forgot-password" className="text-steel-400 hover:text-paper">
          Forgot your password?
        </Link>
        <Link href="/register" className="font-semibold text-ember-400 hover:text-ember-300">
          Create an account
        </Link>
      </div>
    </form>
  );
}

export function RegisterForm() {
  const [state, formAction] = useActionState(registerAction, initialActionState);

  return (
    <form action={formAction} className="space-y-5" noValidate>
      <FormMessage state={state} />

      <fieldset className="space-y-4">
        <legend className="cg-eyebrow mb-2">Your business</legend>

        <Field
          label="Business name"
          htmlFor="businessName"
          error={firstError(state, 'businessName')}
          hint="Appears on every quote, invoice and receipt."
          required
        >
          <TextInput
            id="businessName"
            name="businessName"
            autoComplete="organization"
            required
            invalid={Boolean(firstError(state, 'businessName'))}
          />
        </Field>

        <Field label="Trading name" htmlFor="tradingName" error={firstError(state, 'tradingName')}>
          <TextInput id="tradingName" name="tradingName" placeholder="Optional" />
        </Field>

        <Field label="Business phone" htmlFor="phone" error={firstError(state, 'phone')}>
          <TextInput id="phone" name="phone" type="tel" inputMode="tel" autoComplete="tel" />
        </Field>
      </fieldset>

      <fieldset className="space-y-4">
        <legend className="cg-eyebrow mb-2">Your account</legend>

        <Field label="Your name" htmlFor="fullName" error={firstError(state, 'fullName')} required>
          <TextInput
            id="fullName"
            name="fullName"
            autoComplete="name"
            required
            invalid={Boolean(firstError(state, 'fullName'))}
          />
        </Field>

        <Field label="Email" htmlFor="email" error={firstError(state, 'email')} required>
          <TextInput
            id="email"
            name="email"
            type="email"
            inputMode="email"
            autoComplete="email"
            autoCapitalize="none"
            required
            invalid={Boolean(firstError(state, 'email'))}
          />
        </Field>

        <Field
          label="Password"
          htmlFor="password"
          error={firstError(state, 'password')}
          hint="At least 10 characters."
          required
        >
          <TextInput
            id="password"
            name="password"
            type="password"
            autoComplete="new-password"
            required
            invalid={Boolean(firstError(state, 'password'))}
          />
        </Field>

        <Field
          label="Confirm password"
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
      </fieldset>

      <SubmitButton className="w-full" pendingLabel="Creating your account…">
        Create account
      </SubmitButton>

      <p className="text-center text-sm text-steel-400">
        Already registered?{' '}
        <Link href="/login" className="font-semibold text-ember-400 hover:text-ember-300">
          Sign in
        </Link>
      </p>
    </form>
  );
}

export function ForgotPasswordForm() {
  const [state, formAction] = useActionState(requestPasswordResetAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <Field label="Email" htmlFor="email" error={firstError(state, 'email')} required>
        <TextInput
          id="email"
          name="email"
          type="email"
          inputMode="email"
          autoComplete="email"
          autoCapitalize="none"
          required
          invalid={Boolean(firstError(state, 'email'))}
        />
      </Field>

      <SubmitButton className="w-full" pendingLabel="Sending…">
        Send reset link
      </SubmitButton>

      <p className="text-center text-sm text-steel-400">
        <Link href="/login" className="hover:text-paper">
          Back to sign in
        </Link>
      </p>
    </form>
  );
}

export function ResetPasswordForm({ token }: { token: string }) {
  const [state, formAction] = useActionState(resetPasswordAction, initialActionState);

  return (
    <form action={formAction} className="space-y-4" noValidate>
      <FormMessage state={state} />

      <input type="hidden" name="token" value={token} />

      <Field
        label="New password"
        htmlFor="password"
        error={firstError(state, 'password')}
        hint="At least 10 characters."
        required
      >
        <TextInput
          id="password"
          name="password"
          type="password"
          autoComplete="new-password"
          required
          invalid={Boolean(firstError(state, 'password'))}
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

      <SubmitButton className="w-full" pendingLabel="Updating password…">
        Update password
      </SubmitButton>
    </form>
  );
}
