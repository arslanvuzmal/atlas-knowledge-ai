import { randomUUID } from 'node:crypto';
import type { AccessLevel, Prisma, SourceType } from '@prisma/client';
import { prisma } from '@/lib/database/client';
import { setChunkEmbeddings } from '@/lib/database/vector';
import { embedTexts } from '@/lib/embeddings';
import { chunkDocument } from '@/lib/documents/chunk';
import { ExtractionError, extractBySourceType, extractHtml } from '@/lib/documents/extract';
import { getRetrievalSettings } from '@/lib/retrieval/settings';
import { buildStorageKey, getStorage } from '@/lib/storage';
import { detectPromptInjection } from '@/lib/security/prompt-injection';
import { recordAudit } from '@/lib/security/audit';
import { sha256 } from '@/lib/security/hash';
import { safeFetchDocument } from '@/lib/security/url-guard';
import { logger, newCorrelationId } from '@/lib/observability/logger';
import { env } from '@/lib/env';

/**
 * Document ingestion.
 *
 * One state machine drives every source type. Each stage updates the
 * IngestionJob row before it runs, so a failure leaves an accurate record of
 * *where* it failed rather than a generic error, and the UI can show real
 * progress instead of a spinner.
 *
 *   UPLOADED -> VALIDATING -> EXTRACTING -> CHUNKING -> EMBEDDING -> INDEXED
 *                                                                 \-> FAILED
 *
 * Chunk rows and their embeddings are written inside a transaction. A partially
 * embedded document would silently answer questions from half its content,
 * which is worse than a clean failure the operator can retry.
 */

export interface IngestSourceInput {
  knowledgeBaseId: string;
  title: string;
  accessLevel: AccessLevel;
  sourceType: SourceType;
  bytes: Buffer;
  originalFilename?: string | null;
  mimeType?: string | null;
  sourceUrl?: string | null;
  uploadedBy?: string | null;
  language?: string;
}

export interface IngestResult {
  ok: boolean;
  documentId?: string;
  jobId?: string;
  chunkCount?: number;
  pageCount?: number;
  correlationId: string;
  duplicateOf?: { id: string; title: string };
  injectionRisk?: string;
  error?: { stage: string; message: string };
  warnings: string[];
}

const STAGE_PROGRESS = {
  VALIDATION: 10,
  EXTRACTION: 35,
  CHUNKING: 55,
  EMBEDDING: 80,
  INDEXING: 95,
  COMPLETE: 100,
} as const;

async function advance(
  jobId: string,
  stage: keyof typeof STAGE_PROGRESS,
  documentStatus?: 'VALIDATING' | 'EXTRACTING' | 'CHUNKING' | 'EMBEDDING' | 'INDEXED',
  documentId?: string,
): Promise<void> {
  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { stage, progress: STAGE_PROGRESS[stage], status: 'RUNNING' },
  });
  if (documentStatus && documentId) {
    await prisma.document.update({ where: { id: documentId }, data: { status: documentStatus } });
  }
}

async function failJob(
  jobId: string,
  documentId: string,
  stage: string,
  message: string,
): Promise<void> {
  await prisma.ingestionJob.update({
    where: { id: jobId },
    data: { status: 'FAILED', lastError: message, completedAt: new Date() },
  });
  await prisma.document.update({
    where: { id: documentId },
    data: { status: 'FAILED', lastError: `${stage}: ${message}` },
  });
}

/**
 * Ingests a source end to end.
 *
 * Callers are responsible for authorisation and for file validation; by the
 * time this runs the bytes are trusted to be a permitted type from a permitted
 * user. Everything about their *contents* remains untrusted.
 */
export async function ingestSource(input: IngestSourceInput): Promise<IngestResult> {
  const correlationId = newCorrelationId();
  const log = logger.child({ correlationId, knowledgeBaseId: input.knowledgeBaseId });
  const warnings: string[] = [];

  const checksum = sha256(input.bytes);

  // --- Duplicate detection (before any work is done) -------------------------
  const existing = await prisma.document.findUnique({
    where: { knowledgeBaseId_checksum: { knowledgeBaseId: input.knowledgeBaseId, checksum } },
    select: { id: true, title: true },
  });
  if (existing) {
    log.info('Rejected duplicate document', { checksum: checksum.slice(0, 12) });
    return {
      ok: false,
      correlationId,
      duplicateOf: existing,
      warnings,
      error: {
        stage: 'VALIDATION',
        message: `This file is already in the knowledge base as "${existing.title}".`,
      },
    };
  }

  // --- Create the document and its job ---------------------------------------
  const document = await prisma.document.create({
    data: {
      knowledgeBaseId: input.knowledgeBaseId,
      title: input.title,
      originalFilename: input.originalFilename ?? null,
      sourceType: input.sourceType,
      mimeType: input.mimeType ?? null,
      sourceUrl: input.sourceUrl ?? null,
      checksum,
      status: 'UPLOADED',
      accessLevel: input.accessLevel,
      language: input.language ?? 'en',
      fileSize: input.bytes.byteLength,
      uploadedBy: input.uploadedBy ?? null,
    },
  });

  const job = await prisma.ingestionJob.create({
    data: {
      documentId: document.id,
      status: 'RUNNING',
      stage: 'VALIDATION',
      progress: 0,
      attemptCount: 1,
      correlationId,
      startedAt: new Date(),
    },
  });

  await recordAudit({
    action: 'document.upload',
    entityType: 'Document',
    entityId: document.id,
    userId: input.uploadedBy ?? null,
    newData: {
      title: input.title,
      sourceType: input.sourceType,
      accessLevel: input.accessLevel,
      fileSize: input.bytes.byteLength,
    },
    metadata: { correlationId },
  });

  try {
    // --- Stage 1: store the original ----------------------------------------
    await advance(job.id, 'VALIDATION', 'VALIDATING', document.id);

    const storageKey = buildStorageKey(
      document.id,
      1,
      input.originalFilename ?? `${input.sourceType.toLowerCase()}-source.txt`,
    );
    // A URL source has no original binary worth keeping beyond its extracted text.
    if (input.sourceType !== 'WEBSITE') {
      await getStorage().put(storageKey, input.bytes, input.mimeType ?? 'application/octet-stream');
    }

    const version = await prisma.documentVersion.create({
      data: {
        documentId: document.id,
        version: 1,
        checksum,
        storagePath: input.sourceType === 'WEBSITE' ? null : storageKey,
        processingStatus: 'RUNNING',
      },
    });

    await prisma.document.update({
      where: { id: document.id },
      data: { storagePath: input.sourceType === 'WEBSITE' ? null : storageKey },
    });

    // --- Stage 2: extract ----------------------------------------------------
    await advance(job.id, 'EXTRACTION', 'EXTRACTING', document.id);
    const extraction = await extractBySourceType(input.sourceType, input.bytes);
    warnings.push(...extraction.warnings);

    // Scan the extracted text for injected instructions. This never blocks
    // ingestion of otherwise legitimate content; it records a signal that the
    // document library surfaces to administrators.
    const assessment = detectPromptInjection(extraction.fullText);
    if (assessment.detected) {
      log.warn('Prompt-injection patterns detected in ingested document', {
        documentId: document.id,
        risk: assessment.risk,
        categories: assessment.categories,
      });
      await recordAudit({
        action: 'chat.injection.detected',
        entityType: 'Document',
        entityId: document.id,
        userId: input.uploadedBy ?? null,
        metadata: {
          risk: assessment.risk,
          score: assessment.score,
          categories: assessment.categories,
          patterns: assessment.signals.map((signal) => signal.pattern),
          context: 'ingestion',
        },
      });
      if (assessment.risk === 'high' || assessment.risk === 'medium') {
        warnings.push(
          `This document contains text matching known prompt-injection patterns (${assessment.categories.join(', ')}). It has been indexed, and the assistant treats all source text as data rather than instructions, but an administrator should review it.`,
        );
      }
    }

    // --- Stage 3: chunk ------------------------------------------------------
    await advance(job.id, 'CHUNKING', 'CHUNKING', document.id);
    const settings = await getRetrievalSettings();
    const drafts = chunkDocument(extraction.pages, {
      chunkSize: settings.chunkSize,
      chunkOverlap: settings.chunkOverlap,
    });

    if (drafts.length === 0) {
      throw new ExtractionError(
        'Chunking produced no usable sections from this document.',
        'empty',
      );
    }

    // --- Stage 4: embed ------------------------------------------------------
    await advance(job.id, 'EMBEDDING', 'EMBEDDING', document.id);
    const embedding = await embedTexts(
      drafts.map((draft) =>
        // The heading travels with the text so a chunk is embedded in context.
        draft.sectionTitle ? `${draft.sectionTitle}\n\n${draft.content}` : draft.content,
      ),
    );

    if (embedding.vectors.length !== drafts.length) {
      throw new Error(
        `Embedding provider returned ${embedding.vectors.length} vectors for ${drafts.length} chunks.`,
      );
    }

    // --- Stage 5: persist atomically ----------------------------------------
    await advance(job.id, 'INDEXING');

    // Round trips inside this transaction are kept to a fixed handful rather
    // than scaling with chunk count. Creating chunks one at a time was fine
    // against a local database and exceeded Prisma's interactive-transaction
    // budget against a remote pooler, where every statement pays real latency.
    await prisma.$transaction(
      async (tx: Prisma.TransactionClient) => {
        await tx.documentChunk.createMany({
          data: drafts.map((draft) => ({
            documentId: document.id,
            documentVersionId: version.id,
            chunkIndex: draft.chunkIndex,
            content: draft.content,
            tokenCount: draft.tokenCount,
            pageNumber: draft.pageNumber,
            sectionTitle: draft.sectionTitle,
            accessLevel: input.accessLevel,
            knowledgeBaseId: input.knowledgeBaseId,
            searchText: draft.searchText,
            metadata: draft.metadata as Prisma.InputJsonValue,
            embeddingProvider: embedding.provider,
            embeddingModel: embedding.model,
          })),
        });

        // `createMany` cannot return ids, so they are read back and matched on
        // chunkIndex — which is unique per version and is the same key the
        // embedding vectors are ordered by.
        const created = await tx.documentChunk.findMany({
          where: { documentVersionId: version.id },
          select: { id: true, chunkIndex: true },
          orderBy: { chunkIndex: 'asc' },
        });

        await setChunkEmbeddings(
          created.map((chunk) => ({
            chunkId: chunk.id,
            vector: embedding.vectors[chunk.chunkIndex],
          })),
          tx,
        );

        await tx.documentVersion.update({
          where: { id: version.id },
          data: {
            processingStatus: 'COMPLETED',
            extractedText: extraction.fullText.slice(0, 200_000),
            pageCount: extraction.pageCount,
            embeddingProvider: embedding.provider,
            embeddingModel: embedding.model,
            embeddingDimensions: embedding.dimensions,
          },
        });

        await tx.document.update({
          where: { id: document.id },
          data: {
            status: 'INDEXED',
            pageCount: extraction.pageCount,
            chunkCount: drafts.length,
            lastError: null,
          },
        });
      },
      // Generous relative to the work, because the floor is network latency to
      // a possibly distant database rather than anything this code controls.
      { timeout: 120_000, maxWait: 20_000 },
    );

    await prisma.ingestionJob.update({
      where: { id: job.id },
      data: {
        status: 'SUCCEEDED',
        stage: 'COMPLETE',
        progress: 100,
        completedAt: new Date(),
        lastError: null,
      },
    });

    await recordAudit({
      action: 'document.ingest.complete',
      entityType: 'Document',
      entityId: document.id,
      userId: input.uploadedBy ?? null,
      newData: {
        chunkCount: drafts.length,
        pageCount: extraction.pageCount,
        embeddingProvider: embedding.provider,
        embeddingModel: embedding.model,
      },
      metadata: { correlationId },
    });

    log.info('Document indexed', {
      documentId: document.id,
      chunkCount: drafts.length,
      embeddingMs: embedding.processingTimeMs,
    });

    return {
      ok: true,
      documentId: document.id,
      jobId: job.id,
      chunkCount: drafts.length,
      pageCount: extraction.pageCount,
      correlationId,
      injectionRisk: assessment.detected ? assessment.risk : undefined,
      warnings,
    };
  } catch (error) {
    const stage =
      error instanceof ExtractionError
        ? 'EXTRACTION'
        : ((await prisma.ingestionJob.findUnique({ where: { id: job.id } }))?.stage ??
          'VALIDATION');

    const message =
      error instanceof ExtractionError
        ? error.message
        : error instanceof Error
          ? error.message
          : 'An unexpected error occurred during ingestion.';

    log.error('Ingestion failed', { documentId: document.id, stage, error });
    await failJob(job.id, document.id, stage, message);
    await recordAudit({
      action: 'document.ingest.failure',
      entityType: 'Document',
      entityId: document.id,
      userId: input.uploadedBy ?? null,
      metadata: { stage, message, correlationId },
    });

    return {
      ok: false,
      documentId: document.id,
      jobId: job.id,
      correlationId,
      error: { stage, message },
      warnings,
    };
  }
}

/**
 * Re-runs ingestion for an existing document from its stored original.
 *
 * Old chunks are removed and replaced inside the same flow, so a reprocess with
 * new chunk settings or a new embedding provider fully rebuilds the index for
 * that document rather than mixing generations.
 */
export async function reprocessDocument(
  documentId: string,
  actorId?: string | null,
): Promise<IngestResult> {
  const correlationId = newCorrelationId();

  const document = await prisma.document.findUnique({
    where: { id: documentId },
    include: { versions: { orderBy: { version: 'desc' }, take: 1 } },
  });

  if (!document) {
    return {
      ok: false,
      correlationId,
      warnings: [],
      error: { stage: 'VALIDATION', message: 'Document not found.' },
    };
  }

  let bytes: Buffer;
  try {
    if (document.sourceType === 'WEBSITE') {
      if (!document.sourceUrl) {
        throw new Error('This website source has no recorded URL to re-fetch.');
      }
      const fetched = await safeFetchDocument(document.sourceUrl);
      if (!fetched.ok || !fetched.body) {
        throw new Error(fetched.reason ?? 'The source URL could not be retrieved.');
      }
      bytes = Buffer.from(fetched.body, 'utf8');
    } else {
      const storagePath = document.storagePath ?? document.versions[0]?.storagePath;
      if (!storagePath) throw new Error('The original file is no longer available in storage.');
      bytes = await getStorage().get(storagePath);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Failed to load the original source.';
    await prisma.document.update({
      where: { id: documentId },
      data: { status: 'FAILED', lastError: `REPROCESS: ${message}` },
    });
    return {
      ok: false,
      documentId,
      correlationId,
      warnings: [],
      error: { stage: 'VALIDATION', message },
    };
  }

  // Remove the previous generation, then re-ingest under the same identity.
  await prisma.$transaction([
    prisma.documentChunk.deleteMany({ where: { documentId } }),
    prisma.documentVersion.deleteMany({ where: { documentId } }),
    prisma.document.delete({ where: { id: documentId } }),
  ]);

  await recordAudit({
    action: 'document.reprocess',
    entityType: 'Document',
    entityId: documentId,
    userId: actorId ?? null,
    metadata: { correlationId, previousChunkCount: document.chunkCount },
  });

  return ingestSource({
    knowledgeBaseId: document.knowledgeBaseId,
    title: document.title,
    accessLevel: document.accessLevel,
    sourceType: document.sourceType,
    bytes,
    originalFilename: document.originalFilename,
    mimeType: document.mimeType,
    sourceUrl: document.sourceUrl,
    uploadedBy: actorId ?? document.uploadedBy,
    language: document.language,
  });
}

/**
 * Ingests an explicitly approved URL.
 *
 * This is not a crawler. It fetches exactly the page it is given, through the
 * SSRF-validated fetcher, and never follows links found in the content.
 */
export async function ingestUrl(options: {
  url: string;
  knowledgeBaseId: string;
  accessLevel: AccessLevel;
  title?: string;
  uploadedBy?: string | null;
}): Promise<IngestResult> {
  const correlationId = newCorrelationId();

  const fetched = await safeFetchDocument(options.url, {
    maxBytes: env().MAX_UPLOAD_SIZE_MB * 1024 * 1024,
  });

  if (!fetched.ok || !fetched.body) {
    return {
      ok: false,
      correlationId,
      warnings: [],
      error: { stage: 'VALIDATION', message: fetched.reason ?? 'The URL could not be retrieved.' },
    };
  }

  const contentType = (fetched.contentType ?? '').toLowerCase();
  const isHtml = contentType.includes('html') || /<html[\s>]/i.test(fetched.body.slice(0, 2000));
  const isText = contentType.includes('text/') || contentType.includes('json');

  if (!isHtml && !isText) {
    return {
      ok: false,
      correlationId,
      warnings: [],
      error: {
        stage: 'VALIDATION',
        message: `The URL returned "${contentType || 'an unknown content type'}", which is not a supported web page.`,
      },
    };
  }

  let derivedTitle = options.title?.trim();
  if (!derivedTitle) {
    const parsed = await extractHtml(fetched.body).catch(() => null);
    derivedTitle = parsed?.title ?? new URL(fetched.finalUrl ?? options.url).hostname;
  }

  const result = await ingestSource({
    knowledgeBaseId: options.knowledgeBaseId,
    title: derivedTitle,
    accessLevel: options.accessLevel,
    sourceType: 'WEBSITE',
    bytes: Buffer.from(fetched.body, 'utf8'),
    mimeType: contentType || 'text/html',
    sourceUrl: fetched.finalUrl ?? options.url,
    uploadedBy: options.uploadedBy,
  });

  await recordAudit({
    action: 'document.url.ingest',
    entityType: 'Document',
    entityId: result.documentId ?? null,
    userId: options.uploadedBy ?? null,
    newData: { url: fetched.finalUrl, bytesRead: fetched.bytesRead, ok: result.ok },
    metadata: { correlationId: result.correlationId },
  });

  return result;
}

/** Creates a document from text typed directly into the dashboard. */
export async function ingestManualText(options: {
  knowledgeBaseId: string;
  title: string;
  body: string;
  accessLevel: AccessLevel;
  sourceType: 'FAQ' | 'MANUAL_ENTRY';
  uploadedBy?: string | null;
}): Promise<IngestResult> {
  return ingestSource({
    knowledgeBaseId: options.knowledgeBaseId,
    title: options.title,
    accessLevel: options.accessLevel,
    sourceType: options.sourceType,
    bytes: Buffer.from(options.body, 'utf8'),
    mimeType: 'text/markdown',
    uploadedBy: options.uploadedBy,
    originalFilename: `${options.title.replace(/[^A-Za-z0-9]+/g, '-').toLowerCase()}-${randomUUID().slice(0, 8)}.md`,
  });
}
