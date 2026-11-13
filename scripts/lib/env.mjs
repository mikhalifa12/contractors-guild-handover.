/**
 * Minimal .env loader used by the Node scripts (no runtime dependency).
 * Values already present in process.env always win, so CI can override.
 */
import { readFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

export function loadEnvFile(path = '.env') {
  const absolute = resolve(process.cwd(), path);
  if (!existsSync(absolute)) return;

  const contents = readFileSync(absolute, 'utf8');
  for (const rawLine of contents.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;

    const separator = line.indexOf('=');
    if (separator === -1) continue;

    const key = line.slice(0, separator).trim();
    let value = line.slice(separator + 1).trim();

    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }

    if (key && process.env[key] === undefined) {
      process.env[key] = value;
    }
  }
}

function intFromEnv(name, fallback) {
  const raw = process.env[name];
  if (raw === undefined || raw === '') return fallback;
  const parsed = Number.parseInt(raw, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

/** Database settings with development-safe defaults. */
export function databaseSettings() {
  const port = intFromEnv('DEV_DB_PORT', 5433);
  const host = process.env.DEV_DB_HOST ?? '127.0.0.1';
  const name = process.env.DEV_DB_NAME ?? 'contractors_guild';
  const superuser = process.env.DEV_DB_SUPERUSER ?? 'cg_admin';
  const superuserPassword = process.env.DEV_DB_SUPERUSER_PASSWORD ?? '';
  const appUser = process.env.APP_DB_USER ?? 'cg_app';
  const appPassword = process.env.APP_DB_PASSWORD ?? '';

  return {
    host,
    port,
    name,
    testName: process.env.TEST_DB_NAME ?? `${name}_test`,
    superuser,
    superuserPassword,
    appUser,
    appPassword,
    dataDir: process.env.DEV_DB_DATA_DIR ?? 'data/pg',
    adminUrl:
      process.env.DATABASE_ADMIN_URL ??
      `postgresql://${superuser}:${encodeURIComponent(superuserPassword)}@${host}:${port}/${name}`,
    appUrl:
      process.env.DATABASE_URL ??
      `postgresql://${appUser}:${encodeURIComponent(appPassword)}@${host}:${port}/${name}`,
  };
}
