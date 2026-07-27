import type { RetrievedChunkRow } from '@/lib/database/vector';
import { STOPWORDS, hash32, tokenise } from '@/lib/retrieval/text';

/**
 * Cross-encoder-style reranking without a cross-encoder.
 *
 * The first-stage retrievers optimise for recall. Reranking optimises for
 * precision over that candidate set using signals the retrievers do not have:
 *
 *  - **Coverage** - what share of the query's distinct terms the passage
 *    actually contains. This is the strongest single signal, because a passage
 *    that answers a question almost always mentions most of what was asked.
 *  - **Proximity** - how tightly the matched terms cluster. Terms appearing in
 *    one sentence beat the same terms scattered across a page.
 *  - **Rare-term weighting** - a match on an unusual term is worth more than a
 *    match on a common one, approximated from term length and corpus frequency
 *    within the candidate set.
 *  - **Section-title match** - a heading match is a strong topical signal.
 *  - **Length normalisation** - stops a very long passage winning on volume.
 *
 * `RERANK_MODEL_NOTE` is surfaced in the UI so the technique is never presented
 * as something it is not.
 */

export const RERANK_MODEL_NOTE =
  'Lexical cross-scoring reranker (term coverage, proximity, rarity, and heading match). No external reranking model is called.';

export interface RerankedChunk extends RetrievedChunkRow {
  /** Fused first-stage score, before reranking. */
  retrievalScore: number;
  rerankScore: number;
  signals: {
    coverage: number;
    proximity: number;
    rarity: number;
    titleMatch: number;
    lengthPenalty: number;
  };
}

function inverseDocumentFrequency(candidates: RetrievedChunkRow[]): Map<string, number> {
  const documentFrequency = new Map<string, number>();
  for (const candidate of candidates) {
    const unique = new Set(tokenise(candidate.content));
    for (const term of unique) {
      documentFrequency.set(term, (documentFrequency.get(term) ?? 0) + 1);
    }
  }
  const total = Math.max(1, candidates.length);
  const idf = new Map<string, number>();
  for (const [term, frequency] of documentFrequency) {
    idf.set(term, Math.log(1 + total / frequency));
  }
  return idf;
}

/** Smallest window (in token positions) containing the most query terms. */
function proximityScore(chunkTokens: string[], queryTerms: Set<string>): number {
  const positions: number[] = [];
  for (let i = 0; i < chunkTokens.length; i += 1) {
    if (queryTerms.has(chunkTokens[i])) positions.push(i);
  }
  if (positions.length < 2) return positions.length === 1 ? 0.5 : 0;

  let best = Number.POSITIVE_INFINITY;
  for (let i = 1; i < positions.length; i += 1) {
    best = Math.min(best, positions[i] - positions[i - 1]);
  }
  // A gap of 1 (adjacent) scores 1.0; a gap of 40 scores near 0.
  return Math.max(0, 1 - (best - 1) / 40);
}

export function rerank(
  query: string,
  candidates: (RetrievedChunkRow & { retrievalScore?: number })[],
  limit: number,
): RerankedChunk[] {
  if (candidates.length === 0) return [];

  const queryTokens = tokenise(query);
  const queryTerms = new Set(queryTokens);
  const idf = inverseDocumentFrequency(candidates);

  const scored: RerankedChunk[] = candidates.map((candidate) => {
    const chunkTokens = tokenise(candidate.content);
    const chunkTermSet = new Set(chunkTokens);

    let matchedWeight = 0;
    let totalWeight = 0;
    for (const term of queryTerms) {
      const weight = idf.get(term) ?? Math.log(1 + term.length / 3);
      totalWeight += weight;
      if (chunkTermSet.has(term)) matchedWeight += weight;
    }
    const coverage = totalWeight > 0 ? matchedWeight / totalWeight : 0;

    const rarityHits = [...queryTerms].filter(
      (term) => chunkTermSet.has(term) && !STOPWORDS.has(term) && term.length >= 6,
    ).length;
    const rarity = queryTerms.size > 0 ? Math.min(1, rarityHits / Math.max(1, queryTerms.size)) : 0;

    const proximity = proximityScore(chunkTokens, queryTerms);

    const titleTokens = new Set(tokenise(candidate.sectionTitle ?? ''));
    const titleHits = [...queryTerms].filter((term) => titleTokens.has(term)).length;
    const titleMatch = queryTerms.size > 0 ? titleHits / queryTerms.size : 0;

    // Passages far from the typical length are mildly penalised.
    const characters = candidate.content.length;
    const lengthPenalty = characters > 2400 ? Math.max(0.7, 1 - (characters - 2400) / 8000) : 1;

    const retrievalScore = candidate.retrievalScore ?? candidate.score ?? 0;

    const rerankScore =
      (0.42 * coverage +
        0.16 * proximity +
        0.12 * rarity +
        0.1 * titleMatch +
        0.2 * Math.max(0, Math.min(1, retrievalScore))) *
      lengthPenalty;

    return {
      ...candidate,
      retrievalScore,
      rerankScore,
      signals: { coverage, proximity, rarity, titleMatch, lengthPenalty },
    };
  });

  scored.sort((a, b) => {
    if (b.rerankScore !== a.rerankScore) return b.rerankScore - a.rerankScore;
    // Deterministic tie-break so identical scores produce a stable order across
    // runs, which matters for reproducible evaluation results.
    return hash32(a.id) - hash32(b.id);
  });

  return scored.slice(0, limit);
}

/**
 * Reciprocal rank fusion. Combines ranked lists without needing their scores to
 * be on a comparable scale, which is exactly the problem when fusing cosine
 * similarity with ts_rank.
 */
export function reciprocalRankFusion(
  lists: RetrievedChunkRow[][],
  k = 60,
): (RetrievedChunkRow & { retrievalScore: number })[] {
  const fused = new Map<string, RetrievedChunkRow & { retrievalScore: number }>();

  for (const list of lists) {
    list.forEach((row, index) => {
      const contribution = 1 / (k + index + 1);
      const existing = fused.get(row.id);
      if (existing) {
        existing.retrievalScore += contribution;
      } else {
        fused.set(row.id, { ...row, retrievalScore: contribution });
      }
    });
  }

  return [...fused.values()].sort((a, b) => b.retrievalScore - a.retrievalScore);
}
