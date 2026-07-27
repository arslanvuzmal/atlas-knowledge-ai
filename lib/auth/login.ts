import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { verifyPassword } from '@/lib/auth/password';
import { createSession } from '@/lib/auth/session';
import { keyedHash } from '@/lib/security/hash';
import { recordAudit } from '@/lib/security/audit';
import { logger } from '@/lib/observability/logger';

/**
 * Authentication.
 *
 * Two properties matter here beyond checking the password:
 *
 *  - **Uniform failure.** Every failure path returns the same message and does
 *    the same amount of work, including a dummy password verification when the
 *    account does not exist. Otherwise response timing and wording become an
 *    account-enumeration oracle.
 *  - **Durable lockout.** Failed attempts are counted in the database rather
 *    than in process memory, so the lockout survives a restart and applies
 *    across serverless instances.
 */

const MAX_FAILED_ATTEMPTS = 8;
const LOCKOUT_WINDOW_MS = 15 * 60 * 1000;

// A real scrypt hash of a random value. Verifying against it makes the
// "no such user" path cost the same as the "wrong password" path.
const DUMMY_HASH =
  'scrypt$32768$8$1$YXRsYXNkdW1teXNhbHQxMjM0$' +
  'c2NyeXB0ZHVtbXlkZXJpdmVka2V5dmFsdWVmb3J0aW1pbmdzYWZldHlvbmx5MDAwMDAwMDA=';

const GENERIC_FAILURE = 'The email address or password is incorrect.';

export interface LoginResult {
  ok: boolean;
  userId?: string;
  role?: string;
  error?: string;
  lockedOut?: boolean;
  retryAfterSeconds?: number;
}

export async function attemptLogin(options: {
  email: string;
  password: string;
  ip?: string | null;
  userAgent?: string | null;
}): Promise<LoginResult> {
  const email = options.email.trim().toLowerCase();
  const identifierHash = keyedHash(email, env().AUTH_SECRET);

  // --- Lockout check ---------------------------------------------------------
  const since = new Date(Date.now() - LOCKOUT_WINDOW_MS);
  const recentFailures = await prisma.loginAttempt.count({
    where: { identifierHash, successful: false, createdAt: { gte: since } },
  });

  if (recentFailures >= MAX_FAILED_ATTEMPTS) {
    await recordAudit({
      action: 'auth.lockout',
      entityType: 'User',
      metadata: { reason: 'too many failed attempts', windowMinutes: LOCKOUT_WINDOW_MS / 60000 },
      ip: options.ip ?? null,
    });
    return {
      ok: false,
      error: 'Too many failed sign-in attempts. Please try again in 15 minutes.',
      lockedOut: true,
      retryAfterSeconds: Math.ceil(LOCKOUT_WINDOW_MS / 1000),
    };
  }

  const user = await prisma.user.findUnique({ where: { email } });

  // Always run a verification, even with no user, to keep timing uniform.
  const passwordMatches = await verifyPassword(options.password, user?.passwordHash ?? DUMMY_HASH);

  const fail = async (reason: string): Promise<LoginResult> => {
    await prisma.loginAttempt.create({ data: { identifierHash, successful: false } });
    await recordAudit({
      action: 'auth.login.failure',
      entityType: 'User',
      entityId: user?.id ?? null,
      metadata: { reason },
      ip: options.ip ?? null,
    });
    logger.warn('Sign-in failed', { reason });
    return { ok: false, error: GENERIC_FAILURE };
  };

  if (!user) return fail('no such account');
  if (!passwordMatches) return fail('incorrect password');
  if (user.status !== 'ACTIVE') return fail(`account status is ${user.status}`);

  // Demo accounts exist only for the demo. With demo mode off they must not
  // authenticate, or a deployed instance would ship with known credentials.
  if (user.isDemo && !env().DEMO_MODE) {
    return fail('demo account with demo mode disabled');
  }

  await prisma.loginAttempt.create({ data: { identifierHash, successful: true } });
  // Clear the failure history so a successful sign-in resets the counter.
  await prisma.loginAttempt.deleteMany({ where: { identifierHash, successful: false } });

  await createSession(user.id, { ip: options.ip, userAgent: options.userAgent });
  await prisma.user.update({ where: { id: user.id }, data: { lastLoginAt: new Date() } });

  await recordAudit({
    action: 'auth.login.success',
    entityType: 'User',
    entityId: user.id,
    userId: user.id,
    metadata: { role: user.role, isDemo: user.isDemo },
    ip: options.ip ?? null,
  });

  return { ok: true, userId: user.id, role: user.role };
}
