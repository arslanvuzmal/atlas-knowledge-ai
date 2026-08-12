import { z } from 'zod';

/**
 * Central environment validation.
 *
 * Parsing happens once, lazily, and the result is cached. Anything that reads
 * configuration goes through `env()` rather than touching `process.env`, so a
 * misconfigured deployment fails loudly at first use instead of producing
 * subtly wrong behaviour deep inside the retrieval pipeline.
 */

const boolish = (defaultValue: boolean) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      return ['true', '1', 'yes', 'on'].includes(value.trim().toLowerCase());
    });

const intish = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const parsed = Number.parseInt(value, 10);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    })
    .pipe(z.number().int().min(min).max(max));

const floatish = (defaultValue: number, min: number, max: number) =>
  z
    .string()
    .optional()
    .transform((value) => {
      if (value === undefined || value.trim() === '') return defaultValue;
      const parsed = Number.parseFloat(value);
      return Number.isFinite(parsed) ? parsed : defaultValue;
    })
    .pipe(z.number().min(min).max(max));

export const EMBEDDING_PROVIDERS = ['demo', 'openai', 'google', 'huggingface', 'ollama'] as const;
export const LLM_PROVIDERS = [
  'demo',
  'openai',
  'anthropic',
  'gemini',
  'openrouter',
  'ollama',
] as const;

export type EmbeddingProviderName = (typeof EMBEDDING_PROVIDERS)[number];
export type LlmProviderName = (typeof LLM_PROVIDERS)[number];

const optionalSecret = z
  .string()
  .optional()
  .transform((v) => (v && v.trim() !== '' ? v.trim() : undefined));

const schema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),

  DATABASE_URL: z.string().min(1, 'DATABASE_URL is required'),
  DIRECT_URL: z.string().optional(),

  DEMO_MODE: boolish(true),

  APP_URL: z.string().url().default('http://localhost:3000'),

  // 32 characters is the floor for the HMAC keys these secrets back.
  AUTH_SECRET: z.string().min(32, 'AUTH_SECRET must be at least 32 characters'),
  INTERNAL_API_SECRET: z.string().min(32, 'INTERNAL_API_SECRET must be at least 32 characters'),

  STORAGE_PROVIDER: z.enum(['local', 'supabase']).default('local'),
  LOCAL_STORAGE_ROOT: z.string().default('./storage'),
  SUPABASE_URL: optionalSecret,
  SUPABASE_ANON_KEY: optionalSecret,
  SUPABASE_SERVICE_ROLE_KEY: optionalSecret,
  SUPABASE_STORAGE_BUCKET: z.string().default('atlas-documents'),

  EMBEDDING_PROVIDER: z.enum(EMBEDDING_PROVIDERS).default('demo'),
  LLM_PROVIDER: z.enum(LLM_PROVIDERS).default('demo'),
  EMBEDDING_DIMENSIONS: intish(768, 64, 4096),
  EMBEDDING_MODEL: optionalSecret,
  LLM_MODEL: optionalSecret,

  OPENAI_API_KEY: optionalSecret,
  ANTHROPIC_API_KEY: optionalSecret,
  GEMINI_API_KEY: optionalSecret,
  GOOGLE_GENERATIVE_AI_API_KEY: optionalSecret,
  GOOGLE_API_KEY: optionalSecret,
  OPENROUTER_API_KEY: optionalSecret,
  HUGGINGFACE_API_KEY: optionalSecret,
  OLLAMA_BASE_URL: optionalSecret,

  WORKER_URL: optionalSecret,
  WORKER_INTERNAL_SECRET: optionalSecret,

  RATE_LIMIT_BACKEND: z.enum(['memory', 'database']).default('memory'),

  RETENTION_CONVERSATIONS_DAYS: intish(365, 1, 3650),
  RETENTION_RETRIEVAL_LOGS_DAYS: intish(90, 1, 3650),
  RETENTION_AUDIT_LOGS_DAYS: intish(365, 1, 3650),
  RETENTION_FEEDBACK_DAYS: intish(365, 1, 3650),
  RETENTION_ESCALATIONS_DAYS: intish(365, 1, 3650),
  RETENTION_MESSAGES_DAYS: intish(365, 1, 3650),

  MAX_UPLOAD_SIZE_MB: intish(15, 1, 100),
  DEFAULT_CHUNK_SIZE: intish(800, 200, 4000),
  DEFAULT_CHUNK_OVERLAP: intish(120, 0, 1000),
  DEFAULT_RETRIEVAL_COUNT: intish(10, 1, 50),
  DEFAULT_RERANK_COUNT: intish(5, 1, 25),
  DEFAULT_CONFIDENCE_THRESHOLD: floatish(0.65, 0, 1),

  ALLOW_PRODUCTION_SEED: boolish(false),
});

export type Env = z.infer<typeof schema>;

let cached: Env | null = null;

export class EnvironmentError extends Error {
  constructor(public readonly issues: string[]) {
    super(`Invalid environment configuration:\n  - ${issues.join('\n  - ')}`);
    this.name = 'EnvironmentError';
  }
}

/**
 * Validates process.env. Throws EnvironmentError listing every problem at once
 * rather than failing on the first missing value.
 */
export function parseEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const result = schema.safeParse(source);
  if (!result.success) {
    const issues = result.error.issues.map((issue) => {
      const path = issue.path.join('.') || '(root)';
      return `${path}: ${issue.message}`;
    });
    throw new EnvironmentError(issues);
  }

  const parsed = result.data;

  // Populate GEMINI_API_KEY fallback
  if (!parsed.GEMINI_API_KEY) {
    parsed.GEMINI_API_KEY = parsed.GOOGLE_GENERATIVE_AI_API_KEY ?? parsed.GOOGLE_API_KEY;
  }

  // Cross-field rules that a per-field schema cannot express.
  const crossFieldIssues: string[] = [];

  if (parsed.DEFAULT_CHUNK_OVERLAP >= parsed.DEFAULT_CHUNK_SIZE) {
    crossFieldIssues.push(
      'DEFAULT_CHUNK_OVERLAP must be smaller than DEFAULT_CHUNK_SIZE, otherwise chunking cannot advance',
    );
  }
  if (parsed.DEFAULT_RERANK_COUNT > parsed.DEFAULT_RETRIEVAL_COUNT) {
    crossFieldIssues.push(
      'DEFAULT_RERANK_COUNT cannot exceed DEFAULT_RETRIEVAL_COUNT: reranking only reorders what was retrieved',
    );
  }
  if (parsed.STORAGE_PROVIDER === 'supabase') {
    if (!parsed.SUPABASE_URL)
      crossFieldIssues.push('SUPABASE_URL is required when STORAGE_PROVIDER=supabase');
    if (!parsed.SUPABASE_SERVICE_ROLE_KEY)
      crossFieldIssues.push('SUPABASE_SERVICE_ROLE_KEY is required when STORAGE_PROVIDER=supabase');
  }

  // A live provider without its credential would silently fall back at request
  // time, which is exactly the kind of "claims a feature it does not have"
  // behaviour this project must avoid.
  const requiredKey: Partial<Record<string, keyof Env>> = {
    openai: 'OPENAI_API_KEY',
    google: 'GEMINI_API_KEY',
    huggingface: 'HUGGINGFACE_API_KEY',
    anthropic: 'ANTHROPIC_API_KEY',
    gemini: 'GEMINI_API_KEY',
    openrouter: 'OPENROUTER_API_KEY',
  };

  const embeddingKey = requiredKey[parsed.EMBEDDING_PROVIDER];
  if (embeddingKey && !parsed[embeddingKey]) {
    crossFieldIssues.push(
      `${embeddingKey} is required when EMBEDDING_PROVIDER=${parsed.EMBEDDING_PROVIDER}`,
    );
  }
  if (parsed.EMBEDDING_PROVIDER === 'ollama' && !parsed.OLLAMA_BASE_URL) {
    crossFieldIssues.push('OLLAMA_BASE_URL is required when EMBEDDING_PROVIDER=ollama');
  }

  const llmKey = requiredKey[parsed.LLM_PROVIDER];
  if (llmKey && !parsed[llmKey]) {
    crossFieldIssues.push(`${llmKey} is required when LLM_PROVIDER=${parsed.LLM_PROVIDER}`);
  }
  if (parsed.LLM_PROVIDER === 'ollama' && !parsed.OLLAMA_BASE_URL) {
    crossFieldIssues.push('OLLAMA_BASE_URL is required when LLM_PROVIDER=ollama');
  }

  if (parsed.NODE_ENV === 'production' && parsed.DATABASE_URL.startsWith('file:')) {
    crossFieldIssues.push('SQLite (file:) database URLs are not supported in production');
  }

  if (crossFieldIssues.length > 0) {
    throw new EnvironmentError(crossFieldIssues);
  }

  return parsed;
}

export function env(): Env {
  if (!cached) {
    cached = parseEnv();
  }
  return cached;
}

/** Test-only: clears the memoised environment. */
export function resetEnvCache(): void {
  cached = null;
}

export function isDemoMode(): boolean {
  return env().DEMO_MODE;
}
