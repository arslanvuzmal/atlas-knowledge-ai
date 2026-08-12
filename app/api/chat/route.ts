import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { z } from 'zod';
import { guardRequest } from '@/lib/auth/guard';
import { ask } from '@/lib/chat/service';
import { validateQuestion } from '@/lib/retrieval/query';
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
  // They are bound to the PUBLIC role, so they can only ever retrieve public content.
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

  // Anonymous session key
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

  // NO KB database lookups before routing!
  // Routing MUST execute first inside ask(). Pass raw knowledgeBaseId.
  const knowledgeBaseId = parsed.data.knowledgeBaseId ?? null;
  const startedAt = Date.now();

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

    const hasConfidence =
      typeof result.answer.confidence === 'number' && Number.isFinite(result.answer.confidence);

    return NextResponse.json({
      ok: true,
      conversationId: result.conversationId,
      messageId: result.messageId,
      answer: result.answer.text,
      grounding: result.answer.grounding,
      confidence: result.answer.confidence,
      route: result.route,
      sourceType: result.sourceType,
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
      evidence: result.answer.evidence,
      provider: result.answer.provider,
      model: result.answer.model,
      latencyMs: Date.now() - startedAt,
      injectionFlagged: result.injectionFlagged,
      traceId: result.traceId,
      pipelineMeta: {
        accessLevels: result.retrieval.allowedLevels,
        retrieval: {
          vectorCandidates: result.retrieval.vectorCandidates,
          keywordCandidates: result.retrieval.keywordCandidates,
          fusedCandidates: result.retrieval.fusedCandidates,
          afterAccessFilter: result.retrieval.afterAccessFilter,
          rerankedCount: result.retrieval.rerankedCount,
          hybrid: result.retrieval.hybrid,
          droppedByPostFilter: result.retrieval.droppedByPostFilter,
          latencyMs: result.retrieval.latencyMs,
        },
        confidence: {
          // NO fake 1.0 confidence fallback for non-RAG routes!
          value: result.answer.confidence,
          label: result.answer.evidence.confidenceLabel,
          topScore: hasConfidence ? Number(result.answer.confidence!.toFixed(4)) : null,
          coverage: result.answer.evidence.coverage,
          agreement:
            result.answer.evidence.supportingPassages > 0
              ? Number(
                  (
                    result.answer.evidence.supportingPassages /
                    Math.max(1, result.answer.citations.length)
                  ).toFixed(2),
                )
              : 0,
          supportingChunks: result.answer.evidence.supportingPassages,
          uncoveredTerms: [],
        },
        grounding: result.answer.grounding,
        answer: {
          provider: result.answer.provider,
          model: result.answer.model,
          latencyMs: result.answer.latencyMs,
          isDemo: result.answer.isDemo,
          citationCount: result.answer.citations.length,
          invalidCitationMarkers: result.answer.diagnostics.invalidCitationMarkers,
          usedFallbackCitations: result.answer.diagnostics.usedFallbackCitations,
        },
        traceId: result.traceId,
        injectionFlagged: result.injectionFlagged,
        escalationId: result.escalationId,
      },
    });
  } catch (error) {
    const durationMs = Date.now() - startedAt;
    let stage = 'CHAT_GENERATION_FAILED';
    let code = 'CHAT_GENERATION_FAILED';
    let publicMessage = 'The assistant could not complete that request. Please try again.';
    let statusCode = 500;

    if (error && typeof error === 'object' && 'kind' in error) {
      const errKind = (error as { kind?: string }).kind;
      stage = 'CHAT_PROVIDER_FAILED';
      if (errKind === 'auth') {
        code = 'CHAT_PROVIDER_AUTH_FAILED';
        publicMessage = 'The AI provider credential is invalid or missing.';
        statusCode = 503;
      } else if (errKind === 'rate_limit') {
        code = 'CHAT_PROVIDER_RATE_LIMITED';
        publicMessage = 'The AI service rate limit was exceeded. Please try again shortly.';
        statusCode = 429;
      } else if (errKind === 'timeout') {
        code = 'CHAT_PROVIDER_TIMEOUT';
        publicMessage = 'The AI service timed out while generating a response.';
        statusCode = 504;
      } else if (errKind === 'content_filter') {
        code = 'CHAT_CONTENT_FILTERED';
        publicMessage = 'The AI service declined to answer this request due to content policy.';
        statusCode = 400;
      } else {
        code = 'CHAT_PROVIDER_UNAVAILABLE';
        publicMessage = 'The AI service is temporarily unavailable.';
        statusCode = 503;
      }
    } else if (
      error &&
      typeof error === 'object' &&
      'name' in error &&
      String((error as { name: string }).name).includes('Prisma')
    ) {
      stage = 'CHAT_DATABASE_FAILED';
      code = 'CHAT_DATABASE_FAILED';
      publicMessage = 'A database error occurred while completing your request.';
      statusCode = 500;
    }

    logger.error('Chat request failed', {
      correlationId: guard.correlationId,
      stage,
      code,
      statusCode,
      durationMs,
      errorClass: error instanceof Error ? error.constructor.name : typeof error,
      errorMessage: error instanceof Error ? error.message : String(error),
    });

    return NextResponse.json(
      {
        error: publicMessage,
        code,
        correlationId: guard.correlationId,
      },
      { status: statusCode },
    );
  }
}
