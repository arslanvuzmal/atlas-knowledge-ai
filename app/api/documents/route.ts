import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { env } from '@/lib/env';
import { validateUpload } from '@/lib/security/files';
import { ingestSource } from '@/lib/documents/ingest';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 120;

const metadataSchema = z.object({
  knowledgeBaseId: z.string().cuid(),
  title: z.string().min(1).max(200).optional(),
  accessLevel: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']),
});

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'document:upload',
    rateLimit: 'upload',
  });
  if (!guard.ok) return guard.response;

  const maxBytes = env().MAX_UPLOAD_SIZE_MB * 1024 * 1024;

  // Reject an oversized body before buffering it into memory.
  const declaredLength = Number.parseInt(request.headers.get('content-length') ?? '', 10);
  if (Number.isFinite(declaredLength) && declaredLength > maxBytes + 1024 * 64) {
    return NextResponse.json(
      { error: `The upload exceeds the ${env().MAX_UPLOAD_SIZE_MB} MB limit.` },
      { status: 413 },
    );
  }

  let form: FormData;
  try {
    form = await request.formData();
  } catch {
    return NextResponse.json({ error: 'The upload could not be read.' }, { status: 400 });
  }

  const file = form.get('file');
  if (!(file instanceof File)) {
    return NextResponse.json({ error: 'No file was included in the upload.' }, { status: 400 });
  }

  const parsed = metadataSchema.safeParse({
    knowledgeBaseId: form.get('knowledgeBaseId'),
    title: form.get('title') || undefined,
    accessLevel: form.get('accessLevel'),
  });
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid upload details.' },
      { status: 400 },
    );
  }

  // Nobody may classify a document above their own reach. Otherwise a manager
  // could create ADMIN-only content they then cannot see or correct.
  if (!canReadAccessLevel(guard.role, parsed.data.accessLevel)) {
    return NextResponse.json(
      { error: 'You cannot assign an access level above your own.' },
      { status: 403 },
    );
  }

  const knowledgeBase = await prisma.knowledgeBase.findUnique({
    where: { id: parsed.data.knowledgeBaseId },
    select: { id: true },
  });
  if (!knowledgeBase) {
    return NextResponse.json({ error: 'That knowledge base does not exist.' }, { status: 404 });
  }

  const bytes = Buffer.from(await file.arrayBuffer());

  const validation = validateUpload({
    filename: file.name,
    mimeType: file.type,
    size: bytes.byteLength,
    bytes,
    maxSizeBytes: maxBytes,
  });
  if (!validation.ok || !validation.sourceType || !validation.safeFilename) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  try {
    const result = await ingestSource({
      knowledgeBaseId: parsed.data.knowledgeBaseId,
      title: parsed.data.title || validation.safeFilename.replace(/\.[^.]+$/, ''),
      accessLevel: parsed.data.accessLevel,
      sourceType: validation.sourceType,
      bytes,
      originalFilename: validation.safeFilename,
      mimeType: file.type || null,
      uploadedBy: guard.session.user?.id ?? null,
    });

    if (!result.ok) {
      return NextResponse.json(
        {
          error: result.error?.message ?? 'Ingestion failed.',
          stage: result.error?.stage,
          documentId: result.documentId,
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
      pageCount: result.pageCount,
      warnings: result.warnings,
      injectionRisk: result.injectionRisk ?? null,
      correlationId: result.correlationId,
    });
  } catch (error) {
    logger.error('Upload handler failed', { correlationId: guard.correlationId, error });
    return NextResponse.json(
      { error: 'The document could not be processed.', correlationId: guard.correlationId },
      { status: 500 },
    );
  }
}
