import 'dotenv/config';
import { prisma } from '@/lib/database/client';

/**
 * Idempotently restores the retrieval indexes.
 *
 * `prisma migrate dev` reports the pgvector ANN index as schema drift and
 * offers to drop it, because Prisma has no way to model an index type on an
 * `Unsupported` column. Rather than leave the index at the mercy of a routine
 * dev command, this runs as part of seeding and demo reset so the indexes are
 * always present after either.
 *
 * Production applies migrations with `prisma migrate deploy`, which never
 * performs drift removal, so this is a development safeguard.
 */

export async function ensureRetrievalIndexes(): Promise<{ created: string[]; existing: string[] }> {
  const created: string[] = [];
  const existing: string[] = [];

  const before = await prisma.$queryRaw<{ indexname: string }[]>`
    SELECT indexname FROM pg_indexes WHERE tablename = 'DocumentChunk'
  `;
  const present = new Set(before.map((row) => row.indexname));

  if (present.has('DocumentChunk_embedding_hnsw_idx')) {
    existing.push('DocumentChunk_embedding_hnsw_idx');
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
         ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops)`,
    );
    created.push('DocumentChunk_embedding_hnsw_idx');
  }

  if (present.has('DocumentChunk_fts_idx')) {
    existing.push('DocumentChunk_fts_idx');
  } else {
    await prisma.$executeRawUnsafe(
      `CREATE INDEX IF NOT EXISTS "DocumentChunk_fts_idx"
         ON "DocumentChunk" USING GIN (to_tsvector('english', coalesce("sectionTitle", '') || ' ' || "content"))`,
    );
    created.push('DocumentChunk_fts_idx');
  }

  return { created, existing };
}

async function main() {
  const result = await ensureRetrievalIndexes();
  if (result.created.length > 0) {
    console.log(`Created retrieval indexes: ${result.created.join(', ')}`);
  }
  if (result.existing.length > 0) {
    console.log(`Already present: ${result.existing.join(', ')}`);
  }
}

// Only self-execute when run directly, so the seed can import the helper.
if (process.argv[1]?.includes('ensure-indexes')) {
  main()
    .catch((error) => {
      console.error('Failed to ensure retrieval indexes:', error);
      process.exitCode = 1;
    })
    .finally(() => prisma.$disconnect());
}
