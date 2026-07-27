<div align="center">

# Atlas Knowledge AI

**A secure RAG knowledge platform that turns approved documents, websites, policies, manuals and business information into a searchable conversational assistant — with source citations, access controls, feedback analytics and human escalation.**

![Status](https://img.shields.io/badge/status-demo%20ready-00a3c3)
![Tests](https://img.shields.io/badge/tests-221%20passing-4fa866)
![E2E](https://img.shields.io/badge/e2e-44%20passing-4fa866)
![TypeScript](https://img.shields.io/badge/TypeScript-strict-5a58c2)
![License](https://img.shields.io/badge/license-MIT-7d879f)

</div>

![Analytics dashboard](docs/assets/screenshots/02-analytics.png)

---

## The problem

Business knowledge is scattered. Policies live in PDFs, procedures in a wiki, pricing in a spreadsheet, and the real answer in someone's head. Point a general-purpose chatbot at that mess and it will confidently invent an answer — which is worse than no answer, because nobody can tell the difference.

## The approach

Atlas answers only from approved sources, cites the document, section and page behind every claim, and refuses when the sources do not support an answer. Access control is enforced in the database query, so a passage a user may not read is never retrieved in the first place.

Three properties are structural rather than aspirational:

| Guarantee                    | How it holds                                                                                                                                                                                      |
| ---------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **No fabricated citations**  | Whatever the model emits, every citation marker is validated against the passages actually retrieved for that question. A marker with no matching source is deleted from the answer and logged.   |
| **No access-control bypass** | Filtering happens as a SQL predicate against the caller's role, then again after reranking as defence in depth. Text inside a document cannot widen what is retrievable.                          |
| **No unsupported answers**   | Grounding is decided from the retrieval evidence _before_ generation runs. An unsupported verdict short-circuits the model entirely, so fluent prose cannot talk its way past a failed retrieval. |

---

## Live demo

> Deployment pending — see [Deployment](#deployment). The application runs locally with no API credentials; see [Quick start](#quick-start).

### Demo accounts

All demo accounts use the password `AtlasDemo!2026` and **only authenticate while `DEMO_MODE=true`**, so a production deployment never ships with known credentials.

| Role          | Email                          | Reaches                                     |
| ------------- | ------------------------------ | ------------------------------------------- |
| Administrator | `admin@atlasknowledge.demo`    | Everything, plus configuration and audit    |
| Manager       | `manager@atlasknowledge.demo`  | Internal procedures, escalations, analytics |
| Employee      | `employee@atlasknowledge.demo` | Handbook and sales material                 |
| Customer      | `customer@atlasknowledge.demo` | Customer-approved sources                   |
| Public viewer | `viewer@atlasknowledge.demo`   | Public documentation only                   |

Ask every account _"How many days of annual leave do employees receive?"_ to watch access control decide the answer.

---

## Core features

**Ingestion** — PDF, DOCX, TXT, Markdown, CSV, approved URLs, and typed entries. Validation, extraction, chunking, embedding and indexing each report their own state, so a failure names the stage that broke and can be retried.

**Retrieval** — Vector similarity over pgvector fused with PostgreSQL full-text search by reciprocal rank, then reranked on term coverage, proximity, term rarity and heading match.

**Grounded answers** — Direct answer, citations to document/section/page, a verbatim excerpt, and a confidence figure computed from the evidence rather than the wording.

**Access control** — Five levels (Public → Customer → Employee → Manager → Admin) carried on every document _and_ every passage.

**Human escalation** — Raised automatically on low confidence, unsupported answers, negative feedback, or detected injection attempts, and on explicit request. Each carries the conversation summary, retrieved sources, and a suggested reply.

**Analytics** — Grounded-answer rate, unsupported rate, mean confidence, retrieval latency, most-cited documents, most-asked questions, and content gaps. All computed from recorded activity.

**Observability** — Structured logs with correlation IDs and secret redaction, an append-only audit trail, and a health page where every component state reflects a check performed at page load.

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  Next.js 15 (App Router) — server components + route handlers    │
│                                                                   │
│  /  /demo  /login  /chat  /dashboard/*        /api/*             │
└────────────────────────────┬─────────────────────────────────────┘
                             │
        ┌────────────────────┼────────────────────┐
        ▼                    ▼                    ▼
┌───────────────┐   ┌────────────────┐   ┌─────────────────┐
│  Ingestion    │   │   Retrieval    │   │  Auth + RBAC    │
│               │   │                │   │                 │
│ validate      │   │ rewrite query  │   │ scrypt N=32768  │
│ extract       │   │ SQL access     │   │ DB sessions     │
│ chunk         │   │   filter       │   │ 5-level ladder  │
│ embed         │   │ vector + FTS   │   │ permission map  │
│ index         │   │ RRF fusion     │   └─────────────────┘
└───────┬───────┘   │ rerank         │
        │           │ confidence     │
        │           └────────┬───────┘
        │                    │
        ▼                    ▼
┌──────────────────────────────────────────┐
│  PostgreSQL 16 + pgvector                │
│  HNSW cosine index · GIN full-text index │
└──────────────────────────────────────────┘
```

**Single TypeScript application, no separate Python worker.** Ingestion, embedding and retrieval are all implementable in TypeScript at equal quality; a second service would add a deploy target, a network hop and an internal-auth surface for no functional gain. Recorded in [`docs/DECISIONS.md`](docs/DECISIONS.md).

### RAG pipeline

```
question
   │
   ├─ validate + scan for injection patterns
   ├─ resolve follow-ups from recent conversation context
   ├─ ACCESS FILTER  ← SQL predicate on the caller's role
   ├─ vector search (pgvector, cosine)  ┐
   ├─ keyword search (tsvector)         ┴─ reciprocal rank fusion
   ├─ rerank: coverage · proximity · rarity · heading match
   ├─ ACCESS RE-CHECK  ← defence in depth; logs loudly if it ever fires
   ├─ confidence from evidence → SUPPORTED / PARTIAL / UNSUPPORTED
   │       └─ UNSUPPORTED short-circuits: the model is never called
   ├─ generate inside an untrusted-source boundary
   └─ validate every citation against what was retrieved
```

### Access control

```
ADMIN     ██████████████████████████  Public · Customer · Employee · Manager · Admin
MANAGER   ██████████████████████      Public · Customer · Employee · Manager
EMPLOYEE  ████████████████            Public · Customer · Employee
CUSTOMER  ██████████                  Public · Customer
PUBLIC    █████                       Public
```

A role reads its own level and everything below. Content classification and action permissions are separate: "can read manager documents" and "can delete any document" are different authorities.

---

## Screenshots

|                                                                                                          |                                                                                  |
| -------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| ![Chat with citations](docs/assets/screenshots/06-chat-citations.png) **Grounded answer with citations** | ![Source drawer](docs/assets/screenshots/07-source-drawer.png) **Source drawer** |
| ![Access refusal](docs/assets/screenshots/08-access-refusal.png) **Access control refusing an answer**   | ![Documents](docs/assets/screenshots/04-documents.png) **Document library**      |
| ![Escalations](docs/assets/screenshots/09-escalations.png) **Human escalation queue**                    | ![Health](docs/assets/screenshots/12-system-health.png) **System health**        |
| ![Retrieval settings](docs/assets/screenshots/10-retrieval-settings.png) **Retrieval configuration**     | ![Mobile](docs/assets/screenshots/15-mobile-chat.png) **Mobile chat**            |

All screenshots are captured from the running application by `npm run portfolio:capture`. None are mockups.

---

## Technology

| Layer       | Choice                                    | Why                                                             |
| ----------- | ----------------------------------------- | --------------------------------------------------------------- |
| Application | Next.js 15, React 19, TypeScript (strict) | Server components read the database directly; one deploy target |
| Database    | PostgreSQL 16 + pgvector                  | HNSW ANN index and full-text search in one system               |
| ORM         | Prisma 6                                  | Typed access; raw SQL only where pgvector requires it           |
| Styling     | Tailwind CSS                              | Design tokens generated in OKLCH and colour-validated           |
| Auth        | scrypt + database-backed sessions         | No dependency for something this security-critical              |
| Charts      | Hand-built inline SVG                     | Small bundle; full control over mark and label policy           |
| Testing     | Vitest + Playwright                       | 221 unit/integration/retrieval/security, 44 end-to-end          |

---

## Quick start

**Requirements:** Node.js 20+, Docker.

```bash
git clone https://github.com/avuzmal/atlas-knowledge-ai.git
cd atlas-knowledge-ai
npm install

cp .env.example .env
# Generate the two required secrets:
node -e "console.log('AUTH_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
node -e "console.log('INTERNAL_API_SECRET='+require('crypto').randomBytes(32).toString('hex'))"
# Set DATABASE_URL and DIRECT_URL to:
#   postgresql://atlas:atlas_local_dev@localhost:5434/atlas?schema=public

npm run db:up            # PostgreSQL 16 + pgvector on port 5434
npm run db:migrate:deploy
npm run db:seed          # fictional corpus, users, conversations

npm run dev              # http://localhost:3000
```

Sign in with `admin@atlasknowledge.demo` / `AtlasDemo!2026`, or open `/demo` without an account.

Port 5434 is used deliberately so it does not collide with an existing local PostgreSQL on 5432.

### Scripts

| Command                           | Does                                                 |
| --------------------------------- | ---------------------------------------------------- |
| `npm run dev` / `build` / `start` | Development, production build, production server     |
| `npm run verify`                  | format check → lint → typecheck → all tests → build  |
| `npm test`                        | Unit, integration, retrieval and security suites     |
| `npm run test:e2e`                | Playwright, against a production build               |
| `npm run db:up` / `db:down`       | Start/stop the database container                    |
| `npm run db:migrate:deploy`       | Apply migrations (production-safe)                   |
| `npm run db:seed`                 | Seed the fictional corpus and demo activity          |
| `npm run demo:reset`              | Clear demo activity (`--full` also drops the corpus) |
| `npm run portfolio:capture`       | Regenerate every screenshot                          |

---

## Demo mode

The entire platform runs with **no paid credentials**. Two deterministic providers stand in:

**Embeddings** — a hashed lexical projection. Tokens and their character 4-grams are hashed into a fixed-width vector with signed contributions, then L2-normalised, so cosine similarity approximates weighted term overlap with partial credit for shared word shapes.

**Answer generation** — extractive composition. Sentences are scored against the question and assembled with a citation marker after each. Because it can only copy sentences present in the retrieved sources, it is _incapable_ of fabricating a fact or a citation.

**What this is not:** semantic. The demo embedder has no notion that "reimbursement" and "refund" mean the same thing. A pure-synonym paraphrase will retrieve poorly — and the system will say so rather than guess. There is an explicit test asserting exactly that behaviour ([`tests/retrieval/evaluation.test.ts`](tests/retrieval/evaluation.test.ts)).

Set `EMBEDDING_PROVIDER` and `LLM_PROVIDER` to a live service and reprocess to get semantic quality. Supported: OpenAI, Anthropic, Google Gemini, OpenRouter, Hugging Face, Ollama.

---

## Testing

```bash
npm run verify        # the full gate
npm run test:e2e      # browser journey, 44 tests
```

| Suite       | Count | Covers                                                                                                                                                                    |
| ----------- | ----- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Unit        | 156   | Chunking, embeddings, reranking, confidence, citations, RBAC matrix, injection detection, SSRF ranges, upload validation, password hashing, log redaction, env validation |
| Integration | 19    | Full ingestion pipeline, duplicate detection, failure recording, reprocessing, chat persistence, citations, escalation, audit                                             |
| Retrieval   | 15    | 11-case evaluation set: exact, paraphrase, follow-up, multi-document, unsupported, restricted, injection, ambiguous, pricing, refund                                      |
| Security    | 31    | Access ladder across all five roles, SQL-level filtering, restricted-title leakage, 10 injection attacks, auth enumeration, lockout, SSRF, audit integrity                |
| End-to-end  | 44    | Public demo, auth, roles, ingestion, chat, feedback, escalation, every dashboard route, mobile layout                                                                     |

### Demo evaluation results

Against the fictional Northstar Cloud corpus, using deterministic demo embeddings:

```
cases            : 11
passed           : 11/11
retrieval hit    : 11/11 cases retrieved at least one permitted passage
mean confidence  : 59.5%
mean latency     : 7 ms
```

**These are demo evaluation results on a small controlled set.** They demonstrate that the pipeline retrieves, ranks, cites and refuses correctly on this corpus. They are not a general accuracy claim and say nothing about performance on a different corpus. Regenerate with `npm run test:retrieval`.

---

## Security

Documented in [`SECURITY.md`](SECURITY.md), [`docs/THREAT_MODEL.md`](docs/THREAT_MODEL.md) and [`docs/PRODUCTION_HARDENING.md`](docs/PRODUCTION_HARDENING.md).

- Access filtering as a SQL predicate, applied twice
- Prompt-injection detection across 8 categories, with an architectural boundary that makes compliance impossible: the generator has no tools, no network egress, no secrets
- SSRF prevention with DNS resolution checked against private and reserved ranges, and every redirect hop re-validated
- Upload validation by extension, declared MIME, and magic bytes
- scrypt password hashing (N=32768, r=8), database-backed lockout
- HTTP-only session cookies storing only a SHA-256 of the token
- CSRF double-submit, origin checking, rate limiting
- Log redaction of API keys, connection strings and JWTs
- Audit trail with keyed-hash IP storage

**This is not a claim of absolute security.** It is a demonstration project. `docs/PRODUCTION_HARDENING.md` lists what a real deployment would need to add — shared-state rate limiting, WAF, secret rotation, dependency scanning, penetration testing.

---

## Deployment

Preferred: Vercel (application) + Supabase (PostgreSQL with pgvector, plus Storage). See [`docs/DEPLOYMENT_PLAN.md`](docs/DEPLOYMENT_PLAN.md).

Required environment variables are listed in [`.env.example`](.env.example). Production notes:

- `prisma migrate deploy` only — never `migrate dev`, which offers to drop the ANN index as drift
- Do not seed on every build; the seed refuses non-local databases unless `ALLOW_PRODUCTION_SEED=true`
- Set `DEMO_MODE=false` to disable the demo accounts

---

## Known limitations

- **Demo embeddings are lexical, not semantic.** Pure-synonym paraphrases retrieve poorly. Fixed by configuring a real embedding provider and reprocessing.
- **No OCR.** Scanned PDFs without a text layer produce no extractable text; the failure is reported explicitly.
- **In-process rate limiting.** Correct for a single instance; a multi-instance deployment needs shared state.
- **Reranking is lexical**, not a cross-encoder model. Stated in the interface rather than implied otherwise.
- **English-tuned.** Stopwords, stemming and full-text search are configured for English.
- **No streaming responses.** Answers arrive complete.
- **Single-tenant.** No organisation isolation beyond the knowledge-base grouping.

## Roadmap

- Semantic reranking via a cross-encoder
- Streaming responses
- OCR for scanned documents
- Multi-tenant isolation
- Scheduled re-crawling of registered URLs
- Redis-backed rate limiting and job queue

---

## Licence

MIT — see [`LICENSE`](LICENSE).

Built by **Arslan Vuzmal Lone**.

All documents, companies, people and figures in the demonstration corpus are fictional. "Northstar Cloud" is an invented company created for this project and describes no real organisation.
