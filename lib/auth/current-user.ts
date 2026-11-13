import { cookies, headers } from 'next/headers';
import { redirect } from 'next/navigation';
import { getServerConfig } from '@/lib/config';
import { addDays, generateOpaqueToken, hashToken } from '@/lib/auth/tokens';
import {
  createSession,
  findSessionByTokenHash,
  revokeSession,
  touchSession,
  verifyActiveMembership,
  type BusinessRole,
} from '@/lib/auth/session-repository';

/**
 * Server-side session access.
 *
 * This module is the ONLY place that translates a cookie into a tenant
 * context. Server Actions and pages call requireSession()/requireBusinessSession()
 * and never accept a business id from the request.
 */
export type CurrentSession = {
  sessionId: string;
  userId: string;
  email: string;
  fullName: string;
  businessId: string;
  businessRole: BusinessRole;
  legalName: string;
  tradingName: string | null;
  currencyCode: string;
};

function cookieName(): string {
  return getServerConfig().SESSION_COOKIE_NAME;
}

export function sessionCookieOptions(expiresAt: Date) {
  const config = getServerConfig();
  return {
    httpOnly: true,
    sameSite: 'lax' as const,
    secure: config.isProduction,
    path: '/',
    expires: expiresAt,
  };
}

export function newSessionExpiry(now = new Date()): Date {
  return addDays(now, getServerConfig().SESSION_TTL_DAYS);
}

/** Read the current session, or null when there is none / it is invalid. */
export async function getCurrentSession(): Promise<CurrentSession | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName())?.value;
  if (!token) return null;

  const row = await findSessionByTokenHash(hashToken(token));
  if (!row) return null;

  const expiresAt = new Date(row.session_expires_at);
  if (row.session_revoked_at || expiresAt.getTime() <= Date.now() || !row.user_is_active) {
    return null;
  }

  if (!row.business_id || !row.business_role) {
    // A signed-in user without an active business cannot use the app area.
    return null;
  }

  // Defence in depth: re-check the membership through the RLS-protected table.
  const stillMember = await verifyActiveMembership(row.user_id, row.business_id);
  if (!stillMember) return null;

  void touchSession(row.session_id, row.user_id).catch(() => {
    // A failed last_seen update must never break a request.
  });

  return {
    sessionId: row.session_id,
    userId: row.user_id,
    email: row.email,
    fullName: row.full_name,
    businessId: row.business_id,
    businessRole: row.business_role,
    legalName: row.legal_name ?? 'Your business',
    tradingName: row.trading_name,
    currencyCode: row.currency_code ?? 'ZAR',
  };
}

export async function requireSession(): Promise<CurrentSession> {
  const session = await getCurrentSession();
  if (!session) redirect('/login');
  return session;
}

/** Start a session for a user and set the session cookie. */
export async function startSession(params: {
  userId: string;
  businessId: string | null;
}): Promise<{ token: string; expiresAt: Date }> {
  const token = generateOpaqueToken();
  const expiresAt = newSessionExpiry();
  const metadata = await requestMetadata();

  await createSession({
    userId: params.userId,
    businessId: params.businessId,
    tokenHash: hashToken(token),
    expiresAt,
    ipAddress: metadata.ipAddress,
    userAgent: metadata.userAgent,
  });

  const cookieStore = await cookies();
  cookieStore.set(cookieName(), token, sessionCookieOptions(expiresAt));

  return { token, expiresAt };
}

export async function endCurrentSession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(cookieName())?.value;

  if (token) {
    const row = await findSessionByTokenHash(hashToken(token));
    if (row) {
      await revokeSession(row.session_id, row.user_id);
    }
  }

  cookieStore.set(cookieName(), '', { ...sessionCookieOptions(new Date(0)), expires: new Date(0) });
}

export async function requestMetadata(): Promise<{
  ipAddress: string | null;
  userAgent: string | null;
}> {
  const headerList = await headers();
  const forwardedFor = headerList.get('x-forwarded-for');
  const ipAddress = forwardedFor
    ? (forwardedFor.split(',')[0]?.trim() ?? null)
    : (headerList.get('x-real-ip') ?? null);

  return { ipAddress, userAgent: headerList.get('user-agent') };
}
