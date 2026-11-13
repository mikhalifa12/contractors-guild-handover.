/**
 * Shared shape returned by every Server Action that backs a form, so client
 * components can render field-level and form-level errors consistently.
 */
export type ActionState = {
  status: 'idle' | 'success' | 'error';
  message: string | null;
  fieldErrors: Record<string, string[]>;
  /**
   * Machine-readable reason for the state, so a form can offer the right next
   * step (for example "duplicate_customer" adds a Save anyway button) without
   * matching on the message text.
   */
  code?: string | null;
  /**
   * Development-only diagnostics, for example the password reset link when no
   * email provider is configured yet. Never populated in production.
   */
  devInfo?: string | null;
};

export const initialActionState: ActionState = {
  status: 'idle',
  message: null,
  fieldErrors: {},
  code: null,
  devInfo: null,
};

export function errorState(
  message: string,
  fieldErrors: Record<string, string[]> = {},
  code: string | null = null
): ActionState {
  return { status: 'error', message, fieldErrors, code, devInfo: null };
}

export function successState(message: string | null = null, devInfo: string | null = null): ActionState {
  return { status: 'success', message, fieldErrors: {}, code: null, devInfo };
}

/** Log the real error server-side, show the user something safe. */
export function unexpectedError(context: string, error: unknown): ActionState {
  console.error(`[action:${context}]`, error);
  return errorState(
    'Something went wrong on our side. Please try again, and contact support if it keeps happening.'
  );
}

/**
 * Convert a Zod error into per-field messages.
 *
 * Typed structurally so this module (which is imported by client components)
 * does not pull Zod into the browser bundle.
 */
export function fieldErrorsFromZod(error: {
  issues: ReadonlyArray<{ path: ReadonlyArray<string | number>; message: string }>;
}): Record<string, string[]> {
  const fieldErrors: Record<string, string[]> = {};
  for (const issue of error.issues) {
    const key = issue.path.join('.') || 'form';
    fieldErrors[key] = [...(fieldErrors[key] ?? []), issue.message];
  }
  return fieldErrors;
}

/** First error message for a field, if any (used under inputs). */
export function firstError(state: ActionState, field: string): string | undefined {
  return state.fieldErrors[field]?.[0];
}

/** Read a string from FormData without ever returning undefined. */
export function readString(formData: FormData, key: string): string {
  const value = formData.get(key);
  return typeof value === 'string' ? value : '';
}
