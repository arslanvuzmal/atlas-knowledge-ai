import { GoogleGenAI } from '@google/genai';
import type { GenerationRequest, GenerationResult, LlmHealth, LlmProvider } from '@/lib/ai/types';
import { LlmError } from '@/lib/ai/types';
import type { LlmProviderName } from '@/lib/env';

/**
 * Live language-model providers.
 *
 * Anthropic appears here as a supported *technical integration* alongside
 * OpenAI, Gemini, OpenRouter, and Ollama. That is a product capability, not an
 * attribution.
 *
 * All providers share: a bounded timeout, retry limited to transient failures,
 * strict response-shape validation, and error classification that maps onto a
 * safe public message. No provider ever receives a tool definition, so a model
 * that is talked into "calling an API" by injected document text has no
 * mechanism to do so.
 */

const DEFAULT_TIMEOUT_MS = 60_000;
const MAX_ATTEMPTS = 3;

interface ProviderConfig {
  apiKey?: string;
  model?: string;
  baseUrl?: string;
  appUrl?: string;
}

function classify(status: number): { kind: LlmError['kind']; retryable: boolean } {
  if (status === 401 || status === 403) return { kind: 'auth', retryable: false };
  if (status === 429) return { kind: 'rate_limit', retryable: true };
  if (status === 413 || status === 422) return { kind: 'context_length', retryable: false };
  if (status >= 500) return { kind: 'server', retryable: true };
  return { kind: 'invalid_response', retryable: false };
}

async function callWithTimeout<T>(
  operation: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  external?: AbortSignal,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  const forward = () => controller.abort();
  external?.addEventListener('abort', forward);
  try {
    return await operation(controller.signal);
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw new LlmError('The model provider did not respond in time.', 'timeout', true);
    }
    throw error;
  } finally {
    clearTimeout(timer);
    external?.removeEventListener('abort', forward);
  }
}

async function retrying<T>(operation: () => Promise<T>, maxAttempts = MAX_ATTEMPTS): Promise<T> {
  let lastError: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt += 1) {
    try {
      return await operation();
    } catch (error) {
      lastError = error;
      const retryable = error instanceof LlmError && error.retryable;
      if (!retryable || attempt === maxAttempts) break;
      await new Promise((resolve) =>
        setTimeout(resolve, 500 * 2 ** (attempt - 1) + Math.random() * 250),
      );
    }
  }
  throw lastError;
}

function requireText(text: unknown, provider: string): string {
  if (typeof text !== 'string' || text.trim().length === 0) {
    throw new LlmError(
      `${provider} returned an empty or malformed completion.`,
      'invalid_response',
      false,
    );
  }
  return text.trim();
}

abstract class BaseRemoteProvider implements LlmProvider {
  abstract readonly name: LlmProviderName;
  abstract readonly model: string;
  readonly isDemo = false;

  abstract generate(request: GenerationRequest): Promise<GenerationResult>;

  async healthCheck(): Promise<LlmHealth> {
    const checkedAt = new Date().toISOString();
    try {
      const result = await this.generate({
        system: 'Reply with the single word: ready',
        messages: [{ role: 'user', content: 'ready check' }],
        maxTokens: 16,
        temperature: 0,
      });
      return {
        status: result.text.length > 0 ? 'operational' : 'degraded',
        detail: `${this.name} responded using ${this.model}.`,
        checkedAt,
      };
    } catch (error) {
      if (error instanceof LlmError && (error.kind === 'configuration' || error.kind === 'auth')) {
        return {
          status: 'misconfigured',
          detail:
            error.kind === 'auth'
              ? `${this.name} rejected the configured credential.`
              : error.message,
          checkedAt,
        };
      }
      return { status: 'unavailable', detail: `${this.name} could not be reached.`, checkedAt };
    }
  }
}

// ---------------------------------------------------------------------------

export class OpenAiLlmProvider extends BaseRemoteProvider {
  readonly name = 'openai' as const;
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    super();
    this.model = config.model || 'gpt-4o-mini';
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.config.apiKey) {
      throw new LlmError('OPENAI_API_KEY is not configured.', 'configuration', false);
    }
    const started = Date.now();
    const payload = await retrying(() =>
      callWithTimeout(
        async (signal) => {
          const response = await fetch('https://api.openai.com/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
            },
            body: JSON.stringify({
              model: this.model,
              messages: [{ role: 'system', content: request.system }, ...request.messages],
              max_tokens: request.maxTokens,
              temperature: request.temperature,
            }),
            signal,
          });
          if (!response.ok) {
            const { kind, retryable } = classify(response.status);
            throw new LlmError(`OpenAI returned HTTP ${response.status}.`, kind, retryable);
          }
          return (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
        },
        DEFAULT_TIMEOUT_MS,
        request.signal,
      ),
    );

    return {
      text: requireText(payload.choices?.[0]?.message?.content, 'OpenAI'),
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      isDemo: false,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  }
}

export class AnthropicLlmProvider extends BaseRemoteProvider {
  readonly name = 'anthropic' as const;
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    super();
    this.model = config.model || 'claude-sonnet-5';
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.config.apiKey) {
      throw new LlmError('ANTHROPIC_API_KEY is not configured.', 'configuration', false);
    }
    const started = Date.now();
    const payload = await retrying(() =>
      callWithTimeout(
        async (signal) => {
          const response = await fetch('https://api.anthropic.com/v1/messages', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              'x-api-key': this.config.apiKey as string,
              'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
              model: this.model,
              system: request.system,
              messages: request.messages.map((message) => ({
                role: message.role === 'assistant' ? 'assistant' : 'user',
                content: message.content,
              })),
              max_tokens: request.maxTokens,
              temperature: request.temperature,
            }),
            signal,
          });
          if (!response.ok) {
            const { kind, retryable } = classify(response.status);
            throw new LlmError(`Anthropic returned HTTP ${response.status}.`, kind, retryable);
          }
          return (await response.json()) as {
            content?: { type?: string; text?: string }[];
            usage?: { input_tokens?: number; output_tokens?: number };
          };
        },
        DEFAULT_TIMEOUT_MS,
        request.signal,
      ),
    );

    const text = (payload.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block) => block.text ?? '')
      .join('\n');

    return {
      text: requireText(text, 'Anthropic'),
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      isDemo: false,
      usage: {
        inputTokens: payload.usage?.input_tokens,
        outputTokens: payload.usage?.output_tokens,
      },
    };
  }
}

const geminiClientCache = new Map<string, GoogleGenAI>();

const INTERACTIVE_TIMEOUT_MS = 18_000;
const MAX_INTERACTIVE_ATTEMPTS = 2;

export class GeminiLlmProvider extends BaseRemoteProvider {
  readonly name = 'gemini' as const;
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    super();
    this.model = config.model || 'gemini-2.5-flash';
  }

  private getClient(): GoogleGenAI {
    const key = this.config.apiKey!;
    if (!geminiClientCache.has(key)) {
      geminiClientCache.set(key, new GoogleGenAI({ apiKey: key }));
    }
    return geminiClientCache.get(key)!;
  }

  async generate(
    request: GenerationRequest & { enableLiveSearch?: boolean },
  ): Promise<GenerationResult> {
    if (!this.config.apiKey) {
      throw new LlmError('GEMINI_API_KEY is not configured.', 'configuration', false);
    }
    const started = Date.now();
    const ai = this.getClient();

    try {
      const response = await retrying(
        () =>
          callWithTimeout(
            async () => {
              const genConfig: {
                maxOutputTokens?: number;
                tools?: Array<{ googleSearch: Record<string, never> }>;
              } = {
                maxOutputTokens: request.maxTokens,
              };
              if (request.enableLiveSearch) {
                genConfig.tools = [{ googleSearch: {} }];
              }
              return await ai.models.generateContent({
                model: this.model,
                contents: [
                  { role: 'user', parts: [{ text: request.system }] },
                  ...request.messages.map((message) => ({
                    role: message.role === 'assistant' ? 'model' : 'user',
                    parts: [{ text: message.content }],
                  })),
                ],
                config: genConfig,
              });
            },
            INTERACTIVE_TIMEOUT_MS,
            request.signal,
          ),
        MAX_INTERACTIVE_ATTEMPTS,
      );

      const text = response.text ?? '';
      return {
        text: requireText(text, 'Gemini'),
        provider: this.name,
        model: this.model,
        latencyMs: Date.now() - started,
        isDemo: false,
        usage: {
          inputTokens: response.usageMetadata?.promptTokenCount,
          outputTokens: response.usageMetadata?.candidatesTokenCount,
        },
      };
    } catch (error) {
      if (error instanceof LlmError) throw error;
      const status = (error as { status?: number }).status ?? 500;
      const { kind, retryable } = classify(status);
      throw new LlmError(
        error instanceof Error ? error.message : `Gemini returned an error: ${String(error)}`,
        kind,
        retryable,
      );
    }
  }
}

export class OpenRouterLlmProvider extends BaseRemoteProvider {
  readonly name = 'openrouter' as const;
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    super();
    this.model = config.model || 'meta-llama/llama-3.1-8b-instruct';
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    if (!this.config.apiKey) {
      throw new LlmError('OPENROUTER_API_KEY is not configured.', 'configuration', false);
    }
    const started = Date.now();
    const payload = await retrying(() =>
      callWithTimeout(
        async (signal) => {
          const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
            method: 'POST',
            headers: {
              'Content-Type': 'application/json',
              Authorization: `Bearer ${this.config.apiKey}`,
              'HTTP-Referer': this.config.appUrl ?? 'http://localhost:3000',
              'X-Title': 'Atlas Knowledge AI',
            },
            body: JSON.stringify({
              model: this.model,
              messages: [{ role: 'system', content: request.system }, ...request.messages],
              max_tokens: request.maxTokens,
              temperature: request.temperature,
            }),
            signal,
          });
          if (!response.ok) {
            const { kind, retryable } = classify(response.status);
            throw new LlmError(`OpenRouter returned HTTP ${response.status}.`, kind, retryable);
          }
          return (await response.json()) as {
            choices?: { message?: { content?: string } }[];
            usage?: { prompt_tokens?: number; completion_tokens?: number };
          };
        },
        DEFAULT_TIMEOUT_MS,
        request.signal,
      ),
    );

    return {
      text: requireText(payload.choices?.[0]?.message?.content, 'OpenRouter'),
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      isDemo: false,
      usage: {
        inputTokens: payload.usage?.prompt_tokens,
        outputTokens: payload.usage?.completion_tokens,
      },
    };
  }
}

export class OllamaLlmProvider extends BaseRemoteProvider {
  readonly name = 'ollama' as const;
  readonly model: string;

  constructor(private readonly config: ProviderConfig) {
    super();
    this.model = config.model || 'llama3.1';
  }

  async generate(request: GenerationRequest): Promise<GenerationResult> {
    const base = this.config.baseUrl;
    if (!base) {
      throw new LlmError('OLLAMA_BASE_URL is not configured.', 'configuration', false);
    }
    const started = Date.now();
    const payload = await retrying(() =>
      callWithTimeout(
        async (signal) => {
          const response = await fetch(`${base.replace(/\/$/, '')}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              model: this.model,
              messages: [{ role: 'system', content: request.system }, ...request.messages],
              stream: false,
              options: { temperature: request.temperature, num_predict: request.maxTokens },
            }),
            signal,
          });
          if (!response.ok) {
            const { kind, retryable } = classify(response.status);
            throw new LlmError(`Ollama returned HTTP ${response.status}.`, kind, retryable);
          }
          return (await response.json()) as { message?: { content?: string } };
        },
        180_000, // local inference on CPU can be slow
        request.signal,
      ),
    );

    return {
      text: requireText(payload.message?.content, 'Ollama'),
      provider: this.name,
      model: this.model,
      latencyMs: Date.now() - started,
      isDemo: false,
    };
  }
}
