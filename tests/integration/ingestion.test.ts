import { afterAll, describe, expect, it } from 'vitest';
import { prisma } from '@/lib/database/client';
import { ingestManualText, ingestSource, reprocessDocument } from '@/lib/documents/ingest';
import { countEmbeddedChunks } from '@/lib/database/vector';

/**
 * End-to-end ingestion against the real database.
 *
 * Every document created here is tracked and removed afterwards, so the suite
 * can run repeatedly without polluting the seeded corpus that the retrieval and
 * security suites depend on.
 */

const created: string[] = [];

async function knowledgeBaseId(): Promise<string> {
  const base = await prisma.knowledgeBase.findFirst({ select: { id: true } });
  if (!base) throw new Error('No knowledge base found. Run `npm run db:seed`.');
  return base.id;
}

afterAll(async () => {
  if (created.length > 0) {
    await prisma.document.deleteMany({ where: { id: { in: created } } });
  }
  await prisma.$disconnect();
});

describe('document ingestion', () => {
  it('runs the full pipeline and produces retrievable passages', async () => {
    const body = `# Test Policy Document

## Overview

This document exists only to verify the ingestion pipeline end to end. It describes a fictional widget calibration procedure.

## Calibration Window

Widgets must be calibrated every 90 days. A widget that misses its calibration window is quarantined until an engineer signs it off.

## Escalation

If calibration fails twice consecutively, the incident is escalated to the hardware reliability team within one business day.`;

    const result = await ingestSource({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Ingestion Test ${Date.now()}`,
      accessLevel: 'PUBLIC',
      sourceType: 'MARKDOWN',
      bytes: Buffer.from(body, 'utf8'),
      originalFilename: 'ingestion-test.md',
      mimeType: 'text/markdown',
    });

    expect(result.ok).toBe(true);
    expect(result.documentId).toBeDefined();
    created.push(result.documentId as string);

    expect(result.chunkCount).toBeGreaterThan(0);

    const document = await prisma.document.findUnique({
      where: { id: result.documentId },
      include: { chunks: true, versions: true, jobs: true },
    });

    expect(document?.status).toBe('INDEXED');
    expect(document?.chunks.length).toBe(result.chunkCount);
    expect(document?.versions[0]?.processingStatus).toBe('COMPLETED');
    expect(document?.jobs[0]?.status).toBe('SUCCEEDED');
    expect(document?.jobs[0]?.stage).toBe('COMPLETE');
    expect(document?.jobs[0]?.progress).toBe(100);
  });

  it('gives every persisted chunk an embedding', async () => {
    const before = await countEmbeddedChunks();

    const result = await ingestManualText({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Embedding Test ${Date.now()}`,
      body: 'The quarterly reconciliation runs on the first business day of each quarter and is owned by the finance operations team. It compares ledger balances against the warehouse extract.',
      accessLevel: 'PUBLIC',
      sourceType: 'MANUAL_ENTRY',
    });

    expect(result.ok).toBe(true);
    created.push(result.documentId as string);

    const after = await countEmbeddedChunks();
    expect(after - before).toBe(result.chunkCount);

    // No chunk may exist without a vector: an unembedded chunk is invisible to
    // retrieval, which is a silent correctness failure rather than a loud one.
    const orphans = await prisma.$queryRaw<{ count: bigint }[]>`
      SELECT COUNT(*)::bigint AS count
      FROM "DocumentChunk"
      WHERE "documentId" = ${result.documentId} AND "embedding" IS NULL
    `;
    expect(Number(orphans[0].count)).toBe(0);
  });

  it('records provider and model metadata on every chunk', async () => {
    const result = await ingestManualText({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Metadata Test ${Date.now()}`,
      body: 'Support tickets raised outside business hours are queued and acknowledged at the start of the next working day in the customer primary region.',
      accessLevel: 'PUBLIC',
      sourceType: 'FAQ',
    });
    created.push(result.documentId as string);

    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: result.documentId },
      select: {
        embeddingProvider: true,
        embeddingModel: true,
        accessLevel: true,
        searchText: true,
      },
    });

    expect(chunks.length).toBeGreaterThan(0);
    for (const chunk of chunks) {
      expect(chunk.embeddingProvider).toBeTruthy();
      expect(chunk.embeddingModel).toBeTruthy();
      expect(chunk.accessLevel).toBe('PUBLIC');
      expect(chunk.searchText.length).toBeGreaterThan(0);
    }
  });

  it('rejects a byte-identical duplicate in the same knowledge base', async () => {
    const kb = await knowledgeBaseId();
    const bytes = Buffer.from(
      `# Duplicate Probe ${Date.now()}\n\nThis exact content is submitted twice to confirm checksum-based duplicate detection works.`,
      'utf8',
    );

    const first = await ingestSource({
      knowledgeBaseId: kb,
      title: 'Duplicate Probe A',
      accessLevel: 'PUBLIC',
      sourceType: 'MARKDOWN',
      bytes,
      originalFilename: 'dup.md',
      mimeType: 'text/markdown',
    });
    expect(first.ok).toBe(true);
    created.push(first.documentId as string);

    const second = await ingestSource({
      knowledgeBaseId: kb,
      title: 'Duplicate Probe B',
      accessLevel: 'PUBLIC',
      sourceType: 'MARKDOWN',
      bytes,
      originalFilename: 'dup-again.md',
      mimeType: 'text/markdown',
    });

    expect(second.ok).toBe(false);
    expect(second.duplicateOf?.id).toBe(first.documentId);
    // Rejection happens before any work, so no second document is created.
    expect(second.documentId).toBeUndefined();
  });

  it('records a failure with its stage rather than throwing', async () => {
    const result = await ingestSource({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Corrupt PDF ${Date.now()}`,
      accessLevel: 'PUBLIC',
      sourceType: 'PDF',
      bytes: Buffer.from('%PDF-1.7\ntruncated and unparseable'),
      originalFilename: 'corrupt.pdf',
      mimeType: 'application/pdf',
    });

    expect(result.ok).toBe(false);
    expect(result.error?.stage).toBe('EXTRACTION');
    created.push(result.documentId as string);

    const document = await prisma.document.findUnique({
      where: { id: result.documentId },
      include: { jobs: true },
    });
    expect(document?.status).toBe('FAILED');
    expect(document?.lastError).toContain('EXTRACTION');
    expect(document?.jobs[0]?.status).toBe('FAILED');
  });

  it('rebuilds the index when a document is reprocessed', async () => {
    const result = await ingestManualText({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Reprocess Test ${Date.now()}`,
      body: 'Access reviews are performed every six months. Each reviewer confirms that the people listed still require their current level of access, and revokes anything no longer needed.',
      accessLevel: 'PUBLIC',
      sourceType: 'MANUAL_ENTRY',
    });
    expect(result.ok).toBe(true);
    const originalId = result.documentId as string;

    const reprocessed = await reprocessDocument(originalId);
    expect(reprocessed.ok).toBe(true);
    created.push(reprocessed.documentId as string);

    // The old record is replaced rather than left behind as a duplicate.
    const old = await prisma.document.findUnique({ where: { id: originalId } });
    expect(old).toBeNull();

    const fresh = await prisma.document.findUnique({
      where: { id: reprocessed.documentId },
      include: { chunks: true },
    });
    expect(fresh?.status).toBe('INDEXED');
    expect(fresh?.chunks.length).toBeGreaterThan(0);
  });

  it('writes an audit trail for the ingestion lifecycle', async () => {
    const result = await ingestManualText({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Audit Test ${Date.now()}`,
      body: 'Every configuration change is recorded with the previous and new value so a reviewer can reconstruct exactly what changed and when.',
      accessLevel: 'PUBLIC',
      sourceType: 'MANUAL_ENTRY',
    });
    created.push(result.documentId as string);

    const entries = await prisma.auditLog.findMany({
      where: { entityId: result.documentId },
      select: { action: true },
    });
    const actions = entries.map((entry) => entry.action);
    expect(actions).toContain('document.upload');
    expect(actions).toContain('document.ingest.complete');
  });

  it('carries the document access level onto every chunk', async () => {
    const result = await ingestManualText({
      knowledgeBaseId: await knowledgeBaseId(),
      title: `Restricted Test ${Date.now()}`,
      body: 'This restricted note exists to confirm that the document access level is denormalised onto each chunk, which is what the SQL retrieval filter reads.',
      accessLevel: 'MANAGER',
      sourceType: 'MANUAL_ENTRY',
    });
    created.push(result.documentId as string);

    const chunks = await prisma.documentChunk.findMany({
      where: { documentId: result.documentId },
      select: { accessLevel: true },
    });
    expect(chunks.length).toBeGreaterThan(0);
    expect(chunks.every((chunk) => chunk.accessLevel === 'MANAGER')).toBe(true);
  });
});
