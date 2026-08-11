import { NextResponse } from 'next/server';
import { z } from 'zod';
import { getSession } from '@/lib/auth/session';
import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { prisma } from '@/lib/database/client';
import { ask } from '@/lib/chat/service';

export const dynamic = 'force-dynamic';

const schema = z.object({
  action: z.enum(['find', 'clarify', 'shorten']),
  currentDraft: z.string().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getSession();
  if (!session.isAuthenticated || !session.user) {
    return NextResponse.json(
      { error: 'You must be signed in to perform this action.' },
      { status: 401 },
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
    return NextResponse.json({ error: 'Invalid AI draft action.' }, { status: 400 });
  }

  const { action, currentDraft } = parsed.data;

  // Fetch conversation with latest messages & contact intelligence
  const conversation = await prisma.conversation.findFirst({
    where: { id: conversationId, workspaceId: workspace.id },
    include: {
      messages: { orderBy: { createdAt: 'asc' } },
      contact: { include: { intelligence: true, company: true } },
    },
  });

  if (!conversation) {
    return NextResponse.json({ error: 'Conversation not found.' }, { status: 404 });
  }

  const userMessages = conversation.messages.filter((m) => m.role === 'USER');
  const latestCustomerQuestion =
    userMessages[userMessages.length - 1]?.content || conversation.title;

  if (action === 'find') {
    const kb = await prisma.knowledgeBase.findFirst({
      where: { workspaceId: workspace.id },
      orderBy: { createdAt: 'asc' },
    });

    const result = await ask({
      question: latestCustomerQuestion,
      userId: session.user.id,
      knowledgeBaseId: kb?.id,
      role: session.role,
      conversationId: conversation.id,
    });

    return NextResponse.json({
      ok: true,
      draftText: result.answer.text,
      grounding: result.answer.grounding,
      confidence: Math.round((result.answer.confidence || 0.8) * 100),
      citations: result.answer.citations.map((c) => ({
        title: c.documentTitle,
        excerpt: c.excerpt,
        relevanceScore: Math.round((c.relevanceScore || 0) * 100),
      })),
    });
  }

  if (action === 'clarify') {
    const contactName = conversation.contact?.displayName || 'prospect';
    const companyName = conversation.contact?.company?.name || 'their organization';
    const seatCount = conversation.contact?.intelligence?.seatRequirement;

    let fallbackText = `Thank you for reaching out, ${contactName}! `;
    if (seatCount) {
      fallbackText += `To help us tailor the Team plan for your ${seatCount} users at ${companyName}, could you confirm if your team requires SAML SSO integration or custom SLA agreements?`;
    } else {
      fallbackText += `To ensure we provide the exact specifications for ${companyName}, could you share your target team size and preferred deployment timeline?`;
    }

    return NextResponse.json({ ok: true, draftText: fallbackText });
  }

  if (action === 'shorten') {
    if (!currentDraft || currentDraft.trim().length === 0) {
      return NextResponse.json({ ok: true, draftText: '' });
    }

    const sentences = currentDraft.split(/(?<=[.!?])\s+/);
    const shortened = sentences.slice(0, Math.max(1, Math.ceil(sentences.length / 2))).join(' ');
    return NextResponse.json({ ok: true, draftText: shortened });
  }

  return NextResponse.json({ error: 'Unsupported action.' }, { status: 400 });
}
