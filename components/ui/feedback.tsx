'use client';

import type { ReactNode } from 'react';
import { useFormStatus } from 'react-dom';
import { cn } from '@/lib/cn';
import { buttonClasses } from '@/components/ui/button';
import type { ActionState } from '@/lib/actions/state';

/**
 * Form status banner. Renders field-independent errors and confirmations
 * returned by Server Actions.
 */
export function FormMessage({ state }: { state: ActionState }) {
  if (state.status === 'idle' || !state.message) return null;

  const isError = state.status === 'error';

  return (
    <div
      role={isError ? 'alert' : 'status'}
      aria-live="polite"
      className={cn(
        'rounded-lg border px-3.5 py-3 text-sm',
        isError
          ? 'border-signal-danger/50 bg-signal-danger/10 text-signal-danger'
          : 'border-signal-success/50 bg-signal-success/10 text-signal-success'
      )}
    >
      <p>{state.message}</p>
      {state.devInfo ? (
        <p className="mt-2 break-all font-mono text-xs text-steel-300">{state.devInfo}</p>
      ) : null}
    </div>
  );
}

/** Submits a form and disables itself while the action is in flight. */
export function SubmitButton({
  children,
  variant = 'primary',
  size = 'md',
  className,
  pendingLabel = 'Working…',
}: {
  children: ReactNode;
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger';
  size?: 'sm' | 'md' | 'lg';
  className?: string;
  pendingLabel?: string;
}) {
  const { pending } = useFormStatus();

  return (
    <button
      type="submit"
      disabled={pending}
      aria-busy={pending}
      className={buttonClasses(variant, size, className)}
    >
      {pending ? pendingLabel : children}
    </button>
  );
}

export function Alert({
  tone = 'info',
  title,
  children,
}: {
  tone?: 'info' | 'warning' | 'danger' | 'ember' | 'success';
  title?: string;
  children: ReactNode;
}) {
  const tones = {
    info: 'border-signal-info/40 bg-signal-info/10 text-steel-300',
    success: 'border-signal-success/40 bg-signal-success/10 text-steel-300',
    warning: 'border-signal-warning/40 bg-signal-warning/10 text-steel-300',
    danger: 'border-signal-danger/40 bg-signal-danger/10 text-steel-300',
    ember: 'border-ember-500/40 bg-ember-500/10 text-steel-300',
  } as const;

  return (
    <div className={cn('rounded-lg border px-4 py-3 text-sm', tones[tone])}>
      {title ? <p className="mb-1 font-bold uppercase tracking-wider text-paper">{title}</p> : null}
      <div className="space-y-2">{children}</div>
    </div>
  );
}
