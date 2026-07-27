import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { ask } from '@/lib/chat/service';
import { validateQuestion } from '@/lib/retrieval/query';
import { prisma } from '@/lib/database/client';
import { randomToken } from '@/lib/security/hash';
import { logger } from '@/lib/observability/logger';

export const dynamic = 'force-dynamic';
export const maxDuration = 60;

const ANON_COOKIE = 'atlas_demo_key';

const schema = z.object({
  question: z.string(),
  conversationId: z.string().cuid().nullish(),
  knowledgeBaseId: z.string().cuid().nullish(),
});

export async function POST(request: Request) {
  // Anonymous callers are permitted: the public demo is a first-class surface.
  // They are bound to the PUBLIC role, so they can only ever retrieve public
  // content regardless of what they ask for.
  const guard = await guardRequest(request, {
    allowAnonymous: true,
    rateLimit: 'chat',
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

  const validation = validateQuestion(parsed.data.question);
  if (!validation.ok) {
    return NextResponse.json({ error: validation.reason }, { status: 400 });
  }

  // Anonymous sessions get a random key so their conversation history is theirs
  // alone and is not addressable by anyone who guesses a conversation id.
  const cookieStore = await cookies();
  let anonymousKey: string | null = null;
  if (!guard.session.isAuthenticated) {
    anonymousKey = cookieStore.get(ANON_COOKIE)?.value ?? null;
    if (!anonymousKey) {
      anonymousKey = randomToken(18);
      cookieStore.set(ANON_COOKIE, anonymousKey, {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: 60 * 60 * 24 * 7,
      });
    }
  }

  let knowledgeBaseId = parsed.data.knowledgeBaseId ?? null;
  if (!knowledgeBaseId) {
    const primary = await prisma.knowledgeBase.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    knowledgeBaseId = primary?.id ?? null;
  }

  try {
    const result = await ask({
      question: validation.question,
      role: guard.role,
      userId: guard.session.user?.id ?? null,
      anonymousKey,
      conversationId: parsed.data.conversationId ?? null,
      knowledgeBaseId,
      ip: guard.ip,
    });

    return NextResponse.json({
      conversationId: result.conversationId,
      messageId: result.messageId,
      answer: result.answer.text,
      grounding: result.answer.grounding,
      confidence: result.answer.confidence,
      citations: result.answer.citations.map((citation) => ({
        ordinal: citation.ordinal,
        documentId: citation.documentId,
        documentTitle: citation.documentTitle,
        sectionTitle: citation.sectionTitle,
        pageNumber: citation.pageNumber,
        excerpt: citation.excerpt,
        relevanceScore: Number(citation.relevanceScore.toFixed(4)),
      })),
      relatedSources: result.answer.relatedSources,
      provider: result.answer.provider,
      model: result.answer.model,
      isDemo: result.answer.isDemo,
      escalationId: result.escalationId,
      injectionFlagged: result.injectionFlagged,
      traceId: result.traceId,
    });
  } catch (error) {
    logger.error('Chat request failed', { correlationId: guard.correlationId, error });
    // No stack trace, no provider detail, no query echo.
    return NextResponse.json(
      {
        error: 'The assistant could not complete that request. Please try again.',
        correlationId: guard.correlationId,
      },
      { status: 500 },
    );
  }
}
