#!/usr/bin/env node
/**
 * Headless Contractors Guild server for PC boot.
 *
 * Started automatically at Windows logon by boot.vbs (see `npm run boot:install`).
 * Starts the embedded PostgreSQL cluster, applies pending migrations, seeds the
 * demo tenant the first time only, then serves the production Next.js build.
 *
 *   node scripts/serve.mjs          run in the foreground (also used at boot)
 *   node scripts/serve.mjs stop     stop the boot server (and its database)
 *   node scripts/serve.mjs status   is the boot server running?
 *
 * A single-instance lock (scripts/.serve.lock) prevents two copies from
 * fighting over the ports when the shortcut is launched twice.
 */

import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync, appendFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { databaseSettings, loadEnvFile } from './lib/env.mjs';
import { isRunning, start } from './lib/postgres.mjs';

// Load .env before anything reads database settings (the boot environment
// does not inherit variables from an interactive shell).
loadEnvFile();

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const logDir = join(projectRoot, 'logs');
const logFile = join(logDir, 'serve.log');
const lockFile = join(projectRoot, 'scripts', '.serve.lock');
const tunnelUrlFile = join(logDir, 'tunnel-url.txt');

const command = process.argv[2] ?? 'run';

function log(message) {
  const line = `[${new Date().toISOString()}] ${message}`;
  try {
    mkdirSync(logDir, { recursive: true });
    appendFileSync(logFile, `${line}\n`);
  } catch {
    /* logging is best effort */
  }
}

/** Read the PID recorded by a live instance, if any. */
function lockPid() {
  try {
    const raw = readFileSync(lockFile, 'utf8').trim();
    const pid = Number.parseInt(raw, 10);
    return Number.isFinite(pid) && pid > 0 ? pid : null;
  } catch {
    return null;
  }
}

/** Is this PID alive and ours (a node process)? */
function pidAlive(pid) {
  if (!pid) return false;
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

async function commandRun() {
  if (pidAlive(lockPid())) {
    console.log('Boot server is already running.');
    return;
  }
  writeFileSync(lockFile, String(process.pid));

  const settings = databaseSettings();

  try {
    // 1-3. Database, migrations and seed. Retried because security software
    //      sometimes kills freshly-spawned helper processes in the first
    //      minutes after logon; a later attempt almost always succeeds.
    let prepared = false;
    for (let attempt = 1; attempt <= 3 && !prepared; attempt += 1) {
      try {
        if (!isRunning(settings)) {
          log(`starting PostgreSQL (attempt ${attempt})`);
          await start(settings);
        } else {
          log('PostgreSQL already running');
        }
        log('applying migrations');
        await node(['scripts/db.mjs', 'migrate']);
        // Demo seed — first boot only (the script exits early when the
        // tenant already exists, so this stays cheap on every boot).
        log('ensuring seed data');
        await node(['scripts/seeds.mjs']);
        prepared = true;
      } catch (error) {
        log(`prepare attempt ${attempt} failed: ${error.message}`);
        if (attempt < 3) {
          await new Promise((resolvePromise) => setTimeout(resolvePromise, 10_000));
        } else {
          throw error;
        }
      }
    }

    // 4. Production Next.js server, if a build exists; otherwise fall back
    //    to the dev server so the phone still works before the first build.
    // 4. Publish the app to the internet (works around AVG blocking LAN).
    startTunnel();

    const production = existsSync(join(projectRoot, '.next', 'BUILD_ID'));
    const args = production ? ['scripts/serve-next.mjs', 'start'] : ['scripts/serve-next.mjs', 'dev'];
    log(`serving app (${args[1]})`);
    // .env carries NODE_ENV=development for interactive work; the boot server
    // must run the matching mode or Next.js warns and mis-optimises.
    await node(args, {
      NODE_ENV: production ? 'production' : 'development',
    });
  } catch (error) {
    log(`failed: ${error.message}`);
    console.error(`Boot server failed: ${error.message}`);
    process.exitCode = 1;
  } finally {
    rmSync(lockFile, { force: true });
    rmSync(tunnelUrlFile, { force: true });
  }
}

/**
 * Start the Cloudflare quick tunnel that publishes the app to the internet,
 * bypassing every local firewall (AVG blocks the phone's LAN connections on
 * this PC). The generated URL is written to logs/tunnel-url.txt so
 * `npm run boot:status` can show and QR-encode it. Runs until serve exits.
 *
 * Tunnel failure never takes the server down — the LAN address still works.
 */
function startTunnel() {
  const cloudflared = join(projectRoot, 'node_modules', 'cloudflared', 'bin', 'cloudflared.exe');
  if (!existsSync(cloudflared)) {
    log('tunnel skipped (cloudflared not installed)');
    return;
  }
  try {
    rmSync(tunnelUrlFile, { force: true });
  } catch {
    /* ignore */
  }
  const child = spawn(cloudflared, ['tunnel', '--url', 'http://localhost:3000'], {
    cwd: projectRoot,
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env,
    windowsHide: true,
  });
  const scan = (chunk) => {
    const match = chunk.toString().match(/https:\/\/[a-z0-9-]+\.trycloudflare\.com/);
    if (match) {
      try {
        writeFileSync(tunnelUrlFile, match[0]);
      } catch {
        /* ignore */
      }
      log(`tunnel ready: ${match[0]}`);
    }
  };
  child.stdout.on('data', scan);
  child.stderr.on('data', scan);
  child.on('exit', (code) => log(`tunnel exited (code ${code})`));
  log('tunnel starting');
}

/** Spawn node and wait; on failure the output is already in the log file. */
function node(args, envOverrides = {}) {
  return new Promise((resolvePromise, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: projectRoot,
      stdio: ['ignore', 'pipe', 'pipe'],
      env: { ...process.env, ...envOverrides },
    });
    child.stdout.on('data', (chunk) => {
      log(`[out] ${chunk.toString().trim().split('\n').join(' | ')}`);
    });
    child.stderr.on('data', (chunk) => {
      log(`[err] ${chunk.toString().trim().split('\n').join(' | ')}`);
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0) resolvePromise();
      else reject(new Error(`${args.join(' ')} exited with code ${code}`));
    });
  });
}

/** Stop a running boot server by killing its process tree (best effort). */
async function commandStop() {
  const pid = lockPid();
  if (!pidAlive(pid)) {
    console.log('Boot server is not running.');
    rmSync(lockFile, { force: true });
    return;
  }
  // Windows: taskkill /T takes the whole tree (next server included).
  // PostgreSQL is detached (started via pg_ctl), so stop it separately.
  const { execFileSync } = await import('node:child_process');
  try {
    execFileSync('taskkill', ['/F', '/T', '/PID', String(pid)], { stdio: 'pipe' });
    console.log(`Boot server (pid ${pid}) stopped.`);
  } catch {
    console.log(`Could not stop pid ${pid} — it may have just exited.`);
  }
  rmSync(lockFile, { force: true });
  try {
    await node(['scripts/db.mjs', 'stop']);
    console.log('Database stopped too.');
  } catch {
    /* database may already be down; not fatal */
  }
}

function commandStatus() {
  const pid = lockPid();
  if (pidAlive(pid)) {
    console.log(`Boot server is running (pid ${pid}).`);
    console.log('  PC:  http://localhost:3000');
    return;
  }
  console.log('Boot server is not running. Start it with: npm run boot:start');
}

switch (command) {
  case 'run':
    await commandRun();
    break;
  case 'stop':
    await commandStop();
    break;
  case 'status':
    commandStatus();
    break;
  default:
    console.log('Usage: node scripts/serve.mjs [run|stop|status]');
    process.exitCode = 1;
}
