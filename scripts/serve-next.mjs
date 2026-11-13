#!/usr/bin/env node
/**
 * Run the Next.js CLI directly under node so the boot server's process tree
 * contains no shell shims — `taskkill /T /PID <serve-pid>` then reliably
 * stops everything (postgres + next).
 *
 *   node scripts/serve-next.mjs start   production server (.next must exist)
 *   node scripts/serve-next.mjs dev     dev server fallback
 */

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const projectRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
process.chdir(projectRoot);

const mode = process.argv[2] === 'dev' ? 'dev' : 'start';

// Rewrite argv so the Next CLI sees: next <start|dev> -H 0.0.0.0 -p 3000
process.argv = [process.argv[0], 'next', mode, '-H', '0.0.0.0', '-p', '3000'];

await import('next/dist/bin/next');
