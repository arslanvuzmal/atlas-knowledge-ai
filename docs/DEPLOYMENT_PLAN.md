# Deployment plan

Target: **Vercel** for the application, **Supabase** for PostgreSQL with pgvector and for object storage. Both have free tiers sufficient for a demonstration deployment.

> **Deployed and verified** at [atlas-knowledge-ai.vercel.app](https://atlas-knowledge-ai.vercel.app), region `ap-northeast-1`. All 44 end-to-end tests pass against the live URL.

## Two things that cost real time, recorded so they don't again

**PowerShell adds a BOM when piping.** Setting environment variables with `'value' | vercel env add NAME production` from PowerShell 5.1 stores `﻿value`. The application then failed with `Invalid enum value ... received '﻿supabase'`. Environment variables must be set from bash, or with a method that does not prepend a byte-order mark. This is invisible in the Vercel dashboard.

**`connection_limit=1` starves parallel queries.** The common serverless advice is one connection per instance, but the dashboard issues a dozen aggregate queries through `Promise.all`. With a limit of 1 and the default 10-second pool timeout, they queue and time out with `P2024`. `connection_limit=8&pool_timeout=25` is what actually works here.

---

## 1. Database

Create a Supabase project, then enable the extension:

```sql
CREATE EXTENSION IF NOT EXISTS vector;
```

Supabase exposes two connection strings and **both are needed**, for different reasons:

| Variable       | Port          | Used by                                                                                                                                |
| -------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `DATABASE_URL` | 6543 (pooler) | The running application. Serverless functions open many short-lived connections; without the pooler they exhaust the connection limit. |
| `DIRECT_URL`   | 5432 (direct) | `prisma migrate deploy`. Migrations run DDL, which the transaction pooler does not support.                                            |

Append `?pgbouncer=true&connection_limit=1` to `DATABASE_URL`.

Apply migrations from your machine before the first deploy:

```bash
DATABASE_URL="<direct url>" DIRECT_URL="<direct url>" npx prisma migrate deploy
```

Then confirm both retrieval indexes exist:

```sql
SELECT indexname FROM pg_indexes WHERE tablename = 'DocumentChunk';
-- expect DocumentChunk_embedding_hnsw_idx and DocumentChunk_fts_idx
```

If the HNSW index is missing, run `npx tsx scripts/ensure-indexes.ts` against the direct URL. Never run `prisma migrate dev` against production — it treats the ANN index as drift and offers to drop it.

## 2. Storage

Create a **private** bucket named `atlas-documents`. Private is not optional: file access is authorised by the application, which checks the caller's role against the document's access level before serving a byte. A public bucket would make every uploaded file reachable by URL alone, bypassing that check entirely.

The service-role key is used server-side only and must never appear in a `NEXT_PUBLIC_` variable.

## 3. Application

Import the repository into Vercel. Node.js 20.x. Default build command (`npm run build`, which runs `prisma generate` first).

**The build command must not touch the database.** No migrations, no seeding. A build that mutates data will eventually run twice concurrently, or roll back a deploy while leaving the schema changed.

### Environment variables

| Variable                              | Value                                                             |
| ------------------------------------- | ----------------------------------------------------------------- |
| `DATABASE_URL`                        | Supabase pooler URL, port 6543                                    |
| `DIRECT_URL`                          | Supabase direct URL, port 5432                                    |
| `AUTH_SECRET`                         | 32+ random bytes, freshly generated                               |
| `INTERNAL_API_SECRET`                 | 32+ random bytes, freshly generated                               |
| `APP_URL` / `NEXT_PUBLIC_APP_URL`     | The deployed URL, https                                           |
| `DEMO_MODE` / `NEXT_PUBLIC_DEMO_MODE` | `true` for a portfolio deployment                                 |
| `STORAGE_PROVIDER`                    | `supabase`                                                        |
| `SUPABASE_URL`                        | Project URL                                                       |
| `SUPABASE_SERVICE_ROLE_KEY`           | Service role key (server-side only)                               |
| `SUPABASE_STORAGE_BUCKET`             | `atlas-documents`                                                 |
| `EMBEDDING_PROVIDER` / `LLM_PROVIDER` | `demo`, or a live provider plus its key                           |
| `ALLOW_PRODUCTION_SEED`               | Omit. Set to `true` only for the one-off seed below, then remove. |

Generate the secrets fresh — never reuse the local development values:

```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```

`APP_URL` must be https so session cookies are issued with the `Secure` flag.

## 4. Seeding, once

Seeding is a deliberate manual step, not part of the build. The seed script refuses any non-local database unless `ALLOW_PRODUCTION_SEED=true`.

```bash
ALLOW_PRODUCTION_SEED=true \
DATABASE_URL="<direct url>" \
DIRECT_URL="<direct url>" \
STORAGE_PROVIDER=supabase \
SUPABASE_URL="..." SUPABASE_SERVICE_ROLE_KEY="..." \
npm run db:seed
```

Remove `ALLOW_PRODUCTION_SEED` afterwards.

## 5. Verification

Do not report the deployment as working until every item passes on the live URL:

1. Home page loads and shows non-zero document and passage counts
2. `/demo` loads and answers a supported question with citations
3. `/demo` refuses a restricted question without naming the document
4. Sign-in works with a demo account
5. Dashboard loads with real figures
6. `/dashboard/documents` lists the seeded corpus
7. `/dashboard/health` reports the database as operational with pgvector present
8. A file uploads and reaches INDEXED
9. That document answers a question and the citation opens the right passage
10. A follow-up question resolves using context
11. An employee-level question is refused for a public visitor
12. An unsupported question produces the refusal and an escalation
13. Feedback submits
14. Analytics reflect the new activity
15. Mobile layout has no horizontal scroll
16. No console errors on any page
17. Data persists across a redeploy

Then update the README's demo link with the verified URL.

## Naming

Preferred: `atlas-knowledge-ai.vercel.app`. If taken, ask before choosing — do not silently substitute. Alternatives: `atlas-knowledge-avuzmal`, `atlas-rag-avuzmal`, `atlas-ai-knowledge`, `atlas-knowledge-by-avuzmal`.

## Cost

Everything above fits the free tiers. Supabase pauses a free project after a week of inactivity — the first request afterwards is slow while it resumes, which is worth knowing before demonstrating it live.

No paid resource is provisioned without asking first.

## Worker

Not deployed. Ingestion runs inside the application by design ([`DECISIONS.md`](DECISIONS.md#1-one-typescript-application-not-an-application-plus-a-python-worker)). `WORKER_URL` stays unset, and the health page reports the worker as intentionally absent rather than missing.

## Rollback

Vercel keeps previous deployments; promote an earlier one to roll back the application. Database migrations are forward-only — to reverse one, write a new migration. Supabase point-in-time recovery covers data loss on paid plans; on the free tier, take a manual `pg_dump` before anything destructive.
