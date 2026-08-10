DO $$
BEGIN
  CREATE EXTENSION IF NOT EXISTS vector;
  CREATE INDEX IF NOT EXISTS "DocumentChunk_embedding_hnsw_idx"
    ON "DocumentChunk"
    USING hnsw ("embedding" vector_cosine_ops);
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pgvector extension not installed; skipping HNSW index creation.';
END $$;

-- Backs the keyword half of hybrid search. This expression must stay identical
-- to the one in keywordSearch() in lib/database/vector.ts, or the planner will
-- silently stop using the index.
CREATE INDEX IF NOT EXISTS "DocumentChunk_fts_idx"
  ON "DocumentChunk"
  USING GIN (to_tsvector('english', coalesce("sectionTitle", '') || ' ' || "content"));
