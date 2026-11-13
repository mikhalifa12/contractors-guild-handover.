import { createHash, randomBytes, randomUUID } from 'node:crypto';

/**
 * Opaque token helpers for sessions and share links.
 *
 * Tokens are 256 bits of CSPRNG output. Only the SHA-256 hash is stored, so a
 * database leak does not hand over usable session cookies or quote links.
 * Because the input entropy is already 256 bits, a fast hash is the correct
 * choice here (there is nothing to brute-force).
 */
const DEFAULT_TOKEN_BYTES = 32;

export function generateOpaqueToken(bytes: number = DEFAULT_TOKEN_BYTES): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

export function generateId(): string {
  return randomUUID();
}

/** Quote / invoice / receipt share links (Phase 3+). */
export function generatePublicToken(): string {
  return generateOpaqueToken(24);
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 24 * 60 * 60 * 1000);
}

export function addMinutes(date: Date, minutes: number): Date {
  return new Date(date.getTime() + minutes * 60 * 1000);
}

/** Constant-time-ish comparison for short tokens (used by tests and webhooks). */
export function safeTokenEquals(a: string, b: string): boolean {
  const bufferA = Buffer.from(a, 'utf8');
  const bufferB = Buffer.from(b, 'utf8');
  if (bufferA.length !== bufferB.length) return false;
  let difference = 0;
  for (let index = 0; index < bufferA.length; index += 1) {
    difference |= (bufferA[index] ?? 0) ^ (bufferB[index] ?? 0);
  }
  return difference === 0;
}
