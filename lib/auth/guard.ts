import { headers } from 'next/headers';
import { NextResponse } from 'next/server';
import type { Role } from '@prisma/client';
import { getSession, CSRF_COOKIE, type SessionContext } from '@/lib/auth/session';
import { hasPermission, type Permission } from '@/lib/auth/rbac';
import { checkRateLimit, type RateLimitName } from '@/lib/security/rate-limit';
import { recordAudit } from '@/lib/security/audit';
import { newCorrelationId } from '@/lib/observability/logger';

/**
 * Route-handler guards.
 *
 * Every mutating API route runs through `guardRequest`, which applies, in
 * order: origin check, CSRF double-submit check, rate limit, authentication,
 * and permission. A route that forgets one of these has to actively opt out
 * rather than passively omit it.
 */

export interface GuardOptions {
  permission?: Permission;
  rateLimit?: RateLimitName;
  /** Set for GET handlers, which are not state-changing. */
  skipCsrf?: boolean;
  /** Allows anonymous callers, who are treated as the PUBLIC role. */
  allowAnonymous?: boolean;
}

export interface GuardSuccess {
  ok: true;
  session: SessionContext;
  role: Role;
  ip: string | null;
  correlationId: string;
}

export interface GuardFailure {
  ok: false;
  response: NextResponse;
}

export type GuardResult = GuardSuccess | GuardFailure;

/**
 * Best-effort client address for rate limiting and audit correlation. It is
 * only ever stored as a keyed hash, never in plain text.
 */
export async function getClientIp(): Promise<string | null> {
  const headerList = await headers();
  const forwarded = headerList.get('x-forwarded-for');
  if (forwarded) return forwarded.split(',')[0].trim();
  return headerList.get('x-real-ip') ?? null;
}

function errorResponse(
  status: number,
  message: string,
  correlationId: string,
  extra: Record<string, unknown> = {},
): NextResponse {
  return NextResponse.json({ error: message, correlationId, ...extra }, { status });
}

/** Rejects cross-site requests before any work is done. */
async function originAllowed(): Promise<boolean> {
  const headerList = await headers();
  const origin = headerList.get('origin');
  // Same-origin fetches from a browser omit Origin on some navigations; a
  // missing Origin combined with a valid CSRF token is acceptable.
  if (!origin) return true;

  const host = headerList.get('host');
  if (!host) return false;

  try {
    return new URL(origin).host === host;
  } catch {
    return false;
  }
}

export async function guardRequest(
  request: Request,
  options: GuardOptions = {},
): Promise<GuardResult> {
  const correlationId = newCorrelationId();
  const ip = await getClientIp();

  // --- Origin -------------------------------------------------------------
  if (!options.skipCsrf && !(await originAllowed())) {
    return {
      ok: false,
      response: errorResponse(403, 'Cross-origin requests are not permitted.', correlationId),
    };
  }

  // --- CSRF double-submit --------------------------------------------------
  if (!options.skipCsrf) {
    const headerToken = request.headers.get('x-atlas-csrf');
    const cookieHeader = request.headers.get('cookie') ?? '';
    const match = new RegExp(`(?:^|;\\s*)${CSRF_COOKIE}=([^;]+)`).exec(cookieHeader);
    const cookieToken = match ? decodeURIComponent(match[1]) : null;

    // Anonymous callers have no session and therefore no CSRF cookie; for them
    // the origin check above is the control.
    if (cookieToken && headerToken !== cookieToken) {
      return {
        ok: false,
        response: errorResponse(403, 'Invalid or missing CSRF token.', correlationId),
      };
    }
  }

  // --- Rate limit ----------------------------------------------------------
  if (options.rateLimit) {
    const identifier = ip ?? 'unknown';
    const limit = checkRateLimit(options.rateLimit, identifier);
    if (!limit.allowed) {
      await recordAudit({
        action: 'security.rate-limit',
        entityType: 'Request',
        metadata: { limit: options.rateLimit, correlationId },
        ip,
      });
      return {
        ok: false,
        response: NextResponse.json(
          {
            error: 'Too many requests. Please wait a moment and try again.',
            retryAfterSeconds: limit.retryAfterSeconds,
            correlationId,
          },
          { status: 429, headers: { 'Retry-After': String(limit.retryAfterSeconds) } },
        ),
      };
    }
  }

  // --- Authentication ------------------------------------------------------
  const session = await getSession();

  if (!session.isAuthenticated && !options.allowAnonymous) {
    return {
      ok: false,
      response: errorResponse(401, 'You must sign in to do that.', correlationId),
    };
  }

  // --- Permission ----------------------------------------------------------
  if (options.permission && !hasPermission(session.role, options.permission)) {
    await recordAudit({
      action: 'security.unauthorised',
      entityType: 'Request',
      userId: session.user?.id ?? null,
      metadata: { permission: options.permission, role: session.role, correlationId },
      ip,
    });
    // 403, not 404: the caller is authenticated and the route exists. Resource
    // existence is hidden at the query layer instead, by scoping every read to
    // the caller's access levels.
    return {
      ok: false,
      response: errorResponse(403, 'You do not have permission to do that.', correlationId),
    };
  }

  return { ok: true, session, role: session.role, ip, correlationId };
}

/** Page-level guard for server components. Returns null when not permitted. */
export async function requirePagePermission(
  permission: Permission,
): Promise<SessionContext | null> {
  const session = await getSession();
  if (!session.isAuthenticated) return null;
  if (!hasPermission(session.role, permission)) return null;
  return session;
}

export function jsonError(status: number, message: string, extra: Record<string, unknown> = {}) {
  return NextResponse.json({ error: message, ...extra }, { status });
}
