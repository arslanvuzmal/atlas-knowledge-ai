import { prisma } from '@/lib/database/client';
import { ingestSource, type IngestResult } from '@/lib/documents/ingest';
import { logger } from '@/lib/observability/logger';

/**
 * Ingestion Job Queue
 *
 * Abstraction over a job queue for document ingestion.
 * Development uses a database-backed worker; production can swap in
 * an external queue (Redis, SQS, etc.) by replacing the driver.
 */

export type JobStatus = 'PENDING' | 'PROCESSING' | 'COMPLETED' | 'FAILED';

export interface IngestionJobPayload {
  knowledgeBaseId: string;
  title: string;
  accessLevel: 'PUBLIC' | 'CUSTOMER' | 'EMPLOYEE' | 'MANAGER' | 'ADMIN';
  sourceType: 'PDF' | 'DOCX' | 'TXT' | 'MARKDOWN' | 'CSV' | 'WEBSITE' | 'FAQ' | 'MANUAL_ENTRY';
  bytes: Buffer;
  originalFilename?: string | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
  uploadedBy?: string | null;
  language?: string;
}

export interface QueuedJob {
  id: string;
  payload: IngestionJobPayload;
  status: JobStatus;
  attempts: number;
  maxAttempts: number;
  createdAt: Date;
  updatedAt: Date;
  startedAt?: Date | null;
  completedAt?: Date | null;
  lastError?: string | null;
  result?: IngestResult | null;
}

function serializePayload(payload: IngestionJobPayload): any {
  return {
    ...payload,
    bytes: payload.bytes.toString('base64'),
  };
}

function deserializePayload(data: any): IngestionJobPayload {
  return {
    ...data,
    bytes: Buffer.from(data.bytes, 'base64'),
  };
}

function jobKey(id: string): string {
  return `ingestion:job:${id}`;
}

function nowISO(): string {
  return new Date().toISOString();
}

/**
 * Creates a new ingestion job in the queue.
 */
export async function enqueueIngestionJob(
  payload: IngestionJobPayload,
  options: { maxAttempts?: number } = {},
): Promise<QueuedJob> {
  const id = crypto.randomUUID();
  const createdAt = nowISO();

  await prisma.systemSetting.create({
    data: {
      key: jobKey(id),
      value: {
        payload: serializePayload(payload),
        maxAttempts: options.maxAttempts ?? 3,
        status: 'PENDING',
        attempts: 0,
        createdAt,
        updatedAt: createdAt,
      },
    },
  });

  logger.info('Ingestion job enqueued', { jobId: id, knowledgeBaseId: payload.knowledgeBaseId });
  return {
    id,
    payload,
    status: 'PENDING',
    attempts: 0,
    maxAttempts: options.maxAttempts ?? 3,
    createdAt: new Date(),
    updatedAt: new Date(),
  };
}

/**
 * Gets the next pending job from the queue.
 * Uses a simple polling approach with a lock to prevent race conditions.
 */
export async function dequeueIngestionJob(): Promise<QueuedJob | null> {
  // Find the oldest pending job
  const settings = await prisma.systemSetting.findMany({
    where: {
      key: { startsWith: 'ingestion:job:' },
      value: { path: ['status'], equals: 'PENDING' },
    },
    orderBy: { updatedAt: 'asc' },
    take: 1,
  });

  if (settings.length === 0) return null;

  const setting = settings[0];
  const jobData = setting.value as any;

  // Try to claim the job atomically
  const updated = await prisma.systemSetting.update({
    where: { key: setting.key },
    data: {
      value: {
        ...jobData,
        status: 'PROCESSING',
        attempts: jobData.attempts + 1,
        startedAt: nowISO(),
        updatedAt: nowISO(),
      },
    },
  });

  const claimed = updated.value as any;
  const jobId = setting.key.replace('ingestion:job:', '');

  return {
    id: jobId,
    payload: deserializePayload(claimed.payload),
    status: 'PROCESSING',
    attempts: claimed.attempts,
    maxAttempts: claimed.maxAttempts,
    createdAt: new Date(claimed.createdAt),
    updatedAt: new Date(setting.updatedAt),
    startedAt: claimed.startedAt ? new Date(claimed.startedAt) : null,
  };
}

/**
 * Marks a job as completed.
 */
export async function completeIngestionJob(jobId: string, result: IngestResult): Promise<void> {
  await prisma.systemSetting.update({
    where: { key: jobKey(jobId) },
    data: {
      value: {
        status: 'COMPLETED',
        completedAt: nowISO(),
        updatedAt: nowISO(),
        result: JSON.parse(JSON.stringify(result)), // Ensure serializable
      },
    },
  });
}

/**
 * Marks a job as failed.
 */
export async function failIngestionJob(jobId: string, error: string): Promise<void> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: jobKey(jobId) },
  });

  if (!setting) return;

  const jobData = setting.value as any;
  const willRetry = jobData.attempts < jobData.maxAttempts;

  await prisma.systemSetting.update({
    where: { key: setting.key },
    data: {
      value: {
        ...jobData,
        status: willRetry ? 'PENDING' : 'FAILED',
        lastError: error,
        updatedAt: nowISO(),
        completedAt: willRetry ? null : nowISO(),
      },
    },
  });

  if (willRetry) {
    logger.info('Ingestion job will be retried', {
      jobId,
      attempt: jobData.attempts,
      maxAttempts: jobData.maxAttempts,
    });
  } else {
    logger.error('Ingestion job failed permanently', { jobId, error });
  }
}

/**
 * Processes a single ingestion job.
 * This is the worker function that can be run in a loop or as a scheduled task.
 */
export async function processIngestionJob(job: QueuedJob): Promise<void> {
  const { id, payload } = job;

  logger.info('Processing ingestion job', { jobId: id });

  try {
    const result = await ingestSource(payload);

    if (result.ok) {
      await completeIngestionJob(id, result);
      logger.info('Ingestion job completed', { jobId: id, documentId: result.documentId });
    } else {
      await failIngestionJob(id, result.error?.message ?? 'Ingestion failed');
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    await failIngestionJob(id, message);
  }
}

/**
 * Runs the ingestion worker loop.
 * Processes jobs until no more pending jobs are available.
 */
export async function runIngestionWorker(options: { maxJobs?: number } = {}): Promise<number> {
  const { maxJobs = 10 } = options;
  let processed = 0;

  while (processed < maxJobs) {
    const job = await dequeueIngestionJob();
    if (!job) {
      // No more pending jobs
      break;
    }

    await processIngestionJob(job);
    processed++;

    // Small delay between jobs to avoid overwhelming the system
    if (processed < maxJobs) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return processed;
}

/**
 * Schedules the worker to run periodically.
 * In development, this can be called from a cron-like scheduler.
 * In production, this should be replaced with a proper queue worker.
 */
export function scheduleIngestionWorker(
  intervalMs = 30000,
  options: { maxJobsPerRun?: number } = {},
): NodeJS.Timeout {
  const { maxJobsPerRun = 5 } = options;

  return setInterval(async () => {
    try {
      await runIngestionWorker({ maxJobs: maxJobsPerRun });
    } catch (error) {
      logger.error('Ingestion worker error', { error });
    }
  }, intervalMs);
}

/**
 * Gets the status of a queued job.
 */
export async function getJobStatus(jobId: string): Promise<QueuedJob | null> {
  const setting = await prisma.systemSetting.findUnique({
    where: { key: jobKey(jobId) },
  });

  if (!setting) return null;

  const jobData = setting.value as any;
  return {
    id: jobId,
    payload: deserializePayload(jobData.payload),
    status: jobData.status,
    attempts: jobData.attempts,
    maxAttempts: jobData.maxAttempts,
    createdAt: new Date(jobData.createdAt),
    updatedAt: new Date(setting.updatedAt),
    startedAt: jobData.startedAt ? new Date(jobData.startedAt) : null,
    completedAt: jobData.completedAt ? new Date(jobData.completedAt) : null,
    lastError: jobData.lastError ?? null,
    result: jobData.result ?? null,
  };
}

/**
 * Cleans up old completed/failed jobs.
 * Should be run periodically to prevent the settings table from growing.
 */
export async function cleanupOldJobs(olderThanDays = 7): Promise<number> {
  const cutoff = new Date(Date.now() - olderThanDays * 24 * 60 * 60 * 1000);

  const oldSettings = await prisma.systemSetting.findMany({
    where: {
      key: { startsWith: 'ingestion:job:' },
      updatedAt: { lt: cutoff },
    },
    select: { key: true },
  });

  if (oldSettings.length === 0) return 0;

  await prisma.systemSetting.deleteMany({
    where: {
      key: { in: oldSettings.map((s) => s.key) },
    },
  });

  logger.info('Cleaned up old ingestion jobs', { count: oldSettings.length });
  return oldSettings.length;
}
