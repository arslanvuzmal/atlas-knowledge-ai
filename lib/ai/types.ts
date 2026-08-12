import type { LlmProviderName } from '@/lib/env';

export interface ChatMessage {
  role: 'system' | 'user' | 'assistant';
  content: string;
}

export interface GenerationRequest {
  system: string;
  messages: ChatMessage[];
  maxTokens: number;
  temperature: number;
  enableLiveSearch?: boolean;
  signal?: AbortSignal;
}

export interface GenerationResult {
  text: string;
  provider: LlmProviderName;
  model: string;
  latencyMs: number;
  isDemo: boolean;
  sources?: Array<{ title: string; domain: string; uri: string }>;
  /** Populated when the provider reports usage. */
  usage?: { inputTokens?: number; outputTokens?: number };
}

export interface LlmHealth {
  status: 'operational' | 'demo' | 'degraded' | 'misconfigured' | 'unavailable';
  detail: string;
  checkedAt: string;
}

export interface LlmProvider {
  readonly name: LlmProviderName;
  readonly model: string;
  readonly isDemo: boolean;
  generate(request: GenerationRequest): Promise<GenerationResult>;
  healthCheck(): Promise<LlmHealth>;
}

export class LlmError extends Error {
  constructor(
    message: string,
    public readonly kind:
      | 'auth'
      | 'rate_limit'
      | 'timeout'
      | 'server'
      | 'invalid_response'
      | 'content_filter'
      | 'context_length'
      | 'network'
      | 'configuration',
    public readonly retryable: boolean,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}

/** Maps a provider failure onto a message that is safe to show a user. */
export function publicMessageForLlmError(error: unknown): string {
  if (!(error instanceof LlmError)) {
    return 'The assistant could not generate an answer. Please try again.';
  }
  switch (error.kind) {
    case 'timeout':
      return 'The assistant took too long to respond. Please try again.';
    case 'rate_limit':
      return 'The assistant is handling too many requests right now. Please try again shortly.';
    case 'configuration':
    case 'auth':
      return 'The language model provider is not correctly configured. An administrator has been notified.';
    case 'context_length':
      return 'That question needed more context than the model can accept. Try asking something more specific.';
    case 'content_filter':
      return 'The provider declined to answer that request.';
    default:
      return 'The assistant could not generate an answer. Please try again.';
  }
}
