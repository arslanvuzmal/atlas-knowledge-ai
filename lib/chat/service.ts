import type { Role } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { generateAnswer, buildSuggestedReply, type AnswerResult } from '@/lib/ai/answer';
import { getModelSettings, getRetrievalSettings } from '@/lib/retrieval/settings';
import { retrieve } from '@/lib/retrieval/search';
import type { ConversationTurn } from '@/lib/retrieval/query';
import { detectPromptInjection } from '@/lib/security/prompt-injection';
import { recordAudit } from '@/lib/security/audit';
import { logger, newCorrelationId } from '@/lib/observability/logger';

/**
 * Chat orchestration and persistence.
 *
 * Retrieval and generation are pure; this module is what makes a turn durable:
 * it owns the conversation, the two message rows, the citations, and the
 * retrieval trace. The trace deliberately stores chunk *ids* and never chunk
 * text, so an operator reading retrieval logs cannot see content they would not
 * be allowed to retrieve themselves.
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
}

const MAX_HISTORY_MESSAGES = 20;

async function resolveConversation(input: AskInput): Promise<{ id: string; isNew: boolean }> {
  if (input.conversationId) {
    const existing = await prisma.conversation.findUnique({
      where: { id: input.conversationId },
      select: { id: true, userId: true, anonymousKey: true },
    });

    // Ownership is verified here rather than trusted from the request body: a
    // conversation id is guessable, and history must not be readable or
    // extendable by anyone else.
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

  // --- Conversation history --------------------------------------------------
  const priorMessages = await prisma.message.findMany({
    where: { conversationId },
    orderBy: { createdAt: 'asc' },
    take: MAX_HISTORY_MESSAGES,
    select: { role: true, content: true },
  });

  const history: ConversationTurn[] = priorMessages.map((message) => ({
    role: message.role,
    content: message.content,
  }));

  // Persisted before retrieval so the question survives even if generation
  // fails partway through.
  await prisma.message.create({
    data: {
      conversationId,
      role: 'USER',
      content: input.question,
      flagged: injectionFlagged,
    },
  });

  // --- Retrieval -------------------------------------------------------------
  const retrieval = await retrieve({
    question: input.question,
    role: input.role,
    knowledgeBaseId: input.knowledgeBaseId ?? null,
    history,
    settings,
    traceId,
  });

  // --- Generation ------------------------------------------------------------
  const answer = await generateAnswer({
    question: input.question,
    role: input.role,
    retrieval,
    history,
    settings,
    modelSettings,
    traceId,
  });

  const totalLatency = Date.now() - startedAt;

  // --- Persist the assistant turn -------------------------------------------
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

  await prisma.retrievalLog.create({
    data: {
      conversationId,
      query: input.question,
      rewrittenQuery: retrieval.preparation.rewritten,
      retrievedChunkIds: retrieval.chunks.map((chunk) => chunk.id),
      rerankedChunkIds: answer.citations.map((citation) => citation.chunkId),
      candidateCount: retrieval.stats.fusedCandidates,
      filteredCount: retrieval.stats.afterAccessFilter,
      confidence: answer.confidence,
      grounding: answer.grounding,
      accessLevel: retrieval.allowedLevels[retrieval.allowedLevels.length - 1] ?? 'PUBLIC',
      latencyMs: totalLatency,
      traceId,
    },
  });

  await prisma.conversation.update({
    where: { id: conversationId },
    data: { updatedAt: new Date() },
  });

  // --- Automatic escalation --------------------------------------------------
  let escalationId: string | null = null;
  if (answer.escalationSuggested || injectionFlagged) {
    const reason = injectionFlagged
      ? `Question matched prompt-injection patterns (${assessment.categories.join(', ')}).`
      : (answer.escalationReason ?? 'The assistant could not answer confidently.');

    const escalation = await prisma.escalation.create({
      data: {
        conversationId,
        userId: input.userId ?? null,
        reason,
        summary: buildConversationSummary(history, input.question, answer),
        suggestedReply: buildSuggestedReply(input.question, answer),
        priority: injectionFlagged ? 'HIGH' : answer.grounding === 'UNSUPPORTED' ? 'NORMAL' : 'LOW',
        status: 'OPEN',
      },
      select: { id: true },
    });
    escalationId = escalation.id;

    await prisma.conversation.update({
      where: { id: conversationId },
      data: { status: 'ESCALATED' },
    });

    await recordAudit({
      action: 'escalation.create',
      entityType: 'Escalation',
      entityId: escalation.id,
      userId: input.userId ?? null,
      ip: input.ip ?? null,
      newData: { reason, automatic: true, grounding: answer.grounding },
      metadata: { traceId },
    });
  }

  await recordAudit({
    action: 'chat.query',
    entityType: 'Conversation',
    entityId: conversationId,
    userId: input.userId ?? null,
    ip: input.ip ?? null,
    metadata: {
      traceId,
      grounding: answer.grounding,
      confidence: answer.confidence,
      citationCount: answer.citations.length,
      latencyMs: totalLatency,
      provider: answer.provider,
      retrieved: retrieval.stats.fusedCandidates,
    },
  });

  log.info('Chat turn completed', {
    conversationId,
    grounding: answer.grounding,
    confidence: answer.confidence,
    latencyMs: totalLatency,
    citations: answer.citations.length,
  });

  return {
    conversationId,
    messageId: assistantMessage.id,
    answer,
    traceId,
    injectionFlagged,
    escalationId,
  };
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

  // Negative feedback is a defined escalation trigger.
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
