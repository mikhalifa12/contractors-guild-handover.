#!/usr/bin/env node
/**
 * Contractors Guild database CLI.
 *
 *   npm run db:setup    first-time setup: cluster, roles, database, migrations
 *   npm run db:start    start the local PostgreSQL cluster
 *   npm run db:stop     stop it
 *   npm run db:status   show cluster + migration state
 *   npm run db:migrate  apply pending migrations
 *   npm run db:reset    DESTRUCTIVE: recreate the development database
 *
 * The application itself never uses this script; it connects with the
 * non-superuser role in DATABASE_URL so row level security is enforced.
 */
import { Client } from 'pg';
import { loadEnvFile, databaseSettings } from './lib/env.mjs';
import {
  assertAdminCanBypassRls,
  ensureDatabaseAndRoles,
  initialise,
  isInitialised,
  isRunning,
  migrate,
  start,
  stop,
} from './lib/postgres.mjs';

loadEnvFile();
const settings = databaseSettings();
const command = (process.argv[2] ?? 'help').toLowerCase();

function buildUrl(templateUrl, database) {
  const url = new URL(templateUrl);
  url.pathname = `/${database}`;
  return url.toString();
}

async function withAdminClient(database, fn) {
  const client = new Client({
    connectionString: buildUrl(settings.adminUrl, database),
    ssl: false,
    // Fail fast instead of hanging forever when the local cluster is
    // unhealthy (for example when antivirus kills its client backends).
    connectionTimeoutMillis: 8000,
  });
  await client.connect();
  try {
    return await fn(client);
  } finally {
    await client.end();
  }
}

async function commandSetup() {
  console.log('• initialising cluster (if needed)...');
  initialise(settings);
  console.log('• starting PostgreSQL...');
  await start(settings);

  // The maintenance database is used for cluster-wide objects (roles, databases).
  const maintenance = await withAdminClient('postgres', async (client) => {
    await assertAdminCanBypassRls(client);
    await ensureDatabaseAndRoles(client, settings);
    return true;
  });
  if (maintenance) console.log('• roles and databases ready');

  await withAdminClient(settings.name, async (client) => {
    const applied = await migrate(client, settings);
    console.log(
      applied.length
        ? `• applied migrations: ${applied.join(', ')}`
        : '• schema already up to date'
    );
  });

  console.log('\nSetup complete.\n');
  printUrls();
}

async function commandMigrate() {
  if (!isRunning(settings)) {
    console.error('PostgreSQL is not running. Run: npm run db:start');
    process.exitCode = 1;
    return;
  }
  await withAdminClient(settings.name, async (client) => {
    const applied = await migrate(client, settings);
    console.log(
      applied.length ? `Applied: ${applied.join(', ')}` : 'No pending migrations.'
    );
  });
}

async function commandStatus() {
  const initialised = isInitialised(settings);
  const running = initialised && isRunning(settings);
  console.log(`cluster dir : ${settings.dataDir}`);
  console.log(`initialised : ${initialised ? 'yes' : 'no'}`);
  console.log(`running     : ${running ? 'yes' : 'no'}`);
  if (!running) return;

  await withAdminClient(settings.name, async (client) => {
    const { rows } = await client.query(
      `select version, applied_at from app.schema_migrations order by version`
    );
    console.log(`migrations  : ${rows.length}`);
    for (const row of rows) {
      console.log(`  - ${row.version} (${row.applied_at.toISOString()})`);
    }
    const counts = await client.query(
      `select
         (select count(*) from public.users) as users,
         (select count(*) from public.businesses) as businesses,
         (select count(*) from public.customers) as customers`
    );
    const c = counts.rows[0];
    console.log(`rows        : users=${c.users} businesses=${c.businesses} customers=${c.customers}`);
  });
}

async function commandReset() {
  console.log('!! This drops and recreates the development database. !!');
  await start(settings);
  await withAdminClient('postgres', async (client) => {
    await ensureDatabaseAndRoles(client, settings);
    await client.query(
      `select pg_terminate_backend(pid) from pg_stat_activity
        where datname = $1 and pid <> pg_backend_pid()`,
      [settings.name]
    );
    await client.query(`drop database if exists "${settings.name}"`);
    await client.query(`create database "${settings.name}" owner "${settings.superuser}"`);
    await client.query(`grant connect on database "${settings.name}" to "${settings.appUser}"`);
  });
  await commandMigrate();
  console.log('Development database recreated.');
}

function printUrls() {
  console.log('Application DATABASE_URL (non-superuser, RLS enforced):');
  console.log(`  ${settings.appUrl}`);
  console.log('Admin DATABASE_ADMIN_URL (migrations only):');
  console.log(`  ${settings.adminUrl}`);
  console.log('\nStart the web app with: npm run dev');
}

function commandHelp() {
  console.log(`Contractors Guild database CLI

  node scripts/db.mjs setup     first-time setup (cluster, roles, migrations)
  node scripts/db.mjs start     start the local cluster
  node scripts/db.mjs stop      stop the local cluster
  node scripts/db.mjs status    cluster, migration and row counts
  node scripts/db.mjs migrate   apply pending migrations
  node scripts/db.mjs reset     DESTRUCTIVE: recreate the dev database
  node scripts/db.mjs urls      print connection strings
`);
}

const commands = {
  setup: commandSetup,
  start: async () => {
    const started = await start(settings);
    console.log(started ? 'PostgreSQL started.' : 'PostgreSQL was already running.');
    console.log(`Listening on ${settings.host}:${settings.port}`);
  },
  stop: async () => {
    const stopped = stop(settings);
    console.log(stopped ? 'PostgreSQL stopped.' : 'PostgreSQL is not running.');
  },
  status: commandStatus,
  migrate: commandMigrate,
  reset: commandReset,
  urls: async () => printUrls(),
  help: commandHelp,
};

const handler = commands[command] ?? commandHelp;

try {
  await handler();
} catch (error) {
  console.error(`\nError: ${error.message}`);
  process.exitCode = 1;
}
