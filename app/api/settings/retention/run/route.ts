import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { applyRetentionPolicies } from '@/lib/data-lifecycle';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'settings:retention:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const result = await applyRetentionPolicies();

  await recordAudit({
    action: 'settings.retention.run',
    entityType: 'SystemSetting',
    entityId: 'retention.cleanup',
    userId: guard.session.user?.id ?? null,
    newData: result,
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, deleted: result });
}
