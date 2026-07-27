import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { reprocessDocument } from '@/lib/documents/ingest';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

export async function POST(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'document:reprocess',
    rateLimit: 'upload',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const document = await prisma.document.findUnique({
    where: { id },
    select: { id: true, accessLevel: true },
  });
  if (!document || !canReadAccessLevel(guard.role, document.accessLevel)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  try {
    const result = await reprocessDocument(id, guard.session.user?.id ?? null);

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error?.message ?? 'Reprocessing failed.',
          stage: result.error?.stage,
          documentId: result.documentId,
          correlationId: result.correlationId,
        },
        { status: 422 },
      );
    }

    return NextResponse.json({
      ok: true,
      // Reprocessing rebuilds the document, so the id changes. The client needs
      // the new one to navigate to the refreshed record.
      documentId: result.documentId,
      chunkCount: result.chunkCount,
      warnings: result.warnings,
      correlationId: result.correlationId,
    });
  } catch (error) {
    logger.error('Reprocess handler failed', { documentId: id, error });
    return NextResponse.json({ error: 'Reprocessing failed.' }, { status: 500 });
  }
}
