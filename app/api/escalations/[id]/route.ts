import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  status: z.enum(['OPEN', 'ASSIGNED', 'IN_PROGRESS', 'RESOLVED', 'CLOSED']).optional(),
  priority: z.enum(['LOW', 'NORMAL', 'HIGH', 'URGENT']).optional(),
  assignedTo: z.string().cuid().nullish(),
  resolutionNote: z.string().max(4000).nullish(),
  resolutionCategory: z
    .enum([
      'MISSING_KNOWLEDGE',
      'OUTDATED_SOURCE',
      'CONFLICTING_SOURCE',
      'RETRIEVAL_FAILURE',
      'ACCESS_PROBLEM',
      'INCORRECT_ANSWER',
      'USER_MISUNDERSTANDING',
      'OTHER',
    ])
    .nullish(),
});

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  const guard = await guardRequest(request, {
    permission: 'escalation:manage',
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

  const existing = await prisma.escalation.findUnique({ where: { id } });
  if (!existing) {
    return NextResponse.json({ error: 'Escalation not found.' }, { status: 404 });
  }

  if (parsed.data.assignedTo) {
    const assignee = await prisma.user.findUnique({
      where: { id: parsed.data.assignedTo },
      select: { id: true, role: true },
    });
    // Only someone who can actually work escalations may be assigned one.
    if (!assignee || !['MANAGER', 'ADMIN'].includes(assignee.role)) {
      return NextResponse.json(
        { error: 'Escalations can only be assigned to a manager or administrator.' },
        { status: 400 },
      );
    }
  }

  const data: Record<string, unknown> = {};
  if (parsed.data.status !== undefined) data.status = parsed.data.status;
  if (parsed.data.priority !== undefined) data.priority = parsed.data.priority;
  if (parsed.data.assignedTo !== undefined) data.assignedTo = parsed.data.assignedTo;
  if (parsed.data.resolutionNote !== undefined) data.resolutionNote = parsed.data.resolutionNote;
  if (parsed.data.resolutionCategory !== undefined)
    data.resolutionCategory = parsed.data.resolutionCategory;

  // Assigning without an explicit status moves it out of the OPEN queue, which
  // is what the person doing the assigning means.
  if (parsed.data.assignedTo && parsed.data.status === undefined && existing.status === 'OPEN') {
    data.status = 'ASSIGNED';
  }

  if (Object.keys(data).length === 0) {
    return NextResponse.json({ error: 'No changes were supplied.' }, { status: 400 });
  }

  const updated = await prisma.escalation.update({ where: { id }, data });

  // Closing the last open escalation returns the conversation to normal.
  if (updated.status === 'RESOLVED' || updated.status === 'CLOSED') {
    const stillOpen = await prisma.escalation.count({
      where: {
        conversationId: updated.conversationId,
        status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
      },
    });
    if (stillOpen === 0) {
      await prisma.conversation.update({
        where: { id: updated.conversationId },
        data: { status: 'ACTIVE' },
      });
    }
  }

  await recordAudit({
    action: 'escalation.update',
    entityType: 'Escalation',
    entityId: id,
    userId: guard.session.user?.id ?? null,
    previousData: {
      status: existing.status,
      priority: existing.priority,
      assignedTo: existing.assignedTo,
      resolutionCategory: existing.resolutionCategory,
    },
    newData: data,
    ip: guard.ip,
  });

  return NextResponse.json({
    ok: true,
    escalation: {
      id: updated.id,
      status: updated.status,
      priority: updated.priority,
      assignedTo: updated.assignedTo,
    },
  });
}
