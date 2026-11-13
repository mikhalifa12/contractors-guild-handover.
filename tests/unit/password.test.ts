import '@/tests/helpers/env';
import { describe, expect, it } from 'vitest';
import {
  assertPasswordLength,
  hashPassword,
  parseStoredHash,
  passwordHashNeedsUpgrade,
  verifyDummyPassword,
  verifyPassword,
} from '@/lib/auth/password';
import { generateOpaqueToken, hashToken, safeTokenEquals } from '@/lib/auth/tokens';

describe('password hashing', () => {
  it('hashes and verifies a password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('scrypt$')).toBe(true);
    expect(await verifyPassword('correct horse battery staple', hash)).toBe(true);
  });

  it('rejects the wrong password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(await verifyPassword('Correct horse battery staple', hash)).toBe(false);
    expect(await verifyPassword('', hash)).toBe(false);
  });

  it('produces a unique salt for every hash', async () => {
    const first = await hashPassword('same-password-value');
    const second = await hashPassword('same-password-value');
    expect(first).not.toEqual(second);
    expect(await verifyPassword('same-password-value', first)).toBe(true);
    expect(await verifyPassword('same-password-value', second)).toBe(true);
  });

  it('stores cost parameters in the hash string', async () => {
    const hash = await hashPassword('parameters-are-recorded');
    const parsed = parseStoredHash(hash);
    expect(parsed).not.toBeNull();
    expect(parsed?.cost).toBe(4096); // test configuration
    expect(parsed?.blockSize).toBe(8);
    expect(passwordHashNeedsUpgrade(hash)).toBe(false);
  });

  it('rejects malformed stored hashes instead of throwing', async () => {
    expect(parseStoredHash('not-a-hash')).toBeNull();
    expect(await verifyPassword('anything', 'bcrypt$whatever')).toBe(false);
  });

  it('flags hashes created with weaker parameters for upgrade', async () => {
    const weak = 'scrypt$N=1024,r=8,p=1$c2FsdA$aGFzaA';
    expect(passwordHashNeedsUpgrade(weak)).toBe(true);
  });

  it('always returns false for the timing equaliser', async () => {
    expect(await verifyDummyPassword('anything')).toBe(false);
  });

  it('enforces the password policy', () => {
    expect(() => assertPasswordLength('short')).toThrow();
    expect(() => assertPasswordLength('x'.repeat(201))).toThrow();
    expect(() => assertPasswordLength('a-long-enough-password')).not.toThrow();
  });
});

describe('session tokens', () => {
  it('generates high-entropy, URL-safe tokens', () => {
    const token = generateOpaqueToken();
    expect(token).toMatch(/^[A-Za-z0-9_-]+$/);
    expect(token.length).toBeGreaterThanOrEqual(40);
    expect(generateOpaqueToken()).not.toEqual(token);
  });

  it('hashes tokens deterministically without storing the token', () => {
    const token = generateOpaqueToken();
    const hash = hashToken(token);
    expect(hash).toMatch(/^[0-9a-f]{64}$/);
    expect(hashToken(token)).toEqual(hash);
    expect(hash).not.toContain(token);
  });

  it('compares tokens safely', () => {
    expect(safeTokenEquals('abc123', 'abc123')).toBe(true);
    expect(safeTokenEquals('abc123', 'abc124')).toBe(false);
    expect(safeTokenEquals('abc123', 'abc12')).toBe(false);
  });
});
