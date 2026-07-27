import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { ingestUrl } from '@/lib/documents/ingest';
import { validateUrlSyntax } from '@/lib/security/url-guard';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const schema = z.object({
  url: z.string().min(1).max(2048),
  knowledgeBaseId: z.string().cuid(),
  title: z.string().max(200).optional(),
  accessLevel: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']),
});

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'document:upload',
    rateLimit: 'urlIngest',
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
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  if (!canReadAccessLevel(guard.role, parsed.data.accessLevel)) {
    return NextResponse.json(
      { error: 'You cannot assign an access level above your own.' },
      { status: 403 },
    );
  }

  // Cheap syntactic rejection first, so an obviously internal target never
  // reaches the DNS-resolving stage.
  const syntax = validateUrlSyntax(parsed.data.url);
  if (!syntax.ok) {
    return NextResponse.json({ error: syntax.reason }, { status: 400 });
  }

  try {
    const result = await ingestUrl({
      url: parsed.data.url,
      knowledgeBaseId: parsed.data.knowledgeBaseId,
      accessLevel: parsed.data.accessLevel,
      title: parsed.data.title,
      uploadedBy: guard.session.user?.id ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error?.message ?? 'The URL could not be ingested.',
          stage: result.error?.stage,
          duplicateOf: result.duplicateOf,
          correlationId: result.correlationId,
        },
        { status: result.duplicateOf ? 409 : 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      warnings: result.warnings,
      injectionRisk: result.injectionRisk ?? null,
      correlationId: result.correlationId,
    });
  } catch (error) {
    logger.error('URL ingestion failed', { correlationId: guard.correlationId, error });
    return NextResponse.json(
      { error: 'The URL could not be processed.', correlationId: guard.correlationId },
      { status: 500 },
    );
  }
}
