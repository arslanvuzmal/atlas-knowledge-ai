import { NextResponse } from 'next/server';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { getStorage, StorageError } from '@/lib/storage';
import { recordAudit } from '@/lib/security/audit';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

/**
 * Serves an original uploaded file.
 *
 * The storage key alone is never sufficient authorisation. The key is looked up
 * against a Document row, and the caller's role is checked against that
 * document's access level before a single byte is read. This is why the local
 * storage adapter returns an application route rather than a filesystem path.
 */
export async function GET(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'document:download',
    skipCsrf: true,
  });
  if (!guard.ok) return guard.response;

  const url = new URL(request.url);
  const key = url.searchParams.get('key');
  if (!key) {
    return NextResponse.json({ error: 'No storage key was supplied.' }, { status: 400 });
  }

  const document = await prisma.document.findFirst({
    where: { storagePath: key },
    select: {
      id: true,
      title: true,
      accessLevel: true,
      mimeType: true,
      originalFilename: true,
    },
  });

  if (!document || !canReadAccessLevel(guard.role, document.accessLevel)) {
    return NextResponse.json({ error: 'File not found.' }, { status: 404 });
  }

  try {
    const bytes = await getStorage().get(key);

    await recordAudit({
      action: 'document.download',
      entityType: 'Document',
      entityId: document.id,
      userId: guard.session.user?.id ?? null,
      metadata: { filename: document.originalFilename },
      ip: guard.ip,
    });

    const safeName = (document.originalFilename ?? 'document').replace(/["\r\n]/g, '');

    return new NextResponse(new Uint8Array(bytes), {
      headers: {
        'Content-Type': document.mimeType || 'application/octet-stream',
        // `attachment` prevents an uploaded HTML or SVG file from executing in
        // the application's origin.
        'Content-Disposition': `attachment; filename="${safeName}"`,
        'Content-Length': String(bytes.byteLength),
        'Cache-Control': 'private, no-store',
        'X-Content-Type-Options': 'nosniff',
      },
    });
  } catch (error) {
    if (error instanceof StorageError && error.kind === 'not_found') {
      return NextResponse.json({ error: 'File not found.' }, { status: 404 });
    }
    logger.error('Document download failed', { documentId: document.id, error });
    return NextResponse.json({ error: 'The file could not be retrieved.' }, { status: 500 });
  }
}
