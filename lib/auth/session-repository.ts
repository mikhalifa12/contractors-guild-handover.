import { withContext } from '@/lib/db';

/**
 * Session persistence.
 *
 * Only the SHA-256 hash of the session token is stored. Lookups happen through
 * app.auth_find_session because the caller does not yet have a session context
 * when it presents the cookie.
 */
export type BusinessRole = 'OWNER' | 'ADMIN' | 'STAFF' | 'VIEWER';

export type SessionLookupRow = {
  session_id: string;
  user_id: string;
  email: string;
  full_name: string;
  user_is_active: boolean;
  session_expires_at: string | Date;
  session_revoked_at: string | Date | null;
  business_id: string | null;
  business_role: BusinessRole | null;
  membership_status: 'INVITED' | 'ACTIVE' | 'DISABLED' | null;
  legal_name: string | null;
  trading_name: string | null;
  currency_code: string | null;
};

export async function findSessionByTokenHash(tokenHash: string): Promise<SessionLookupRow | null> {
  return withContext({}, async (client) => {
    const { rows } = await client.query<SessionLookupRow>(
      `select * from app.auth_find_session($1)`,
      [tokenHash]
    );
    return rows[0] ?? null;
  });
}

export async function createSession(params: {
  userId: string;
  businessId: string | null;
  tokenHash: string;
  expiresAt: Date;
  ipAddress: string | null;
  userAgent: string | null;
}): Promise<{ sessionId: string }> {
  return withContext({ userId: params.userId, businessId: params.businessId }, async (client) => {
    const { rows } = await client.query<{ id: string }>(
      `insert into sessions (user_id, token_hash, expires_at, ip_address, user_agent)
       values ($1, $2, $3, $4, $5)
       returning id`,
      [
        params.userId,
        params.tokenHash,
        params.expiresAt,
        params.ipAddress,
        params.userAgent,
      ]
    );

    const sessionId = rows[0]?.id;
    if (!sessionId) throw new Error('Could not create a session');

    return { sessionId };
  });
}

/** Confirm the session's business is still an active membership for the user. */
export async function verifyActiveMembership(
  userId: string,
  businessId: string
): Promise<boolean> {
  return withContext({ userId, businessId }, async (client) => {
    const { rows } = await client.query<{ ok: boolean }>(
      `select exists (
         select 1 from business_users
          where business_id = $1 and user_id = $2 and status = 'ACTIVE'
       ) as ok`,
      [businessId, userId]
    );
    return rows[0]?.ok === true;
  });
}

export async function touchSession(sessionId: string, userId: string): Promise<void> {
  await withContext({ userId }, async (client) => {
    await client.query(
      `update sessions
          set last_seen_at = now()
        where id = $1
          and last_seen_at < now() - interval '5 minutes'`,
      [sessionId]
    );
  });
}

export async function revokeSession(sessionId: string, userId: string): Promise<void> {
  await withContext({ userId }, async (client) => {
    await client.query(
      `update sessions set revoked_at = now() where id = $1 and user_id = $2 and revoked_at is null`,
      [sessionId, userId]
    );
  });
}

/** Sign out every other device (used after a password change). */
export async function revokeOtherSessions(userId: string, keepSessionId: string): Promise<number> {
  return withContext({ userId }, async (client) => {
    const result = await client.query(
      `update sessions
          set revoked_at = now()
        where user_id = $1 and id <> $2 and revoked_at is null`,
      [userId, keepSessionId]
    );
    return result.rowCount ?? 0;
  });
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  return withContext({ userId }, async (client) => {
    const result = await client.query(
      `update sessions set revoked_at = now() where user_id = $1 and revoked_at is null`,
      [userId]
    );
    return result.rowCount ?? 0;
  });
}
