import { Prisma } from '@prisma/client';
import type { AccessLevel } from '@prisma/client';
import { prisma } from '@/lib/database/client';

/**
 * pgvector access layer.
 *
 * Prisma cannot select `Unsupported("vector(768)")` columns, so every read and
 * write of an embedding goes through the typed raw-SQL helpers here. Two rules
 * are enforced at this boundary:
 *
 *   1. The access-level filter is part of the SQL `WHERE` clause, not a
 *      post-filter in application code. A chunk the caller may not read is
 *      never loaded into memory in the first place.
 *   2. Vector literals are passed as bound parameters and cast in SQL. Nothing
 *      is string-concatenated into the statement.
 */

export interface VectorSearchFilters {
  allowedAccessLevels: AccessLevel[];
  knowledgeBaseId?: string | null;
  documentId?: string | null;
  limit: number;
}

export interface RetrievedChunkRow {
  id: string;
  documentId: string;
  documentVersionId: string;
  chunkIndex: number;
  content: string;
  pageNumber: number | null;
  sectionTitle: string | null;
  accessLevel: AccessLevel;
  knowledgeBaseId: string;
  documentTitle: string;
  documentSourceType: string;
  documentSourceUrl: string | null;
  score: number;
}

function toVectorLiteral(vector: number[]): string {
  // pgvector's text input format. Values are finite by construction; the guard
  // keeps a NaN from a broken provider out of the database.
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

export async function setChunkEmbedding(
  chunkId: string,
  vector: number[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  await client.$executeRaw`
    UPDATE "DocumentChunk"
    SET embedding = ${toVectorLiteral(vector)}::vector
    WHERE id = ${chunkId}
  `;
}

export async function setChunkEmbeddings(
  entries: { chunkId: string; vector: number[] }[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  // One statement per chunk keeps the parameter count bounded and predictable;
  // the whole set runs inside the caller's transaction.
  for (const entry of entries) {
    await client.$executeRaw`
      UPDATE "DocumentChunk"
      SET embedding = ${toVectorLiteral(entry.vector)}::vector
      WHERE id = ${entry.chunkId}
    `;
  }
}

function buildFilterSql(filters: VectorSearchFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`c."accessLevel"::text = ANY(${filters.allowedAccessLevels.map(String)}::text[])`,
    Prisma.sql`d."status" = 'INDEXED'`,
    Prisma.sql`d."archivedAt" IS NULL`,
  ];
  if (filters.knowledgeBaseId) {
    clauses.push(Prisma.sql`c."knowledgeBaseId" = ${filters.knowledgeBaseId}`);
  }
  if (filters.documentId) {
    clauses.push(Prisma.sql`c."documentId" = ${filters.documentId}`);
  }
  return Prisma.join(clauses, ' AND ');
}

/** Cosine similarity search. Returns rows already filtered to the caller's reach. */
export async function vectorSearch(
  queryVector: number[],
  filters: VectorSearchFilters,
): Promise<RetrievedChunkRow[]> {
  if (filters.allowedAccessLevels.length === 0) return [];

  const literal = toVectorLiteral(queryVector);

  const rows = await prisma.$queryRaw<RetrievedChunkRow[]>`
    SELECT
      c."id",
      c."documentId",
      c."documentVersionId",
      c."chunkIndex",
      c."content",
      c."pageNumber",
      c."sectionTitle",
      c."accessLevel",
      c."knowledgeBaseId",
      d."title"      AS "documentTitle",
      d."sourceType"::text AS "documentSourceType",
      d."sourceUrl"  AS "documentSourceUrl",
      (1 - (c."embedding" <=> ${literal}::vector))::float8 AS "score"
    FROM "DocumentChunk" c
    INNER JOIN "Document" d ON d."id" = c."documentId"
    WHERE c."embedding" IS NOT NULL AND ${buildFilterSql(filters)}
    ORDER BY c."embedding" <=> ${literal}::vector
    LIMIT ${filters.limit}
  `;

  return rows;
}

/**
 * Lexical half of hybrid search, using PostgreSQL full-text search.
 *
 * This complements the vector side rather than duplicating it: `ts_rank`
 * weights rare terms highly, so an exact product name or policy number is
 * found even when the embedding model treats it as noise.
 */
export async function keywordSearch(
  query: string,
  filters: VectorSearchFilters,
): Promise<RetrievedChunkRow[]> {
  if (filters.allowedAccessLevels.length === 0) return [];
  const cleaned = query.replace(/[^\p{L}\p{N}\s'-]/gu, ' ').trim();
  if (cleaned.length === 0) return [];

  const rows = await prisma.$queryRaw<RetrievedChunkRow[]>`
    SELECT
      c."id",
      c."documentId",
      c."documentVersionId",
      c."chunkIndex",
      c."content",
      c."pageNumber",
      c."sectionTitle",
      c."accessLevel",
      c."knowledgeBaseId",
      d."title"      AS "documentTitle",
      d."sourceType"::text AS "documentSourceType",
      d."sourceUrl"  AS "documentSourceUrl",
      ts_rank(
        to_tsvector('english', coalesce(c."sectionTitle", '') || ' ' || c."content"),
        websearch_to_tsquery('english', ${cleaned})
      )::float8 AS "score"
    FROM "DocumentChunk" c
    INNER JOIN "Document" d ON d."id" = c."documentId"
    WHERE ${buildFilterSql(filters)}
      AND to_tsvector('english', coalesce(c."sectionTitle", '') || ' ' || c."content")
          @@ websearch_to_tsquery('english', ${cleaned})
    ORDER BY "score" DESC
    LIMIT ${filters.limit}
  `;

  return rows;
}

/** Counts chunks that currently carry an embedding. Used by the health page. */
export async function countEmbeddedChunks(): Promise<number> {
  const rows = await prisma.$queryRaw<{ count: bigint }[]>`
    SELECT COUNT(*)::bigint AS count FROM "DocumentChunk" WHERE "embedding" IS NOT NULL
  `;
  return Number(rows[0]?.count ?? 0);
}

/** Verifies the pgvector extension is installed and reports its version. */
export async function checkVectorExtension(): Promise<{ installed: boolean; version?: string }> {
  try {
    const rows = await prisma.$queryRaw<{ extversion: string }[]>`
      SELECT extversion FROM pg_extension WHERE extname = 'vector'
    `;
    if (rows.length === 0) return { installed: false };
    return { installed: true, version: rows[0].extversion };
  } catch {
    return { installed: false };
  }
}
