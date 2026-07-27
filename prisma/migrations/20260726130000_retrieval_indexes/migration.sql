-- Retrieval indexes.
--
-- Prisma models neither pgvector index types nor expression indexes, so these
-- are declared in raw SQL and kept in their own migration. `prisma migrate dev`
-- reports the ANN index as drift and offers to drop it; scripts/ensure-indexes.ts
-- restores both idempotently and is run by `db:seed` and `demo:reset`.
-- Production uses `prisma migrate deploy`, which never performs drift removal.

-- Approximate nearest-neighbour index for cosine distance. HNSW needs no
-- training pass, which suits an index that is rebuilt whenever documents are
-- reprocessed.
CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk"
  USING hnsw ("embedding" vector_cosine_ops);

-- Backs the keyword half of hybrid search. This expression must stay identical
-- to the one in keywordSearch() in lib/database/vector.ts, or the planner will
-- silently stop using the index.
CREATE INDEX IF NOT EXISTS "DocumentChunk_fts_idx"
  ON "DocumentChunk"
  USING GIN (to_tsvector('english', coalesce("sectionTitle", '') || ' ' || "content"));
