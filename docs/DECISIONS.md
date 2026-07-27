# Architecture decisions

Each entry records what was chosen, what it was chosen over, and what it costs. Decisions that turned out to be wrong stay in the record with a note rather than being edited out.

---

## 1. One TypeScript application, not an application plus a Python worker

**Chosen:** ingestion, embedding, retrieval and generation all run inside the Next.js application.

**Over:** a FastAPI service handling ingestion and retrieval, with Next.js as a front end.

**Why:** every operation needed here — PDF and DOCX extraction, chunking, embedding calls, vector queries — has a mature TypeScript implementation of equal quality. A second service would add a second deploy target, a network hop on every ingestion, an internal authentication surface to secure, and a second dependency tree to patch. The Python ecosystem's advantage is in model training and numerical work, neither of which this project does.

**Cost:** if the project later needed local transformer inference or heavy numerical processing, that work would have to move out. The storage and embedding interfaces are provider-shaped, so extraction to a service later is a contained change rather than a rewrite.

---

## 2. PostgreSQL with pgvector, not a dedicated vector database

**Chosen:** one PostgreSQL instance holding relational data and vectors, with an HNSW index for cosine distance.

**Over:** Pinecone, Weaviate, Qdrant, or Chroma alongside PostgreSQL.

**Why:** the access-control filter is the single most important property of this system, and it must be applied _inside_ the query that fetches passages. With pgvector, `accessLevel = ANY(...)` is a predicate in the same statement as the ANN search. With a separate vector store, the filter either has to be replicated into that store's metadata filtering — a second source of truth for a security control — or applied after retrieval, which means restricted content is read into application memory before being discarded.

It also means one backup, one connection string, one migration path, and transactional consistency between a document and its passages.

**Cost:** pgvector's HNSW is not as fast as a purpose-built store at very large scale. At this corpus size the difference is unmeasurable; the crossover is in the millions of vectors.

---

## 3. Deterministic demo providers, not a "coming soon" mode

**Chosen:** a hashed-lexical embedding provider and an extractive answer generator that make the entire platform work with zero credentials.

**Over:** requiring an API key to run anything, or stubbing the AI layer with canned responses.

**Why:** a project that cannot be run cannot be evaluated. Canned responses would be dishonest — the demonstration would show a pipeline that does not exist. A deterministic lexical retriever is genuinely doing retrieval: it ranks, it scores, it fails honestly when it cannot match. The extractive generator can only copy sentences that are present in the retrieved sources, so it is structurally incapable of fabricating a fact or a citation.

**Cost:** the demo has no semantic understanding. "Reimbursement" will not match "refund". This is stated in the README, on the dashboard, in the code comments, and asserted by a test that expects a pure-synonym paraphrase to _fail_ rather than quietly pass.

---

## 4. Chunk size measured in characters, not tokens

**Chosen:** chunk size and overlap are character counts.

**Over:** token counts from a tokeniser.

**Why:** tokenisation is provider-specific. A chunk sized in GPT tokens is a different size in Claude tokens and different again in a local model. An administrator adjusting the value on the settings page needs it to mean something concrete and predictable. Characters are exact, provider-independent, and directly visible in the source text.

An estimated token count is carried alongside each chunk for context budgeting, where an estimate is sufficient.

**Cost:** a chunk of 800 characters is a different number of tokens in dense technical prose than in ordinary text. Context budgeting uses the estimate rather than the character count, so this does not cause overruns.

---

## 5. Custom scrypt authentication, not NextAuth

**Chosen:** scrypt password hashing with database-backed sessions.

**Over:** NextAuth/Auth.js.

**Why:** the requirement is narrow — email and password, five roles, server-enforced permissions. NextAuth's value is in OAuth provider integration, which this project does not use. Against that, it would bring an adapter layer, its own session model, and a dependency in the most security-critical path.

Writing it directly is roughly 200 lines and makes every property inspectable: the session token is stored only as a SHA-256, so a database leak cannot be replayed; failed attempts are counted in the database, so lockout survives a restart and works across instances; the failure path costs the same whether or not the account exists, so response timing is not an enumeration oracle.

**Cost:** no OAuth. Adding it would mean adopting a library or writing more code. The `User` model already carries `externalId` for that path.

---

## 6. Hand-built SVG charts, not a charting library

**Chosen:** inline SVG components.

**Over:** Recharts, Chart.js, or Visx.

**Why:** the shapes required are a line chart, horizontal bars, a segmented bar and a meter. Each is well under a hundred lines. A library would add 50–150 KB to the bundle and then have to be fought to comply with the design system's mark specifications — 2px strokes, 4px rounded data ends, a 2px surface gap between adjacent fills, direct labels on selected marks only, and text tokens rather than series colours for all labels.

Building them directly also made the accessible table fallback and the crosshair hover layer straightforward rather than a wrapper around library internals.

**Cost:** no free zoom, brush, or animation. None is needed here.

---

## 7. Colour tokens generated in OKLCH and validated, not chosen by eye

**Chosen:** chart colours were generated in OKLCH and checked with a validator against the chart surface. The three-slot categorical set passes lightness band, chroma floor, colour-vision-deficiency separation (worst adjacent deutan ΔE 17.4 against a floor of 8.0), normal-vision separation, and 3:1 contrast.

**Over:** picking hex values that look good.

**Why:** colourblind-safety is computable. Roughly 1 in 12 men has a colour vision deficiency; a palette that fails deutan separation is unreadable for them, and eyeballing cannot detect it. The first three candidate palettes failed — including the visually appealing cyan/violet pairing at equal lightness — which is exactly the point of measuring.

**Cost:** the accent is a slightly deeper cyan than a purely aesthetic choice would have picked. Recorded in [`DESIGN_SYSTEM.md`](DESIGN_SYSTEM.md).

---

## 8. A single dark appearance, not a light/dark toggle

**Chosen:** one validated dark theme.

**Over:** shipping both.

**Why:** a light theme is not an inversion. Every colour would need re-stepping and re-validating against a white surface, and the first attempt at a light categorical set failed the chroma floor. Shipping an unvalidated light mode would mean shipping a set of colours that had not passed the checks the dark set had to pass.

**Cost:** users who prefer light interfaces are not served. Honest, and recorded, rather than hidden behind a broken toggle.

---

## 9. Retrieval indexes in their own migration, with an idempotent repair

**Chosen:** the pgvector HNSW index and the full-text GIN index live in a dedicated migration, plus `scripts/ensure-indexes.ts` which recreates them idempotently as part of seeding.

**Over:** leaving them in the initial migration.

**Why:** Prisma cannot model an index type on an `Unsupported` column, so `prisma migrate dev` sees the ANN index as schema drift and offers to drop it. During development it did exactly that. Separating the indexes and adding a repair step means a routine dev command cannot silently disable vector search. Production uses `migrate deploy`, which never performs drift removal.

**Cost:** one extra migration and a script. Cheap against silently losing the ANN index.

---

## 10. Unsupported answers short-circuit before generation

**Chosen:** grounding is decided from retrieval evidence, and an `UNSUPPORTED` verdict returns without calling the model.

**Over:** always generating, then judging the answer.

**Why:** if the model runs, it will produce fluent text, and fluent text is persuasive regardless of whether evidence supports it. Deciding first means a failed retrieval cannot be rescued by good prose. It also makes the refusal path free and instant, and removes any chance of an injected instruction influencing a case where there was nothing legitimate to say.

**Cost:** a case where retrieval scores poorly but a model could still have assembled a correct answer from weak evidence now refuses. That trade is deliberate: a refusal is recoverable, a confident wrong answer is not.

---

## 11. Citations validated after generation, not trusted

**Chosen:** every citation marker the model emits is checked against the passages supplied for that question. Unmatched markers are stripped and logged.

**Over:** rendering whatever the model produced.

**Why:** this is the mechanism behind "never fabricate a citation". A model asked for citations will sometimes emit `[7]` when six sources were supplied. Without validation that becomes a clickable citation pointing at nothing, which is worse than no citation because it looks authoritative.

Markers are then renumbered to a contiguous sequence so the prose and the citation cards agree.

**Cost:** an answer whose markers are all invalid loses its citations and is downgraded to partially supported. Correct: an answer that cannot show its sources has not demonstrated grounding.

---

## 12. Page boundaries are hard chunk boundaries

**Chosen:** a chunk never spans two pages.

**Over:** allowing chunks to flow across pages for better semantic continuity.

**Why:** found by a failing test. A chunk carries one page number, used as the citation target. If it spans pages 4 and 5, its recorded page is wrong for part of its content, and a reader following the citation lands in the wrong place. A citation that points at the wrong page is a correctness failure, not a formatting nit.

**Cost:** slightly smaller chunks at page boundaries, and overlap dropped across them. Worth it for citations that can be trusted.
