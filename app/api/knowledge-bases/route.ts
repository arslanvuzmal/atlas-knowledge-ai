import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  name: z.string().min(2).max(120),
  description: z.string().max(500).optional(),
  visibility: z.enum(['PUBLIC', 'INTERNAL', 'RESTRICTED']),
});

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60);
}

export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    permission: 'knowledgebase:manage',
    rateLimit: 'mutation',
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

  const baseSlug = toSlug(parsed.data.name) || 'knowledge-base';
  let slug = baseSlug;
  // Slugs are unique; append a counter rather than failing on a name collision.
  for (let attempt = 2; attempt < 50; attempt += 1) {
    const clash = await prisma.knowledgeBase.findUnique({ where: { slug }, select: { id: true } });
    if (!clash) break;
    slug = `${baseSlug}-${attempt}`;
  }

  const created = await prisma.knowledgeBase.create({
    data: {
      name: parsed.data.name,
      slug,
      description: parsed.data.description ?? null,
      visibility: parsed.data.visibility,
      ownerId: guard.session.user?.id ?? null,
    },
  });

  await recordAudit({
    action: 'knowledgebase.create',
    entityType: 'KnowledgeBase',
    entityId: created.id,
    userId: guard.session.user?.id ?? null,
    newData: { name: created.name, slug: created.slug, visibility: created.visibility },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, knowledgeBase: created });
}
