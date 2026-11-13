import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { Client } from 'pg';
import { resetServerConfigCache } from '@/lib/config';
import { configurePgTypeParsers } from '@/lib/db/type-parsers';
import { clearRateLimits } from '@/lib/security/rate-limit';

/**
 * Test environment bootstrap.
 *
 * Import this module FIRST in every test file: it configures the environment
 * pointing at the test database before any application module reads config.
 */
const INFO_FILE = resolve(process.cwd(), 'data', '.test-db.json');

type DatabaseInfo = {
  adminUrl: string;
  appUrl: string;
  database: string;
};

const info: DatabaseInfo = JSON.parse(readFileSync(INFO_FILE, 'utf8'));

// `NODE_ENV` is typed read-only; the suite still has to declare itself.
(process.env as Record<string, string>).NODE_ENV = 'test';
process.env.DATABASE_URL = info.appUrl;
process.env.DATABASE_SSL = 'disable';
process.env.DATABASE_POOL_MAX = '5';
process.env.PUBLIC_APP_URL = 'http://localhost:3000';
process.env.SESSION_COOKIE_NAME = 'cg_session';
process.env.SESSION_TTL_DAYS = '30';
// Keep the suite fast: production uses 16384 (see PASSWORD_HASH_COST).
process.env.PASSWORD_HASH_COST = '4096';
process.env.PASSWORD_RESET_TTL_MINUTES = '60';
process.env.STORAGE_DRIVER = 'local';
process.env.STORAGE_LOCAL_DIR = 'data/test-uploads';
process.env.MAX_UPLOAD_BYTES = '2097152';

resetServerConfigCache();
configurePgTypeParsers();

export const testDatabaseInfo = info;

/** Connection as the migration/owner role (bypasses RLS: verification only). */
export async function withAdminClient<T>(fn: (client: Client) => Promise<T>): Promise<T> {
  const client = new Client({ connectionString: info.adminUrl, ssl: false });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

/** Reset database and process-local state between integration test cases. */
export async function resetDatabase(): Promise<void> {
  clearRateLimits();
  await withAdminClient(async (client) => {
    await client.query(`truncate table public.users, public.businesses restart identity cascade`);
  });
}

export async function countRows(table: string, where = 'true', params: unknown[] = []): Promise<number> {
  return withAdminClient(async (client) => {
    const result = await client.query<{ count: string }>(
      `select count(*)::text as count from public.${table} where ${where}`,
      params
    );
    return Number(result.rows[0]?.count ?? '0');
  });
}
