/**
 * Local PostgreSQL lifecycle, migrations and role bootstrap.
 *
 * Production uses any managed PostgreSQL (Supabase, RDS, Neon, ...) through
 * DATABASE_URL. For local development and the automated test suite this module
 * manages a real PostgreSQL cluster using the binaries shipped by the
 * `embedded-postgres` dev dependency, so a developer only needs Node + npm.
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdirSync, existsSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { databaseSettings } from './env.mjs';

const require = createRequire(import.meta.url);

/** Resolve the directory holding initdb / pg_ctl / postgres. */
export function resolvePostgresBinDir() {
  const platform = process.platform;
  const arch = process.arch;
  // The binary packages are published as @embedded-postgres/<os>-<arch> where
  // <os> is 'darwin', 'linux' or 'windows' — Node's process.platform says
  // 'win32', so it is normalised here.
  const osName = platform === 'win32' ? 'windows' : platform;
  const packageName = `@embedded-postgres/${osName}-${arch}`;

  let entryPoint;
  try {
    // The package restricts subpath access via "exports", so resolve the main
    // entry and walk up to the package root that holds native/bin.
    entryPoint = require.resolve(packageName);
  } catch {
    throw new Error(
      `Embedded PostgreSQL binaries for ${platform}/${arch} are not installed.\n` +
        `Install them with: npm install -D ${packageName}\n` +
        `Or point DATABASE_URL / DATABASE_ADMIN_URL at an existing PostgreSQL server.`
    );
  }

  let directory = dirname(entryPoint);
  for (let depth = 0; depth < 4; depth += 1) {
    const candidate = join(directory, 'native', 'bin');
    if (existsSync(join(candidate, process.platform === 'win32' ? 'pg_ctl.exe' : 'pg_ctl'))) {
      return candidate;
    }
    directory = dirname(directory);
  }

  throw new Error(`Could not find native/bin next to ${entryPoint}`);
}

function run(binary, args, { allowFailure = false, input, timeoutMs } = {}) {
  const result = spawnSync(binary, args, {
    encoding: 'utf8',
    input,
    // Some security software stalls pg_ctl.exe after the postmaster detaches
    // (the server itself is up — see server.log). The TCP readiness poll is
    // what decides success on Windows, so a hung pg_ctl must not block us.
    timeout: timeoutMs,
    env: { ...process.env, PGDATA: '' },
  });

  if (result.status !== 0 && !allowFailure) {
    throw new Error(
      `${binary} ${args.join(' ')} failed (exit ${result.status})\n${result.stdout ?? ''}\n${
        result.stderr ?? ''
      }`
    );
  }
  return result;
}

function pgConfigPaths(settings) {
  const binDir = resolvePostgresBinDir();
  const dataDir = resolve(process.cwd(), settings.dataDir);
  return {
    binDir,
    dataDir,
    initdb: join(binDir, 'initdb'),
    pgCtl: join(binDir, 'pg_ctl'),
    logFile: join(dataDir, 'server.log'),
    pidFile: join(dataDir, 'postmaster.pid'),
  };
}

export function isInitialised(settings = databaseSettings()) {
  const { dataDir } = pgConfigPaths(settings);
  return existsSync(join(dataDir, 'PG_VERSION'));
}

export function isRunning(settings = databaseSettings()) {
  const { pgCtl, dataDir } = pgConfigPaths(settings);
  if (!isInitialised(settings)) return false;
  const result = run(pgCtl, ['-D', dataDir, 'status'], { allowFailure: true });
  if (result.status === 0) return true;
  // pg_ctl.exe can be blocked or killed by aggressive antivirus on Windows,
  // making "status" report a healthy cluster as stopped. Fall back to an
  // actual TCP connection attempt against the configured host/port.
  return tcpPortAcceptsConnections(settings.host, settings.port);
}

/**
 * Synchronous single TCP connect probe (for use in CLI commands).
 * Spawns a throwaway node child because Node has no blocking connect API.
 */
function tcpPortAcceptsConnections(host, port) {
  const probe = [
    `const net=require('net');`,
    `const s=net.connect({host:${JSON.stringify(host)},port:${port}});`,
    `const t=setTimeout(()=>process.exit(1),1000);`,
    `s.once('connect',()=>{clearTimeout(t);s.destroy();process.exit(0);});`,
    `s.once('error',()=>{clearTimeout(t);process.exit(1);});`,
  ].join('');
  const result = spawnSync(process.execPath, ['-e', probe], { encoding: 'utf8' });
  return result.status === 0;
}

/**
 * Wait until the server accepts TCP connections (or give up).
 *
 * On Windows `pg_ctl -w` can hang forever after the postmaster detaches, so
 * the startup script polls the port instead. This is only ever used against
 * the local development cluster.
 */
export function waitForTcpReady(host, port, timeoutMs = 60_000) {
  const net = require('node:net');
  const deadline = Date.now() + timeoutMs;

  return new Promise((resolve) => {
    function attempt() {
      if (Date.now() > deadline) {
        resolve(false);
        return;
      }
      const socket = new net.Socket();
      let settled = false;
      const finish = (result) => {
        if (settled) return;
        settled = true;
        socket.destroy();
        if (result) resolve(true);
        else setTimeout(attempt, 500);
      };
      socket.once('connect', () => finish(true));
      socket.once('error', () => finish(false));
      socket.setTimeout(2000, () => finish(false));
      socket.connect({ host, port });
    }
    attempt();
  });
}

export function initialise(settings = databaseSettings()) {
  const { initdb, dataDir } = pgConfigPaths(settings);
  if (isInitialised(settings)) return false;

  // initdb requires an empty target directory, so the password file lives next
  // to the data directory (not inside it) and is removed afterwards.
  const parentDir = dirname(dataDir);
  mkdirSync(parentDir, { recursive: true });
  const passwordFile = join(parentDir, `.initdb-password-${process.pid}`);
  writeFileSync(passwordFile, `${settings.superuserPassword}\n`, { mode: 0o600 });

  try {
    run(initdb, [
      '-D',
      dataDir,
      '-U',
      settings.superuser,
      '-A',
      'scram-sha-256',
      '--pwfile',
      passwordFile,
      '--encoding=UTF8',
      '--locale=C',
      '-E',
      'UTF8',
    ]);
  } finally {
    rmSync(passwordFile, { force: true });
  }

  return true;
}

export async function start(settings = databaseSettings()) {
  const { pgCtl, dataDir, logFile } = pgConfigPaths(settings);
  initialise(settings);

  if (isRunning(settings)) return false;

  // fsync/synchronous_commit are relaxed deliberately: this cluster is a
  // disposable local development instance, never production data.
  // Windows has no /tmp; point the socket directory at the data directory so
  // PostgreSQL never fails on a missing path (TCP is what the app connects by).
  const socketDir = process.platform === 'win32' ? dataDir.replace(/\\/g, '/') : '/tmp';
  // Windows memory-footprint reduction. On memory-constrained machines (and
  // always on Windows here) the extra helper processes of the newer defaults
  // fail to fork with ERROR_COMMITMENT_LIMIT (1455), which crash-loops the
  // cluster. Synchronous I/O, no parallel workers and a tiny shared buffer
  // pool are entirely sufficient for local development and the test suite.
  const isWindows = process.platform === 'win32';
  const lowMemoryOptions = isWindows
    ? [
        '-c io_method=sync',
        '-c shared_buffers=32MB',
        '-c max_connections=20',
        '-c max_worker_processes=2',
        '-c max_parallel_workers=0',
        '-c max_parallel_workers_per_gather=0',
        '-c autovacuum=off',
        '-c temp_buffers=800kB',
        '-c work_mem=1MB',
        '-c maintenance_work_mem=16MB',
      ]
    : [];

  const options = [
    `-p ${settings.port}`,
    `-c listen_addresses=${settings.host}`,
    `-c unix_socket_directories=${socketDir}`,
    ...lowMemoryOptions,
    `-c fsync=off`,
    `-c synchronous_commit=off`,
    `-c full_page_writes=off`,
  ]
    .filter(Boolean)
    .join(' ');

  if (process.platform === 'win32') {
    // Do not let pg_ctl block: poll the port ourselves instead (see above).
    const launchResult = run(pgCtl, ['-D', dataDir, '-l', logFile, '-o', options, 'start'], {
      allowFailure: true,
      timeoutMs: 15_000,
    });
    const ready = await waitForTcpReady(settings.host, settings.port);
    if (!ready) {
      throw new Error(
        `PostgreSQL did not accept connections on ${settings.host}:${settings.port} within 60s.\n` +
          `pg_ctl output: ${(launchResult.stderr || launchResult.stdout || '(none)').trim()}\n` +
          `See ${logFile}.`
      );
    }
    return true;
  }

  run(pgCtl, ['-D', dataDir, '-l', logFile, '-w', '-t', '60', '-o', options, 'start']);
  return true;
}

export function stop(settings = databaseSettings()) {
  const { pgCtl, dataDir } = pgConfigPaths(settings);
  if (!isInitialised(settings) || !isRunning(settings)) return false;
  run(pgCtl, ['-D', dataDir, '-m', 'fast', '-w', '-t', '60', 'stop']);
  return true;
}

/** Create the runtime role, the database and grant privileges. */
export async function ensureDatabaseAndRoles(client, settings = databaseSettings()) {
  const adminExists = await client.query('select 1 from pg_roles where rolname = $1', [
    settings.superuser,
  ]);
  if (adminExists.rowCount === 0) {
    throw new Error(
      `The migration role "${settings.superuser}" does not exist on this cluster. ` +
        'Set DEV_DB_SUPERUSER (and DATABASE_ADMIN_URL) to a role that can create databases.'
    );
  }

  // The runtime role must never be able to bypass row level security.
  const appExists = await client.query('select 1 from pg_roles where rolname = $1', [
    settings.appUser,
  ]);
  const role = quoteIdent(settings.appUser);
  const password = quoteLiteral(settings.appPassword);

  if (appExists.rowCount === 0) {
    await client.query(
      `create role ${role} with login password ${password} nosuperuser nocreatedb nocreaterole nobypassrls`
    );
  } else {
    await client.query(
      `alter role ${role} with login password ${password} nosuperuser nocreatedb nocreaterole nobypassrls`
    );
  }

  for (const database of [settings.name, settings.testName]) {
    const exists = await client.query('select 1 from pg_database where datname = $1', [database]);
    if (exists.rowCount === 0) {
      await client.query(
        `create database ${quoteIdent(database)} owner ${quoteIdent(settings.superuser)}`
      );
    }
    await client.query(
      `grant connect on database ${quoteIdent(database)} to ${quoteIdent(settings.appUser)}`
    );
  }
}

function quoteIdent(identifier) {
  return `"${String(identifier).replace(/"/g, '""')}"`;
}

function quoteLiteral(value) {
  return `'${String(value).replace(/'/g, "''")}'`;
}

/** Apply every pending SQL migration in db/migrations. */
export async function migrate(client, settings = databaseSettings()) {
  await client.query(`create schema if not exists app`);
  await client.query(
    `create table if not exists app.schema_migrations (
       version text primary key,
       applied_at timestamptz not null default now()
     )`
  );

  const migrationsDir = resolve(process.cwd(), 'db', 'migrations');
  const files = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.sql'))
    .sort();

  const applied = new Set(
    (await client.query('select version from app.schema_migrations')).rows.map((row) => row.version)
  );

  const newlyApplied = [];
  for (const file of files) {
    const version = file.replace(/\.sql$/, '');
    if (applied.has(version)) continue;

    const sql = readFileSync(join(migrationsDir, file), 'utf8');
    try {
      await client.query('begin');
      await client.query(sql);
      await client.query('insert into app.schema_migrations (version) values ($1)', [version]);
      await client.query('commit');
      newlyApplied.push(version);
    } catch (error) {
      await client.query('rollback');
      throw new Error(`Migration ${file} failed: ${error.message}`);
    }
  }

  // Privileges follow table creation, so they are re-applied after migrations.
  await client.query(`select app.grant_app_role($1)`, [settings.appUser]);

  return newlyApplied;
}

/** Fail fast if the migration role cannot bypass RLS (see db/migrations/0002). */
export async function assertAdminCanBypassRls(client) {
  const { rows } = await client.query(
    `select rolsuper or rolbypassrls as can_bypass
     from pg_roles where rolname = current_user`
  );
  if (!rows[0]?.can_bypass) {
    throw new Error(
      'The DATABASE_ADMIN_URL role must have SUPERUSER or BYPASSRLS so that the ' +
        'SECURITY DEFINER auth helpers can read membership rows. See SECURITY.md.'
    );
  }
}
