import type { GroundingLevel } from '@prisma/client';
import { getLlmProvider } from '@/lib/ai';
import { buildPrompt, UNSUPPORTED_ANSWER, type BuiltPrompt } from '@/lib/ai/prompt';
import {
  attachFallbackCitations,
  validateCitations,
  type ValidatedCitation,
} from '@/lib/ai/citations';
import { LlmError, publicMessageForLlmError, type ChatMessage } from '@/lib/ai/types';
import type { ConversationTurn } from '@/lib/retrieval/query';
import type { RetrievalResult } from '@/lib/retrieval/search';
import type { RerankedChunk } from '@/lib/reranking';
import { suggestRelatedSources } from '@/lib/retrieval/search';
import type { RetrievalSettings } from '@/lib/retrieval/settings';
import type { Role } from '@prisma/client';
import { logger } from '@/lib/observability/logger';

/**
 * Answer generation.
 *
 * The order of operations is what makes the "no fabricated citations" and "say
 * so when you do not know" guarantees hold:
 *
 *   1. Grounding is decided from the *retrieval evidence*, before the model is
 *      called. An UNSUPPORTED verdict short-circuits generation entirely, so
 *      there is no opportunity for a fluent answer to talk its way past a
 *      failed retrieval.
 *   2. The model only ever sees sources that survived the access filter.
 *   3. Whatever comes back is passed through citation validation, which deletes
 *      any marker that does not correspond to a supplied source.
 */

export interface AnswerRequest {
  question: string;
  role: Role;
  retrieval: RetrievalResult;
  history: ConversationTurn[];
  settings: RetrievalSettings;
  modelSettings: { llmProviderOverride: string; maxAnswerTokens: number; temperature: number };
  traceId?: string;
}

export interface EvidencePacket {
  /** Plain-language description of evidence strength. */
  confidenceLabel: 'Strong evidence' | 'Partial evidence' | 'Insufficient evidence';
  /** Number of distinct passages cited. */
  supportingPassages: number;
  /** Number of distinct documents cited. */
  supportingDocuments: number;
  /** Coverage of question terms in the evidence (0-1). */
  coverage: number;
  /** Whether approved sources contain contradictory information on the topic. */
  conflictDetected: boolean;
  /** Documents involved in a conflict, if detected. */
  conflictingDocuments: { documentId: string; title: string; excerpt: string }[];
}

export interface AnswerResult {
  text: string;
  grounding: GroundingLevel;
  confidence: number;
  citations: ValidatedCitation[];
  provider: string;
  model: string;
  latencyMs: number;
  isDemo: boolean;
  /** True when the retrieval or the answer warrants human review. */
  escalationSuggested: boolean;
  escalationReason: string | null;
  relatedSources: { documentId: string; title: string; sectionTitle: string | null }[];
  /** Rich evidence packet for the UI. */
  evidence: EvidencePacket;
  diagnostics: {
    invalidCitationMarkers: number[];
    usedFallbackCitations: boolean;
    promptTokens: number;
    truncatedSources: number;
    generationFailed: boolean;
  };
}

function buildHistoryMessages(history: ConversationTurn[], limit: number): ChatMessage[] {
  if (limit <= 0) return [];
  return history
    .slice(-limit)
    .filter((turn) => turn.role === 'USER' || turn.role === 'ASSISTANT')
    .map((turn) => ({
      role: turn.role === 'USER' ? ('user' as const) : ('assistant' as const),
      // A previous assistant turn is conversational context only. The system
      // prompt already forbids treating it as evidence, and it carries no
      // citation markers into the new prompt.
      content:
        turn.role === 'ASSISTANT'
          ? turn.content.replace(/\[\d{1,2}\]/g, '').slice(0, 1200)
          : turn.content.slice(0, 1200),
    }));
}

/**
 * Detects contradictory information across retrieved sources.
 *
 * This is a heuristic: it looks for passages that make opposing claims
 * about the same entities/quantities. It is not authoritative—conflicts
 * are flagged for human review rather than automatically resolved.
 */
function detectConflicts(
  chunks: RerankedChunk[],
  question: string,
): {
  detected: boolean;
  conflictingDocuments: { documentId: string; title: string; excerpt: string }[];
} {
  if (chunks.length < 2) return { detected: false, conflictingDocuments: [] };

  // Extract key terms from the question that indicate a specific factual query
  const questionTerms = question
    .toLowerCase()
    .split(/\s+/)
    .filter((t) => t.length > 3);
  if (questionTerms.length === 0) return { detected: false, conflictingDocuments: [] };

  // Group chunks by document
  const byDocument = new Map<string, RerankedChunk[]>();
  for (const chunk of chunks) {
    const existing = byDocument.get(chunk.documentId) ?? [];
    existing.push(chunk);
    byDocument.set(chunk.documentId, existing);
  }

  // Simple conflict heuristic: look for numeric discrepancies in passages
  // that address the same question terms
  const numberPattern =
    /\b(\d+(?:[.,]\d+)?)\s*(days?|hours?|months?|years?|percent|%|\$|USD|GB|MB|KB|TB|users?|seats?|licenses?)\b/gi;
  const numericClaims = new Map<
    string,
    { documentId: string; title: string; value: string; context: string }[]
  >();

  for (const [docId, docChunks] of byDocument) {
    const docTitle = docChunks[0].documentTitle;
    for (const chunk of docChunks) {
      const matches = chunk.content.matchAll(numberPattern);
      for (const match of matches) {
        const fullMatch = match[0];
        const key = fullMatch.toLowerCase().replace(/\s+/g, ' ');
        const existing = numericClaims.get(key) ?? [];
        existing.push({
          documentId: docId,
          title: docTitle,
          value: fullMatch,
          context: chunk.content.slice(
            Math.max(0, match.index! - 80),
            match.index! + fullMatch.length + 80,
          ),
        });
        numericClaims.set(key, existing);
      }
    }
  }

  // Check if the same unit has different values across documents
  const conflictingDocuments: { documentId: string; title: string; excerpt: string }[] = [];
  const seenDocs = new Set<string>();

  for (const [, claims] of numericClaims) {
    if (claims.length < 2) continue;
    const uniqueValues = new Set(claims.map((c) => c.value));
    if (uniqueValues.size > 1) {
      for (const claim of claims) {
        if (!seenDocs.has(claim.documentId)) {
          seenDocs.add(claim.documentId);
          conflictingDocuments.push({
            documentId: claim.documentId,
            title: claim.title,
            excerpt: claim.context.trim(),
          });
        }
      }
    }
  }

  // Also check for direct contradictory language (allows/denies, required/optional, etc.)
  const contradictionPairs = [
    ['allows', 'does not allow'],
    ['permits', 'prohibits'],
    ['required', 'optional'],
    ['must', 'must not'],
    ['shall', 'shall not'],
    ['is', 'is not'],
    ['includes', 'excludes'],
    ['covers', 'does not cover'],
  ];

  const lowerChunks = chunks.map((c) => c.content.toLowerCase());
  for (const [positive, negative] of contradictionPairs) {
    const hasPositive = lowerChunks.some((c) => c.includes(positive));
    const hasNegative = lowerChunks.some((c) => c.includes(negative));
    if (hasPositive && hasNegative) {
      // Find which documents have which
      for (const chunk of chunks) {
        const lower = chunk.content.toLowerCase();
        if (lower.includes(positive) || lower.includes(negative)) {
          if (!seenDocs.has(chunk.documentId)) {
            seenDocs.add(chunk.documentId);
            conflictingDocuments.push({
              documentId: chunk.documentId,
              title: chunk.documentTitle,
              excerpt: chunk.content.slice(0, 200).trim(),
            });
          }
        }
      }
    }
  }

  return {
    detected: conflictingDocuments.length >= 2,
    conflictingDocuments: conflictingDocuments.slice(0, 4),
  };
}

function unsupportedAnswer(
  retrieval: RetrievalResult,
  role: Role,
): { text: string; related: { documentId: string; title: string; sectionTitle: string | null }[] } {
  const related = suggestRelatedSources(retrieval.chunks, role, 3);

  let text = UNSUPPORTED_ANSWER;
  if (related.length > 0) {
    const titles = related.map((source) => source.title);
    const unique = [...new Set(titles)];
    text += `\n\nThe closest approved material covers ${unique.join(', ')}, but it does not address your question directly.`;
  }
  if (retrieval.confidence.uncoveredTerms.length > 0) {
    text += `\n\nI found nothing about: ${retrieval.confidence.uncoveredTerms.slice(0, 5).join(', ')}.`;
  }
  text +=
    '\n\nYou can rephrase the question with a more specific term, or ask for a human to review it.';

  return { text, related };
}

export async function generateAnswer(request: AnswerRequest): Promise<AnswerResult> {
  const { retrieval, settings, modelSettings, role } = request;
  const started = Date.now();

  // --- 1. Unsupported short-circuit -----------------------------------------
  if (retrieval.grounding === 'UNSUPPORTED' || retrieval.chunks.length === 0) {
    const { text, related } = unsupportedAnswer(retrieval, role);
    const evidence = buildEvidencePacket(retrieval, [], false);
    return {
      text,
      grounding: 'UNSUPPORTED',
      confidence: retrieval.confidence.confidence,
      citations: [],
      provider: 'none',
      model: 'not-invoked',
      latencyMs: Date.now() - started,
      isDemo: false,
      escalationSuggested: true,
      escalationReason:
        retrieval.chunks.length === 0
          ? 'No approved source matched the question.'
          : 'Retrieval confidence was below the configured threshold.',
      relatedSources: related,
      evidence,
      diagnostics: {
        invalidCitationMarkers: [],
        usedFallbackCitations: false,
        promptTokens: 0,
        truncatedSources: 0,
        generationFailed: false,
      },
    };
  }

  // --- 2. Prompt assembly ----------------------------------------------------
  const prompt: BuiltPrompt = buildPrompt(request.question, retrieval.chunks);
  const provider = getLlmProvider(modelSettings.llmProviderOverride);

  const messages: ChatMessage[] = [
    ...buildHistoryMessages(request.history, settings.conversationHistoryLength),
    { role: 'user', content: prompt.userContent },
  ];

  // --- 3. Generation ---------------------------------------------------------
  let rawText: string;
  let providerLatency = 0;
  let generationFailed = false;

  try {
    const generation = await provider.generate({
      system: prompt.system,
      messages,
      maxTokens: modelSettings.maxAnswerTokens,
      temperature: modelSettings.temperature,
    });
    rawText = generation.text;
    providerLatency = generation.latencyMs;
  } catch (error) {
    logger.error('Answer generation failed', {
      provider: provider.name,
      traceId: request.traceId,
      error,
    });
    generationFailed = true;
    rawText = publicMessageForLlmError(error);

    const evidence = buildEvidencePacket(retrieval, [], true);
    return {
      text: rawText,
      grounding: 'UNSUPPORTED',
      confidence: retrieval.confidence.confidence,
      citations: [],
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - started,
      isDemo: provider.isDemo,
      escalationSuggested: true,
      escalationReason: `The language model provider failed: ${
        error instanceof LlmError ? error.kind : 'unknown error'
      }.`,
      relatedSources: suggestRelatedSources(retrieval.chunks, role, 3),
      evidence,
      diagnostics: {
        invalidCitationMarkers: [],
        usedFallbackCitations: false,
        promptTokens: prompt.estimatedTokens,
        truncatedSources: prompt.truncatedSources,
        generationFailed,
      },
    };
  }

  // --- 4. Citation validation ------------------------------------------------
  const scores = new Map(retrieval.chunks.map((chunk) => [chunk.id, chunk.rerankScore]));
  const validated = validateCitations(rawText, prompt.sources, scores);

  if (validated.invalidMarkers.length > 0) {
    // Worth alerting on: it means the model referenced a source it was not given.
    logger.warn('Model produced citation markers with no matching source', {
      provider: provider.name,
      invalidMarkers: validated.invalidMarkers,
      suppliedSources: prompt.sources.length,
      traceId: request.traceId,
    });
  }

  let citations = validated.citations;
  let usedFallbackCitations = false;

  const modelDeclinedToAnswer = validated.text
    .toLowerCase()
    .includes(UNSUPPORTED_ANSWER.slice(0, 60).toLowerCase());

  if (!validated.hasCitations && !modelDeclinedToAnswer) {
    citations = attachFallbackCitations(prompt.sources, scores, settings.citationCount);
    usedFallbackCitations = true;
  }

  citations = citations.slice(0, settings.citationCount);

  // --- 5. Final grounding ----------------------------------------------------
  // An answer the model itself declined to give is unsupported regardless of
  // what the retrieval scores suggested.
  let grounding: GroundingLevel = modelDeclinedToAnswer ? 'UNSUPPORTED' : retrieval.grounding;
  if (grounding === 'SUPPORTED' && citations.length === 0) {
    grounding = 'PARTIALLY_SUPPORTED';
  }

  const escalationSuggested =
    grounding === 'UNSUPPORTED' ||
    retrieval.confidence.confidence < settings.confidenceThreshold ||
    validated.invalidMarkers.length > 0;

  let escalationReason: string | null = null;
  if (grounding === 'UNSUPPORTED') {
    escalationReason = 'The knowledge base did not support an answer.';
  } else if (retrieval.confidence.confidence < settings.confidenceThreshold) {
    escalationReason = `Confidence ${retrieval.confidence.confidence.toFixed(2)} was below the ${settings.confidenceThreshold.toFixed(2)} threshold.`;
  } else if (validated.invalidMarkers.length > 0) {
    escalationReason = 'The generated answer referenced sources that were not retrieved.';
  }

  // --- 6. Build evidence packet with conflict detection ----------------------
  const conflict = detectConflicts(retrieval.chunks, request.question);
  if (conflict.detected) {
    logger.warn('Contradictory approved sources detected', {
      question: request.question,
      conflictingDocuments: conflict.conflictingDocuments.map((d) => d.title),
      traceId: request.traceId,
    });
  }

  const evidence = buildEvidencePacket(
    retrieval,
    citations,
    conflict.detected,
    conflict.conflictingDocuments,
  );

  return {
    text: validated.text.length > 0 ? validated.text : UNSUPPORTED_ANSWER,
    grounding,
    confidence: retrieval.confidence.confidence,
    citations,
    provider: provider.name,
    model: provider.model,
    latencyMs: providerLatency,
    isDemo: provider.isDemo,
    escalationSuggested,
    escalationReason,
    relatedSources:
      grounding === 'UNSUPPORTED' ? suggestRelatedSources(retrieval.chunks, role, 3) : [],
    evidence,
    diagnostics: {
      invalidCitationMarkers: validated.invalidMarkers,
      usedFallbackCitations,
      promptTokens: prompt.estimatedTokens,
      truncatedSources: prompt.truncatedSources,
      generationFailed,
    },
  };
}

/**
 * Builds the evidence packet for the UI.
 */
function buildEvidencePacket(
  retrieval: RetrievalResult,
  citations: ValidatedCitation[],
  conflictDetected: boolean,
  conflictingDocuments: { documentId: string; title: string; excerpt: string }[] = [],
): EvidencePacket {
  const supportingPassages = citations.length;
  const supportingDocuments = new Set(citations.map((c) => c.documentId)).size;
  const coverage = retrieval.confidence.coverage;

  let confidenceLabel: EvidencePacket['confidenceLabel'] = 'Insufficient evidence';
  if (coverage >= 0.6 && supportingPassages >= 2) confidenceLabel = 'Strong evidence';
  else if (coverage >= 0.3 || supportingPassages >= 1) confidenceLabel = 'Partial evidence';

  return {
    confidenceLabel,
    supportingPassages,
    supportingDocuments,
    coverage: Number(coverage.toFixed(2)),
    conflictDetected,
    conflictingDocuments,
  };
}

/** Suggested reply an operator can start from when handling an escalation. */
export function buildSuggestedReply(question: string, answer: AnswerResult): string {
  if (answer.grounding === 'UNSUPPORTED') {
    return `Thank you for your question about "${question.slice(0, 120)}". Our knowledge base does not currently cover this, so a member of the team is reviewing it and will follow up with a definitive answer.`;
  }
  const sources = answer.citations.map((citation) => citation.documentTitle);
  const unique = [...new Set(sources)];
  return `Thank you for your question. Based on ${unique.join(' and ') || 'our approved documentation'}, here is what we can confirm:\n\n${answer.text}\n\nPlease review and confirm before sending.`;
}
