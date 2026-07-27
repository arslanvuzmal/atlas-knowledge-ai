import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({ reviewed: z.boolean() });

/** Marks a feedback item as reviewed, or returns it to the queue. */
export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'feedback:review',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

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

  const existing = await prisma.feedback.findUnique({ where: { id }, select: { reviewed: true } });
  if (!existing) {
    return NextResponse.json({ error: 'Feedback not found.' }, { status: 404 });
  }

  const updated = await prisma.feedback.update({
    where: { id },
    data: { reviewed: parsed.data.reviewed },
  });

  await recordAudit({
    action: 'feedback.review',
    entityType: 'Feedback',
    entityId: id,
    userId: guard.session.user?.id ?? null,
    previousData: { reviewed: existing.reviewed },
    newData: { reviewed: updated.reviewed },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, reviewed: updated.reviewed });
}
