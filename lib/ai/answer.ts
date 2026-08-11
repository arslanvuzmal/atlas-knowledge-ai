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
import { detectMaterialConflicts } from '@/lib/rag/conflict';

export type AnswerSourceType = 'APPROVED_KNOWLEDGE' | 'EXTERNAL_LIVE' | 'GENERAL_MODEL' | 'LOCAL';

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
  confidenceLabel:
    'Strong evidence' | 'Partial evidence' | 'Insufficient evidence' | 'N/A' | 'Current Web Data';
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
  sourceType?: AnswerSourceType;
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
      content:
        turn.role === 'ASSISTANT'
          ? turn.content.replace(/\[\d{1,2}\]/g, '').slice(0, 1200)
          : turn.content.slice(0, 1200),
    }));
}

function detectConflicts(
  chunks: RerankedChunk[],
  question: string,
): {
  detected: boolean;
  conflictingDocuments: { documentId: string; title: string; excerpt: string }[];
} {
  return detectMaterialConflicts(chunks, question);
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

/**
 * General Knowledge generation path (bypasses RAG).
 */
export async function generateGeneralAnswer(request: {
  question: string;
  history: ConversationTurn[];
  modelSettings: { llmProviderOverride: string; maxAnswerTokens: number; temperature: number };
  traceId?: string;
}): Promise<AnswerResult> {
  const started = Date.now();
  const provider = getLlmProvider(request.modelSettings.llmProviderOverride);

  const system =
    'You are Atlas, a helpful general-purpose assistant integrated with a governed enterprise knowledge platform.\n' +
    'Answer ordinary general-knowledge and conversational questions naturally, clearly and concisely.\n' +
    "Do not pretend general knowledge came from the organization's approved knowledge base.\n" +
    'Do not fabricate Atlas citations.\n' +
    "If a question asks about this organization's policies, pricing, products, security, employees, internal processes or approved documents, the application will route it through governed RAG instead.\n" +
    'If information is likely to be current or time-sensitive, do not guess; the application will route it to a live-information tool.';

  const messages: ChatMessage[] = [
    ...buildHistoryMessages(request.history, 6),
    { role: 'user', content: request.question },
  ];

  try {
    const generation = await provider.generate({
      system,
      messages,
      maxTokens: request.modelSettings.maxAnswerTokens,
      temperature: request.modelSettings.temperature,
    });

    return {
      text: generation.text,
      grounding: 'SUPPORTED',
      confidence: 1.0,
      citations: [],
      provider: provider.name,
      model: provider.model,
      latencyMs: generation.latencyMs,
      isDemo: provider.isDemo,
      sourceType: 'GENERAL_MODEL',
      escalationSuggested: false,
      escalationReason: null,
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
  } catch (error) {
    logger.error('General answer generation failed', { provider: provider.name, error });
    return {
      text: publicMessageForLlmError(error),
      grounding: 'UNSUPPORTED',
      confidence: 0,
      citations: [],
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - started,
      isDemo: provider.isDemo,
      sourceType: 'GENERAL_MODEL',
      escalationSuggested: false,
      escalationReason: null,
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
        generationFailed: true,
      },
    };
  }
}

/**
 * Live External Information path (bypasses RAG, uses Google Search / live tools).
 */
export async function generateLiveAnswer(request: {
  question: string;
  history: ConversationTurn[];
  modelSettings: { llmProviderOverride: string; maxAnswerTokens: number; temperature: number };
  missingLocation?: boolean;
  traceId?: string;
}): Promise<AnswerResult> {
  const started = Date.now();

  if (request.missingLocation) {
    return {
      text: 'Sure — which city or location?',
      grounding: 'SUPPORTED',
      confidence: 1.0,
      citations: [],
      provider: 'local',
      model: 'intent-router',
      latencyMs: Date.now() - started,
      isDemo: false,
      sourceType: 'LOCAL',
      escalationSuggested: false,
      escalationReason: null,
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
  }

  const provider = getLlmProvider(request.modelSettings.llmProviderOverride);

  const system =
    'You are Atlas, an intelligent assistant equipped with current real-time search capabilities.\n' +
    'Answer live, external, or current-world questions clearly and accurately using current information.\n' +
    'Keep your response concise and up to date.';

  const messages: ChatMessage[] = [
    ...buildHistoryMessages(request.history, 4),
    { role: 'user', content: request.question },
  ];

  try {
    const generation = await (
      provider as unknown as {
        generate: (req: Record<string, unknown>) => Promise<{ text: string; latencyMs: number }>;
      }
    ).generate({
      system,
      messages,
      maxTokens: request.modelSettings.maxAnswerTokens,
      temperature: request.modelSettings.temperature,
      enableLiveSearch: true,
    });

    return {
      text: generation.text,
      grounding: 'SUPPORTED',
      confidence: 1.0,
      citations: [],
      provider: provider.name,
      model: provider.model,
      latencyMs: generation.latencyMs,
      isDemo: provider.isDemo,
      sourceType: 'EXTERNAL_LIVE',
      escalationSuggested: false,
      escalationReason: null,
      relatedSources: [],
      evidence: {
        confidenceLabel: 'Current Web Data',
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
  } catch (error) {
    logger.error('Live answer generation failed', { provider: provider.name, error });
    return {
      text: publicMessageForLlmError(error),
      grounding: 'UNSUPPORTED',
      confidence: 0,
      citations: [],
      provider: provider.name,
      model: provider.model,
      latencyMs: Date.now() - started,
      isDemo: provider.isDemo,
      sourceType: 'EXTERNAL_LIVE',
      escalationSuggested: false,
      escalationReason: null,
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
        generationFailed: true,
      },
    };
  }
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
      sourceType: 'APPROVED_KNOWLEDGE',
      escalationSuggested: true,
      escalationReason:
        retrieval.chunks.length === 0
          ? 'No permitted chunks were found.'
          : 'Retrieval confidence was below the minimum threshold.',
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
      sourceType: 'APPROVED_KNOWLEDGE',
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
    sourceType: 'APPROVED_KNOWLEDGE',
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

export function buildSuggestedReply(question: string, answer: AnswerResult): string {
  if (answer.grounding === 'UNSUPPORTED') {
    return `Thank you for your question about "${question.slice(0, 120)}". Our knowledge base does not currently cover this, so a member of the team is reviewing it and will follow up with a definitive answer.`;
  }
  const sources = answer.citations.map((citation) => citation.documentTitle);
  const unique = [...new Set(sources)];
  return `Thank you for your question. Based on ${unique.join(' and ') || 'our approved documentation'}, here is what we can confirm:\n\n${answer.text}\n\nPlease review and confirm before sending.`;
}
