import { NextResponse } from 'next/server';
import { destroySession, getSession } from '@/lib/auth/session';
import { getClientIp } from '@/lib/auth/guard';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

export async function POST() {
  const session = await getSession();
  const ip = await getClientIp();

  if (session.user) {
    await recordAudit({
      action: 'auth.logout',
      entityType: 'User',
      entityId: session.user.id,
      userId: session.user.id,
      ip,
    });
  }

  // Always clears the cookies, even for an already-invalid session, so a stale
  // cookie cannot linger in the browser.
  await destroySession();
  return NextResponse.json({ ok: true });
}
