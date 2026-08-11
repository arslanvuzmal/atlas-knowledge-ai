import { env } from '@/lib/env';
import { logger } from '@/lib/observability/logger';
import { DemoEmbeddingProvider } from '@/lib/embeddings/demo';
import {
  GoogleEmbeddingProvider,
  HuggingFaceEmbeddingProvider,
  OllamaEmbeddingProvider,
  OpenAiEmbeddingProvider,
} from '@/lib/embeddings/remote';
import type { EmbeddingProvider, EmbeddingResult } from '@/lib/embeddings/types';
import { fitToDimensions } from '@/lib/embeddings/types';

/**
 * Embedding provider registry.
 *
 * The pgvector column has a fixed width, so every provider's output is fitted
 * to `EMBEDDING_DIMENSIONS` before storage. Provider, model, and dimensions are
 * recorded on each chunk, which is what makes index drift detectable rather
 * than silently corrupting similarity scores.
 */

let cachedProvider: EmbeddingProvider | null = null;
let cachedKey = '';

// Bounded LRU Cache for query embeddings (max 500 queries)
const queryEmbeddingCache = new Map<string, number[]>();
const MAX_QUERY_CACHE_SIZE = 500;

export function getEmbeddingProvider(): EmbeddingProvider {
  const config = env();
  const key = `${config.EMBEDDING_PROVIDER}:${config.EMBEDDING_MODEL ?? ''}:${config.EMBEDDING_DIMENSIONS}`;
  if (cachedProvider && cachedKey === key) return cachedProvider;

  const shared = {
    model: config.EMBEDDING_MODEL,
    dimensions: config.EMBEDDING_DIMENSIONS,
  };

  switch (config.EMBEDDING_PROVIDER) {
    case 'openai':
      cachedProvider = new OpenAiEmbeddingProvider({ ...shared, apiKey: config.OPENAI_API_KEY });
      break;
    case 'google':
      cachedProvider = new GoogleEmbeddingProvider({ ...shared, apiKey: config.GEMINI_API_KEY });
      break;
    case 'huggingface':
      cachedProvider = new HuggingFaceEmbeddingProvider({
        ...shared,
        apiKey: config.HUGGINGFACE_API_KEY,
      });
      break;
    case 'ollama':
      cachedProvider = new OllamaEmbeddingProvider({ ...shared, baseUrl: config.OLLAMA_BASE_URL });
      break;
    case 'demo':
    default:
      cachedProvider = new DemoEmbeddingProvider(config.EMBEDDING_DIMENSIONS);
      break;
  }

  cachedKey = key;
  return cachedProvider;
}

export function resetEmbeddingProviderCache(): void {
  cachedProvider = null;
  cachedKey = '';
  queryEmbeddingCache.clear();
}

/** Batch size chosen to stay well inside every provider's request limits. */
const BATCH_SIZE = 64;

export async function embedTexts(texts: string[], signal?: AbortSignal): Promise<EmbeddingResult> {
  const provider = getEmbeddingProvider();
  const targetDimensions = env().EMBEDDING_DIMENSIONS;
  const started = Date.now();

  const vectors: number[][] = [];
  for (let offset = 0; offset < texts.length; offset += BATCH_SIZE) {
    const batch = texts.slice(offset, offset + BATCH_SIZE);
    const produced = await provider.embed(batch, signal);
    for (const vector of produced) {
      vectors.push(fitToDimensions(vector, targetDimensions));
    }
  }

  const processingTimeMs = Date.now() - started;

  if (
    !provider.isDemo &&
    !provider.supportsDimensionRequest &&
    provider.nativeDimensions !== targetDimensions
  ) {
    logger.warn('Embedding vectors were resized to fit the index width', {
      provider: provider.name,
      nativeDimensions: provider.nativeDimensions,
      targetDimensions,
    });
  }

  return {
    vectors,
    provider: provider.name,
    model: provider.model,
    dimensions: targetDimensions,
    processingTimeMs,
    isDemo: provider.isDemo,
  };
}

export async function embedQuery(text: string, signal?: AbortSignal): Promise<number[]> {
  const provider = getEmbeddingProvider();
  const targetDimensions = env().EMBEDDING_DIMENSIONS;
  const cacheKey = `${provider.name}:${provider.model}:${targetDimensions}:${text.trim().toLowerCase()}`;

  if (queryEmbeddingCache.has(cacheKey)) {
    return queryEmbeddingCache.get(cacheKey)!;
  }

  const result = await embedTexts([text], signal);
  const vector = result.vectors[0];

  if (queryEmbeddingCache.size >= MAX_QUERY_CACHE_SIZE) {
    const firstKey = queryEmbeddingCache.keys().next().value;
    if (firstKey) queryEmbeddingCache.delete(firstKey);
  }
  queryEmbeddingCache.set(cacheKey, vector);

  return vector;
}

export { DemoEmbeddingProvider } from '@/lib/embeddings/demo';
export * from '@/lib/embeddings/types';
