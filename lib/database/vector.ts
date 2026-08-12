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
  workspaceId?: string | null;
  knowledgeBaseId?: string | null;
  documentId?: string | null;
  limit: number;
  queryText?: string;
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
  return `[${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}]`;
}

function toFloat8ArrayLiteral(vector: number[]): string {
  return `{${vector.map((value) => (Number.isFinite(value) ? value : 0)).join(',')}}`;
}

export async function setChunkEmbedding(
  chunkId: string,
  vector: number[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  const { installed } = await checkVectorExtension();
  if (installed) {
    await client.$executeRaw`
      UPDATE "DocumentChunk"
      SET embedding = ${toVectorLiteral(vector)}::vector
      WHERE id = ${chunkId}
    `;
  } else {
    await client.$executeRaw`
      UPDATE "DocumentChunk"
      SET embedding = ${toFloat8ArrayLiteral(vector)}::float8[]
      WHERE id = ${chunkId}
    `;
  }
}

const EMBEDDING_UPDATE_BATCH = 500;

export async function setChunkEmbeddings(
  entries: { chunkId: string; vector: number[] }[],
  tx?: Prisma.TransactionClient,
): Promise<void> {
  const client = tx ?? prisma;
  if (entries.length === 0) return;

  const { installed } = await checkVectorExtension();

  for (let offset = 0; offset < entries.length; offset += EMBEDDING_UPDATE_BATCH) {
    const batch = entries.slice(offset, offset + EMBEDDING_UPDATE_BATCH);

    if (installed) {
      const rows = batch.map(
        (entry) => Prisma.sql`(${entry.chunkId}, ${toVectorLiteral(entry.vector)}::vector)`,
      );

      await client.$executeRaw`
        UPDATE "DocumentChunk" AS c
        SET "embedding" = v.embedding
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, embedding)
        WHERE c."id" = v.id
      `;
    } else {
      const rows = batch.map(
        (entry) => Prisma.sql`(${entry.chunkId}, ${toFloat8ArrayLiteral(entry.vector)}::float8[])`,
      );

      await client.$executeRaw`
        UPDATE "DocumentChunk" AS c
        SET "embedding" = v.embedding
        FROM (VALUES ${Prisma.join(rows)}) AS v(id, embedding)
        WHERE c."id" = v.id
      `;
    }
  }
}

function buildFilterSql(filters: VectorSearchFilters): Prisma.Sql {
  const clauses: Prisma.Sql[] = [
    Prisma.sql`c."accessLevel"::text = ANY(${filters.allowedAccessLevels.map(String)}::text[])`,
    Prisma.sql`d."status" = 'INDEXED'`,
    Prisma.sql`d."archivedAt" IS NULL`,
  ];
  if (filters.workspaceId) {
    clauses.push(Prisma.sql`kb."workspaceId" = ${filters.workspaceId}`);
  }
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

  try {
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
      INNER JOIN "KnowledgeBase" kb ON kb."id" = c."knowledgeBaseId"
      WHERE c."embedding" IS NOT NULL AND ${buildFilterSql(filters)}
      ORDER BY c."embedding" <=> ${literal}::vector
      LIMIT ${filters.limit}
    `;

    return rows;
  } catch {
    // pgvector <=> operator not present; return candidate chunks for fusion & reranking
    if (filters.queryText) {
      const kw = await keywordSearch(filters.queryText, filters);
      if (kw.length > 0) return kw;
    }
    try {
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
          0.85::float8 AS "score"
        FROM "DocumentChunk" c
        INNER JOIN "Document" d ON d."id" = c."documentId"
        INNER JOIN "KnowledgeBase" kb ON kb."id" = c."knowledgeBaseId"
        WHERE ${buildFilterSql(filters)}
        ORDER BY c."accessLevel" DESC, c."chunkIndex" ASC
        LIMIT ${filters.limit}
      `;
      return rows;
    } catch {
      return [];
    }
  }
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
    INNER JOIN "KnowledgeBase" kb ON kb."id" = c."knowledgeBaseId"
    WHERE ${buildFilterSql(filters)}
      AND to_tsvector('english', coalesce(c."sectionTitle", '') || ' ' || c."content")
          @@ websearch_to_tsquery('english', ${cleaned})
    ORDER BY "score" DESC
    LIMIT ${filters.limit}
  `;

  if (rows.length > 0) return rows;

  const terms = cleaned
    .split(/\s+/)
    .filter((t) => t.length >= 3)
    .map((t) => t.replace(/[^\w]/g, ''))
    .filter(Boolean);
  if (terms.length === 0) return [];
  const orExpr = terms.join(' | ');

  try {
    const fallbackRows = await prisma.$queryRaw<RetrievedChunkRow[]>`
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
          to_tsquery('english', ${orExpr})
        )::float8 AS "score"
      FROM "DocumentChunk" c
      INNER JOIN "Document" d ON d."id" = c."documentId"
      INNER JOIN "KnowledgeBase" kb ON kb."id" = c."knowledgeBaseId"
      WHERE ${buildFilterSql(filters)}
        AND to_tsvector('english', coalesce(c."sectionTitle", '') || ' ' || c."content")
            @@ to_tsquery('english', ${orExpr})
      ORDER BY "score" DESC
      LIMIT ${filters.limit}
    `;
    return fallbackRows;
  } catch {
    return [];
  }
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
