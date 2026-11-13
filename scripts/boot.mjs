#!/usr/bin/env node
/**
 * Manage the "start Contractors Guild at PC boot" setup.
 *
 *   npm run boot:install    create the Startup shortcut (starts at logon)
 *   npm run boot:remove     remove the Startup shortcut
 *   npm run boot:status     installed? running? where are the logs?
 *   npm run boot:start      start the boot server now (hidden window)
 *   npm run boot:stop       stop the boot server and its database
 *
 * The shortcut uses wscript.exe with boot.vbs so the server window stays
 * invisible; everything it prints lands in logs/serve.log.
 */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { networkInterfaces } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

/** Best-effort LAN IPv4 for the phone URL (skips dead link-local adapters). */
function lanAddress() {
  const usable = [];
  for (const addresses of Object.values(networkInterfaces())) {
    for (const address of addresses ?? []) {
      if (address.family !== 'IPv4' || address.internal) continue;
      if (address.address.startsWith('169.254.')) continue;
      usable.push(address.address);
    }
  }
  const score = (ip) => {
    if (/^192\.168\./.test(ip)) return 3;
    if (/^10\./.test(ip)) return 2;
    if (/^172\.(1[6-9]|2\d|3[01])\./.test(ip)) return 1;
    return 0;
  };
  return usable.sort((a, b) => score(b) - score(a))[0] ?? null;
}

/**
 * Save the phone QR as an image (easy to scan from a second screen or to
 * keep around) and return the URL it encodes.
 */
/**
 * Save the phone QR as an image and return { url, kind }.
 * Prefers the Cloudflare tunnel URL (works from any network, immune to AVG)
 * and falls back to the PC's LAN address.
 */
async function writeQrPng() {
  let url = null;
  let kind = 'lan';
  try {
    url = readFileSync(join(projectRoot, 'logs', 'tunnel-url.txt'), 'utf8').trim() || null;
    if (url) kind = 'tunnel (works on any Wi-Fi)';
  } catch {
    /* no tunnel running */
  }
  if (!url) {
    const ip = lanAddress();
    if (!ip) return null;
    url = `http://${ip}:3000`;
  }
  try {
    const { default: QRCode } = await import('qrcode');
    await QRCode.toFile(join(projectRoot, 'phone-qr.png'), url, {
      width: 480,
      margin: 2,
      color: { dark: '#07080a', light: '#f4f5f7' },
    });
  } catch {
    /* QR image is a nice-to-have; the terminal still shows the address */
  }
  return { url, kind };
}

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const startupDir = join(
  process.env.APPDATA ?? join(process.env.USERPROFILE ?? '', 'AppData', 'Roaming'),
  'Microsoft',
  'Windows',
  'Start Menu',
  'Programs',
  'Startup'
);
const shortcutPath = join(startupDir, 'ContractorsGuild.bat');
const vbsPath = join(projectRoot, 'scripts', 'boot.vbs');
const serveScript = join(projectRoot, 'scripts', 'serve.mjs');

const command = process.argv[2] ?? 'status';

function commandInstall() {
  // The .bat simply asks Windows Script Host to run boot.vbs (hidden).
  const bat = [
    '@echo off',
    `start "" wscript.exe "${vbsPath}"`,
  ].join('\r\n');
  writeFileSync(shortcutPath, `${bat}\r\n`);
  console.log(`✓ Installed. Contractors Guild will start when you log in.`);
  console.log(`  Shortcut: ${shortcutPath}`);
  console.log('  It starts hidden; activity goes to logs/serve.log.');
}

function commandRemove() {
  if (existsSync(shortcutPath)) {
    rmSync(shortcutPath);
    console.log('✓ Removed. The app will no longer start at logon.');
  } else {
    console.log('Not installed (no Startup entry found).');
  }
}

function commandStart() {
  const result = spawnSync('wscript.exe', [vbsPath], { stdio: 'ignore', shell: false });
  if (result.error) {
    console.error(`Could not start: ${result.error.message}`);
    process.exitCode = 1;
    return;
  }
  console.log('Boot server starting (hidden). Give it ~10 seconds, then:');
  console.log('  PC:    http://localhost:3000');
  console.log('  Phone: scan the QR from: npm run launch');
}

function commandStop() {
  const result = spawnSync(process.execPath, [serveScript, 'stop'], {
    stdio: 'inherit',
    cwd: projectRoot,
  });
  process.exitCode = result.status ?? 0;
}

async function commandStatus() {
  const installed = existsSync(shortcutPath);
  console.log(`Installed at logon : ${installed ? 'yes' : 'no'}`);
  if (installed) console.log(`  ${shortcutPath}`);

  const lockPath = join(projectRoot, 'scripts', '.serve.lock');
  let running = false;
  let pid = null;
  try {
    pid = Number.parseInt(readFileSync(lockPath, 'utf8').trim(), 10);
    process.kill(pid, 0);
    running = true;
  } catch {
    running = false;
  }
  console.log(`Running now        : ${running ? `yes (pid ${pid})` : 'no'}`);
  console.log(`Log file           : ${join(projectRoot, 'logs', 'serve.log')}`);
  console.log('PC address         : http://localhost:3000');

  const phone = await writeQrPng();
  if (phone) {
    console.log(`Phone address      : ${phone.url}`);
    console.log(`Connection type    : ${phone.kind}`);
    console.log('Phone QR image     : phone-qr.png (open it, scan with the phone camera)');
  }
}

switch (command) {
  case 'install':
    commandInstall();
    break;
  case 'remove':
    commandRemove();
    break;
  case 'start':
    commandStart();
    break;
  case 'stop':
    commandStop();
    break;
  case 'status':
    await commandStatus();
    break;
  default:
    console.log('Usage: node scripts/boot.mjs [install|remove|start|stop|status]');
    process.exitCode = 1;
}
