import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { ingestManualText } from '@/lib/documents/ingest';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  knowledgeBaseId: z.string().cuid(),
  title: z.string().min(1).max(200),
  body: z.string().min(40, 'Provide at least 40 characters of content.').max(200_000),
  accessLevel: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']),
  sourceType: z.enum(['FAQ', 'MANUAL_ENTRY']),
});

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'document:upload',
    rateLimit: 'upload',
  });
  if (!guard.ok) return guard.response;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  if (!canReadAccessLevel(guard.role, parsed.data.accessLevel)) {
    return NextResponse.json(
      { error: 'You cannot assign an access level above your own.' },
      { status: 403 },
    );
  }

  try {
    const result = await ingestManualText({
      knowledgeBaseId: parsed.data.knowledgeBaseId,
      title: parsed.data.title,
      body: parsed.data.body,
      accessLevel: parsed.data.accessLevel,
      sourceType: parsed.data.sourceType,
      uploadedBy: guard.session.user?.id ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error?.message ?? 'The entry could not be indexed.',
          duplicateOf: result.duplicateOf,
        },
        { status: result.duplicateOf ? 409 : 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      warnings: result.warnings,
    });
  } catch (error) {
    logger.error('Manual text ingestion failed', { correlationId: guard.correlationId, error });
    return NextResponse.json({ error: 'The entry could not be indexed.' }, { status: 500 });
  }
}
