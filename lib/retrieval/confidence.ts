import type { GroundingLevel } from '@prisma/client';
import type { RerankedChunk } from '@/lib/reranking';
import { STOPWORDS, tokenise } from '@/lib/retrieval/text';

/**
 * Retrieval confidence.
 *
 * Confidence answers one question: *how much of what was asked is actually
 * covered by what was found?* It is computed from the evidence, never from the
 * generated answer, so a fluent-sounding answer cannot inflate it.
 *
 * Four components, each capped at 1:
 *
 *  - `topScore`    - how strong the single best passage is.
 *  - `coverage`    - share of the question's content terms present anywhere in
 *                    the selected passages. The dominant term, because an
 *                    unanswerable question characteristically has low coverage.
 *  - `agreement`   - whether several independent passages support the topic,
 *                    which distinguishes a real answer from one lucky match.
 *  - `margin`      - separation between the best passage and the rest. A flat
 *                    distribution means nothing stood out.
 */

export interface ConfidenceBreakdown {
  confidence: number;
  topScore: number;
  coverage: number;
  agreement: number;
  margin: number;
  supportingChunks: number;
  /** Question terms with no match anywhere in the evidence. */
  uncoveredTerms: string[];
}

export function calculateConfidence(
  question: string,
  chunks: RerankedChunk[],
): ConfidenceBreakdown {
  if (chunks.length === 0) {
    return {
      confidence: 0,
      topScore: 0,
      coverage: 0,
      agreement: 0,
      margin: 0,
      supportingChunks: 0,
      uncoveredTerms: [...new Set(tokenise(question))].filter((t) => !STOPWORDS.has(t)),
    };
  }

  const questionTerms = [...new Set(tokenise(question))].filter(
    (term) => !STOPWORDS.has(term) && term.length >= 3,
  );

  const combinedTerms = new Set<string>();
  for (const chunk of chunks) {
    for (const token of tokenise(`${chunk.sectionTitle ?? ''} ${chunk.content}`)) {
      combinedTerms.add(token);
    }
  }

  const uncoveredTerms = questionTerms.filter((term) => !combinedTerms.has(term));
  const coverage =
    questionTerms.length === 0
      ? 0.5
      : (questionTerms.length - uncoveredTerms.length) / questionTerms.length;

  const topScore = Math.max(0, Math.min(1, chunks[0].rerankScore));

  // A passage counts as "supporting" when it covers at least a third of the
  // question's terms on its own.
  const supportingChunks = chunks.filter((chunk) => chunk.signals.coverage >= 0.34).length;
  const agreement = Math.min(1, supportingChunks / 3);

  const second = chunks[1]?.rerankScore ?? 0;
  const margin = topScore > 0 ? Math.max(0, Math.min(1, (topScore - second) / topScore)) : 0;

  const confidence = 0.28 * topScore + 0.44 * coverage + 0.18 * agreement + 0.1 * margin;

  return {
    confidence: Number(Math.max(0, Math.min(1, confidence)).toFixed(4)),
    topScore: Number(topScore.toFixed(4)),
    coverage: Number(coverage.toFixed(4)),
    agreement: Number(agreement.toFixed(4)),
    margin: Number(margin.toFixed(4)),
    supportingChunks,
    uncoveredTerms,
  };
}

/**
 * Maps confidence onto the three grounding states the product exposes.
 *
 * The upper band sits meaningfully above the configured threshold so that
 * "supported" means clearly supported, and the space between the threshold and
 * that band becomes "partially supported" rather than being rounded up.
 */
export function determineGrounding(
  breakdown: ConfidenceBreakdown,
  threshold: number,
): GroundingLevel {
  if (breakdown.supportingChunks === 0 && breakdown.coverage < 0.5) return 'UNSUPPORTED';
  if (breakdown.confidence < threshold * 0.75) return 'UNSUPPORTED';
  if (breakdown.confidence < threshold) return 'PARTIALLY_SUPPORTED';
  if (breakdown.coverage < 0.6) return 'PARTIALLY_SUPPORTED';
  return 'SUPPORTED';
}

export const GROUNDING_LABELS: Record<GroundingLevel, string> = {
  SUPPORTED: 'Supported',
  PARTIALLY_SUPPORTED: 'Partially supported',
  UNSUPPORTED: 'Not supported',
};

export const GROUNDING_DESCRIPTIONS: Record<GroundingLevel, string> = {
  SUPPORTED: 'This answer is grounded in the cited approved sources.',
  PARTIALLY_SUPPORTED:
    'Some of this is supported by the cited sources, but the knowledge base does not fully cover the question.',
  UNSUPPORTED:
    'The approved knowledge base does not contain enough reliable information to answer this.',
};
