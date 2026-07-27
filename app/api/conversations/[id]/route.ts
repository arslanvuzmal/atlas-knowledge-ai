import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';

export const dynamic = 'force-dynamic';

const patchSchema = z.object({ title: z.string().min(1).max(140) });

/**
 * Ownership check.
 *
 * A conversation may be read or modified by its owner, and read by a manager or
 * administrator who holds `conversation:read:all`. Everything else is reported
 * as not found rather than forbidden, so conversation ids cannot be probed.
 */
async function loadOwned(id: string, userId: string | undefined, role: string) {
  const conversation = await prisma.conversation.findUnique({
    where: { id },
    select: { id: true, userId: true },
  });
  if (!conversation) return null;

  const isOwner = Boolean(userId) && conversation.userId === userId;
  const canReadAll = hasPermission(role as never, 'conversation:read:all');
  if (!isOwner && !canReadAll) return null;

  return { conversation, isOwner };
}

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
    return NextResponse.json(
      { error: 'A title between 1 and 140 characters is required.' },
      { status: 400 },
    );
  }

  const found = await loadOwned(id, guard.session.user?.id, guard.role);
  if (!found || !found.isOwner) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const updated = await prisma.conversation.update({
    where: { id },
    data: { title: parsed.data.title },
    select: { id: true, title: true },
  });

  return NextResponse.json({ ok: true, conversation: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'conversation:delete:own',
    rateLimit: 'mutation',
  });
  if (!guard.ok) return guard.response;

  const { id } = await context.params;

  const found = await loadOwned(id, guard.session.user?.id, guard.role);
  // Deletion is owner-only. A manager who can read a conversation must not be
  // able to destroy the audit trail attached to it.
  if (!found || !found.isOwner) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  await prisma.conversation.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
