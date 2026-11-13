import { randomBytes, scrypt as scryptCallback, timingSafeEqual } from 'node:crypto';
import { promisify } from 'node:util';
import { getServerConfig } from '@/lib/config';

const scrypt = promisify(scryptCallback) as (
  password: string | Buffer,
  salt: string | Buffer,
  keylen: number,
  options: { N: number; r: number; p: number; maxmem: number }
) => Promise<Buffer>;

const KEY_LENGTH = 64;
const BLOCK_SIZE = 8;
const PARALLELISM = 1;
const SALT_LENGTH = 16;
const ALGORITHM = 'scrypt';

/**
 * Password hashing with Node's built-in scrypt.
 *
 * Stored format:
 *   scrypt$N=<cost>,r=<block>,p=<parallel>$<salt base64url>$<hash base64url>
 *
 * scrypt is memory-hard and built into Node, so there is no native build step
 * and no third-party dependency in the authentication path.
 */
export async function hashPassword(password: string): Promise<string> {
  const cost = getServerConfig().PASSWORD_HASH_COST;
  assertPasswordLength(password);

  const salt = randomBytes(SALT_LENGTH);
  const derived = await scrypt(password, salt, KEY_LENGTH, {
    N: cost,
    r: BLOCK_SIZE,
    p: PARALLELISM,
    maxmem: 256 * 1024 * 1024,
  });

  return [
    ALGORITHM,
    `N=${cost},r=${BLOCK_SIZE},p=${PARALLELISM}`,
    salt.toString('base64url'),
    derived.toString('base64url'),
  ].join('$');
}

export async function verifyPassword(password: string, storedHash: string): Promise<boolean> {
  const parsed = parseStoredHash(storedHash);
  if (!parsed) return false;

  const derived = await scrypt(password, parsed.salt, parsed.hash.length, {
    N: parsed.cost,
    r: parsed.blockSize,
    p: parsed.parallelism,
    maxmem: 256 * 1024 * 1024,
  });

  if (derived.length !== parsed.hash.length) return false;
  return timingSafeEqual(derived, parsed.hash);
}

/**
 * Constant-ish work for unknown accounts: sign-in always performs one scrypt
 * derivation so that "user does not exist" is not obviously faster than
 * "wrong password".
 */
let dummyHashPromise: Promise<string> | null = null;
export async function verifyDummyPassword(password: string): Promise<false> {
  dummyHashPromise ??= hashPassword('contractors-guild-timing-equaliser');
  const dummyHash = await dummyHashPromise;
  await verifyPassword(password, dummyHash);
  return false;
}

export function assertPasswordLength(password: string): void {
  if (password.length < 10) {
    throw new Error('Password must be at least 10 characters long.');
  }
  if (password.length > 200) {
    throw new Error('Password must be 200 characters or fewer.');
  }
}

type ParsedHash = {
  cost: number;
  blockSize: number;
  parallelism: number;
  salt: Buffer;
  hash: Buffer;
};

export function parseStoredHash(stored: string): ParsedHash | null {
  const parts = stored.split('$');
  if (parts.length !== 4) return null;

  const [algorithm, params, saltPart, hashPart] = parts;
  if (algorithm !== ALGORITHM || !params || !saltPart || !hashPart) return null;

  const settings: Record<string, number> = {};
  for (const pair of params.split(',')) {
    const [key, value] = pair.split('=');
    if (!key || !value) return null;
    const parsed = Number.parseInt(value, 10);
    if (!Number.isFinite(parsed)) return null;
    settings[key] = parsed;
  }

  const cost = settings.N;
  const blockSize = settings.r;
  const parallelism = settings.p;
  if (!cost || !blockSize || !parallelism) return null;

  try {
    return {
      cost,
      blockSize,
      parallelism,
      salt: Buffer.from(saltPart, 'base64url'),
      hash: Buffer.from(hashPart, 'base64url'),
    };
  } catch {
    return null;
  }
}

/** True when the stored hash was produced with different (weaker) parameters. */
export function passwordHashNeedsUpgrade(stored: string): boolean {
  const parsed = parseStoredHash(stored);
  if (!parsed) return true;
  return parsed.cost < getServerConfig().PASSWORD_HASH_COST;
}
