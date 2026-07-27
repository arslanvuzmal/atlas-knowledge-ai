/**
 * In-process sliding-window rate limiter.
 *
 * Deliberately simple: a single Node process holds the counters. That is
 * correct for the local/demo deployment target and for a single Vercel
 * instance, but it does NOT coordinate across serverless instances. The
 * production hardening guide documents Redis or Postgres as the shared-state
 * upgrade. Login lockout, which must survive instance churn, is backed by the
 * LoginAttempt table instead of this module.
 */

interface Bucket {
  hits: number[];
}

const buckets = new Map<string, Bucket>();
let lastSweep = Date.now();
const SWEEP_INTERVAL_MS = 60_000;

export interface RateLimitRule {
  /** Window length in milliseconds. */
  windowMs: number;
  /** Maximum requests permitted inside the window. */
  max: number;
}

export interface RateLimitResult {
  allowed: boolean;
  remaining: number;
  limit: number;
  /** Seconds until the window frees a slot. Zero when allowed. */
  retryAfterSeconds: number;
}

export const RATE_LIMITS = {
  login: { windowMs: 15 * 60_000, max: 10 },
  chat: { windowMs: 60_000, max: 20 },
  publicChat: { windowMs: 60_000, max: 10 },
  upload: { windowMs: 5 * 60_000, max: 20 },
  urlIngest: { windowMs: 10 * 60_000, max: 10 },
  feedback: { windowMs: 60_000, max: 30 },
  mutation: { windowMs: 60_000, max: 60 },
} as const satisfies Record<string, RateLimitRule>;

export type RateLimitName = keyof typeof RATE_LIMITS;

function sweep(now: number) {
  if (now - lastSweep < SWEEP_INTERVAL_MS) return;
  lastSweep = now;
  const cutoff = now - 60 * 60_000;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

export function checkRateLimit(
  name: RateLimitName,
  identifier: string,
  now: number = Date.now(),
): RateLimitResult {
  const rule = RATE_LIMITS[name];
  sweep(now);

  const key = `${name}:${identifier}`;
  const bucket = buckets.get(key) ?? { hits: [] };
  const windowStart = now - rule.windowMs;
  bucket.hits = bucket.hits.filter((t) => t > windowStart);

  if (bucket.hits.length >= rule.max) {
    buckets.set(key, bucket);
    const oldest = bucket.hits[0] ?? now;
    const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
    return { allowed: false, remaining: 0, limit: rule.max, retryAfterSeconds };
  }

  bucket.hits.push(now);
  buckets.set(key, bucket);
  return {
    allowed: true,
    remaining: rule.max - bucket.hits.length,
    limit: rule.max,
    retryAfterSeconds: 0,
  };
}

/** Test helper. */
export function resetRateLimits(): void {
  buckets.clear();
  lastSweep = 0;
}
