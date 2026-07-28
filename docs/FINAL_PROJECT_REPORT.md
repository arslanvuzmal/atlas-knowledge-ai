# Final project report

**Atlas Knowledge AI** — a secure RAG knowledge platform.
Report generated 2026-07-27.

---

## 1. Executive summary

A complete, tested RAG knowledge platform: document ingestion across six source types, hybrid retrieval over pgvector, source-grounded answers with validated citations, five-level access control enforced in SQL, human escalation, and analytics computed from real activity.

It runs end to end with **no paid AI credentials** through deterministic demo providers.

**Status by stage:**

| Stage                 | State                                                 |
| --------------------- | ----------------------------------------------------- |
| Build                 | Complete                                              |
| Local verification    | Passing — 221 tests + 44 end-to-end, production build |
| GitHub publication    | Complete, CI green                                    |
| Authorship audit      | NOT PRESENT — VERIFIED                                |
| Production deployment | **Live and verified**                                 |

Every stage is complete. The demonstration is live at [atlas-knowledge-ai.vercel.app](https://atlas-knowledge-ai.vercel.app).

## 2. Paths

|               |                                                                 |
| ------------- | --------------------------------------------------------------- |
| Local project | `C:\Users\laptopzone\Desktop\Atlas Knowledge AI`                |
| Backup        | None required — no pre-existing folder was found or overwritten |
| Repository    | https://github.com/arslanvuzmal/atlas-knowledge-ai              |

## 3. Architecture

Single TypeScript Next.js 15 application. No separate Python worker — ingestion, embedding and retrieval are equally implementable in TypeScript, and a second service would add a deploy target, a network hop and an internal-auth surface for no functional gain. Recorded in `docs/DECISIONS.md`.

PostgreSQL 16 with pgvector holds relational data and vectors together, so the access-control predicate sits inside the same SQL statement as the vector search.

## 4. Features implemented

Ingestion (PDF, DOCX, TXT, Markdown, CSV, approved URLs, typed entries) with a staged state machine and retry · structure-aware chunking · provider-independent embeddings (demo + OpenAI, Google, Hugging Face, Ollama) · provider-independent generation (demo + OpenAI, Anthropic, Gemini, OpenRouter, Ollama) · hybrid vector + full-text retrieval with reciprocal rank fusion · lexical reranking · evidence-based confidence · validated citations · five-level access control · conversation memory with follow-up resolution · feedback · human escalation · analytics · audit log · health checks · 16 dashboard routes, none dead.

## 5. Database

16 models. `accessLevel` is denormalised onto every chunk because retrieval filters on the chunk. Sessions store only a token hash. Login attempts are counted in the database so lockout survives restarts. Retrieval logs store chunk identifiers, never text. Audit rows survive user deletion by design (`SetNull`, not cascade).

Two hand-written indexes — HNSW for cosine distance, GIN for full-text — in their own migration, with `scripts/ensure-indexes.ts` restoring them idempotently because `prisma migrate dev` treats the ANN index as drift.

## 6. Test results

```
Unit          156 passed
Integration    19 passed
Retrieval      15 passed
Security       31 passed
              ─────────
              221 passed

End-to-end     44 passed  (Playwright, incl. mobile)
```

Format check, ESLint, TypeScript strict, and the production build all pass. `npm run verify` exits 0.

**Demo evaluation results** (fictional corpus, deterministic demo embeddings):

```
cases            : 11
passed           : 11/11
retrieval hit    : 11/11
mean confidence  : 59.5%
mean latency     : 7 ms
```

Not a general accuracy claim.

### Defects found by tests and fixed

1. Chunks could span page boundaries, making citation page numbers wrong.
2. Grid items forced horizontal page scroll on mobile (`min-width: auto`).
3. Headings ran into sentences in extractive answers.
4. `.gitignore` pattern `storage/` silently excluded the `lib/storage/` source directory.
5. `.github/pull_request_template.md` reached CI unformatted — fixed, with `.gitattributes` added so line endings cannot hide the failure locally again.

## 7. GitHub

|            |                                                              |
| ---------- | ------------------------------------------------------------ |
| URL        | https://github.com/arslanvuzmal/atlas-knowledge-ai           |
| Visibility | Public                                                       |
| Commits    | 17                                                           |
| CI         | Green — verify job and end-to-end job, both against pgvector |
| Git author | `avuzmal <arslanvuzmallone@gmail.com>`                       |

### Authorship audit — NOT PRESENT, VERIFIED

Verified against the GitHub API, not merely locally:

```
contributors        : arslanvuzmal (User) — 17 commits
distinct authors    : avuzmal <arslanvuzmallone@gmail.com>
distinct committers : avuzmal <arslanvuzmallone@gmail.com>
bot-attributed      : 0
```

186 tracked files scanned: **0 secrets, 0 prohibited attribution**. 19 Anthropic/Claude references, all legitimate model-provider configuration, classified individually in `docs/AUTHORSHIP_AUDIT.md`.

## 8. Deployment

|              |                                                               |
| ------------ | ------------------------------------------------------------- |
| Platform     | Vercel, team `arslan-vuzmal-lone`                             |
| **Live URL** | **https://atlas-knowledge-ai.vercel.app**                     |
| Database     | Supabase PostgreSQL + pgvector 0.8.2, region `ap-northeast-1` |
| Storage      | Supabase Storage, private bucket `atlas-documents`            |
| Worker       | Not applicable by design                                      |
| Status       | **Live and verified**                                         |

### Live verification

All **44 end-to-end tests pass against the production URL**, covering every dashboard route, real document ingestion, feedback, escalation, and mobile layout.

Additionally confirmed by direct request:

```
/                    200
/demo                200
/login               200
/api/health          200

landing page         8 documents · 108 passages · 18 questions, read from the database

supported question   SUPPORTED, confidence 0.855, 3 citations,
                     all from "Refund and Cancellation Policy"

access control       anonymous asks an EMPLOYEE question  -> UNSUPPORTED, 0 citations, no title leak
                     anonymous asks a MANAGER question    -> UNSUPPORTED, 0 citations, no title leak
                     employee signs in, same question     -> SUPPORTED, 4 citations, Employee Handbook
                     employee asks a MANAGER question     -> UNSUPPORTED, 0 citations, no title leak

unsupported topic    UNSUPPORTED, 0 citations
prompt injection     UNSUPPORTED, no secret, no system prompt, no restricted title
```

The access-control line is the one that matters: an identical question returns a refusal or a cited answer purely according to the caller's role.

### Two deployment defects found and fixed

**Ingestion could not survive a remote database.** Chunk persistence ran 2N round trips inside one interactive transaction. Invisible against localhost; against a pooled remote database a 14-chunk document exceeded Prisma's 5-second transaction budget and ingestion failed outright. Rewritten to `createMany` plus a single batched `UPDATE ... FROM (VALUES ...)`, making round trips constant rather than proportional to chunk count. This would have broken **every upload in production**, not merely the seed.

**PowerShell prepended a byte-order mark to environment variables.** Values piped from PowerShell 5.1 were stored as `﻿supabase`, failing enum validation at runtime and returning 500 everywhere. Invisible in the Vercel dashboard. Re-set from bash.

A third adjustment: `connection_limit=1` — the usual serverless advice — starved the dashboard's parallel aggregate queries into a `P2024` pool timeout. Now `connection_limit=8&pool_timeout=25`.

## 9. Environment variables

All 14 are set in Vercel production and preview. None outstanding.

Already set in Vercel production and preview: `AUTH_SECRET`, `INTERNAL_API_SECRET`, `DEMO_MODE`, `NEXT_PUBLIC_DEMO_MODE`, `EMBEDDING_PROVIDER`, `LLM_PROVIDER`.

## 10. Demo credentials

Password `AtlasDemo!2026` for all. Valid only while `DEMO_MODE=true`.

`admin@` · `manager@` · `employee@` · `customer@` · `viewer@` — all `atlasknowledge.demo`.

## 11. Known limitations

Demo embeddings are lexical, not semantic — a pure-synonym paraphrase retrieves poorly, and a test asserts this rather than hiding it · no OCR · in-process rate limiting · lexical reranking, not a cross-encoder · English-tuned · no streaming · single-tenant · no external security audit.

## 12. Portfolio materials

| Item                     | Location                             |
| ------------------------ | ------------------------------------ |
| Screenshots (16)         | `docs/assets/screenshots/`           |
| Fiverr gallery           | `portfolio/fiverr/FIVERR_GALLERY.md` |
| Video script + shot list | `portfolio/video/`                   |
| Case study (7 pages)     | `portfolio/case-study/CASE_STUDY.md` |

---

## Completion summary

```
LOCAL PROJECT:              C:\Users\laptopzone\Desktop\Atlas Knowledge AI
BACKUP:                     Not required — no pre-existing folder
GITHUB:                     https://github.com/arslanvuzmal/atlas-knowledge-ai
LATEST COMMIT:              see `git log -1` on main
GIT AUTHOR:                 avuzmal <arslanvuzmallone@gmail.com>
CLAUDE CONTRIBUTOR STATUS:  NOT PRESENT — VERIFIED
CI:                         PASSING — verify + end-to-end, both green
PUBLIC DEPLOYMENT:          LIVE — https://atlas-knowledge-ai.vercel.app
DATABASE:                   Supabase PostgreSQL + pgvector 0.8.2 (ap-northeast-1)
                            8 documents · 108 passages · all embedded
STORAGE:                    Supabase Storage, private bucket atlas-documents
WORKER:                     Not applicable by design
TESTS:                      221 passing + 44 end-to-end, the latter also run
                            green against the live production URL
BUILD:                      PASSING locally and on Vercel
DEMO LOGIN:                 admin@atlasknowledge.demo / AtlasDemo!2026
                            (also manager@ employee@ customer@ viewer@)
KNOWN BLOCKERS:             None.
```
