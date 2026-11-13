import '@/tests/helpers/env';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('next/headers', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    cookies: async () => mocks.cookieStore,
    headers: async () => mocks.headersList,
  };
});

vi.mock('next/navigation', async () => {
  const mocks = await import('@/tests/helpers/next-mocks');
  return {
    redirect: (url: string): never => {
      throw new mocks.RedirectSignal(url);
    },
  };
});

vi.mock('next/cache', () => ({ revalidatePath: () => undefined }));

import {
  loginAction,
  logoutAction,
  registerAction,
  requestPasswordResetAction,
  resetPasswordAction,
} from '@/lib/actions/auth';
import { requireSession } from '@/lib/auth/current-user';
import { clearRateLimits } from '@/lib/security/rate-limit';
import { countRows, resetDatabase, withAdminClient } from '@/tests/helpers/env';
import { cookieStore, RedirectSignal } from '@/tests/helpers/next-mocks';
import {
  expectRedirect,
  expectStateError,
  expectStateSuccess,
  formData,
  runAction,
} from '@/tests/helpers/actions';

const PASSWORD = 'guild-strong-password';

afterEach(() => {
  vi.restoreAllMocks();
});

async function registerOwner(
  overrides: Partial<Record<'email' | 'businessName' | 'fullName' | 'password', string>> = {}
) {
  const email = overrides.email ?? `owner-${crypto.randomUUID()}@example.com`;
  const outcome = await runAction(
    registerAction,
    formData({
      fullName: overrides.fullName ?? 'Sipho Ndlovu',
      email,
      password: overrides.password ?? PASSWORD,
      confirmPassword: overrides.password ?? PASSWORD,
      businessName: overrides.businessName ?? 'Ndlovu Electrical',
      tradingName: 'Ndlovu Sparks',
      phone: '+27 82 555 0100',
    })
  );
  return { email, outcome };
}

describe('registration', () => {
  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
  });

  it('creates the user, business, owner membership, settings and numbering in one step', async () => {
    const { email, outcome } = await registerOwner();

    expectRedirect(outcome, '/app/onboarding');

    expect(await countRows('users')).toBe(1);
    expect(await countRows('businesses')).toBe(1);
    expect(await countRows('business_users', `role = 'OWNER' and status = 'ACTIVE'`)).toBe(1);
    expect(await countRows('business_settings')).toBe(1);
    expect(await countRows('document_sequences')).toBe(4);
    expect(await countRows('audit_events', `event_type = 'auth.registered'`)).toBe(1);

    // The email is stored normalised and the password is never stored in clear.
    const user = await withAdminClient(async (client) => {
      const { rows } = await client.query<{ email: string; password_hash: string }>(
        `select email, password_hash from public.users`
      );
      return rows[0];
    });
    expect(user?.email).toBe(email.toLowerCase());
    expect(user?.password_hash).not.toContain(PASSWORD);
    expect(user?.password_hash.startsWith('scrypt$')).toBe(true);

    // A session cookie was issued.
    expect(cookieStore.peek('cg_session')).toBeTruthy();
  });

  it('refuses a duplicate email address (case insensitive)', async () => {
    const { email } = await registerOwner();
    const duplicate = await registerOwner({ email: email.toUpperCase() });

    const state = expectStateError(duplicate.outcome);
    expect(state.fieldErrors.email?.[0]).toMatch(/already/i);
    expect(await countRows('users')).toBe(1);
    expect(await countRows('businesses')).toBe(1);
  });

  it('rejects invalid input before touching the database', async () => {
    const outcome = await runAction(
      registerAction,
      formData({
        fullName: 'A',
        email: 'not-an-email',
        password: 'short',
        confirmPassword: 'short',
        businessName: '',
        tradingName: '',
        phone: '',
      })
    );

    const state = expectStateError(outcome);
    expect(Object.keys(state.fieldErrors).length).toBeGreaterThan(0);
    expect(await countRows('users')).toBe(0);
  });

  it('rate limits repeated sign-ups from the same address', async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      await registerOwner();
    }
    const blocked = await registerOwner();
    const state = expectStateError(blocked.outcome);
    expect(state.message).toMatch(/too many sign-up attempts/i);
    expect(await countRows('users')).toBe(5);
  });
});

describe('sign in and sign out', () => {
  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
  });

  it('honours a same-origin next target and ignores an external one', async () => {
    const { email } = await registerOwner();
    cookieStore.clear();

    const deepLink = await runAction(
      loginAction,
      formData({ email, password: PASSWORD, next: '/app/invoices' })
    );
    expectRedirect(deepLink, '/app/invoices');

    cookieStore.clear();
    const openRedirect = await runAction(
      loginAction,
      formData({ email, password: PASSWORD, next: 'https://evil.example.com/steal' })
    );
    expectRedirect(openRedirect, '/app');
  });

  it('signs in with valid credentials and records the login', async () => {
    const { email } = await registerOwner();
    cookieStore.clear();

    const outcome = await runAction(loginAction, formData({ email, password: PASSWORD }));
    expectRedirect(outcome, '/app');

    expect(cookieStore.peek('cg_session')).toBeTruthy();
    expect(await countRows('sessions', 'revoked_at is null')).toBe(2); // registration + login
    // Registration signs the owner in immediately, so two successful sign-ins are recorded.
    expect(await countRows('audit_events', `event_type = 'auth.login_succeeded'`)).toBe(2);
    expect(
      await countRows('users', 'last_login_at is not null')
    ).toBe(1);
  });

  it('accepts the email in any casing', async () => {
    const { email } = await registerOwner();
    cookieStore.clear();

    const outcome = await runAction(
      loginAction,
      formData({ email: email.toUpperCase(), password: PASSWORD })
    );
    expectRedirect(outcome, '/app');
  });

  it('rejects a wrong password, records the failure and issues no session', async () => {
    const { email } = await registerOwner();
    cookieStore.clear();

    const outcome = await runAction(
      loginAction,
      formData({ email, password: 'definitely-not-the-password' })
    );
    const state = expectStateError(outcome);
    expect(state.message).toMatch(/incorrect/i);
    expect(cookieStore.peek('cg_session')).toBeUndefined();
    // No new session row: only the one created at registration remains.
    expect(await countRows('sessions')).toBe(1);
    expect(await countRows('audit_events', `event_type = 'auth.login_failed'`)).toBe(1);
  });

  it('gives the same answer for an unknown account', async () => {
    const outcome = await runAction(
      loginAction,
      formData({ email: 'nobody@example.com', password: PASSWORD })
    );
    const state = expectStateError(outcome);
    expect(state.message).toMatch(/incorrect/i);
  });

  it('revokes the session on sign out', async () => {
    const { email } = await registerOwner();
    cookieStore.clear();
    await runAction(loginAction, formData({ email, password: PASSWORD }));

    await expect(logoutAction()).rejects.toBeInstanceOf(RedirectSignal);

    expect(cookieStore.peek('cg_session')).toBeUndefined();

    // The current session is revoked; the one created at registration stays
    // valid (a different device/browser as far as the database is concerned).
    expect(await countRows('sessions', 'revoked_at is null')).toBe(1);
    await expect(requireSession()).rejects.toBeInstanceOf(RedirectSignal);
  });
});

describe('password reset', () => {
  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
  });

  it('issues a one-time reset link and rotates the password', async () => {
    const { email } = await registerOwner();
    const consoleSpies = (['log', 'info', 'warn', 'error'] as const).map((method) =>
      vi.spyOn(console, method).mockImplementation(() => undefined)
    );

    const request = await runAction(requestPasswordResetAction, formData({ email }));
    const requested = expectStateSuccess(request);
    expect(requested.message).toMatch(/if an account exists/i);
    expect(requested.devInfo).toContain('/reset-password?token=');
    // Compare only the call count so a regression cannot print the bearer token
    // inside Vitest's assertion diagnostics.
    expect(consoleSpies.some((spy) => spy.mock.calls.length > 0)).toBe(false);
    expect(await countRows('password_reset_tokens', 'used_at is null')).toBe(1);

    const token = requested.devInfo?.split('token=')[1] ?? '';
    expect(token.length).toBeGreaterThan(20);

    const newPassword = 'a-brand-new-password';
    const reset = await runAction(
      resetPasswordAction,
      formData({ token, password: newPassword, confirmPassword: newPassword })
    );
    expectRedirect(reset, '/login?reset=1');

    // Old sessions are revoked, the token cannot be reused.
    expect(await countRows('sessions', 'revoked_at is null')).toBe(0);
    expect(await countRows('password_reset_tokens', 'used_at is not null')).toBe(1);

    const reuse = await runAction(
      resetPasswordAction,
      formData({ token, password: newPassword, confirmPassword: newPassword })
    );
    expectStateError(reuse);

    // New password works, the old one does not.
    cookieStore.clear();
    const withNew = await runAction(loginAction, formData({ email, password: newPassword }));
    expectRedirect(withNew, '/app');

    cookieStore.clear();
    const withOld = await runAction(loginAction, formData({ email, password: PASSWORD }));
    expectStateError(withOld);
  });

  it('does not reveal whether an account exists', async () => {
    const outcome = await runAction(
      requestPasswordResetAction,
      formData({ email: 'ghost@example.com' })
    );
    const state = expectStateSuccess(outcome);
    expect(state.message).toMatch(/if an account exists/i);
    expect(state.devInfo).toBeNull();
    expect(await countRows('password_reset_tokens')).toBe(0);
  });

  it('rejects an invalid token', async () => {
    const outcome = await runAction(
      resetPasswordAction,
      formData({
        token: 'not-a-real-token',
        password: 'a-brand-new-password',
        confirmPassword: 'a-brand-new-password',
      })
    );
    const state = expectStateError(outcome);
    expect(state.message).toMatch(/invalid or has expired/i);
  });
});

describe('protected area', () => {
  beforeEach(async () => {
    await resetDatabase();
    cookieStore.clear();
    clearRateLimits();
  });

  it('redirects to the login page when there is no session', async () => {
    await expect(requireSession()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it('redirects when the session token is forged', async () => {
    await registerOwner();
    await cookieStore.set('cg_session', 'a-forged-session-token');
    await expect(requireSession()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it('honours a valid session', async () => {
    const { email } = await registerOwner();
    const session = await requireSession();
    expect(session.email).toBe(email.toLowerCase());
    expect(session.businessRole).toBe('OWNER');
    expect(session.businessId).toMatch(/^[0-9a-f-]{36}$/);
  });

  it('stops accepting a session once it is revoked in the database', async () => {
    await registerOwner();
    expect((await requireSession()).email).toBeTruthy();

    await withAdminClient(async (client) => {
      await client.query(`update public.sessions set revoked_at = now()`);
    });

    await expect(requireSession()).rejects.toBeInstanceOf(RedirectSignal);
  });

  it('stops accepting sessions after the expiry time passes', async () => {
    await registerOwner();
    await withAdminClient(async (client) => {
      await client.query(
        `update public.sessions
            set created_at = now() - interval '2 days',
                expires_at = now() - interval '1 day'`
      );
    });

    await expect(requireSession()).rejects.toBeInstanceOf(RedirectSignal);
  });
});
