# Database design

PostgreSQL 16 with pgvector. Sixteen models. Relational data and vectors live in the same database deliberately — see [`DECISIONS.md`](DECISIONS.md#2-postgresql-with-pgvector-not-a-dedicated-vector-database).

---

## Identity

### User

`id · name · email(unique) · passwordHash? · externalId?(unique) · role · status · isDemo · lastLoginAt · timestamps`

`passwordHash` is nullable and `externalId` exists so an external identity provider can be added without a migration. `isDemo` gates authentication: a demo account is rejected when `DEMO_MODE` is off, so a production deployment cannot ship with known credentials.

### Session

`id · tokenHash(unique) · userId · expiresAt · ipHash? · userAgentHash? · revokedAt? · createdAt`

Stores the **SHA-256 of the token**, never the token. A database leak cannot be replayed as a valid session. `revokedAt` allows immediate invalidation on a role change rather than waiting for expiry. IP and user agent are keyed hashes.

### LoginAttempt

`id · identifierHash · successful · createdAt`

Lockout state in the database rather than in process memory, so it survives restarts and applies across serverless instances. The identifier is a keyed hash — the table never holds a plain email for a failed attempt. Indexed on `(identifierHash, createdAt)` for the sliding-window count.

---

## Knowledge

### Document

`id · knowledgeBaseId · title · originalFilename? · sourceType · mimeType? · storagePath? · sourceUrl? · checksum · status · accessLevel · language · fileSize · pageCount? · chunkCount · currentVersion · lastError? · uploadedBy? · archivedAt? · timestamps`

```prisma
@@unique([knowledgeBaseId, checksum])
```

Duplicate detection is scoped to the knowledge base. The same bytes may legitimately exist in two collections, but never twice in one — and the check runs on the SHA-256 before any extraction work happens.

`status` is the ingestion state machine: `UPLOADED → VALIDATING → EXTRACTING → CHUNKING → EMBEDDING → INDEXED`, with `FAILED` and `ARCHIVED` as terminals. `lastError` records the stage and message so a failure is actionable rather than opaque.

### DocumentChunk

`id · documentId · documentVersionId · chunkIndex · content · tokenCount · pageNumber? · sectionTitle? · accessLevel · knowledgeBaseId · searchText · metadata? · embeddingProvider? · embeddingModel? · embedding · createdAt`

**`accessLevel` and `knowledgeBaseId` are denormalised from the parent.** This is the single most important design decision in the schema. Retrieval filters on the chunk, so those columns must live on the chunk — a join would put the security predicate on the wrong side of the query plan, and the point is that a restricted passage is never read at all.

The cost is that changing a document's access level must update every chunk. That happens in the same request, and there is a test asserting it.

`embedding` is `Unsupported("vector(768)")`. Prisma cannot select it, so all vector access goes through `lib/database/vector.ts`.

```prisma
@@unique([documentVersionId, chunkIndex])
```

### DocumentVersion

`id · documentId · version · checksum · storagePath? · processingStatus · extractedText? · pageCount? · embeddingProvider? · embeddingModel? · embeddingDimensions? · createdAt`

Records which provider and model produced the vectors. This is what makes index drift _detectable_ after a provider change, instead of silently producing incomparable vectors in one index.

---

## Conversations

### Conversation

`id · userId? · knowledgeBaseId? · title · status · anonymousKey? · timestamps`

`userId` and `anonymousKey` are mutually exclusive. Public demo visitors get a random key in an HTTP-only cookie, so their history is theirs alone and a conversation id is not sufficient to join someone else's thread. Ownership is verified server-side on every access, never trusted from the request.

### Message

`id · conversationId · role · content · confidence? · grounded? · modelProvider? · modelName? · latencyMs? · flagged · createdAt`

Provenance travels with the answer: which provider, which model, how confident, how well grounded. `flagged` marks a turn where injection patterns were detected.

### Citation

`id · messageId · documentId · chunkId? · pageNumber? · sectionTitle? · excerpt · relevanceScore · ordinal · createdAt`

The excerpt is stored rather than re-derived, so a citation still displays correctly after the document is reprocessed and its chunks change. `chunkId` is nullable with `onDelete: SetNull` for the same reason.

### Feedback / Escalation

Feedback carries an optional structured reason. Escalation carries the conversation summary, retrieved sources, a suggested reply, priority, status and assignee — enough for a human to act without opening the transcript.

---

## Operations

### IngestionJob

`id · documentId · status · stage · progress · attemptCount · lastError? · correlationId? · startedAt? · completedAt? · timestamps`

Ingestion currently runs in-request, but this models the state a queue would need — so moving to a worker changes the invocation, not the schema. The health page reads it to detect jobs stuck over fifteen minutes.

### RetrievalLog

`id · conversationId? · query · rewrittenQuery? · retrievedChunkIds[] · rerankedChunkIds[] · candidateCount · filteredCount · confidence · grounding? · accessLevel · latencyMs · traceId? · createdAt`

**Chunk identifiers only, never chunk text.** An operator reading retrieval traces must not see content they would not be permitted to retrieve themselves.

### AuditLog

`id · userId? · action · entityType · entityId? · previousData? · newData? · metadata? · ipHash? · createdAt`

Append-only by convention — the application never updates or deletes. The database user _can_, which is an accepted gap named in [`PRODUCTION_HARDENING.md`](PRODUCTION_HARDENING.md). All JSON fields pass through the redactor before writing.

### SystemSetting / Integration

Settings are validated on write and again on read, so a hand-edited row cannot break the pipeline. `Integration.configurationMetadata` holds non-secret metadata only — API keys live in environment variables and never touch the database.

---

## Indexes

Beyond the primary keys and unique constraints:

```sql
-- Approximate nearest neighbour. HNSW over IVFFlat because it needs no
-- training pass, which suits an index rebuilt whenever documents are
-- reprocessed.
CREATE INDEX "DocumentChunk_embedding_hnsw_idx"
  ON "DocumentChunk" USING hnsw ("embedding" vector_cosine_ops);

-- Keyword half of hybrid search. This expression must stay byte-identical to
-- the one in keywordSearch(), or the planner silently stops using it.
CREATE INDEX "DocumentChunk_fts_idx"
  ON "DocumentChunk" USING GIN (
    to_tsvector('english', coalesce("sectionTitle", '') || ' ' || "content")
  );
```

Both live in their own migration. Prisma cannot model an index type on an `Unsupported` column, so `prisma migrate dev` reports the ANN index as drift and offers to drop it — which it did, during development. `scripts/ensure-indexes.ts` restores both idempotently as part of seeding. Production uses `migrate deploy`, which never removes drift.

Composite indexes support the hot queries: `(knowledgeBaseId, accessLevel)` on chunks, `(knowledgeBaseId, status)` on documents, `(conversationId, createdAt)` on messages, `(status, priority)` on escalations.

---

## Cascade rules

Deliberate rather than uniform:

| Relation                          | Rule    | Why                                                      |
| --------------------------------- | ------- | -------------------------------------------------------- |
| Document → Chunk, Version, Job    | Cascade | Meaningless without the parent                           |
| Conversation → Message → Citation | Cascade | Deleting a conversation removes its content              |
| User → Session                    | Cascade | Sessions cannot outlive the account                      |
| User → Document.uploadedBy        | SetNull | The document survives the uploader leaving               |
| User → AuditLog                   | SetNull | **The trail must survive account deletion**              |
| Chunk → Citation.chunkId          | SetNull | The citation keeps its stored excerpt after reprocessing |

The audit rule is the one that matters: cascading there would let deleting an account erase the record of what it did.

---

## Transactions

Chunk creation and vector writes happen in one transaction. A partially embedded document would answer questions from half its content — worse than a clean failure the operator can retry.

Reprocessing deletes chunks, versions and the document, then re-ingests, so a reprocess with new settings fully rebuilds rather than mixing generations.
