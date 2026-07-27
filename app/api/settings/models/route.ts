import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { getModelSettings, saveModelSettings } from '@/lib/retrieval/settings';
import { resetLlmProviderCache } from '@/lib/ai';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'settings:models:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const previous = await getModelSettings();
  const result = await saveModelSettings(body, guard.session.user?.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.errors.join(' '), errors: result.errors },
      { status: 400 },
    );
  }

  // The provider instance is memoised, so a change must invalidate it.
  resetLlmProviderCache();

  await recordAudit({
    action: 'settings.models.update',
    entityType: 'SystemSetting',
    entityId: 'models.configuration',
    userId: guard.session.user?.id ?? null,
    previousData: previous,
    newData: result.settings,
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, settings: result.settings });
}
