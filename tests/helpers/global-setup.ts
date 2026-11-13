import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { Client } from 'pg';
import { databaseSettings, loadEnvFile } from '../../scripts/lib/env.mjs';
import {
  assertAdminCanBypassRls,
  ensureDatabaseAndRoles,
  isRunning,
  migrate,
  start,
  stop,
} from '../../scripts/lib/postgres.mjs';

/**
 * Vitest global setup.
 *
 * Uses an external PostgreSQL when TEST_DATABASE_URL is provided (CI or a
 * developer's own server). Otherwise it starts the embedded PostgreSQL cluster
 * that ships as a dev dependency, creates the test database, applies every
 * migration and writes the connection details to data/.test-db.json for the
 * test workers.
 */
const INFO_FILE = resolve(process.cwd(), 'data', '.test-db.json');

type DatabaseInfo = {
  adminUrl: string;
  appUrl: string;
  database: string;
  startedHere: boolean;
};

function withDatabase(url: string, database: string): string {
  const parsed = new URL(url);
  parsed.pathname = `/${database}`;
  return parsed.toString();
}

export default async function setup(): Promise<() => Promise<void>> {
  const existingTestUrl = process.env.TEST_DATABASE_URL;

  let info: DatabaseInfo;

  if (existingTestUrl) {
    const database = new URL(existingTestUrl).pathname.replace(/^\//, '');
    info = {
      adminUrl: process.env.DATABASE_ADMIN_URL ?? existingTestUrl,
      appUrl: existingTestUrl,
      database,
      startedHere: false,
    };
  } else {
    loadEnvFile();
    const base = databaseSettings();
    const startedHere = !isRunning(base);

    if (startedHere) start(base);
    else start(base); // idempotent: ensures the cluster is up

    const testDatabase = base.testName;

    const maintenance = new Client({
      connectionString: withDatabase(base.adminUrl, 'postgres'),
      ssl: false,
    });
    await maintenance.connect();
    try {
      await assertAdminCanBypassRls(maintenance);
      // Creates both the development and the test database.
      await ensureDatabaseAndRoles(maintenance, base);
    } finally {
      await maintenance.end();
    }

    const adminUrl = withDatabase(base.adminUrl, testDatabase);
    const appUrl = withDatabase(base.appUrl, testDatabase);

    const migrationClient = new Client({ connectionString: adminUrl, ssl: false });
    await migrationClient.connect();
    try {
      const applied = await migrate(migrationClient, { ...base, name: testDatabase });
      if (applied.length) {
        console.info(`[tests] migrations applied: ${applied.join(', ')}`);
      }
    } finally {
      await migrationClient.end();
    }

    info = { adminUrl, appUrl, database: testDatabase, startedHere };
  }

  // Give the workers a clean database every run.
  const cleanup = new Client({ connectionString: info.adminUrl, ssl: false });
  await cleanup.connect();
  try {
    await cleanup.query(
      `truncate table public.users, public.businesses restart identity cascade`
    );
  } finally {
    await cleanup.end();
  }

  mkdirSync(dirname(INFO_FILE), { recursive: true });
  writeFileSync(INFO_FILE, JSON.stringify(info, null, 2));

  return async () => {
    // Keep the cluster running between runs (it is the same one used by the
    // dev server); only stop it when this setup started it and CI asks for a
    // full shutdown via TEST_STOP_DB=1.
    if (info.startedHere && process.env.TEST_STOP_DB === '1') {
      loadEnvFile();
      stop(databaseSettings());
    }
  };
}
