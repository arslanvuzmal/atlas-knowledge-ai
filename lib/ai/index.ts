import { env, type LlmProviderName } from '@/lib/env';
import { DemoLlmProvider } from '@/lib/ai/demo';
import {
  AnthropicLlmProvider,
  GeminiLlmProvider,
  OllamaLlmProvider,
  OpenAiLlmProvider,
  OpenRouterLlmProvider,
} from '@/lib/ai/remote';
import type { LlmProvider } from '@/lib/ai/types';

/**
 * Language-model provider registry.
 *
 * Selection is driven by `LLM_PROVIDER`, optionally overridden at runtime by an
 * administrator through the models settings page. An override that names a
 * provider whose credential is absent is ignored rather than obeyed, because
 * silently failing every chat request is worse than continuing on the
 * configured default.
 */

let cached: LlmProvider | null = null;
let cachedKey = '';

function credentialPresent(name: LlmProviderName): boolean {
  const config = env();
  switch (name) {
    case 'demo':
      return true;
    case 'openai':
      return Boolean(config.OPENAI_API_KEY);
    case 'anthropic':
      return Boolean(config.ANTHROPIC_API_KEY);
    case 'gemini':
      return Boolean(config.GEMINI_API_KEY);
    case 'openrouter':
      return Boolean(config.OPENROUTER_API_KEY);
    case 'ollama':
      return Boolean(config.OLLAMA_BASE_URL);
    default:
      return false;
  }
}

function construct(name: LlmProviderName): LlmProvider {
  const config = env();
  const shared = { model: config.LLM_MODEL, appUrl: config.APP_URL };

  switch (name) {
    case 'openai':
      return new OpenAiLlmProvider({ ...shared, apiKey: config.OPENAI_API_KEY });
    case 'anthropic':
      return new AnthropicLlmProvider({ ...shared, apiKey: config.ANTHROPIC_API_KEY });
    case 'gemini':
      return new GeminiLlmProvider({ ...shared, apiKey: config.GEMINI_API_KEY });
    case 'openrouter':
      return new OpenRouterLlmProvider({ ...shared, apiKey: config.OPENROUTER_API_KEY });
    case 'ollama':
      return new OllamaLlmProvider({ ...shared, baseUrl: config.OLLAMA_BASE_URL });
    case 'demo':
    default:
      return new DemoLlmProvider();
  }
}

export function resolveLlmProviderName(override?: string | null): LlmProviderName {
  const configured = env().LLM_PROVIDER;
  const candidate = (override ?? '').trim() as LlmProviderName;
  if (candidate && candidate !== configured && credentialPresent(candidate)) {
    return candidate;
  }
  return configured;
}

export function getLlmProvider(override?: string | null): LlmProvider {
  const name = resolveLlmProviderName(override);
  const key = `${name}:${env().LLM_MODEL ?? ''}`;
  if (cached && cachedKey === key) return cached;
  cached = construct(name);
  cachedKey = key;
  return cached;
}

export function resetLlmProviderCache(): void {
  cached = null;
  cachedKey = '';
}

export { DemoLlmProvider } from '@/lib/ai/demo';
export * from '@/lib/ai/types';
