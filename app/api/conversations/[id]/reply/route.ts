import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { hasPermission } from '@/lib/auth/rbac';
import { prisma } from '@/lib/database/client';

export const dynamic = 'force-dynamic';

const schema = z.object({
  content: z.string().min(1, 'Message content cannot be empty.').max(5000, 'Message is too long.'),
  mode: z.enum(['reply', 'note']).default('reply'),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isAuthenticated || !session.user) {
    return NextResponse.json(
      { error: 'You must be signed in to perform this action.' },
      { status: 401 },
    );
  }

  if (!hasPermission(session.role, 'inbox:reply') && !hasPermission(session.role, 'inbox:read')) {
    return NextResponse.json(
      { error: 'Forbidden: Insufficient permissions to post in inbox.' },
      { status: 403 },
    );
  }

  let workspace;
  try {
    workspace = await getCurrentWorkspaceContext(session.user);
  } catch {
    return NextResponse.json({ error: 'No authorized workspace found.' }, { status: 403 });
  }

  const { id: conversationId } = await params;

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: 'Malformed JSON payload.' }, { status: 400 });
  }

  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: parsed.error.issues[0]?.message || 'Invalid parameters.' },
      { status: 400 },
    );
  }

  const { content, mode } = parsed.data;

  // Validate conversation belongs to workspace
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: workspace.id },
    include: { contact: true },
  });

  if (!conversation) {
    return NextResponse.json(
      { error: 'Conversation not found in your workspace.' },
      { status: 404 },
    );
  }

  const isNote = mode === 'note';
  const role = isNote ? 'SYSTEM' : 'ASSISTANT';
  const formattedContent = isNote ? `[Internal Note] ${content}` : content;

  // Create message in database
  const message = await prisma.message.create({
    data: {
      conversationId: conversation.id,
      role,
      content: formattedContent,
      grounded: 'SUPPORTED',
      modelProvider: isNote ? 'HUMAN_NOTE' : 'HUMAN_AGENT',
      modelName: session.user.name,
    },
  });

  // Update conversation timestamp
  await prisma.conversation.update({
    where: { id: conversation.id },
    data: { updatedAt: new Date() },
  });

  // Persist CRM Activity
  if (conversation.contactId) {
    await prisma.crmActivity
      .create({
        data: {
          workspaceId: workspace.id,
          contactId: conversation.contactId,
          actorId: session.user.id,
          conversationId: conversation.id,
          type: isNote ? 'INTERNAL_NOTE' : 'HUMAN_RESPONSE',
          title: isNote ? 'Internal Note Added' : 'Outbound Reply Sent',
          description: isNote
            ? `${session.user.name} added an internal note: ${content.slice(0, 100)}`
            : `${session.user.name} sent a reply to ${conversation.contact?.displayName || 'Customer'}`,
          metadata: { messageId: message.id, contentPreview: content.slice(0, 100) },
        },
      })
      .catch(() => null);
  }

  // Audit event
  await prisma.auditLog
    .create({
      data: {
        userId: session.user.id,
        action: isNote ? 'inbox.note.create' : 'inbox.reply.create',
        entityType: 'Conversation',
        entityId: conversation.id,
        metadata: { workspaceId: workspace.id, mode, messageId: message.id },
      },
    })
    .catch(() => null);

  return NextResponse.json({
    ok: true,
    message: {
      id: message.id,
      role: message.role,
      content: message.content,
      createdAt: message.createdAt.toISOString(),
      isNote,
      authorName: session.user.name,
    },
  });
}
