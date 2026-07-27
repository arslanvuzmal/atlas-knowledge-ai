# Atlas Knowledge AI

## A secure RAG knowledge assistant

_Case study — export to PDF for portfolio use._

---

<div style="page-break-after: always"></div>

## Page 1 · Overview

**Atlas Knowledge AI** turns approved documents, websites, policies and manuals into a searchable conversational assistant — one that cites the document, section and page behind every claim, and refuses when the sources do not support an answer.

Built by **Arslan Vuzmal Lone**.

|                              |                                                                              |
| ---------------------------- | ---------------------------------------------------------------------------- |
| **Stack**                    | Next.js 15, React 19, TypeScript, PostgreSQL 16 + pgvector, Prisma, Tailwind |
| **Tests**                    | 265 automated — 221 unit/integration/retrieval/security, 44 end-to-end       |
| **Runs without credentials** | Deterministic demo providers; no API key required                            |
| **Licence**                  | MIT                                                                          |

The demonstration corpus describes **Northstar Cloud**, an invented company. Every document, figure and person in it is fictional.

---

<div style="page-break-after: always"></div>

## Page 2 · The business problem

Organisational knowledge is scattered across PDFs, wikis, spreadsheets and people's heads. Answering a routine question means knowing which document holds it and which version is current.

The obvious fix — point a chatbot at the pile — fails in a specific and dangerous way: **a general-purpose model will confidently invent an answer**, and nobody reading it can tell the difference between a fact retrieved from a policy and one the model produced because it sounded right.

For a support team, that is a wrong answer sent to a customer. For an HR question, it is a policy misstated as fact. The failure is silent, which is what makes it expensive.

A second problem compounds the first: not everyone should see everything. An employee handbook is not customer-facing; an incident-response procedure is not employee-facing. A knowledge assistant that ignores this is a data leak with a chat interface.

**What Atlas does differently.** Three properties are structural rather than aspirational:

1. **Citations cannot be fabricated.** Every marker the model emits is validated against the passages actually retrieved. Unmatched markers are deleted and logged.
2. **Access control cannot be bypassed.** Filtering is a SQL predicate against the caller's role, applied before retrieval and again after reranking.
3. **Unsupported questions are refused.** Grounding is decided from the evidence _before_ the model is called, so fluent prose cannot rescue a failed retrieval.

---

<div style="page-break-after: always"></div>

## Page 3 · Document ingestion

Six source types: PDF, Word, Markdown, plain text, CSV, and explicitly approved web pages, plus entries typed directly.

Ingestion is a state machine, and each stage reports its own status — so a failure names the stage that broke rather than presenting an opaque error:

```
UPLOADED → VALIDATING → EXTRACTING → CHUNKING → EMBEDDING → INDEXED
                                                          ↘ FAILED
```

**Validation.** Extension allowlist, declared MIME type checked against the extension, and magic bytes checked against the actual content — because the declared type on an upload is attacker-controlled. Filenames are reduced to a safe basename; traversal sequences and Windows reserved device names are neutralised.

**Extraction.** Per-page text with page identity preserved, because a page number is what a citation ultimately points at.

**Chunking.** Structure-aware and hierarchical: splitting happens at the strongest available boundary — page, then heading, then paragraph, then sentence, then word. Page boundaries are hard, because a chunk spanning two pages would record the wrong one and send a reader to the wrong place.

**Embedding and indexing.** Chunks and their vectors are written in a single transaction. A partially embedded document would answer questions from half its content, which is worse than a clean failure the operator can retry.

**Duplicate detection** runs on a SHA-256 of the source bytes, before any processing work happens.

![Document library](../../docs/assets/screenshots/04-documents.png)

---

<div style="page-break-after: always"></div>

## Page 4 · Retrieval and grounded answers

```
question
   ├─ validate, scan for injection patterns
   ├─ expand follow-ups from recent context
   ├─ ACCESS FILTER — SQL predicate on the caller's role
   ├─ vector search (cosine, HNSW)  ┐
   ├─ keyword search (tsvector)     ┴─ reciprocal rank fusion
   ├─ rerank: coverage · proximity · rarity · heading match
   ├─ ACCESS RE-CHECK — defence in depth
   ├─ confidence from evidence → SUPPORTED / PARTIAL / UNSUPPORTED
   │      └─ UNSUPPORTED short-circuits: the model is never called
   ├─ generate inside an untrusted-source boundary
   └─ validate every citation against what was retrieved
```

**Hybrid search** because the two methods fail differently. Vector search finds passages that share meaning without sharing wording; keyword search weights rare terms heavily, so an exact product name or policy number is found even when the embedding treats it as noise. Their scores are not comparable, so they are fused by _rank_ rather than score.

**Confidence is computed from the evidence, never the answer** — coverage of the question's terms, strength of the best passage, agreement across passages, and separation between best and second. A fluent answer cannot inflate it.

**Every claim carries a citation** to the document, section and page, with the verbatim excerpt available in one click.

![Chat with citations](../../docs/assets/screenshots/06-chat-citations.png)

---

<div style="page-break-after: always"></div>

## Page 5 · Access control and escalation

Five levels, carried on every document **and every passage**:

```
ADMIN     ██████████████████████████  Public · Customer · Employee · Manager · Admin
MANAGER   ██████████████████████      Public · Customer · Employee · Manager
EMPLOYEE  ████████████████            Public · Customer · Employee
CUSTOMER  ██████████                  Public · Customer
PUBLIC    █████                       Public
```

The level is denormalised onto the passage deliberately: retrieval filters on the passage, so the predicate belongs there. A restricted passage is never read out of the database — not read and then hidden.

A document above the caller's level returns **404, not 403**, so the API cannot be used to confirm that a restricted document exists. Related-source suggestions and answer text are filtered by the same rules.

**Human escalation** is raised automatically on low confidence, an unsupported answer, negative feedback, or a detected injection attempt — and on explicit request. Each carries the conversation summary, the retrieved sources, a suggested reply, priority and assignee, so a human can act without opening the transcript.

![Access refusal](../../docs/assets/screenshots/08-access-refusal.png)

---

<div style="page-break-after: always"></div>

## Page 6 · Dashboard and analytics

Sixteen dashboard routes, each permission-gated server-side. Every figure is computed from recorded activity at request time — none is illustrative.

Measured: grounded-answer rate, unsupported rate, mean confidence, retrieval latency, most-cited documents, most-asked questions, and **content gaps** — the questions that retrieved poorly, which are the documents worth writing next.

The health page reports a state for each component that reflects a check performed at page load. Nothing defaults to "operational"; a component that could not be probed reports UNAVAILABLE, and one intentionally running on local providers reports DEMO rather than pretending to be production.

![Analytics](../../docs/assets/screenshots/02-analytics.png)

---

<div style="page-break-after: always"></div>

## Page 7 · Results, safeguards, limitations

### Demonstrated

Against the fictional Northstar Cloud corpus, using deterministic demo embeddings:

```
evaluation cases : 11
passed           : 11/11
retrieval hit    : 11/11
mean confidence  : 59.5%
mean latency     : 7 ms
```

Covering exact, paraphrased, follow-up, multi-document, unsupported, restricted, injection, ambiguous, pricing and refund questions.

**These are demo evaluation results on a controlled set.** They show the pipeline retrieves, ranks, cites and refuses correctly on this corpus. They are not a general accuracy claim and say nothing about a different corpus.

### Safeguards

Access filtering in SQL applied twice · injection detection across eight categories, with a generator that has no tools, no network and no secrets · SSRF prevention with DNS resolution checked against reserved ranges and every redirect re-validated · upload validation by extension, MIME and magic bytes · scrypt password hashing with database-backed lockout · session tokens stored only as hashes · CSRF, origin checks, rate limiting · log redaction · audit trail with keyed-hash IP storage.

### Honest limitations

- **Demo embeddings are lexical, not semantic.** Pure-synonym paraphrases retrieve poorly. A test asserts this rather than hiding it. Configuring a real provider and reprocessing fixes it.
- **No OCR.** Scanned PDFs without a text layer produce no extractable text; the failure is reported explicitly.
- **Rate limiting is in-process.** Correct on one instance; a multi-instance deployment needs shared state.
- **Reranking is lexical**, not a cross-encoder. The interface says so.
- **English-tuned**, single-tenant, no streaming.
- **No external security audit.**

### Possible extensions

Semantic cross-encoder reranking · streaming responses · OCR · multi-tenant isolation · scheduled URL re-crawling · Redis-backed rate limiting and a job queue.

---

_Northstar Cloud is an invented company. No real organisation, client, or result is described in this document._
