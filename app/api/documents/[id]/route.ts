import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { canReadAccessLevel, hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { getStorage } from '@/lib/storage';
import { recordAudit } from '@/lib/security/audit';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({
  accessLevel: z.enum(['PUBLIC', 'CUSTOMER', 'EMPLOYEE', 'MANAGER', 'ADMIN']).optional(),
  title: z.string().min(1).max(200).optional(),
  archived: z.boolean().optional(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, { rateLimit: 'mutation' });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = patchSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid request.' }, { status: 400 });
  }

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document || !canReadAccessLevel(guard.role, document.accessLevel)) {
    // A document the caller cannot read is reported as absent, so this endpoint
    // cannot be used to probe for the existence of restricted documents.
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  const data: Record<string, unknown> = {};

  if (parsed.data.accessLevel !== undefined) {
    if (!hasPermission(guard.role, 'document:change-access-level')) {
      return NextResponse.json({ error: 'You cannot change access levels.' }, { status: 403 });
    }
    if (!canReadAccessLevel(guard.role, parsed.data.accessLevel)) {
      return NextResponse.json(
        { error: 'You cannot assign an access level above your own.' },
        { status: 403 },
      );
    }
    data.accessLevel = parsed.data.accessLevel;
  }

  if (parsed.data.title !== undefined) {
    if (!hasPermission(guard.role, 'document:upload')) {
      return NextResponse.json({ error: 'You cannot edit documents.' }, { status: 403 });
    }
    data.title = parsed.data.title;
  }

  if (parsed.data.archived !== undefined) {
    if (!hasPermission(guard.role, 'document:archive')) {
      return NextResponse.json({ error: 'You cannot archive documents.' }, { status: 403 });
    }
    data.archivedAt = parsed.data.archived ? new Date() : null;
    data.status = parsed.data.archived ? 'ARCHIVED' : 'INDEXED';
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No changes were supplied.' }, { status: 400 });
  }

  const updated = await prisma.document.update({ where: { id }, data });

  // An access-level change must propagate to every chunk, because retrieval
  // filters on the chunk's own level, not the document's.
  if (parsed.data.accessLevel !== undefined) {
    await prisma.documentChunk.updateMany({
      where: { documentId: id },
      data: { accessLevel: parsed.data.accessLevel },
    });
    await recordAudit({
      action: 'document.access-level.change',
      entityType: 'Document',
      entityId: id,
      userId: guard.session.user?.id ?? null,
      previousData: { accessLevel: document.accessLevel },
      newData: { accessLevel: parsed.data.accessLevel },
      ip: guard.ip,
    });
  }

  if (parsed.data.archived !== undefined) {
    await recordAudit({
      action: 'document.archive',
      entityType: 'Document',
      entityId: id,
      userId: guard.session.user?.id ?? null,
      newData: { archived: parsed.data.archived },
      ip: guard.ip,
    });
  }

  return NextResponse.json({
    ok: true,
    document: {
      id: updated.id,
      title: updated.title,
      accessLevel: updated.accessLevel,
      status: updated.status,
    },
  });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'document:delete',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const document = await prisma.document.findUnique({ where: { id } });
  if (!document || !canReadAccessLevel(guard.role, document.accessLevel)) {
    return NextResponse.json({ error: 'Document not found.' }, { status: 404 });
  }

  // The stored object is removed on a best-effort basis. A storage failure must
  // not leave a half-deleted database record behind.
  if (document.storagePath) {
    try {
      await getStorage().remove(document.storagePath);
    } catch (error) {
      logger.warn('Failed to remove stored object during document deletion', {
        documentId: id,
        error,
      });
    }
  }

  await recordAudit({
    action: 'document.delete',
    entityType: 'Document',
    entityId: id,
    userId: guard.session.user?.id ?? null,
    previousData: {
      title: document.title,
      accessLevel: document.accessLevel,
      chunkCount: document.chunkCount,
    },
    ip: guard.ip,
  });

  // Chunks, versions, jobs, and citations cascade from the schema.
  await prisma.document.delete({ where: { id } });

  return NextResponse.json({ ok: true });
}
