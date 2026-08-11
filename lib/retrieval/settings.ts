import { z } from 'zod';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';

/**
 * Runtime-tunable retrieval configuration with 30-second in-memory cache.
 */

export const RETRIEVAL_SETTINGS_KEY = 'retrieval.configuration';

export const retrievalSettingsSchema = z
  .object({
    chunkSize: z.number().int().min(200).max(4000),
    chunkOverlap: z.number().int().min(0).max(1000),
    retrievalCount: z.number().int().min(1).max(50),
    rerankCount: z.number().int().min(1).max(25),
    confidenceThreshold: z.number().min(0).max(1),
    citationCount: z.number().int().min(1).max(10),
    hybridSearch: z.boolean(),
    queryRewriting: z.boolean(),
    conversationHistoryLength: z.number().int().min(0).max(20),
  })
  .refine((value) => value.chunkOverlap < value.chunkSize, {
    message: 'Chunk overlap must be smaller than chunk size.',
    path: ['chunkOverlap'],
  })
  .refine((value) => value.rerankCount <= value.retrievalCount, {
    message: 'Rerank count cannot exceed retrieval count.',
    path: ['rerankCount'],
  })
  .refine((value) => value.citationCount <= value.rerankCount, {
    message: 'Citation count cannot exceed rerank count.',
    path: ['citationCount'],
  });

export type RetrievalSettings = z.infer<typeof retrievalSettingsSchema>;

export function defaultRetrievalSettings(): RetrievalSettings {
  const config = env();
  return {
    chunkSize: config.DEFAULT_CHUNK_SIZE,
    chunkOverlap: config.DEFAULT_CHUNK_OVERLAP,
    retrievalCount: config.DEFAULT_RETRIEVAL_COUNT,
    rerankCount: config.DEFAULT_RERANK_COUNT,
    confidenceThreshold: config.DEFAULT_CONFIDENCE_THRESHOLD,
    citationCount: Math.min(4, config.DEFAULT_RERANK_COUNT),
    hybridSearch: true,
    queryRewriting: true,
    conversationHistoryLength: 6,
  };
}

let cachedRetrievalSettings: RetrievalSettings | null = null;
let retrievalCacheExpiry = 0;

export async function getRetrievalSettings(): Promise<RetrievalSettings> {
  const now = Date.now();
  if (cachedRetrievalSettings && now < retrievalCacheExpiry) {
    return cachedRetrievalSettings;
  }

  const defaults = defaultRetrievalSettings();
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: RETRIEVAL_SETTINGS_KEY } });
    if (!row) {
      cachedRetrievalSettings = defaults;
      retrievalCacheExpiry = now + 30_000;
      return defaults;
    }
    const parsed = retrievalSettingsSchema.safeParse(row.value);
    const settings = parsed.success ? parsed.data : defaults;
    cachedRetrievalSettings = settings;
    retrievalCacheExpiry = now + 30_000;
    return settings;
  } catch {
    return defaults;
  }
}

export async function saveRetrievalSettings(
  input: unknown,
  updatedBy?: string,
): Promise<{ ok: true; settings: RetrievalSettings } | { ok: false; errors: string[] }> {
  const parsed = retrievalSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`,
      ),
    };
  }

  await prisma.systemSetting.upsert({
    where: { key: RETRIEVAL_SETTINGS_KEY },
    create: { key: RETRIEVAL_SETTINGS_KEY, value: parsed.data, updatedBy },
    update: { value: parsed.data, updatedBy },
  });

  cachedRetrievalSettings = parsed.data;
  retrievalCacheExpiry = Date.now() + 30_000;

  return { ok: true, settings: parsed.data };
}

// ---------------------------------------------------------------------------
// Model provider selection
// ---------------------------------------------------------------------------

export const MODEL_SETTINGS_KEY = 'models.configuration';

export const modelSettingsSchema = z.object({
  llmProviderOverride: z.string().max(40),
  embeddingProviderOverride: z.string().max(40),
  maxAnswerTokens: z.number().int().min(128).max(4096),
  temperature: z.number().min(0).max(1),
});

export type ModelSettings = z.infer<typeof modelSettingsSchema>;

export function defaultModelSettings(): ModelSettings {
  return {
    llmProviderOverride: '',
    embeddingProviderOverride: '',
    maxAnswerTokens: 900,
    temperature: 0.1,
  };
}

let cachedModelSettings: ModelSettings | null = null;
let modelCacheExpiry = 0;

export async function getModelSettings(): Promise<ModelSettings> {
  const now = Date.now();
  if (cachedModelSettings && now < modelCacheExpiry) {
    return cachedModelSettings;
  }

  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: MODEL_SETTINGS_KEY } });
    if (!row) {
      cachedModelSettings = defaultModelSettings();
      modelCacheExpiry = now + 30_000;
      return cachedModelSettings;
    }
    const parsed = modelSettingsSchema.safeParse(row.value);
    const settings = parsed.success ? parsed.data : defaultModelSettings();
    cachedModelSettings = settings;
    modelCacheExpiry = now + 30_000;
    return settings;
  } catch {
    return defaultModelSettings();
  }
}

export async function saveModelSettings(
  input: unknown,
  updatedBy?: string,
): Promise<{ ok: true; settings: ModelSettings } | { ok: false; errors: string[] }> {
  const parsed = modelSettingsSchema.safeParse(input);
  if (!parsed.success) {
    return {
      ok: false,
      errors: parsed.error.issues.map(
        (issue) => `${issue.path.join('.') || 'value'}: ${issue.message}`,
      ),
    };
  }
  await prisma.systemSetting.upsert({
    where: { key: MODEL_SETTINGS_KEY },
    create: { key: MODEL_SETTINGS_KEY, value: parsed.data, updatedBy },
    update: { value: parsed.data, updatedBy },
  });

  cachedModelSettings = parsed.data;
  modelCacheExpiry = Date.now() + 30_000;

  return { ok: true, settings: parsed.data };
}
