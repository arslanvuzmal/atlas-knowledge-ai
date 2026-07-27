import type { EmbeddingHealth, EmbeddingProvider } from '@/lib/embeddings/types';
import { EmbeddingError, normaliseVector } from '@/lib/embeddings/types';
import type { EmbeddingProviderName } from '@/lib/env';

/**
 * Live embedding providers.
 *
 * All four speak different wire formats but share the same failure handling:
 * a bounded timeout, classification of the error into retryable and
 * non-retryable kinds, and a strict shape check on the response. A provider
 * that returns something unexpected raises `invalid_response` rather than
 * silently producing a malformed vector that would poison the index.
 */

const DEFAULT_TIMEOUT_MS = 30_000;
const MAX_ATTEMPTS = 3;

async function withTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const onExternalAbort = () => controller.abort();
  external?.addEventListener('abort', onExternalAbort);
  try {
    return await operation(controller.signal);
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', onExternalAbort);
  }
}

function classifyStatus(status: number): { kind: EmbeddingError['kind']; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'invalid_response', retryable: false };
}

/** Retries only what is worth retrying, with exponential backoff and jitter. */
async function withRetry<T>(operation: () => Promise<T>): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof EmbeddingError && error.retryable;
      if (!retryable || attempt === MAX_ATTEMPTS) break;
      const backoff = 400 * 2 ** (attempt - 1) + Math.random() * 200;
      await new Promise((resolve) => setTimeout(resolve, backoff));
    }
  }
  throw lastError;
}

function assertVectors(value: unknown, expectedCount: number): number[][] {
  if (!Array.isArray(value) || value.length !== expectedCount) {
    throw new EmbeddingError(
      `Provider returned ${Array.isArray(value) ? value.length : 'a non-array'} embeddings for ${expectedCount} inputs.`,
      'invalid_response',
      false,
    );
  }
  return value.map((vector) => {
    if (
      !Array.isArray(vector) ||
      vector.length === 0 ||
      !vector.every((n) => typeof n === 'number' && Number.isFinite(n))
    ) {
      throw new EmbeddingError(
        'Provider returned a malformed embedding vector.',
        'invalid_response',
        false,
      );
    }
    return vector as number[];
  });
}

interface RemoteConfig {
  apiKey?: string;
  model?: string;
  dimensions: number;
  baseUrl?: string;
}

// ---------------------------------------------------------------------------
// OpenAI
// ---------------------------------------------------------------------------

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai' as const;
  readonly model: string;
  readonly nativeDimensions = 1536;
  // text-embedding-3-* support native dimension reduction, so no truncation
  // fallback is needed.
  readonly supportsDimensionRequest = true;
  readonly isDemo = false;

  constructor(private readonly config: RemoteConfig) {
    this.model = config.model || 'text-embedding-3-small';
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new EmbeddingError('OPENAI_API_KEY is not configured.', 'configuration', false);
    }
    return withRetry(async () =>
      withTimeout(
        async (timeoutSignal) => {
          const response = await fetch('https://api.openai.com/v1/embeddings', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              input: texts,
              dimensions: this.config.dimensions,
            }),
            signal: timeoutSignal,
          });
          if (!response.ok) {
            const { kind, retryable } = classifyStatus(response.status);
            throw new EmbeddingError(
              `OpenAI embeddings returned HTTP ${response.status}.`,
              kind,
              retryable,
            );
          }
          const payload = (await response.json()) as { data?: { embedding?: number[] }[] };
          const vectors = assertVectors(
            payload.data?.map((d) => d.embedding),
            texts.length,
          );
          return vectors.map(normaliseVector);
        },
        DEFAULT_TIMEOUT_MS,
        signal,
      ),
    );
  }

  async healthCheck(): Promise<EmbeddingHealth> {
    return remoteHealthCheck(this, () => this.embed(['health check']));
  }
}

// ---------------------------------------------------------------------------
// Google
// ---------------------------------------------------------------------------

export class GoogleEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'google' as const;
  readonly model: string;
  readonly nativeDimensions = 768;
  readonly supportsDimensionRequest = true;
  readonly isDemo = false;

  constructor(private readonly config: RemoteConfig) {
    this.model = config.model || 'text-embedding-004';
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new EmbeddingError('GEMINI_API_KEY is not configured.', 'configuration', false);
    }
    const url = `https://generativelanguage.googleapis.com/v1beta/models/${this.model}:batchEmbedContents?key=${this.config.apiKey}`;
    return withRetry(async () =>
      withTimeout(
        async (timeoutSignal) => {
          const response = await fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              requests: texts.map((text) => ({
                model: `models/${this.model}`,
                content: { parts: [{ text }] },
                outputDimensionality: this.config.dimensions,
              })),
            }),
            signal: timeoutSignal,
          });
          if (!response.ok) {
            const { kind, retryable } = classifyStatus(response.status);
            throw new EmbeddingError(
              `Google embeddings returned HTTP ${response.status}.`,
              kind,
              retryable,
            );
          }
          const payload = (await response.json()) as { embeddings?: { values?: number[] }[] };
          const vectors = assertVectors(
            payload.embeddings?.map((e) => e.values),
            texts.length,
          );
          return vectors.map(normaliseVector);
        },
        DEFAULT_TIMEOUT_MS,
        signal,
      ),
    );
  }

  async healthCheck(): Promise<EmbeddingHealth> {
    return remoteHealthCheck(this, () => this.embed(['health check']));
  }
}

// ---------------------------------------------------------------------------
// Hugging Face
// ---------------------------------------------------------------------------

export class HuggingFaceEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'huggingface' as const;
  readonly model: string;
  readonly nativeDimensions = 384;
  readonly supportsDimensionRequest = false;
  readonly isDemo = false;

  constructor(private readonly config: RemoteConfig) {
    this.model = config.model || 'sentence-transformers/all-MiniLM-L6-v2';
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    if (!this.config.apiKey) {
      throw new EmbeddingError('HUGGINGFACE_API_KEY is not configured.', 'configuration', false);
    }
    return withRetry(async () =>
      withTimeout(
        async (timeoutSignal) => {
          const response = await fetch(
            `https://api-inference.huggingface.co/pipeline/feature-extraction/${this.model}`,
            {
              method: 'POST',
              headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${this.config.apiKey}`,
              },
              body: JSON.stringify({ inputs: texts, options: { wait_for_model: true } }),
              signal: timeoutSignal,
            },
          );
          if (!response.ok) {
            const { kind, retryable } = classifyStatus(response.status);
            throw new EmbeddingError(
              `Hugging Face embeddings returned HTTP ${response.status}.`,
              kind,
              retryable,
            );
          }
          const payload = (await response.json()) as number[][];
          return assertVectors(payload, texts.length).map(normaliseVector);
        },
        60_000, // cold model loads are slow on the free inference endpoint
        signal,
      ),
    );
  }

  async healthCheck(): Promise<EmbeddingHealth> {
    return remoteHealthCheck(this, () => this.embed(['health check']));
  }
}

// ---------------------------------------------------------------------------
// Ollama (local)
// ---------------------------------------------------------------------------

export class OllamaEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'ollama' as const;
  readonly model: string;
  readonly nativeDimensions = 768;
  readonly supportsDimensionRequest = false;
  readonly isDemo = false;

  constructor(private readonly config: RemoteConfig) {
    this.model = config.model || 'nomic-embed-text';
  }

  async embed(texts: string[], signal?: AbortSignal): Promise<number[][]> {
    const base = this.config.baseUrl;
    if (!base) {
      throw new EmbeddingError('OLLAMA_BASE_URL is not configured.', 'configuration', false);
    }
    return withRetry(async () =>
      withTimeout(
        async (timeoutSignal) => {
          const response = await fetch(`${base.replace(/\/$/, '')}/api/embed`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: this.model, input: texts }),
            signal: timeoutSignal,
          });
          if (!response.ok) {
            const { kind, retryable } = classifyStatus(response.status);
            throw new EmbeddingError(
              `Ollama embeddings returned HTTP ${response.status}.`,
              kind,
              retryable,
            );
          }
          const payload = (await response.json()) as { embeddings?: number[][] };
          return assertVectors(payload.embeddings, texts.length).map(normaliseVector);
        },
        120_000,
        signal,
      ),
    );
  }

  async healthCheck(): Promise<EmbeddingHealth> {
    return remoteHealthCheck(this, () => this.embed(['health check']));
  }
}

// ---------------------------------------------------------------------------

async function remoteHealthCheck(
  provider: { name: EmbeddingProviderName; model: string },
  probe: () => Promise<number[][]>,
): Promise<EmbeddingHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const vectors = await probe();
    if (vectors.length !== 1 || vectors[0].length === 0) {
      return {
        status: 'degraded',
        detail: `${provider.name} responded but returned an unexpected payload shape.`,
        checkedAt,
      };
    }
    return {
      status: 'operational',
      detail: `${provider.name} responded successfully using ${provider.model}.`,
      checkedAt,
    };
  } catch (error) {
    if (error instanceof EmbeddingError && error.kind === 'configuration') {
      return { status: 'misconfigured', detail: error.message, checkedAt };
    }
    if (error instanceof EmbeddingError && error.kind === 'auth') {
      return {
        status: 'misconfigured',
        detail: `${provider.name} rejected the configured credential.`,
        checkedAt,
      };
    }
    return {
      status: 'unavailable',
      detail: `${provider.name} could not be reached.`,
      checkedAt,
    };
  }
}
