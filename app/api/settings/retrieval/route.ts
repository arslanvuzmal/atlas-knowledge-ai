import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { getRetrievalSettings, saveRetrievalSettings } from '@/lib/retrieval/settings';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

export async function PUT(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'settings:retrieval:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const previous = await getRetrievalSettings();
  const result = await saveRetrievalSettings(body, guard.session.user?.id);

  if (!result.ok) {
    return NextResponse.json(
      { error: result.errors.join(' '), errors: result.errors },
      { status: 400 },
    );
  }

  await recordAudit({
    action: 'settings.retrieval.update',
    entityType: 'SystemSetting',
    entityId: 'retrieval.configuration',
    userId: guard.session.user?.id ?? null,
    previousData: previous,
    newData: result.settings,
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    settings: result.settings,
    // Chunking parameters only affect documents processed after the change.
    note:
      previous.chunkSize !== result.settings.chunkSize ||
      previous.chunkOverlap !== result.settings.chunkOverlap
        ? 'Chunk size and overlap apply to newly processed documents. Reprocess existing documents to rebuild them with the new settings.'
        : null,
  });
}
