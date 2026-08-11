import type { Role, AccessLevel } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import {
  generateAnswer,
  generateGeneralAnswer,
  generateLiveAnswer,
  buildSuggestedReply,
  type AnswerResult,
  type AnswerSourceType,
} from '@/lib/ai/answer';
import { getModelSettings, getRetrievalSettings } from '@/lib/retrieval/settings';
import { retrieve, type RetrievalResult } from '@/lib/retrieval/search';
import type { ConversationTurn } from '@/lib/retrieval/query';
import { detectPromptInjection } from '@/lib/security/prompt-injection';
import { recordAudit } from '@/lib/security/audit';
import { logger, newCorrelationId } from '@/lib/observability/logger';
import { routeMessage, getConversationalResponse, type ChatRoute } from './intent';
import { resolveIdentity } from '@/lib/crm/contact';
import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { enqueueOutboxEvent, processOutboxEvents } from '@/lib/outbox/worker';

/**
 * Chat orchestration and persistence.
 */

export interface AskInput {
  question: string;
  role: Role;
  userId?: string | null;
  anonymousKey?: string | null;
  conversationId?: string | null;
  knowledgeBaseId?: string | null;
  ip?: string | null;
}

export interface AskOutput {
  conversationId: string;
  messageId: string;
  answer: AnswerResult;
  traceId: string;
  injectionFlagged: boolean;
  escalationId: string | null;
  route: ChatRoute;
  sourceType: AnswerSourceType;
  retrieval: {
    vectorCandidates: number;
    keywordCandidates: number;
    fusedCandidates: number;
    afterAccessFilter: number;
    rerankedCount: number;
    hybrid: boolean;
    droppedByPostFilter: number;
    latencyMs: number;
    allowedLevels: string[];
  };
}

const MAX_HISTORY_MESSAGES = 10;

async function resolveConversation(input: AskInput): Promise<{ id: string; isNew: boolean }> {
  if (input.conversationId) {
    const existing = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, userId: true, anonymousKey: true },
    });

    if (existing) {
      const ownedByUser = input.userId && existing.userId === input.userId;
      const ownedByAnon =
        input.anonymousKey && existing.anonymousKey === input.anonymousKey && !existing.userId;
      if (ownedByUser || ownedByAnon) {
        return { id: existing.id, isNew: false };
      }
    }
  }

  const created = await prisma.conversation.create({
    data: {
      userId: input.userId ?? null,
      anonymousKey: input.userId ? null : (input.anonymousKey ?? null),
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      title: input.question.slice(0, 70) + (input.question.length > 70 ? '…' : ''),
    },
    select: { id: true },
  });

  return { id: created.id, isNew: true };
}

export async function ask(input: AskInput): Promise<AskOutput> {
  const traceId = newCorrelationId();
  const log = logger.child({ traceId, role: input.role });
  const startedAt = Date.now();

  const [settings, modelSettings] = await Promise.all([getRetrievalSettings(), getModelSettings()]);

  const { id: conversationId } = await resolveConversation(input);

  // --- Untrusted-input assessment -------------------------------------------
  const assessment = detectPromptInjection(input.question);
  const injectionFlagged = assessment.risk === 'high' || assessment.risk === 'medium';

  if (assessment.detected) {
    log.warn('Prompt-injection patterns detected in a user question', {
      risk: assessment.risk,
      categories: assessment.categories,
    });
    await recordAudit({
      action: 'chat.injection.detected',
      entityType: 'Conversation',
      entityId: conversationId,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      metadata: {
        risk: assessment.risk,
        score: assessment.score,
        categories: assessment.categories,
        patterns: assessment.signals.map((signal) => signal.pattern),
        context: 'question',
      },
    });
  }

  // --- History Retrieval (Most recent 10 messages, reversed in memory) ------
  const priorMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'desc' },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });

  const history: ConversationTurn[] = priorMessages.reverse().map((message) => ({
    role: message.role,
    content: message.content,
  }));

  // Persist user question
  await prisma.message.create({
    data: {
      conversationId,
      role: 'USER',
      content: input.question,
      flagged: injectionFlagged,
    },
  });

  // --- Multi-lane Route Determination ----------------------------------------
  const routeRes = routeMessage(input.question, history);

  log.debug('Route determined', {
    route: routeRes.route,
    confidence: routeRes.confidence,
    reason: routeRes.reason,
    cleanQuestion: routeRes.cleanQuestion,
  });

  let answer: AnswerResult;
  let retrieval: RetrievalResult | null = null;

  if (routeRes.route === 'LOCAL_CONVERSATION' || routeRes.route === 'HUMAN_REQUEST') {
    const conversationalText = getConversationalResponse(
      routeRes.route === 'HUMAN_REQUEST' ? 'HUMAN_REQUEST' : 'GREETING',
    );
    answer = {
      text: conversationalText,
      grounding: 'SUPPORTED',
      confidence: 1.0,
      citations: [],
      provider: 'local',
      model: 'intent-router',
      latencyMs: Date.now() - startedAt,
      isDemo: false,
      sourceType: 'LOCAL',
      escalationSuggested: routeRes.route === 'HUMAN_REQUEST',
      escalationReason:
        routeRes.route === 'HUMAN_REQUEST' ? 'User explicitly requested human operator.' : null,
      relatedSources: [],
      evidence: {
        confidenceLabel: 'N/A',
        supportingPassages: 0,
        supportingDocuments: 0,
        coverage: 1,
        conflictDetected: false,
        conflictingDocuments: [],
      },
      diagnostics: {
        invalidCitationMarkers: [],
        usedFallbackCitations: false,
        promptTokens: 0,
        truncatedSources: 0,
        generationFailed: false,
      },
    };
  } else if (routeRes.route === 'GENERAL_KNOWLEDGE') {
    answer = await generateGeneralAnswer({
      question: routeRes.cleanQuestion || input.question,
      history,
      modelSettings,
      traceId,
    });
  } else if (routeRes.route === 'LIVE_EXTERNAL') {
    answer = await generateLiveAnswer({
      question: routeRes.cleanQuestion || input.question,
      history,
      modelSettings,
      missingLocation: routeRes.missingLocation,
      traceId,
    });
  } else {
    // Governed RAG: ORGANIZATIONAL_KNOWLEDGE or FOLLOW_UP_ORGANIZATIONAL
    retrieval = await retrieve({
      question: routeRes.cleanQuestion || input.question,
      role: input.role,
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      history,
      settings,
      traceId,
    });

    answer = await generateAnswer({
      question: routeRes.cleanQuestion || input.question,
      role: input.role,
      retrieval,
      history,
      settings,
      modelSettings,
      traceId,
    });
  }

  const totalLatency = Date.now() - startedAt;

  // --- Persist Assistant Message --------------------------------------------
  const assistantMessage = await prisma.message.create({
    data: {
      conversationId,
      role: 'ASSISTANT',
      content: answer.text,
      confidence: answer.confidence,
      grounded: answer.grounding,
      modelProvider: answer.provider,
      modelName: answer.model,
      latencyMs: totalLatency,
      citations: {
        create: answer.citations.map((citation) => ({
          documentId: citation.documentId,
          chunkId: citation.chunkId,
          pageNumber: citation.pageNumber,
          sectionTitle: citation.sectionTitle,
          excerpt: citation.excerpt,
          relevanceScore: citation.relevanceScore,
          ordinal: citation.ordinal,
        })),
      },
    },
  });

  // --- Retrieval Log Persistence -------------------------------------------
  if (retrieval) {
    await prisma.retrievalLog.create({
      data: {
        conversationId,
        query: input.question,
        rewrittenQuery: retrieval.preparation.rewritten,
        retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
        accessLevel: input.role as unknown as AccessLevel,
      },
    });
  }

  // --- Audit Log Persistence ------------------------------------------------
  await recordAudit({
    action: 'chat.query',
    entityType: 'Conversation',
    entityId: conversationId,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    metadata: {
      role: input.role,
      questionLength: input.question.length,
      grounding: answer.grounding,
      confidence: answer.confidence,
      latencyMs: totalLatency,
      injectionFlagged,
      route: routeRes.route,
    },
  });

  // --- Escalation Management ------------------------------------------------
  let escalationId: string | null = null;
  if (answer.escalationSuggested || injectionFlagged) {
    const existingEscalation = await prisma.escalation.findFirst({
      where: { conversationId, status: { in: ['OPEN', 'IN_PROGRESS'] } },
    });

    if (!existingEscalation) {
      const created = await prisma.escalation.create({
        data: {
          conversationId,
          userId: input.userId ?? null,
          priority: injectionFlagged ? 'HIGH' : 'NORMAL',
          reason: answer.escalationReason ?? 'Customer or system escalation created.',
          summary: buildConversationSummary(history, input.question, answer),
          suggestedReply: buildSuggestedReply(input.question, answer),
        },
      });
      escalationId = created.id;
    } else {
      escalationId = existingEscalation.id;
    }

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ESCALATED' },
    });
  }

  // --- Async Non-Blocking CRM & Outbox Enrichment ----------------------------
  try {
    let workspaceId: string | null = null;
    if (input.knowledgeBaseId) {
      const kb = await prisma.knowledgeBase.findUnique({
        where: { id: input.knowledgeBaseId },
        select: { workspaceId: true },
      });
      workspaceId = kb?.workspaceId ?? null;
    }
    if (!workspaceId) {
      const ws = await getCurrentWorkspaceContext().catch(() => null);
      workspaceId = ws?.id ?? null;
    }

    if (workspaceId) {
      const emailMatch = input.question.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const extractedEmail = emailMatch ? emailMatch[1] : undefined;

      const nameMatch = input.question.match(
        /(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      );
      const extractedName = nameMatch ? nameMatch[1] : undefined;

      const contact = await resolveIdentity({
        workspaceId,
        visitorKey: input.anonymousKey ?? undefined,
        email: extractedEmail,
        name: extractedName,
      });

      try {
        await prisma.conversation.update({
          where: { id: conversationId },
          data: { contactId: contact.id, updatedAt: new Date() },
        });
      } catch (convErr) {
        log.warn('Conversation contact update failed (non-blocking)', {
          error: convErr instanceof Error ? convErr.message : String(convErr),
        });
      }

      await enqueueOutboxEvent({
        workspaceId,
        eventType: 'CHAT_TURN_COMPLETED',
        payload: {
          contactId: contact.id,
          conversationId,
          messageId: assistantMessage.id,
          messages: [
            ...history,
            { role: 'user', content: input.question },
            { role: 'assistant', content: answer.text },
          ],
        },
      });

      void processOutboxEvents(5).catch(() => {});
    }
  } catch (crmError) {
    log.warn('CRM / Outbox post-processing failed (non-blocking)', {
      error: crmError instanceof Error ? crmError.message : String(crmError),
    });
  }

  // --- Async Knowledge Gap Tracking (Only for Governed RAG queries) ----------
  if (retrieval) {
    try {
      await trackKnowledgeGap({
        question: input.question,
        role: input.role,
        knowledgeBaseId: input.knowledgeBaseId ?? null,
        retrieval: {
          confidence: retrieval.confidence.confidence,
          grounding: retrieval.grounding,
          chunks: retrieval.chunks.map((c) => ({
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            content: c.content,
          })),
        },
        answer: {
          grounding: answer.grounding,
          text: answer.text,
          escalationSuggested: answer.escalationSuggested,
        },
      });
    } catch (kgError) {
      log.warn('Knowledge-gap tracking failed (non-blocking)', {
        error: kgError instanceof Error ? kgError.message : String(kgError),
      });
    }
  }

  return {
    conversationId,
    messageId: assistantMessage.id,
    answer,
    traceId,
    injectionFlagged,
    escalationId,
    route: routeRes.route,
    sourceType: answer.sourceType ?? 'APPROVED_KNOWLEDGE',
    retrieval: {
      vectorCandidates: retrieval?.stats.vectorCandidates ?? 0,
      keywordCandidates: retrieval?.stats.keywordCandidates ?? 0,
      fusedCandidates: retrieval?.stats.fusedCandidates ?? 0,
      afterAccessFilter: retrieval?.stats.afterAccessFilter ?? 0,
      rerankedCount: retrieval?.stats.rerankedCount ?? 0,
      hybrid: retrieval?.stats.hybrid ?? false,
      droppedByPostFilter: retrieval?.stats.droppedByPostFilter ?? 0,
      latencyMs: retrieval?.stats.latencyMs ?? 0,
      allowedLevels: retrieval?.allowedLevels ?? [],
    },
  };
}

/**
 * Tracks knowledge gaps from low-confidence or unsupported answers.
 */
export async function trackKnowledgeGap(params: {
  question: string;
  role: Role;
  knowledgeBaseId: string | null;
  retrieval: {
    confidence: number;
    grounding: string;
    chunks: Array<{ documentId: string; documentTitle: string; content: string }>;
  };
  answer: {
    grounding: string;
    text: string;
    escalationSuggested: boolean;
  };
}): Promise<void> {
  const { question, knowledgeBaseId, answer } = params;

  if (answer.grounding !== 'UNSUPPORTED' && !answer.escalationSuggested) {
    return;
  }

  let kbId = knowledgeBaseId;
  if (!kbId) {
    const defaultKb = await prisma.knowledgeBase.findFirst({ select: { id: true } });
    if (!defaultKb) return;
    kbId = defaultKb.id;
  }

  const normalizedQuestion = question.trim().toLowerCase();

  const existingGap = await prisma.knowledgeGap.findFirst({
    where: {
      knowledgeBaseId: kbId,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
    orderBy: { lastOccurredAt: 'desc' },
  });

  const similarGap = existingGap ? await findSimilarGap(normalizedQuestion, kbId) : null;

  if (similarGap) {
    await prisma.knowledgeGap.update({
      where: { id: similarGap.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: new Date(),
      },
    });
  } else {
    await prisma.knowledgeGap.create({
      data: {
        knowledgeBaseId: kbId,
        title: `Knowledge gap: ${question.slice(0, 80)}${question.length > 80 ? '...' : ''}`,
        description: `Users repeatedly ask about this topic but approved knowledge is insufficient. Grounding: ${answer.grounding}`,
        status: 'OPEN',
        occurrenceCount: 1,
      },
    });
  }
}

async function findSimilarGap(
  normalizedQuestion: string,
  knowledgeBaseId: string,
): Promise<{ id: string } | null> {
  const gaps = await prisma.knowledgeGap.findMany({
    where: { knowledgeBaseId, status: { in: ['OPEN', 'ACKNOWLEDGED'] } },
    select: { id: true, title: true },
  });

  const questionWords = new Set(normalizedQuestion.split(/\s+/).filter((w) => w.length > 3));

  for (const gap of gaps) {
    const gapWords = new Set(
      gap.title
        .toLowerCase()
        .replace(/[^a-z0-9\s]/g, '')
        .split(/\s+/)
        .filter((w) => w.length > 3),
    );

    const intersection = [...questionWords].filter((w) => gapWords.has(w));
    const union = new Set([...questionWords, ...gapWords]);

    if (union.size > 0 && intersection.length / union.size > 0.4) {
      return { id: gap.id };
    }
  }

  return null;
}

/** Compact conversation summary attached to an escalation for the human handler. */
export function buildConversationSummary(
  history: ConversationTurn[],
  question: string,
  answer: AnswerResult,
): string {
  const previousQuestions = history
    .filter((turn) => turn.role === 'USER')
    .slice(-3)
    .map((turn) => `- ${turn.content.slice(0, 160)}`);

  const parts: string[] = [];
  if (previousQuestions.length > 0) {
    parts.push(`Earlier in this conversation:\n${previousQuestions.join('\n')}`);
  }
  parts.push(`Current question:\n${question}`);
  parts.push(
    `Assistant outcome: ${answer.grounding} at ${(answer.confidence * 100).toFixed(0)}% confidence.`,
  );
  if (answer.citations.length > 0) {
    const sources = [...new Set(answer.citations.map((c) => c.documentTitle))];
    parts.push(`Sources retrieved: ${sources.join(', ')}.`);
  } else {
    parts.push('No approved source supported an answer.');
  }
  return parts.join('\n\n');
}

/** Marks a message helpful or otherwise, and escalates on negative feedback. */
export async function submitFeedback(options: {
  messageId: string;
  userId?: string | null;
  rating: 'HELPFUL' | 'PARTIALLY_HELPFUL' | 'NOT_HELPFUL';
  reason?:
    | 'INCORRECT_ANSWER'
    | 'MISSING_INFORMATION'
    | 'WRONG_SOURCE'
    | 'OUTDATED_INFORMATION'
    | 'TOO_VAGUE'
    | 'ACCESS_ISSUE'
    | 'OTHER'
    | null;
  comment?: string | null;
  ip?: string | null;
}): Promise<{ ok: boolean; feedbackId?: string; escalationId?: string | null; error?: string }> {
  const message = await prisma.message.findUnique({
    where: { id: options.messageId },
    select: { id: true, conversationId: true, content: true, role: true },
  });

  if (!message || message.role !== 'ASSISTANT') {
    return { ok: false, error: 'Feedback can only be left on an assistant answer.' };
  }

  const feedback = await prisma.feedback.create({
    data: {
      messageId: options.messageId,
      userId: options.userId ?? null,
      rating: options.rating,
      reason: options.reason ?? null,
      comment: options.comment?.slice(0, 2000) ?? null,
    },
    select: { id: true },
  });

  await recordAudit({
    action: 'feedback.create',
    entityType: 'Feedback',
    entityId: feedback.id,
    userId: options.userId ?? null,
    ip: options.ip ?? null,
    newData: { rating: options.rating, reason: options.reason ?? null },
  });

  let escalationId: string | null = null;
  if (options.rating === 'NOT_HELPFUL') {
    const escalation = await prisma.escalation.create({
      data: {
        conversationId: message.conversationId,
        userId: options.userId ?? null,
        reason: `Negative feedback${options.reason ? `: ${options.reason.toLowerCase().replace(/_/g, ' ')}` : ''}.`,
        summary: `A user marked an answer as not helpful.\n\nAnswer given:\n${message.content.slice(0, 800)}${
          options.comment ? `\n\nUser comment:\n${options.comment.slice(0, 500)}` : ''
        }`,
        suggestedReply:
          'Review the cited sources for accuracy and completeness, then reply with a corrected answer.',
        priority: 'NORMAL',
        status: 'OPEN',
      },
      select: { id: true },
    });
    escalationId = escalation.id;

    await prisma.conversation.update({
      where: { id: message.conversationId },
      data: { status: 'ESCALATED' },
    });
  }

  return { ok: true, feedbackId: feedback.id, escalationId };
}
