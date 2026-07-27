import { z } from 'zod';
import { prisma } from '@/lib/database/client';
import { env } from '@/lib/env';

/**
 * Runtime-tunable retrieval configuration.
 *
 * Defaults come from the environment; an administrator can override them at
 * runtime through the retrieval settings page, and the override is persisted in
 * SystemSetting. Values are validated on write *and* on read, so a hand-edited
 * database row cannot put the pipeline into an impossible state.
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

export async function getRetrievalSettings(): Promise<RetrievalSettings> {
  const defaults = defaultRetrievalSettings();
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: RETRIEVAL_SETTINGS_KEY } });
    if (!row) return defaults;
    const parsed = retrievalSettingsSchema.safeParse(row.value);
    // A stored value that no longer validates is ignored rather than obeyed.
    return parsed.success ? parsed.data : defaults;
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

  return { ok: true, settings: parsed.data };
}

// ---------------------------------------------------------------------------
// Model provider selection
// ---------------------------------------------------------------------------

export const MODEL_SETTINGS_KEY = 'models.configuration';

export const modelSettingsSchema = z.object({
  /** Empty string means "follow the environment variable". */
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

export async function getModelSettings(): Promise<ModelSettings> {
  try {
    const row = await prisma.systemSetting.findUnique({ where: { key: MODEL_SETTINGS_KEY } });
    if (!row) return defaultModelSettings();
    const parsed = modelSettingsSchema.safeParse(row.value);
    return parsed.success ? parsed.data : defaultModelSettings();
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
  return { ok: true, settings: parsed.data };
}
