import { NextResponse } from 'next/server';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';
import { recordAudit } from '@/lib/security/audit';

export const dynamic = 'force-dynamic';

const schema = z.object({
  conversationId: z.string().cuid(),
  reason: z.string().max(500).optional(),
});

/**
 * Explicit "ask for a human" request.
 *
 * Distinct from the automatic escalation raised on low confidence: this is the
 * user deciding they want a person, which is always a valid request regardless
 * of how confident the assistant was.
 */
export async function POST(request: Request) {
  const guard = await guardRequest(request, {
    allowAnonymous: true,
    permission: 'escalation:create',
    rateLimit: 'feedback',
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

  const conversation = await prisma.conversation.findUnique({
    where: { id: parsed.data.conversationId },
    select: {
      id: true,
      userId: true,
      title: true,
      messages: {
        orderBy: { createdAt: 'desc' },
        take: 6,
        select: { role: true, content: true, grounded: true, confidence: true },
      },
    },
  });

  // Ownership check: a conversation id is guessable, and an escalation carries
  // a transcript, so only the owner or someone who may read all conversations
  // can raise one.
  const isOwner = Boolean(guard.session.user) && conversation?.userId === guard.session.user?.id;
  const canReadAll = hasPermission(guard.role, 'conversation:read:all');
  if (!conversation || (!isOwner && !canReadAll && conversation.userId !== null)) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  // One open escalation per conversation is enough; repeated presses should not
  // flood the queue.
  const existing = await prisma.escalation.findFirst({
    where: {
      conversationId: conversation.id,
      status: { in: ['OPEN', 'ASSIGNED', 'IN_PROGRESS'] },
    },
    select: { id: true },
  });
  if (existing) {
    return NextResponse.json({ ok: true, escalationId: existing.id, alreadyOpen: true });
  }

  const transcript = [...conversation.messages]
    .reverse()
    .map(
      (message) =>
        `${message.role === 'USER' ? 'User' : 'Assistant'}: ${message.content.slice(0, 400)}`,
    )
    .join('\n\n');

  const lastAnswer = conversation.messages.find((message) => message.role === 'ASSISTANT');

  const escalation = await prisma.escalation.create({
    data: {
      conversationId: conversation.id,
      userId: guard.session.user?.id ?? null,
      reason: parsed.data.reason?.trim() || 'The user asked to speak to a human.',
      summary: `A user requested human assistance.\n\nRecent conversation:\n\n${transcript}`,
      suggestedReply:
        lastAnswer && lastAnswer.grounded === 'UNSUPPORTED'
          ? 'The knowledge base did not cover this question. Confirm the correct answer with the owning team, reply to the user, and consider adding a source document.'
          : 'Review the transcript and confirm whether the assistant’s answer was correct and complete before replying.',
      priority: 'NORMAL',
      status: 'OPEN',
    },
    select: { id: true },
  });

  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { status: 'ESCALATED' },
  });

  await recordAudit({
    action: 'escalation.create',
    entityType: 'Escalation',
    entityId: escalation.id,
    userId: guard.session.user?.id ?? null,
    newData: { automatic: false, reason: 'user requested a human' },
    ip: guard.ip,
  });

  return NextResponse.json({ ok: true, escalationId: escalation.id, alreadyOpen: false });
}
