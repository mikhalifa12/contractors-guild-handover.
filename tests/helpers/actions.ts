import { RedirectSignal } from '@/tests/helpers/next-mocks';
import type { ActionState } from '@/lib/actions/state';
import { initialActionState } from '@/lib/actions/state';

/** Build FormData from a plain object (files supported for upload tests). */
export function formData(entries: Record<string, string | Blob>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(entries)) {
    data.append(key, value);
  }
  return data;
}

export type ActionOutcome =
  | { kind: 'state'; state: ActionState }
  | { kind: 'redirect'; url: string };

/**
 * Run a Server Action the way the browser would, capturing the redirect that
 * Next.js would perform instead of letting it escape the test.
 */
export async function runAction(
  action: (state: ActionState, data: FormData) => Promise<ActionState>,
  data: FormData,
  previous: ActionState = initialActionState
): Promise<ActionOutcome> {
  try {
    const state = await action(previous, data);
    return { kind: 'state', state };
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return { kind: 'redirect', url: error.url };
    }
    throw error;
  }
}

/**
 * Run a Server Action that takes only FormData (the shape used by plain
 * `<form action={...}>` buttons such as Archive and status changes) and capture
 * its redirect.
 */
export async function runFormAction(
  action: (data: FormData) => Promise<void>,
  data: FormData
): Promise<ActionOutcome> {
  try {
    await action(data);
    return { kind: 'state', state: initialActionState };
  } catch (error) {
    if (error instanceof RedirectSignal) {
      return { kind: 'redirect', url: error.url };
    }
    throw error;
  }
}

export function expectRedirect(outcome: ActionOutcome, prefix: string): void {
  if (outcome.kind !== 'redirect') {
    throw new Error(
      `Expected a redirect to ${prefix} but the action returned state: ${JSON.stringify(outcome.state)}`
    );
  }
  if (!outcome.url.startsWith(prefix)) {
    throw new Error(`Expected redirect to ${prefix} but went to ${outcome.url}`);
  }
}

export function expectStateError(outcome: ActionOutcome): ActionState {
  if (outcome.kind !== 'state') {
    throw new Error(`Expected an error state but the action redirected to ${outcome.url}`);
  }
  if (outcome.state.status !== 'error') {
    throw new Error(`Expected an error state, received: ${JSON.stringify(outcome.state)}`);
  }
  return outcome.state;
}

export function expectStateSuccess(outcome: ActionOutcome): ActionState {
  if (outcome.kind !== 'state') {
    throw new Error(`Expected a success state but the action redirected to ${outcome.url}`);
  }
  if (outcome.state.status !== 'success') {
    throw new Error(`Expected a success state, received: ${JSON.stringify(outcome.state)}`);
  }
  return outcome.state;
}
