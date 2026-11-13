import { Pool, type PoolClient } from 'pg';
import { getServerConfig } from '@/lib/config';
import { configurePgTypeParsers } from './type-parsers';

configurePgTypeParsers();

/**
 * Database access layer.
 *
 * Every tenant-scoped request runs through `withContext()`, which opens a
 * transaction and sets two PostgreSQL session variables that the row level
 * security policies in db/migrations/0002_rls_policies.sql rely on:
 *
 *     app.user_id      - the authenticated user
 *     app.business_id  - the business selected for this session
 *
 * Both values come from the server-side session record. They are passed as
 * bound parameters to `set_config`, so client input can never reach them.
 */

export type RequestContext = {
  userId?: string | null;
  businessId?: string | null;
};

type GlobalWithPool = typeof globalThis & { __contractorsGuildPool?: Pool };

const globalForPool = globalThis as GlobalWithPool;

export function getPool(): Pool {
  if (globalForPool.__contractorsGuildPool) {
    return globalForPool.__contractorsGuildPool;
  }

  const config = getServerConfig();
  const pool = new Pool({
    connectionString: config.DATABASE_URL,
    max: config.DATABASE_POOL_MAX,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    application_name: 'contractors-guild',
    ssl:
      config.DATABASE_SSL === 'disable'
        ? undefined
        : { rejectUnauthorized: config.DATABASE_SSL === 'verify-full' },
  });

  pool.on('error', (error) => {
    // A pooled connection died (restart, network). Log; the pool reconnects.
    console.error('[db] idle client error:', error.message);
  });

  globalForPool.__contractorsGuildPool = pool;
  return pool;
}

/**
 * Run a callback inside a transaction that carries the tenant context.
 * Anything the callback does is committed atomically or rolled back entirely.
 */
export async function withContext<T>(
  context: RequestContext,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const config = getServerConfig();
  const client = await getPool().connect();

  try {
    await client.query('begin');
    await client.query(`set local statement_timeout = ${config.DATABASE_STATEMENT_TIMEOUT_MS}`);

    if (context.userId) {
      await client.query('select set_config($1, $2, true)', ['app.user_id', context.userId]);
    }
    if (context.businessId) {
      await client.query('select set_config($1, $2, true)', ['app.business_id', context.businessId]);
    }

    const result = await callback(client);
    await client.query('commit');
    return result;
  } catch (error) {
    try {
      await client.query('rollback');
    } catch {
      // Ignore rollback failures: the connection is released and discarded.
    }
    throw error;
  } finally {
    client.release();
  }
}

/** Read-only helper for one-off queries that need no tenant context. */
export async function queryScalar<T>(sql: string, params: readonly unknown[] = []): Promise<T | null> {
  const result = await getPool().query(sql, params as unknown[]);
  const firstRow = result.rows[0] as Record<string, T> | undefined;
  if (!firstRow) return null;
  const firstValue = Object.values(firstRow)[0];
  return (firstValue ?? null) as T | null;
}

/** Close the pool (used by tests and graceful shutdown). */
export async function closePool(): Promise<void> {
  const pool = globalForPool.__contractorsGuildPool;
  if (!pool) return;
  globalForPool.__contractorsGuildPool = undefined;
  await pool.end();
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

/** Guard used before a value is treated as a database identifier. */
export function isUuid(value: unknown): value is string {
  return typeof value === 'string' && UUID_PATTERN.test(value);
}

/** PostgreSQL error codes we translate into friendly messages. */
export const PG_ERROR = {
  UNIQUE_VIOLATION: '23505',
  FOREIGN_KEY_VIOLATION: '23503',
  CHECK_VIOLATION: '23514',
  NOT_NULL_VIOLATION: '23502',
  INSUFFICIENT_PRIVILEGE: '42501',
} as const;

export function isPgError(error: unknown, code?: string): boolean {
  const candidate = error as { code?: string } | null;
  if (!candidate || typeof candidate.code !== 'string') return false;
  return code ? candidate.code === code : true;
}
