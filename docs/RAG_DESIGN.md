# RAG design

Every decision below exists to serve one property: **an answer is either supported by cited sources the caller is permitted to read, or it is refused.**

---

## Chunking

Structure-aware, hierarchical. Splitting happens at the strongest boundary that fits and falls to a weaker one only when it must:

```
page boundary  >  heading  >  blank line  >  sentence  >  word
```

**Page boundaries are hard.** A chunk never spans two pages, because a chunk carries one page number and that number is the citation target. A chunk spanning pages 4 and 5 records one of them, and a reader following the citation lands in the wrong place. This was found by a failing test, not by design.

**Headings close the current chunk.** A heading marks a topic change; letting one chunk straddle two topics degrades both.

**Sentences are not cut.** Sentence splitting protects abbreviations (`e.g.`, `Ltd.`), decimals (`29.99`), and treats a blank line as a hard boundary — without that last rule a heading glues onto the sentence beneath it, and an extractive answer reads _"Refund Window for Annual Subscriptions A customer on an annual subscription may…"_. Also found by looking at real output.

**Words are never cut.** The final fallback snaps to the last word boundary inside the window.

**Overlap is sentence-snapped.** The carry into the next chunk is built from whole sentences at the tail of the previous one, so it reads as language rather than a fragment. Overlap is dropped across a page boundary.

Every chunk carries: heading path, page number, chunk index, token estimate, a lowercased search projection, and the document's access level.

### Size in characters, not tokens

Tokenisation is provider-specific — 800 GPT tokens is a different amount of text than 800 tokens elsewhere. An administrator adjusting this on the settings page needs the number to mean something concrete. An estimated token count travels alongside for context budgeting, where an estimate suffices.

Defaults: 800 characters, 120 overlap.

---

## Embeddings

A provider interface with one demo implementation and four live ones. Every vector is fitted to the index width before storage; provider, model and dimensions are recorded per chunk so a provider change is _detectable_ rather than silently corrupting similarity scores.

### The demo provider

A hashed lexical projection. Tokens and their character 4-grams are hashed into a fixed-width vector using several independent hash functions with **signed** contributions, then L2-normalised so cosine similarity reduces to a dot product.

Signed contributions matter: they turn hash collisions into cancellation rather than systematic inflation. Character 4-grams give partial credit for shared word shapes, so "refund" and "refunds" land near each other without a stemmer being involved in the vector itself.

**What it is:** genuine retrieval. It ranks, it scores, and it fails honestly when it cannot match.

**What it is not:** semantic. It has no notion that "reimbursement" means "refund". A pure-synonym paraphrase retrieves poorly — and the system says so rather than guessing. `tests/retrieval/evaluation.test.ts` asserts exactly that, expecting the paraphrase case to _fail_ under demo embeddings. Making that test pass by weakening the assertion would be dishonest.

It exists so the platform is runnable end to end with no credentials.

---

## Retrieval

### 1. Query preparation

Follow-ups are the common case — _"Does that apply to annual subscriptions?"_ is nearly unsearchable alone. Referential questions are detected (continuation openers, back-references, very short questions with few content terms) and expanded with topical terms from recent turns.

Expansion draws **only from previous user turns**. An assistant turn is not a source of truth; treating it as one would let a bad answer steer the next retrieval.

Rewriting is deterministic and rule-based rather than a model call: it costs nothing, behaves identically in demo and live mode, and appears in the retrieval log — which matters, because a rewritten query changes what evidence the answer is built from.

Crucially it affects only _what is searched for_, never _what may be read_.

### 2. Access filter

Applied as a SQL predicate in the same statement as the vector search:

```sql
WHERE c."accessLevel"::text = ANY($1::text[])
  AND d."status" = 'INDEXED'
  AND d."archivedAt" IS NULL
```

The level is denormalised onto the chunk precisely so this needs no join. A restricted passage is never read into memory.

### 3. Hybrid search

Two searches run in parallel:

- **Vector** — cosine distance over pgvector with an HNSW index
- **Keyword** — `ts_rank` over a GIN-indexed tsvector

They complement rather than duplicate. `ts_rank` weights rare terms heavily, so an exact product name or policy number is found even when the embedding treats it as noise. The vector side finds passages that share meaning without sharing wording.

### 4. Fusion

Reciprocal rank fusion. Cosine similarity and `ts_rank` are not on comparable scales, so their _scores_ cannot be averaged — their _ranks_ can:

```
score(d) = Σ 1 / (k + rank_i(d))    k = 60
```

A passage appearing in both lists outranks one appearing in either alone.

### 5. Reranking

The first stage optimises recall; reranking optimises precision using signals the retrievers lack:

| Signal            | Weight | Rationale                                                                                                                                               |
| ----------------- | ------ | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Term coverage     | 0.42   | Share of the question's terms present, IDF-weighted. Dominant, because a passage that answers a question nearly always mentions most of what was asked. |
| First-stage score | 0.20   | Carries the fused ranking forward.                                                                                                                      |
| Proximity         | 0.16   | Terms in one sentence beat the same terms scattered across a page.                                                                                      |
| Term rarity       | 0.12   | A match on an unusual term is worth more than one on a common term.                                                                                     |
| Heading match     | 0.10   | A section title matching the question is a strong topical signal.                                                                                       |

Multiplied by a length penalty so a very long passage cannot win on volume. Ties break on a hash of the chunk id, making evaluation runs reproducible.

This is **lexical cross-scoring, not a cross-encoder model**. The interface says so, and the retrieval settings page displays it.

### 6. Access re-check

The same filter, in application code, on the survivors. In correct operation it drops nothing. If it ever fires it logs at error level — that would mean the SQL predicate had been weakened, which is a security incident rather than a warning.

---

## Confidence

Computed from **evidence, never from the answer**, so fluent prose cannot inflate it:

| Component | Weight | Measures                                                                                                                                           |
| --------- | ------ | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| Coverage  | 0.44   | Share of question terms present anywhere in the selected passages. Dominant, because an unanswerable question characteristically has low coverage. |
| Top score | 0.28   | Strength of the single best passage.                                                                                                               |
| Agreement | 0.18   | How many passages independently support the topic — distinguishes a real answer from one lucky match.                                              |
| Margin    | 0.10   | Separation between best and second. A flat distribution means nothing stood out.                                                                   |

Mapped to three states:

- **UNSUPPORTED** — no supporting passage and coverage below 0.5, or confidence below 75% of threshold
- **PARTIALLY_SUPPORTED** — below threshold, or above it with coverage under 0.6
- **SUPPORTED** — at or above threshold with adequate coverage

The gap between "clearly supported" and the threshold becomes _partial_ rather than being rounded up.

---

## Generation

### Unsupported short-circuits

An `UNSUPPORTED` verdict returns **without calling the model**. If the model runs it will produce fluent text, and fluent text is persuasive regardless of evidence. Deciding first means a failed retrieval cannot be rescued by good prose.

The refusal carries related sources the caller may see, the specific terms nothing was found for, and a route to a human.

### The trust boundary

Retrieved passages are wrapped in explicit delimiters. The system prompt states — before any data appears — that their contents are quoted material and never instructions. Forged delimiters and control tokens are stripped first.

The model receives no tools, no network access and no secrets. An instruction that crosses the boundary has nothing to act on. That is the control; the delimiters are depth.

### Citation validation

Whatever the model emits, every marker is checked against the passages supplied for **this** question. Unmatched markers are stripped from the text and logged — a `[7]` when six sources were given would otherwise render as a clickable citation pointing at nothing, which is worse than no citation because it looks authoritative.

Surviving markers are renumbered contiguously so the prose and the citation cards agree.

An answer with no markers that did not decline gets the strongest retrieved passages attached as fallback evidence. They are real retrieved passages, never invented, and the grounding label still reflects measured confidence.

### The demo generator

Extractive composition. Sentences from the retrieved sources are scored against the question, filtered (headings excluded, length-bounded), capped at two per source, and reassembled in source order with a citation marker after each.

Because it can only copy sentences present in the sources, it is **structurally incapable** of fabricating a fact or a citation. It also cannot follow an embedded instruction, because it does not interpret text at all.

It does not paraphrase or synthesise. Answers read as curated extracts. That is the honest trade for running with no credentials.

---

## Configuration

Runtime-tunable, validated on write _and_ on read, so a hand-edited database row cannot put the pipeline into an impossible state:

| Setting              | Default   | Constraint                    |
| -------------------- | --------- | ----------------------------- |
| Chunk size           | 800 chars | 200–4000                      |
| Chunk overlap        | 120 chars | Must be less than chunk size  |
| Retrieval count      | 10        | 1–50                          |
| Rerank count         | 5         | Cannot exceed retrieval count |
| Citation count       | 4         | Cannot exceed rerank count    |
| Confidence threshold | 0.65      | 0–1                           |
| History length       | 6 turns   | 0–20                          |
| Hybrid search        | on        | —                             |
| Query rewriting      | on        | —                             |

Chunk settings apply only to documents processed _after_ the change. The settings page says so, and the API response repeats it.

---

## Evaluation

Eleven cases across ten categories, run against the seeded corpus in CI:

```
cases            : 11
passed           : 11/11
retrieval hit    : 11/11
mean confidence  : 59.5%
mean latency     : 7 ms
```

Each case asserts retrieval reached the expected document, that grounding matches expectation, that a refusal carries no citations, and that every citation traces to a genuinely retrieved chunk. Access-control cases additionally assert the forbidden document appears in neither the retrieval nor the answer text.

**These are demo evaluation results on a small controlled set of fictional documents, using deterministic demo embeddings.** They show the pipeline retrieves, ranks, cites and refuses correctly on this corpus. They are not a general accuracy claim.
