import type { PoolClient } from 'pg';
import { withContext } from '@/lib/db';
import { hashPassword, verifyDummyPassword, verifyPassword } from '@/lib/auth/password';

/**
 * User data access.
 *
 * Sign-in lookup goes through app.auth_find_user (a SECURITY DEFINER function)
 * because no tenant context exists yet. Everything else runs inside
 * withContext(), so the users RLS policy ("only your own row") applies.
 */
export type AuthUserRow = {
  id: string;
  email: string;
  password_hash: string;
  full_name: string;
  is_active: boolean;
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  created_at: string;
};

export async function findUserForLogin(email: string): Promise<AuthUserRow | null> {
  return withContext({}, async (client) => {
    const { rows } = await client.query<AuthUserRow>(
      `select id, email, password_hash, full_name, is_active
         from app.auth_find_user($1)`,
      [email]
    );
    return rows[0] ?? null;
  });
}

/**
 * Verify credentials. Returns the user on success, null on failure, and always
 * performs a password derivation so failures are not distinguishable by timing.
 */
export async function authenticate(email: string, password: string): Promise<AuthUserRow | null> {
  const user = await findUserForLogin(email);

  if (!user || !user.is_active) {
    await verifyDummyPassword(password);
    return null;
  }

  const passwordMatches = await verifyPassword(password, user.password_hash);
  if (!passwordMatches) return null;

  return user;
}

export async function getProfile(userId: string): Promise<UserProfile | null> {
  return withContext({ userId }, async (client) => {
    const { rows } = await client.query<UserProfile>(
      `select id, email, full_name, phone, created_at
         from users where id = $1`,
      [userId]
    );
    return rows[0] ?? null;
  });
}

export async function updateProfile(
  userId: string,
  input: { fullName: string; phone: string | null }
): Promise<UserProfile | null> {
  return withContext({ userId }, async (client) => {
    const { rows } = await client.query<UserProfile>(
      `update users
          set full_name = $2, phone = $3
        where id = $1
        returning id, email, full_name, phone, created_at`,
      [userId, input.fullName, input.phone]
    );
    return rows[0] ?? null;
  });
}

export async function changePassword(
  userId: string,
  newPassword: string
): Promise<void> {
  const passwordHash = await hashPassword(newPassword);
  await withContext({ userId }, async (client) => {
    await client.query(`update users set password_hash = $2 where id = $1`, [
      userId,
      passwordHash,
    ]);
  });
}

export async function recordSuccessfulLogin(params: {
  userId: string;
  businessId: string | null;
  ipAddress: string | null;
}): Promise<void> {
  // The business id is part of the context because the audit policy requires a
  // matching active membership for business-scoped events.
  await withContext(
    { userId: params.userId, businessId: params.businessId },
    async (client) => {
      await client.query(`update users set last_login_at = now() where id = $1`, [
        params.userId,
      ]);
      await client.query(
        `insert into audit_events (business_id, user_id, event_type, metadata, ip_address)
         values ($1, $2, 'auth.login_succeeded', '{}'::jsonb, $3)`,
        [params.businessId, params.userId, params.ipAddress]
      );
    }
  );
}

export async function recordFailedLogin(email: string, ipAddress: string | null): Promise<void> {
  // No user context exists, so the event is written with a null user and
  // business id. The email is not stored in clear text: only a short hash is
  // kept so support can correlate repeated attempts without holding PII.
  await withContext({}, async (client) => {
    await client.query(
      `insert into audit_events (event_type, metadata, ip_address)
       values ('auth.login_failed', jsonb_build_object('emailHash', md5(lower($1))), $2)`,
      [email, ipAddress]
    );
  });
}

/**
 * Insert the identity row. Called inside the registration transaction, which
 * has already set app.user_id to this id so the users RLS policy allows it.
 */
export async function insertUser(
  client: PoolClient,
  userId: string,
  input: { email: string; password: string; fullName: string; phone: string | null }
): Promise<void> {
  const passwordHash = await hashPassword(input.password);

  await client.query(
    `insert into users (id, email, password_hash, full_name, phone)
     values ($1, $2, $3, $4, $5)`,
    [userId, input.email, passwordHash, input.fullName, input.phone]
  );
}
