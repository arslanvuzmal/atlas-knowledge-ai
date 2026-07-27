import { NextResponse } from 'next/server';
import { getSession } from '@/lib/auth/session';
import { hasPermission } from '@/lib/auth/rbac';
import { getSystemHealth } from '@/lib/observability/health';
import { env } from '@/lib/env';

export const dynamic = 'force-dynamic';

/**
 * Health endpoint with two levels of detail.
 *
 * Unauthenticated callers (uptime monitors, load balancers) get a liveness
 * signal only. Component detail such as provider names, model identifiers, and
 * failure messages is reconnaissance material, so it requires the health:read
 * permission.
 */
export async function GET() {
  const session = await getSession();

  if (!hasPermission(session.role, 'health:read')) {
    return NextResponse.json(
      { status: 'ok', demoMode: env().DEMO_MODE, checkedAt: new Date().toISOString() },
      { status: 200 },
    );
  }

  const health = await getSystemHealth();
  const httpStatus = health.overall === 'UNAVAILABLE' ? 503 : 200;

  return NextResponse.json(health, { status: httpStatus });
}
