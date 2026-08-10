import { cookies } from 'next/headers';
import type { Role, User } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';
import { keyedHash, randomToken, sha256 } from '@/lib/security/hash';

export const SESSION_COOKIE = 'atlas_session';
export const CSRF_COOKIE = 'atlas_csrf';
const SESSION_TTL_MS = 8 * 60 * 60 * 1000; // 8 hours
const SESSION_RENEW_THRESHOLD_MS = 60 * 60 * 1000; // renew when under 1 hour left

export interface SessionUser {
  id: string;
  name: string;
  email: string;
  role: Role;
  isDemo: boolean;
}

export interface SessionContext {
  user: SessionUser | null;
  /** Effective role. Unauthenticated callers act as PUBLIC, never as unchecked. */
  role: Role;
  isAuthenticated: boolean;
}

function toSessionUser(user: User): SessionUser {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    role: user.role,
    isDemo: user.isDemo,
  };
}

/**
 * Issues a session. The raw token is returned to be placed in an HTTP-only
 * cookie; only its SHA-256 is persisted, so a database leak cannot be replayed
 * as a valid session.
 */
export async function createSession(
  userId: string,
  meta: { ip?: string | null; userAgent?: string | null } = {},
): Promise<{ token: string; csrfToken: string; expiresAt: Date }> {
  const token = randomToken(32);
  const csrfToken = randomToken(24);
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
  const secret = env().AUTH_SECRET;

  await prisma.session.create({
    data: {
      tokenHash: sha256(token),
      userId,
      expiresAt,
      ipHash: meta.ip ? keyedHash(meta.ip, secret) : null,
      userAgentHash: meta.userAgent ? keyedHash(meta.userAgent, secret) : null,
    },
  });

  const cookieStore = await cookies();
  const secure = env().APP_URL.startsWith('https://');

  cookieStore.set(SESSION_COOKIE, token, {
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  // Readable by client script on purpose: it is the double-submit CSRF token.
  // Its security comes from same-origin policy, not from being secret to the page.
  cookieStore.set(CSRF_COOKIE, csrfToken, {
    httpOnly: false,
    secure,
    sameSite: 'lax',
    path: '/',
    expires: expiresAt,
  });

  return { token, csrfToken, expiresAt };
}

/**
 * Resolves the current session. Returns the PUBLIC role for anonymous callers
 * so every downstream authorisation check operates on a concrete role.
 */
export async function getSession(): Promise<SessionContext> {
  const anonymous: SessionContext = { user: null, role: 'PUBLIC', isAuthenticated: false };

  let token: string | undefined;
  let demoRoleCookie: string | undefined;
  try {
    const cookieStore = await cookies();
    token = cookieStore.get(SESSION_COOKIE)?.value;
    demoRoleCookie = cookieStore.get('atlas_demo_role')?.value;
  } catch {
    // `cookies()` is unavailable in some rendering contexts; treat as anonymous.
    return anonymous;
  }

  if (!token) {
    if (env().DEMO_MODE) {
      const demoRole = (demoRoleCookie as Role) || 'ADMIN';
      if (demoRole === 'PUBLIC') return anonymous;

      const demoUser = await prisma.user.findFirst({
        where: { isDemo: true },
        orderBy: { createdAt: 'asc' },
      });

      if (demoUser) {
        return {
          user: toSessionUser({ ...demoUser, role: demoRole }),
          role: demoRole,
          isAuthenticated: true,
        };
      }

      return {
        user: {
          id: 'demo-user-id',
          name: 'Demo Administrator',
          email: 'admin@northstar.example',
          role: demoRole,
          isDemo: true,
        },
        role: demoRole,
        isAuthenticated: true,
      };
    }
    return anonymous;
  }

  const record = await prisma.session.findUnique({
    where: { tokenHash: sha256(token) },
    include: { user: true },
  });

  if (!record || record.revokedAt || record.expiresAt.getTime() <= Date.now()) {
    return anonymous;
  }
  if (record.user.status !== 'ACTIVE') {
    return anonymous;
  }
  // Demo accounts must stop working the moment demo mode is switched off.
  if (record.user.isDemo && !env().DEMO_MODE) {
    return anonymous;
  }

  // Sliding expiry, written only when it is close to lapsing.
  if (record.expiresAt.getTime() - Date.now() < SESSION_RENEW_THRESHOLD_MS) {
    const expiresAt = new Date(Date.now() + SESSION_TTL_MS);
    await prisma.session.update({ where: { id: record.id }, data: { expiresAt } });
  }

  return {
    user: toSessionUser(record.user),
    role: record.user.role,
    isAuthenticated: true,
  };
}

export async function destroySession(): Promise<void> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (token) {
    await prisma.session.updateMany({
      where: { tokenHash: sha256(token), revokedAt: null },
      data: { revokedAt: new Date() },
    });
  }
  cookieStore.delete(SESSION_COOKIE);
  cookieStore.delete(CSRF_COOKIE);
}

export async function revokeAllSessionsForUser(userId: string): Promise<number> {
  const result = await prisma.session.updateMany({
    where: { userId, revokedAt: null },
    data: { revokedAt: new Date() },
  });
  return result.count;
}

/** Housekeeping for expired rows. Safe to call opportunistically. */
export async function pruneExpiredSessions(): Promise<number> {
  const result = await prisma.session.deleteMany({
    where: { expiresAt: { lt: new Date(Date.now() - 24 * 60 * 60 * 1000) } },
  });
  return result.count;
}
