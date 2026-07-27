import { prisma } from '@/lib/database/client';
import { checkVectorExtension, countEmbeddedChunks } from '@/lib/database/vector';
import { getEmbeddingProvider } from '@/lib/embeddings';
import { getLlmProvider } from '@/lib/ai';
import { getStorage } from '@/lib/storage';
import { env } from '@/lib/env';

/**
 * System health.
 *
 * Every component reports a state that reflects an *actual check performed just
 * now*. Nothing defaults to "operational". A component that could not be
 * probed reports UNAVAILABLE, and a component intentionally running without
 * external credentials reports DEMO rather than pretending to be production.
 */

export type HealthState = 'OPERATIONAL' | 'DEMO' | 'DEGRADED' | 'MISCONFIGURED' | 'UNAVAILABLE';

export interface ComponentHealth {
  name: string;
  state: HealthState;
  detail: string;
  latencyMs: number | null;
  metadata?: Record<string, string | number | boolean | null>;
}

export interface SystemHealth {
  overall: HealthState;
  demoMode: boolean;
  checkedAt: string;
  components: ComponentHealth[];
}

const STATE_SEVERITY: Record<HealthState, number> = {
  OPERATIONAL: 0,
  DEMO: 1,
  DEGRADED: 2,
  MISCONFIGURED: 3,
  UNAVAILABLE: 4,
};

function mapProviderStatus(status: string): HealthState {
  switch (status) {
    case 'operational':
      return 'OPERATIONAL';
    case 'demo':
      return 'DEMO';
    case 'degraded':
      return 'DEGRADED';
    case 'misconfigured':
      return 'MISCONFIGURED';
    default:
      return 'UNAVAILABLE';
  }
}

async function timed<T>(
  operation: () => Promise<T>,
): Promise<{ value: T | null; ms: number; error: unknown }> {
  const started = Date.now();
  try {
    const value = await operation();
    return { value, ms: Date.now() - started, error: null };
  } catch (error) {
    return { value: null, ms: Date.now() - started, error };
  }
}

async function checkDatabase(): Promise<ComponentHealth> {
  const probe = await timed(async () => {
    await prisma.$queryRaw`SELECT 1`;
    const extension = await checkVectorExtension();
    const embedded = await countEmbeddedChunks();
    const total = await prisma.documentChunk.count();
    return { extension, embedded, total };
  });

  if (probe.error || !probe.value) {
    return {
      name: 'PostgreSQL database',
      state: 'UNAVAILABLE',
      detail: 'The database did not respond to a health query.',
      latencyMs: probe.ms,
    };
  }

  const { extension, embedded, total } = probe.value;

  if (!extension.installed) {
    return {
      name: 'PostgreSQL database',
      state: 'MISCONFIGURED',
      detail:
        'Connected, but the pgvector extension is not installed. Vector retrieval cannot run until it is enabled.',
      latencyMs: probe.ms,
      metadata: { chunks: total, embeddedChunks: embedded },
    };
  }

  // Chunks without a vector are invisible to retrieval, which is a silent
  // correctness problem rather than an outage. It is reported as degraded.
  const missing = total - embedded;
  if (missing > 0) {
    return {
      name: 'PostgreSQL database',
      state: 'DEGRADED',
      detail: `${missing} of ${total} chunks have no embedding and cannot be retrieved. Reprocess the affected documents.`,
      latencyMs: probe.ms,
      metadata: {
        pgvector: extension.version ?? 'unknown',
        chunks: total,
        embeddedChunks: embedded,
      },
    };
  }

  return {
    name: 'PostgreSQL database',
    state: 'OPERATIONAL',
    detail: `Connected with pgvector ${extension.version ?? 'installed'}. ${embedded} chunks indexed.`,
    latencyMs: probe.ms,
    metadata: { pgvector: extension.version ?? 'unknown', chunks: total, embeddedChunks: embedded },
  };
}

async function checkEmbeddings(): Promise<ComponentHealth> {
  const provider = getEmbeddingProvider();
  const probe = await timed(() => provider.healthCheck());

  if (probe.error || !probe.value) {
    return {
      name: 'Embedding provider',
      state: 'UNAVAILABLE',
      detail: `${provider.name} could not be probed.`,
      latencyMs: probe.ms,
      metadata: { provider: provider.name, model: provider.model },
    };
  }

  return {
    name: 'Embedding provider',
    state: mapProviderStatus(probe.value.status),
    detail: probe.value.detail,
    latencyMs: probe.ms,
    metadata: {
      provider: provider.name,
      model: provider.model,
      dimensions: env().EMBEDDING_DIMENSIONS,
    },
  };
}

async function checkLlm(): Promise<ComponentHealth> {
  const provider = getLlmProvider();
  const probe = await timed(() => provider.healthCheck());

  if (probe.error || !probe.value) {
    return {
      name: 'Language model provider',
      state: 'UNAVAILABLE',
      detail: `${provider.name} could not be probed.`,
      latencyMs: probe.ms,
      metadata: { provider: provider.name, model: provider.model },
    };
  }

  return {
    name: 'Language model provider',
    state: mapProviderStatus(probe.value.status),
    detail: probe.value.detail,
    latencyMs: probe.ms,
    metadata: { provider: provider.name, model: provider.model },
  };
}

async function checkStorage(): Promise<ComponentHealth> {
  const probe = await timed(() => getStorage().healthCheck());

  if (probe.error || !probe.value) {
    return {
      name: 'Document storage',
      state: 'UNAVAILABLE',
      detail: 'The storage adapter could not be probed.',
      latencyMs: probe.ms,
    };
  }

  return {
    name: 'Document storage',
    state: mapProviderStatus(probe.value.status),
    detail: probe.value.detail,
    latencyMs: probe.ms,
    metadata: { provider: probe.value.provider },
  };
}

async function checkIngestionQueue(): Promise<ComponentHealth> {
  const probe = await timed(async () => {
    const [failed, running, stale] = await Promise.all([
      prisma.ingestionJob.count({ where: { status: 'FAILED' } }),
      prisma.ingestionJob.count({ where: { status: 'RUNNING' } }),
      prisma.ingestionJob.count({
        where: { status: 'RUNNING', startedAt: { lt: new Date(Date.now() - 15 * 60 * 1000) } },
      }),
    ]);
    return { failed, running, stale };
  });

  if (probe.error || !probe.value) {
    return {
      name: 'Ingestion pipeline',
      state: 'UNAVAILABLE',
      detail: 'Ingestion job state could not be read.',
      latencyMs: probe.ms,
    };
  }

  const { failed, running, stale } = probe.value;

  if (stale > 0) {
    return {
      name: 'Ingestion pipeline',
      state: 'DEGRADED',
      detail: `${stale} ingestion job(s) have been running for over 15 minutes and are likely stuck.`,
      latencyMs: probe.ms,
      metadata: { failed, running, stale },
    };
  }
  if (failed > 0) {
    return {
      name: 'Ingestion pipeline',
      state: 'DEGRADED',
      detail: `${failed} ingestion job(s) failed. They can be retried from the document library.`,
      latencyMs: probe.ms,
      metadata: { failed, running, stale },
    };
  }

  return {
    name: 'Ingestion pipeline',
    state: 'OPERATIONAL',
    detail:
      running > 0
        ? `${running} document(s) currently processing. No failures recorded.`
        : 'Idle. No failed jobs recorded.',
    latencyMs: probe.ms,
    metadata: { failed, running, stale },
  };
}

function checkWorker(): ComponentHealth {
  const workerUrl = env().WORKER_URL;
  if (!workerUrl) {
    return {
      name: 'External ingestion worker',
      state: 'OPERATIONAL',
      detail:
        'Not deployed. Ingestion runs inside the application by design, so there is no separate worker to monitor.',
      latencyMs: null,
      metadata: { configured: false },
    };
  }
  return {
    name: 'External ingestion worker',
    state: 'DEGRADED',
    detail: `A worker URL is configured but this build performs ingestion in-process and does not call it.`,
    latencyMs: null,
    metadata: { configured: true },
  };
}

export async function getSystemHealth(): Promise<SystemHealth> {
  const [database, embeddings, llm, storage, ingestion] = await Promise.all([
    checkDatabase(),
    checkEmbeddings(),
    checkLlm(),
    checkStorage(),
    checkIngestionQueue(),
  ]);

  const components = [database, embeddings, llm, storage, ingestion, checkWorker()];

  const overall = components.reduce<HealthState>((worst, component) => {
    return STATE_SEVERITY[component.state] > STATE_SEVERITY[worst] ? component.state : worst;
  }, 'OPERATIONAL');

  return {
    overall,
    demoMode: env().DEMO_MODE,
    checkedAt: new Date().toISOString(),
    components,
  };
}
