# Architecture

## Shape

One Next.js 15 application. Server components read the database directly; route handlers serve mutations and the chat endpoint. One PostgreSQL instance holds both relational data and vectors.

```
app/                    routes
  page.tsx              landing (live figures from the database)
  demo/                 public demo, anonymous, PUBLIC role
  login/                authentication
  chat/                 authenticated conversation
  dashboard/            16 routes, each permission-gated server-side
  api/                  23 route handlers

lib/                    the system
  ai/                   prompt, providers, citation validation, answer orchestration
  analytics/            dashboard metrics, computed at request time
  auth/                 password, session, RBAC, route guards, login
  chat/                 turn orchestration and persistence
  database/             Prisma client, pgvector layer
  documents/            extraction, chunking, ingestion state machine
  embeddings/           provider interface, demo + 4 live providers
  observability/        structured logger, health checks
  reranking/            lexical cross-scoring, reciprocal rank fusion
  retrieval/            query preparation, search, confidence, settings
  security/             injection detection, SSRF guard, uploads, audit, rate limit
  storage/              local and Supabase adapters
```

## Request paths

### A question

```
POST /api/chat
  │
  ├─ guardRequest: origin → CSRF → rate limit → auth → permission
  ├─ validate question, detect injection patterns
  ├─ resolve or create conversation (ownership verified, not trusted)
  ├─ persist the user turn
  │
  ├─ retrieve()
  │    ├─ prepareQuery: expand follow-ups from prior USER turns only
  │    ├─ embedQuery
  │    ├─ vectorSearch   ─┐  both carry the access predicate in SQL
  │    ├─ keywordSearch  ─┘
  │    ├─ reciprocalRankFusion
  │    ├─ post-filter access (defence in depth; logs if it fires)
  │    ├─ rerank
  │    └─ calculateConfidence → determineGrounding
  │
  ├─ generateAnswer()
  │    ├─ UNSUPPORTED → return without calling the model
  │    ├─ buildPrompt: sources inside the untrusted boundary
  │    ├─ provider.generate
  │    └─ validateCitations against the supplied sources
  │
  ├─ persist assistant turn + citations + retrieval log
  ├─ raise escalation if warranted
  └─ audit
```

The two facts that matter: the access predicate is inside the SQL statement, and the grounding decision happens before the model is called.

### An upload

```
POST /api/documents
  │
  ├─ guard: permission document:upload, upload rate limit
  ├─ reject oversized bodies before buffering
  ├─ validateUpload: extension → declared MIME → magic bytes
  ├─ refuse an access level above the caller's own
  │
  └─ ingestSource()
       ├─ checksum → duplicate check (before any work)
       ├─ create Document + IngestionJob
       ├─ VALIDATION  → store original
       ├─ EXTRACTION  → per-page text; scan for injection patterns
       ├─ CHUNKING    → structure-aware, page-bounded
       ├─ EMBEDDING   → batched
       ├─ INDEXING    → chunks + vectors in ONE transaction
       └─ audit
```

Chunks and their vectors are written in a single transaction. A partially embedded document would answer questions from half its content — worse than a clean failure the operator can retry.

## Data model

16 models. The ones that carry the design:

**Document / DocumentChunk** — `accessLevel` is denormalised onto the chunk. Retrieval filters on the chunk, so the level must live there; a join would put the security predicate on the wrong side of the query plan. Changing a document's level updates every chunk in the same request.

**DocumentVersion** — records the embedding provider, model and dimensions used. This is what makes index drift detectable after a provider change instead of silently degrading similarity scores.

**Session** — stores `tokenHash`, never the token. A database leak cannot be replayed as a valid session.

**LoginAttempt** — keyed hash of the identifier, so lockout works without storing a plain email for every failed attempt, and survives restarts.

**RetrievalLog** — chunk _identifiers_ only, never chunk text. An operator reading traces cannot see content they could not retrieve themselves.

**AuditLog** — append-only. IP stored as a keyed hash. Values passed through the redactor before writing.

## Vector layer

Prisma cannot select `Unsupported("vector(768)")`, so every read and write of an embedding goes through `lib/database/vector.ts`. Two rules are enforced at that boundary:

1. The access filter is a `WHERE` clause, not a post-filter.
2. Vector literals are bound parameters cast in SQL, never concatenated.

Two indexes, in their own migration:

```sql
CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);

CREATE INDEX "DocumentChunk_fts_idx"
  ON "DocumentChunk" USING GIN (
    to_tsvector('english', coalesce("sectionTitle", '') || ' ' || "content")
  );
```

The GIN expression must stay identical to the one in `keywordSearch`, or the planner silently stops using it.

## Provider abstraction

Embeddings and language models sit behind interfaces with a demo implementation and live implementations. Selection is by environment variable, optionally overridden at runtime by an administrator — but an override naming a provider with no credential is ignored rather than obeyed, because silently failing every request is worse than continuing on the default.

Every provider vector is fitted to the index width before storage. Providers supporting native dimension reduction use it; others are truncated or zero-padded, and the health page reports which.

## Trust boundaries

```
TRUSTED                          UNTRUSTED
─────────────────────────────    ──────────────────────────────
system prompt                    user questions
application code                 document content
environment secrets              website content
role from the session            filenames, MIME types
                                 URLs
                                 conversation history
```

Everything on the right is data. The generator has no tools, no network egress and no secret access, so an instruction that crosses the boundary has nothing to act on. Injection detection is a signal for logging and escalation, not the control.

## What is deliberately absent

- **No queue.** Ingestion runs in-request. Simpler, and the operation is fast enough at this scale. `IngestionJob` already models the state a queue would need.
- **No cache.** Every dashboard figure is computed at request time. Correct by construction; the corpus is small.
- **No streaming.** Answers arrive complete. Streaming would complicate citation validation, which must see the whole answer.
- **No multi-tenancy.** Knowledge bases group documents but do not isolate tenants.
