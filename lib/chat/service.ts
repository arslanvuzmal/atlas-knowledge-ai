import type { Role } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { generateAnswer, buildSuggestedReply, type AnswerResult } from '@/lib/ai/answer';
import { getModelSettings, getRetrievalSettings } from '@/lib/retrieval/settings';
import { retrieve, type RetrievalResult } from '@/lib/retrieval/search';
import type { ConversationTurn } from '@/lib/retrieval/query';
import { detectPromptInjection } from '@/lib/security/prompt-injection';
import { recordAudit } from '@/lib/security/audit';
import { logger, newCorrelationId } from '@/lib/observability/logger';
import { detectIntent, getConversationalResponse } from './intent';
import { resolveIdentity } from '@/lib/crm/contact';
import { enqueueOutboxEvent, processOutboxEvents } from '@/lib/outbox/worker';
import { ensureDemoDataSeeded } from '@/lib/database/auto-seed';

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

  // --- Intent Routing (fast path for conversational messages) ----------------
  const intentResult = detectIntent(input.question, history);
  const isConversational = intentResult.shouldSkipRag;

  log.debug('Intent detected', {
    intent: intentResult.intent,
    confidence: intentResult.confidence,
    isConversational,
    reasoning: intentResult.reasoning,
  });

  let answer: AnswerResult;
  let retrieval: RetrievalResult | null = null;

  if (isConversational) {
    // Tier 0: Fast conversational response - no RAG
    const conversationalText = getConversationalResponse(intentResult.intent);
    answer = {
      text: conversationalText,
      grounding: 'SUPPORTED',
      confidence: 1.0,
      citations: [],
      provider: 'local',
      model: 'intent-router',
      latencyMs: Date.now() - startedAt,
      isDemo: false,
      escalationSuggested: false,
      escalationReason: null,
      relatedSources: [],
      evidence: {
        confidenceLabel: 'Insufficient evidence',
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
    // --- Retrieval -------------------------------------------------------------
    retrieval = await retrieve({
      question: input.question,
      role: input.role,
      knowledgeBaseId: input.knowledgeBaseId ?? null,
      history,
      settings,
      traceId,
    });

    // --- Generation ------------------------------------------------------------
    answer = await generateAnswer({
      question: input.question,
      role: input.role,
      retrieval,
      history,
      settings,
      modelSettings,
      traceId,
    });
  }

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

  // --- Retrieval log (only for RAG queries, not conversational) ------------
  if (retrieval) {
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
  }

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
      retrieved: retrieval ? retrieval.stats.fusedCandidates : 0,
    },
  });

  log.info('Chat turn completed', {
    conversationId,
    grounding: answer.grounding,
    confidence: answer.confidence,
    latencyMs: totalLatency,
    citations: answer.citations.length,
  });

  // --- Contact & Outbox Integration (non-blocking secondary workflow) ------
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
      const seeded = await ensureDemoDataSeeded();
      workspaceId = seeded.workspaceId;
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

  // Track knowledge gaps from low-confidence or unsupported answers
  // This is secondary analytics work - must never crash the primary chat request
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
          confidence: answer.confidence,
          citations: answer.citations.map((c) => ({
            documentId: c.documentId,
            documentTitle: c.documentTitle,
            excerpt: c.excerpt,
          })),
        },
        userId: input.userId ?? null,
      });
    } catch (error) {
      log.warn('Knowledge gap tracking failed (non-blocking)', {
        error: error instanceof Error ? error.message : String(error),
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

/**
 * Detects and tracks knowledge gaps from low-confidence or unsupported answers.
 * Clusters similar questions to identify recurring knowledge gaps.
 */
async function trackKnowledgeGap(input: {
  question: string;
  role: Role;
  knowledgeBaseId: string | null;
  retrieval: {
    confidence: number;
    grounding: string;
    chunks: { documentId: string; documentTitle: string; content: string }[];
  };
  answer: {
    grounding: string;
    confidence: number;
    citations: { documentId: string; documentTitle: string; excerpt: string }[];
  };
  userId: string | null;
}): Promise<void> {
  const { question, role, knowledgeBaseId, retrieval, answer, userId } = input;
  void role;
  void retrieval;
  void userId;

  // Only track gaps for unsupported or low-confidence answers
  if (answer.grounding === 'SUPPORTED' && answer.confidence >= 0.7) {
    return;
  }

  // Normalize question for clustering
  const normalizedQuestion = question
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, '')
    .replace(/\s+/g, ' ')
    .trim();

  if (!normalizedQuestion) return;

  // Find the knowledge base ID if not provided
  let kbId = knowledgeBaseId;
  if (!kbId) {
    const primary = await prisma.knowledgeBase.findFirst({
      orderBy: { createdAt: 'asc' },
      select: { id: true },
    });
    kbId = primary?.id ?? null;
  }
  if (!kbId) return;

  // Check for existing gap with similar question
  const existingGap = await prisma.knowledgeGap.findFirst({
    where: {
      knowledgeBaseId: kbId,
      status: { in: ['OPEN', 'ACKNOWLEDGED'] },
    },
    orderBy: { lastOccurredAt: 'desc' },
  });

  // Simple similarity check - in production, use embeddings for better clustering
  const similarGap = existingGap ? await findSimilarGap(normalizedQuestion, kbId) : null;

  if (similarGap) {
    // Update existing gap
    await prisma.knowledgeGap.update({
      where: { id: similarGap.id },
      data: {
        occurrenceCount: { increment: 1 },
        lastOccurredAt: new Date(),
      },
    });

    // Add new suggested sources if they don't already exist (idempotent)
    const relevantDocs = deduplicateCitationsByDocumentId(answer.citations);
    await addSuggestedSources(similarGap.id, relevantDocs);
  } else {
    // Create new knowledge gap with deduplicated citations
    const relevantDocs = deduplicateCitationsByDocumentId(answer.citations);

    await prisma.knowledgeGap.create({
      data: {
        knowledgeBaseId: kbId,
        title: `Knowledge gap: ${question.slice(0, 80)}${question.length > 80 ? '...' : ''}`,
        description: `Users repeatedly ask about this topic but the knowledge base does not contain sufficient approved information to answer confidently. Grounding: ${answer.grounding}, Confidence: ${(answer.confidence * 100).toFixed(1)}%`,
        status: 'OPEN',
        occurrenceCount: 1,
        suggestedSources: {
          create: relevantDocs.map((d) => ({
            documentId: d.documentId,
            relevanceNote: d.relevanceNote,
          })),
        },
      },
    });
  }
}

/**
 * Deduplicates citations by documentId, keeping the citation with the highest relevance score.
 */
function deduplicateCitationsByDocumentId(
  citations: { documentId: string; documentTitle: string; excerpt: string }[],
): Array<{ documentId: string; relevanceNote: string }> {
  const bestByDoc = new Map<
    string,
    { documentId: string; documentTitle: string; excerpt: string }
  >();

  for (const citation of citations) {
    const existing = bestByDoc.get(citation.documentId);
    if (!existing) {
      bestByDoc.set(citation.documentId, citation);
    }
    // Keep the first citation (highest relevance since citations are ordered by relevance)
  }

  return Array.from(bestByDoc.values()).map((c) => ({
    documentId: c.documentId,
    relevanceNote: `Cited in low-confidence answer: ${c.excerpt.slice(0, 200)}`,
  }));
}

/**
 * Adds suggested sources to an existing knowledge gap, skipping duplicates.
 * Uses upsert to handle concurrent calls idempotently.
 */
async function addSuggestedSources(
  knowledgeGapId: string,
  docs: Array<{ documentId: string; relevanceNote: string }>,
): Promise<void> {
  for (const doc of docs) {
    try {
      await prisma.knowledgeGapSuggestion.upsert({
        where: {
          knowledgeGapId_documentId: {
            knowledgeGapId,
            documentId: doc.documentId,
          },
        },
        create: {
          knowledgeGapId,
          documentId: doc.documentId,
          relevanceNote: doc.relevanceNote,
        },
        update: {
          // Update relevance note with the most recent citation
          relevanceNote: doc.relevanceNote,
        },
      });
    } catch (error) {
      // Ignore unique constraint errors from concurrent operations
      if (error instanceof Error && error.message.includes('P2002')) {
        // Another request already created this suggestion, that's fine
        continue;
      }
      throw error;
    }
  }
}

/**
 * Simple text similarity check for gap clustering.
 * In production, use embedding-based similarity.
 */
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
