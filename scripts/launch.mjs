#!/usr/bin/env node
/**
 * One-command local launcher for Contractors Guild.
 *
 * Starts the embedded PostgreSQL cluster (if not already running), applies any
 * pending migrations, makes sure the demo tenant exists, then runs
 * `next dev` in the foreground. Every step is idempotent, so you can run this
 * every day without thinking about it:
 *
 *   npm run launch
 *
 * Ctrl+C stops the dev server; it also stops the database so nothing is left
 * running in the background. If you prefer to keep the DB up (for example to
 * run a second terminal), pass --keep-db:
 *
 *   npm run launch -- --keep-db
 */

import { spawn } from 'node:child_process';
import { networkInterfaces } from 'node:os';

import { databaseSettings, loadEnvFile } from './lib/env.mjs';
import { isRunning, start } from './lib/postgres.mjs';

// Load .env before anything reads database settings.
loadEnvFile();

/** Best-effort LAN IPv4 address, for the "open this on your phone" hint. */
function lanAddress() {
  const interfaces = networkInterfaces();
  const usable = [];
  for (const addresses of Object.values(interfaces)) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      // Skip dead link-local autoconf addresses from disconnected adapters.
      if (address.address.startsWith('169.254.')) continue;
      usable.push(address.address);
    }
  }
  // Prefer RFC1918 private ranges (home/office Wi-Fi) over anything exotic.
  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 3;
    if (/^10\./.test(ip)) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
    return 0;
  };
  return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
}

const keepDb = process.argv.includes('--keep-db');
let interrupted = false;

process.on('SIGINT', () => {
  interrupted = true;
});

/** Spawn a child attached to this process's stdio and wait for its exit code. */
function runStep(command, args) {
  return new Promise((resolve, reject) => {
    // No shell: every step runs node.exe directly, which avoids the classic
    // "'C:\Program' is not recognized" quoting problem on Windows.
    const child = spawn(command, args, {
      stdio: 'inherit',
      env: process.env,
    });
    child.on('error', reject);
    child.on('exit', (code) => {
      if (code === 0 || interrupted) resolve();
      else reject(new Error(`${command} ${args.join(' ')} exited with code ${code}`));
    });
  });
}

async function main() {
  const settings = databaseSettings();

  console.log('');
  console.log('Contractors Guild — local launch');
  console.log('================================');
  console.log('');

  // 1. Database.
  if (!isRunning(settings)) {
    console.log('[1/4] Starting PostgreSQL…');
    await start(settings);
  } else {
    console.log('[1/4] PostgreSQL already running.');
  }
  console.log(`      listening on ${settings.host}:${settings.port}`);
  console.log('');

  // 2. Migrations.
  console.log('[2/4] Applying migrations…');
  await runStep(process.execPath, ['scripts/db.mjs', 'migrate']);
  console.log('');

  // 3. Seed data.
  console.log('[3/4] Ensuring demo data…');
  await runStep(process.execPath, ['scripts/seeds.mjs']);
  console.log('');

  // 4. Dev server.
  const lan = lanAddress();
  console.log('[4/4] Starting web app…');
  console.log('');
  console.log('  ➜ On this PC:      http://localhost:3000');
  if (lan) {
    const phoneUrl = `http://${lan}:3000`;
    console.log(`  ➜ On your phone:   ${phoneUrl}   (same Wi-Fi)`);
    console.log('');
    try {
      const { default: QRCode } = await import('qrcode');
      await QRCode.toFile('phone-qr.png', phoneUrl, {
        width: 480,
        margin: 2,
        color: { dark: '#07080a', light: '#f4f5f7' },
      });
      console.log('  → Saved phone-qr.png — open it and scan with the phone camera.');
      console.log('  → In Chrome: ⋮ menu → "Add to Home screen" → Install.');
    } catch {
      console.log(`  (Type ${phoneUrl} in the phone's Chrome.)`);
    }
  }
  console.log('  ➜ Sign in: demo@contractorsguild.dev / guild-demo-password');
  console.log('');
  console.log('  Press Ctrl+C to stop (database stops too unless you used --keep-db).');
  console.log('');

  try {
    await runStep(process.execPath, [
      './node_modules/next/dist/bin/next',
      'dev',
      '-H',
      '0.0.0.0',
      '-p',
      '3000',
    ]);
  } finally {
    if (!keepDb) {
      console.log(interrupted ? '\nStopping…' : '');
      try {
        await runStep(process.execPath, ['scripts/db.mjs', 'stop']);
        console.log('Database stopped. See you next time.');
      } catch {
        /* best effort */
      }
    }
  }
}

main().catch((error) => {
  console.error(`\nLaunch failed: ${error.message}`);
  process.exitCode = 1;
});
