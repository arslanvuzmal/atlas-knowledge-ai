import type { EmbeddingHealth, EmbeddingProvider } from '@/lib/embeddings/types';
import { normaliseVector } from '@/lib/embeddings/types';
import { characterNgrams, hash32, termFrequencies, tokenise } from '@/lib/retrieval/text';

/**
 * Deterministic demo embedding provider.
 *
 * WHAT THIS IS: a hashed lexical projection. Tokens (and their character
 * 4-grams) are hashed into a fixed-width vector using several independent hash
 * functions with signed contributions, then L2 normalised. Cosine similarity
 * between two such vectors approximates weighted term overlap with partial
 * credit for shared word-shapes, so "What is the refund window?" genuinely
 * retrieves the passage containing "refunds are issued within 14 days".
 *
 * WHAT THIS IS NOT: a semantic model. It has no notion that "reimbursement"
 * and "refund" mean the same thing. Paraphrases that share no vocabulary will
 * rank poorly compared with a trained embedding model. That limitation is
 * stated in the UI, the README, and the retrieval evaluation report rather than
 * being papered over.
 *
 * It exists so the entire platform is runnable and demonstrable end to end
 * without paid credentials. Switch EMBEDDING_PROVIDER to a live provider and
 * re-index to get semantic quality.
 */

const HASH_SEEDS = [0x811c9dc5, 0x1b873593, 0x85ebca6b, 0xc2b2ae35];
const NGRAM_WEIGHT = 0.35;

export class DemoEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'demo' as const;
  readonly model = 'atlas-deterministic-lexical-v1';
  readonly supportsDimensionRequest = true;
  readonly isDemo = true;

  constructor(public readonly nativeDimensions: number = 768) {}

  private embedOne(text: string): number[] {
    const vector = new Array<number>(this.nativeDimensions).fill(0);
    const tokens = tokenise(text);

    if (tokens.length === 0) {
      // An all-zero vector would have undefined cosine similarity. A stable
      // pseudo-random direction keeps the maths well-defined and keeps empty
      // inputs far from real content.
      for (let i = 0; i < this.nativeDimensions; i += 1) {
        vector[i] = (hash32(`empty:${i}`) % 1000) / 1000 - 0.5;
      }
      return normaliseVector(vector);
    }

    const frequencies = termFrequencies(tokens);

    for (const [token, weight] of frequencies) {
      // Multiple hashes per token reduce the impact of any single collision.
      for (let s = 0; s < HASH_SEEDS.length; s += 1) {
        const hashed = hash32(token, HASH_SEEDS[s]);
        const index = hashed % this.nativeDimensions;
        // The sign bit turns collisions into cancellation rather than
        // systematic inflation.
        const sign = (hashed >>> 31) & 1 ? -1 : 1;
        vector[index] += sign * weight;
      }

      for (const gram of characterNgrams(token)) {
        const hashed = hash32(gram, HASH_SEEDS[0]);
        const index = hashed % this.nativeDimensions;
        const sign = (hashed >>> 31) & 1 ? -1 : 1;
        vector[index] += sign * weight * NGRAM_WEIGHT;
      }
    }

    return normaliseVector(vector);
  }

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((text) => this.embedOne(text));
  }

  async healthCheck(): Promise<EmbeddingHealth> {
    return {
      status: 'demo',
      detail:
        'Deterministic lexical embeddings. No external service is contacted and no credentials are required. Retrieval quality is term-overlap based, not semantic.',
      checkedAt: new Date().toISOString(),
    };
  }
}
