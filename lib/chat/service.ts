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
import { getCurrentWorkspaceContext } from '@/lib/workspace/context';
import { enqueueOutboxEvent } from '@/lib/outbox/worker';

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

function buildConversationSummary(
  history: ConversationTurn[],
  question: string,
  answer: AnswerResult,
): string {
  const userTurns = history.filter((t) => t.role === 'USER').map((t) => t.content);
  userTurns.push(question);
  return `Escalated conversation (${userTurns.length} turns). Latest: "${question.slice(0, 100)}". Outcome: ${answer.grounding ?? 'N/A'}.`;
}

export async function ask(input: AskInput): Promise<AskOutput> {
  const traceId = newCorrelationId();
  const log = logger.child({ traceId, role: input.role });
  const startedAt = Date.now();

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
  const userMessage = await prisma.message.create({
    data: {
      conversationId,
      role: 'USER',
      content: input.question,
      flagged: injectionFlagged,
    },
  });

  // --- Multi-lane Route Determination FIRST ----------------------------------
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
      grounding: null,
      confidence: null,
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
    const modelSettings = await getModelSettings();
    answer = await generateGeneralAnswer({
      question: routeRes.cleanQuestion || input.question,
      history,
      modelSettings,
      traceId,
    });
  } else if (routeRes.route === 'LIVE_EXTERNAL') {
    const modelSettings = await getModelSettings();
    answer = await generateLiveAnswer({
      question: routeRes.cleanQuestion || input.question,
      history,
      modelSettings,
      missingLocation: routeRes.missingLocation,
      traceId,
    });
  } else {
    // Governed RAG: ORGANIZATIONAL_KNOWLEDGE or FOLLOW_UP_ORGANIZATIONAL
    const [settings, modelSettings] = await Promise.all([
      getRetrievalSettings(),
      getModelSettings(),
    ]);

    // Authorize knowledge base against current workspace context
    const wsContext = await getCurrentWorkspaceContext().catch(() => null);
    let targetKbId: string | null = null;

    if (wsContext) {
      if (input.knowledgeBaseId) {
        const authorizedKb = await prisma.knowledgeBase.findFirst({
          where: { id: input.knowledgeBaseId, workspaceId: wsContext.id },
        });
        if (authorizedKb) {
          targetKbId = authorizedKb.id;
        } else {
          log.warn('Knowledge base not authorized for current workspace context', {
            requestedKbId: input.knowledgeBaseId,
            workspaceId: wsContext.id,
          });
        }
      } else {
        const defaultKb = await prisma.knowledgeBase.findFirst({
          where: { workspaceId: wsContext.id },
          orderBy: { createdAt: 'asc' },
        });
        if (defaultKb) {
          targetKbId = defaultKb.id;
        }
      }
    }

    if (!targetKbId || !wsContext) {
      // DO NOT RETRIEVE! Return controlled refusal/access response
      answer = {
        text: 'No authorized knowledge base is configured or accessible for this workspace context.',
        grounding: null,
        confidence: null,
        citations: [],
        provider: 'local',
        model: 'governance-guard',
        latencyMs: Date.now() - startedAt,
        isDemo: false,
        sourceType: 'LOCAL',
        escalationSuggested: true,
        escalationReason: 'Workspace has no authorized knowledge base context.',
        relatedSources: [],
        evidence: {
          confidenceLabel: 'N/A',
          supportingPassages: 0,
          supportingDocuments: 0,
          coverage: 0,
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
    } else {
      retrieval = await retrieve({
        question: routeRes.cleanQuestion || input.question,
        role: input.role,
        workspaceId: wsContext.id,
        knowledgeBaseId: targetKbId,
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

  // --- Retrieval Log Persistence (Only when retrieval ran) ------------------
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

  // --- Synchronous Outbox Event Enqueueing -----------------------------------
  try {
    const wsContext = await getCurrentWorkspaceContext().catch(() => null);
    const workspaceId = wsContext?.id ?? null;

    if (workspaceId) {
      const emailMatch = input.question.match(/([a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,})/);
      const extractedEmail = emailMatch ? emailMatch[1] : undefined;

      const nameMatch = input.question.match(
        /(?:my name is|i am|i'm)\s+([A-Z][a-z]+(?:\s+[A-Z][a-z]+)?)/i,
      );
      const extractedName = nameMatch ? nameMatch[1] : undefined;

      await enqueueOutboxEvent({
        workspaceId,
        eventType: 'CHAT_TURN_COMPLETED',
        payload: {
          conversationId,
          userMessageId: userMessage.id,
          assistantMessageId: assistantMessage.id,
          anonymousKey: input.anonymousKey ?? null,
          extractedEmail: extractedEmail ?? null,
          extractedName: extractedName ?? null,
          question: input.question,
          role: input.role,
          knowledgeBaseId: input.knowledgeBaseId ?? null,
          retrieval: retrieval
            ? {
                confidence: retrieval.confidence.confidence,
                grounding: retrieval.grounding,
                chunks: retrieval.chunks.map((c) => ({
                  documentId: c.documentId,
                  documentTitle: c.documentTitle,
                  content: c.content,
                })),
              }
            : null,
          answer: {
            grounding: answer.grounding ?? 'UNSUPPORTED',
            text: answer.text,
            escalationSuggested: answer.escalationSuggested,
          },
        },
      });
    }
  } catch (outboxErr) {
    log.warn('Outbox event enqueueing failed', {
      error: outboxErr instanceof Error ? outboxErr.message : String(outboxErr),
    });
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
    retrieval: retrieval
      ? {
          vectorCandidates: retrieval.stats.vectorCandidates,
          keywordCandidates: retrieval.stats.keywordCandidates,
          fusedCandidates: retrieval.stats.fusedCandidates,
          afterAccessFilter: retrieval.stats.afterAccessFilter,
          rerankedCount: retrieval.stats.rerankedCount,
          hybrid: retrieval.stats.hybrid,
          droppedByPostFilter: retrieval.stats.droppedByPostFilter,
          latencyMs: retrieval.stats.latencyMs,
          allowedLevels: retrieval.allowedLevels,
        }
      : {
          vectorCandidates: 0,
          keywordCandidates: 0,
          fusedCandidates: 0,
          afterAccessFilter: 0,
          rerankedCount: 0,
          hybrid: false,
          droppedByPostFilter: 0,
          latencyMs: 0,
          allowedLevels: [],
        },
  };
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
