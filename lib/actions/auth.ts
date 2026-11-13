'use server';

import { redirect } from 'next/navigation';
import { getServerConfig } from '@/lib/config';
import { isPgError, PG_ERROR, withContext } from '@/lib/db';
import { hashPassword, verifyPassword } from '@/lib/auth/password';
import { generateId, generateOpaqueToken, hashToken } from '@/lib/auth/tokens';
import {
  endCurrentSession,
  requestMetadata,
  requireSession,
  startSession,
} from '@/lib/auth/current-user';
import { revokeOtherSessions } from '@/lib/auth/session-repository';
import {
  authenticate,
  changePassword as persistPassword,
  findUserForLogin,
  insertUser,
  recordFailedLogin,
  recordSuccessfulLogin,
  updateProfile,
} from '@/lib/repositories/users';
import {
  listMembershipsForUser,
  provisionBusiness,
  provisionBusinessDefaults,
  provisionMembership,
} from '@/lib/repositories/businesses';
import { safeAppRedirectPath } from '@/lib/security/redirect';
import { RATE_LIMITS, checkRateLimit } from '@/lib/security/rate-limit';
import {
  changePasswordSchema,
  forgotPasswordSchema,
  nullish,
  loginSchema,
  registerSchema,
  resetPasswordSchema,
  updateProfileSchema,
} from '@/lib/validation/schemas';
import {
  errorState,
  fieldErrorsFromZod,
  readString,
  successState,
  unexpectedError,
  type ActionState,
} from '@/lib/actions/state';

/**
 * Authentication Server Actions.
 *
 * Registration creates, in ONE transaction:
 *   user -> business -> owner membership -> business settings -> numbering
 * The ids are generated server-side and become the RLS context for the
 * transaction, which is why the inserts are permitted by the policies.
 */
export async function registerAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = registerSchema.safeParse({
    fullName: readString(formData, 'fullName'),
    email: readString(formData, 'email'),
    password: readString(formData, 'password'),
    confirmPassword: readString(formData, 'confirmPassword'),
    businessName: readString(formData, 'businessName'),
    tradingName: readString(formData, 'tradingName'),
    phone: readString(formData, 'phone'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const metadata = await requestMetadata();
  const limit = checkRateLimit(`register:${metadata.ipAddress ?? 'unknown'}`, RATE_LIMITS.register);
  if (!limit.allowed) {
    return errorState(
      `Too many sign-up attempts. Please try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`
    );
  }

  const userId = generateId();
  const businessId = generateId();
  const input = parsed.data;

  try {
    await withContext({ userId, businessId }, async (client) => {
      await insertUser(client, userId, {
        email: input.email,
        password: input.password,
        fullName: input.fullName,
        phone: nullish(input.phone),
      });

      await provisionBusiness(client, businessId, {
        legalName: input.businessName,
        tradingName: nullish(input.tradingName),
        phone: nullish(input.phone),
        email: input.email,
      });

      // Membership must exist before settings/sequences: their RLS policies
      // require an ACTIVE membership for the current user.
      await provisionMembership(client, businessId, userId, 'OWNER');
      await provisionBusinessDefaults(client, businessId);

      await client.query(
        `insert into audit_events (business_id, user_id, event_type, metadata, ip_address)
         values ($1, $2, 'auth.registered', '{}'::jsonb, $3)`,
        [businessId, userId, metadata.ipAddress]
      );
    });
  } catch (error) {
    if (isPgError(error, PG_ERROR.UNIQUE_VIOLATION)) {
      return errorState('That email address is already registered.', {
        email: ['An account with this email already exists. Try signing in instead.'],
      });
    }
    return unexpectedError('register', error);
  }

  try {
    await startSession({ userId, businessId });
    await recordSuccessfulLogin({ userId, businessId, ipAddress: metadata.ipAddress });
  } catch (error) {
    return unexpectedError('register:session', error);
  }

  redirect('/app/onboarding');
}

export async function loginAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = loginSchema.safeParse({
    email: readString(formData, 'email'),
    password: readString(formData, 'password'),
    next: readString(formData, 'next') ?? undefined,
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const metadata = await requestMetadata();
  const limit = checkRateLimit(
    `login:${metadata.ipAddress ?? 'unknown'}:${parsed.data.email}`,
    RATE_LIMITS.login
  );
  if (!limit.allowed) {
    return errorState(
      `Too many sign-in attempts. Please try again in ${Math.ceil(limit.retryAfterSeconds / 60)} minutes.`
    );
  }

  let userId: string;
  let businessId: string | null = null;

  try {
    const user = await authenticate(parsed.data.email, parsed.data.password);
    if (!user) {
      await recordFailedLogin(parsed.data.email, metadata.ipAddress);
      return errorState('Email or password is incorrect.');
    }

    const memberships = await listMembershipsForUser(user.id);
    const membership = memberships[0] ?? null;
    if (!membership) {
      return errorState(
        'This account is not linked to an active business. Contact support to restore access.'
      );
    }

    userId = user.id;
    businessId = membership.business_id;
    await startSession({ userId, businessId });
    await recordSuccessfulLogin({ userId, businessId, ipAddress: metadata.ipAddress });
  } catch (error) {
    return unexpectedError('login', error);
  }

  redirect(safeAppRedirectPath(parsed.data.next));
}

export async function logoutAction(): Promise<void> {
  await endCurrentSession();
  redirect('/login');
}

/**
 * Password reset request.
 *
 * No email provider is configured in Phase 1 (see ROADMAP.md), so in
 * development the reset link is returned to the browser without being written
 * to server logs. In production this branch is disabled and the same neutral
 * message is always returned, so the endpoint cannot be used to discover which
 * email addresses have accounts.
 */
export async function requestPasswordResetAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = forgotPasswordSchema.safeParse({
    email: readString(formData, 'email'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  const metadata = await requestMetadata();
  const limit = checkRateLimit(
    `reset:${metadata.ipAddress ?? 'unknown'}`,
    RATE_LIMITS.passwordReset
  );
  if (!limit.allowed) {
    return errorState('Too many reset requests. Please try again later.');
  }

  const config = getServerConfig();
  const token = generateOpaqueToken(32);
  const expiresAt = new Date(Date.now() + config.PASSWORD_RESET_TTL_MINUTES * 60 * 1000);
  const neutralMessage =
    'If an account exists for that email address, a reset link is on its way.';

  try {
    const created = await withContext({}, async (client) => {
      const { rows } = await client.query<{ created: boolean }>(
        `select app.auth_create_reset($1, $2, $3) as created`,
        [parsed.data.email, hashToken(token), expiresAt]
      );
      return rows[0]?.created === true;
    });

    if (!created) {
      return successState(neutralMessage);
    }

    const resetUrl = `${config.PUBLIC_APP_URL}/reset-password?token=${token}`;

    return successState(
      neutralMessage,
      config.isProduction ? null : `Development reset link: ${resetUrl}`
    );
  } catch (error) {
    return unexpectedError('requestPasswordReset', error);
  }
}

export async function resetPasswordAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const parsed = resetPasswordSchema.safeParse({
    token: readString(formData, 'token'),
    password: readString(formData, 'password'),
    confirmPassword: readString(formData, 'confirmPassword'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const passwordHash = await hashPassword(parsed.data.password);
    const result = await withContext({}, async (client) => {
      const { rows } = await client.query<{ user_id: string; email: string }>(
        `select * from app.auth_consume_reset_and_set_password($1, $2)`,
        [hashToken(parsed.data.token), passwordHash]
      );
      return rows[0] ?? null;
    });

    if (!result) {
      return errorState(
        'That reset link is invalid or has expired. Request a new one and try again.'
      );
    }
  } catch (error) {
    return unexpectedError('resetPassword', error);
  }

  redirect('/login?reset=1');
}

export async function updateProfileAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = updateProfileSchema.safeParse({
    fullName: readString(formData, 'fullName'),
    phone: readString(formData, 'phone'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    const updated = await updateProfile(session.userId, {
      fullName: parsed.data.fullName,
      phone: nullish(parsed.data.phone),
    });
    if (!updated) return errorState('Your profile could not be updated.');
  } catch (error) {
    return unexpectedError('updateProfile', error);
  }

  return successState('Profile updated.');
}

export async function changePasswordAction(
  _previous: ActionState,
  formData: FormData
): Promise<ActionState> {
  const session = await requireSession();

  const parsed = changePasswordSchema.safeParse({
    currentPassword: readString(formData, 'currentPassword'),
    newPassword: readString(formData, 'newPassword'),
    confirmPassword: readString(formData, 'confirmPassword'),
  });

  if (!parsed.success) {
    return errorState('Please check the highlighted fields.', fieldErrorsFromZod(parsed.error));
  }

  try {
    // Re-authenticate before allowing a credential change.
    const current = await findUserForLogin(session.email);
    const matches = current
      ? await verifyPassword(parsed.data.currentPassword, current.password_hash)
      : false;

    if (!matches) {
      return errorState('Please check the highlighted fields.', {
        currentPassword: ['That is not your current password.'],
      });
    }

    await persistPassword(session.userId, parsed.data.newPassword);
    const revoked = await revokeOtherSessions(session.userId, session.sessionId);

    return successState(
      revoked > 0
        ? `Password changed. ${revoked} other session${revoked === 1 ? '' : 's'} signed out.`
        : 'Password changed.'
    );
  } catch (error) {
    return unexpectedError('changePassword', error);
  }
}
