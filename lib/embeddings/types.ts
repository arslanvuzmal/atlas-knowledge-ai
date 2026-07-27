import type { EmbeddingProviderName } from '@/lib/env';

export interface EmbeddingResult {
  vectors: number[][];
  provider: EmbeddingProviderName;
  model: string;
  dimensions: number;
  processingTimeMs: number;
  /** True when the provider produces deterministic, non-semantic vectors. */
  isDemo: boolean;
}

export interface EmbeddingProvider {
  readonly name: EmbeddingProviderName;
  readonly model: string;
  /** Native output width before any projection to the index dimension. */
  readonly nativeDimensions: number;
  /** Whether the provider can emit a requested width directly. */
  readonly supportsDimensionRequest: boolean;
  readonly isDemo: boolean;
  embed(texts: string[], signal?: AbortSignal): Promise<number[][]>;
  /** Lightweight reachability probe. Never throws. */
  healthCheck(): Promise<EmbeddingHealth>;
}

export interface EmbeddingHealth {
  status: 'operational' | 'demo' | 'degraded' | 'misconfigured' | 'unavailable';
  detail: string;
  checkedAt: string;
}

export class EmbeddingError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'auth'
      | 'rate_limit'
      | 'timeout'
      | 'server'
      | 'invalid_response'
      | 'network'
      | 'configuration',
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'EmbeddingError';
  }
}

/** L2 normalisation so cosine similarity reduces to a dot product. */
export function normaliseVector(vector: number[]): number[] {
  let sumSquares = 0;
  for (const value of vector) sumSquares += value * value;
  const magnitude = Math.sqrt(sumSquares);
  if (magnitude === 0) return vector.slice();
  return vector.map((value) => value / magnitude);
}

/**
 * Fits a provider vector to the index width.
 *
 * Truncation of a normalised embedding is the standard Matryoshka-style
 * reduction and is safe for models trained for it; for other models it is a
 * lossy fallback that the health endpoint reports explicitly. Zero-padding a
 * short vector is always safe because the extra dimensions contribute nothing
 * to the dot product.
 */
export function fitToDimensions(vector: number[], target: number): number[] {
  if (vector.length === target) return normaliseVector(vector);
  if (vector.length > target) return normaliseVector(vector.slice(0, target));
  return normaliseVector([...vector, ...new Array(target - vector.length).fill(0)]);
}

export function cosineSimilarity(a: number[], b: number[]): number {
  const length = Math.min(a.length, b.length);
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < length; i += 1) {
    dot += a[i] * b[i];
    magA += a[i] * a[i];
    magB += b[i] * b[i];
  }
  if (magA === 0 || magB === 0) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}
