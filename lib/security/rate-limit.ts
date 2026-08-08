import { logger } from '@/lib/observability/logger';
import { env } from '@/lib/env';

/**
 * Rate limiting with pluggable backends.
 *
 * Two modes:
 *  1. Synchronous in-memory (default, dev/demo) - checkRateLimit()
 *  2. Async shared backends (Database) - checkRateLimitAsync()
 *
 * Login lockout uses the LoginAttempt table directly and is NOT affected by this.
 */

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

// ============================================================================
// SYNCHRONOUS IN-MEMORY BACKEND (default, dev/demo)
// ============================================================================

const buckets = new Map<string, { hits: number[] }>();
let lastSweep = 0;

function sweep(now: number) {
  if (now - lastSweep < 60_000) return;
  lastSweep = now;
  const cutoff = now - 60 * 60_000;
  for (const [key, bucket] of buckets) {
    bucket.hits = bucket.hits.filter((t) => t > cutoff);
    if (bucket.hits.length === 0) buckets.delete(key);
  }
}

/**
 * Synchronous rate limit check (in-memory only).
 * Use for dev/demo. Does NOT work across serverless instances.
 */
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

/** Database fallback using SystemSetting (for when RateLimitEntry model doesn't exist). */
class DatabaseFallbackBackend {
  async check(
    name: string,
    identifier: string,
    rule: { windowMs: number; max: number },
    now: number,
  ): Promise<RateLimitResult> {
    const { prisma } = await import('@/lib/database/client');
    const key = `ratelimit:${name}:${identifier}`;

    const setting = await prisma.systemSetting.findUnique({
      where: { key: `ratelimit:${key}` },
    });

    const data = (setting?.value as { hits: number[] } | undefined) ?? { hits: [] };
    data.hits = data.hits.filter((t: number) => t > now - rule.windowMs);

    if (data.hits.length >= rule.max) {
      const oldest = data.hits[0] ?? now;
      await prisma.systemSetting.upsert({
        where: { key: `ratelimit:${key}` },
        create: { key: `ratelimit:${key}`, value: data },
        update: { value: data },
      });
      const retryAfterSeconds = Math.max(1, Math.ceil((oldest + rule.windowMs - now) / 1000));
      return { allowed: false, remaining: 0, limit: rule.max, retryAfterSeconds };
    }

    data.hits.push(now);
    await prisma.systemSetting.upsert({
      where: { key: `ratelimit:${key}` },
      create: { key: `ratelimit:${key}`, value: data },
      update: { value: data },
    });

    return {
      allowed: true,
      remaining: rule.max - data.hits.length,
      limit: rule.max,
      retryAfterSeconds: 0,
    };
  }

  async reset(): Promise<void> {
    const { prisma } = await import('@/lib/database/client');
    const settings = await prisma.systemSetting.findMany({
      where: { key: { startsWith: 'ratelimit:' } },
      select: { key: true },
    });
    if (settings.length > 0) {
      await prisma.systemSetting.deleteMany({
        where: { key: { in: settings.map((s) => s.key) } },
      });
    }
  }
}

const databaseFallbackBackend = new DatabaseFallbackBackend();

function getBackendType(): 'memory' | 'database' {
  const backend = env().RATE_LIMIT_BACKEND?.toLowerCase();
  if (backend === 'database') return 'database';
  return 'memory';
}

/**
 * Async rate limit check for shared backends (Database).
 * Falls back to in-memory if no shared backend is configured.
 */
export async function checkRateLimitAsync(
  name: RateLimitName,
  identifier: string,
  now: number = Date.now(),
): Promise<RateLimitResult> {
  const backendType = getBackendType();

  if (backendType === 'memory') {
    // Use sync version
    return checkRateLimit(name, identifier, now);
  }

  // Database backend
  try {
    return await databaseFallbackBackend.check(name, identifier, RATE_LIMITS[name], Date.now());
  } catch (error) {
    logger.warn('Database rate limit check failed, falling back to memory', { error });
    return checkRateLimit(name, identifier, now);
  }
}

export async function resetRateLimitsAsync(): Promise<void> {
  const backendType = getBackendType();
  if (backendType === 'database') {
    await databaseFallbackBackend.reset();
  } else {
    resetRateLimits();
  }
}
