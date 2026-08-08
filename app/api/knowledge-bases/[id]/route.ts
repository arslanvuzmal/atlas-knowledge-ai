import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const updateSchema = z.object({
  _action: z.literal('update'),
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']),
});

export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'knowledgebase:manage',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed request body.' }, { status: 400 });
  }

  const parsed = updateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message ?? 'Invalid request.' },
      { status: 400 },
    );
  }

  const existing = await prisma.knowledgeBase.findUnique({
    where: { id },
    select: { name: true, slug: true, description: true, visibility: true, ownerId: true },
  });

  if (!existing) {
    return NextResponse.json({ error: 'Knowledge base not found.' }, { status: 404 });
  }

  const updated = await prisma.knowledgeBase.update({
    where: { id },
    data: {
      name: parsed.data.name,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility,
    },
    select: {
      id: true,
      name: true,
      slug: true,
      description: true,
      visibility: true,
      ownerId: true,
    },
  });

  await recordAudit({
    action: 'knowledgebase.update',
    entityType: 'KnowledgeBase',
    entityId: updated.id,
    userId: guard.session.user?.id ?? null,
    previousData: existing,
    newData: updated,
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, knowledgeBase: updated });
}
