/**
 * Fixed-window rate limiting.
 *
 * LIMITATION (documented in SECURITY.md): this limiter is in-process. It stops
 * casual credential stuffing against a single instance, but it is not a
 * substitute for an edge/WAF limiter or a shared store (Redis/Postgres) once
 * the app runs on more than one server or serverless instance.
 */
type Bucket = { count: number; resetAt: number };

type GlobalWithBuckets = typeof globalThis & { __cgRateLimitBuckets?: Map<string, Bucket> };

const globalForBuckets = globalThis as GlobalWithBuckets;
const buckets = (globalForBuckets.__cgRateLimitBuckets ??= new Map<string, Bucket>());

export type RateLimitResult = {
  allowed: boolean;
  remaining: number;
  retryAfterSeconds: number;
};

export type RateLimitOptions = {
  limit: number;
  windowMs: number;
};

export function checkRateLimit(key: string, options: RateLimitOptions): RateLimitResult {
  const now = Date.now();
  pruneExpired(now);

  const bucket = buckets.get(key);
  if (!bucket || bucket.resetAt <= now) {
    buckets.set(key, { count: 1, resetAt: now + options.windowMs });
    return { allowed: true, remaining: options.limit - 1, retryAfterSeconds: 0 };
  }

  bucket.count += 1;
  if (bucket.count > options.limit) {
    return {
      allowed: false,
      remaining: 0,
      retryAfterSeconds: Math.max(1, Math.ceil((bucket.resetAt - now) / 1000)),
    };
  }

  return { allowed: true, remaining: options.limit - bucket.count, retryAfterSeconds: 0 };
}

export function resetRateLimit(key: string): void {
  buckets.delete(key);
}

/** Clear every bucket. Used by tests; also handy for an operator "unblock" tool. */
export function clearRateLimits(): void {
  buckets.clear();
}

function pruneExpired(now: number): void {
  if (buckets.size < 500) return;
  for (const [key, bucket] of buckets) {
    if (bucket.resetAt <= now) buckets.delete(key);
  }
}

/** Shared limiters used by the auth actions. */
export const RATE_LIMITS = {
  login: { limit: 8, windowMs: 10 * 60 * 1000 },
  register: { limit: 5, windowMs: 60 * 60 * 1000 },
  passwordReset: { limit: 5, windowMs: 60 * 60 * 1000 },
} as const;
