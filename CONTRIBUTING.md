# Contributing

Thanks for taking a look. This is a portfolio project, so the bar for changes is "does it make the demonstration more honest or more useful".

## Setup

```bash
npm install
cp .env.example .env          # then fill in the two secrets and DATABASE_URL
npm run db:up
npm run db:migrate:deploy
npm run db:seed
npm run dev
```

Requires Node.js 20+ and Docker. PostgreSQL runs on port **5434** to avoid colliding with a local install on 5432.

## Before opening a pull request

```bash
npm run verify      # format check, lint, typecheck, all test suites, production build
npm run test:e2e    # browser tests against a production build
```

All of it must pass. `npm run verify` is exactly what CI runs.

## House rules

**Claims must be true.** If a feature is partial, say so in the README and in the interface. The demo embedding provider is described as lexical rather than semantic everywhere it appears, because it is. A test asserts that a pure-synonym paraphrase _fails_ rather than quietly passing.

**Security controls need tests.** Anything touching access control, injection handling, SSRF, upload validation or authentication needs a test that fails without the change.

**Access filtering belongs in SQL.** If you add a retrieval path, the access predicate goes in the query, not in a filter afterwards. The post-filter in `lib/retrieval/search.ts` is defence in depth and logs at error level if it ever drops anything.

**Comments explain why.** The code says what it does. A comment should say why it is that way — a constraint, a trade-off, or a subtlety that would otherwise look like a mistake.

**Charts follow the design system.** Colours come from the validated tokens in `tailwind.config.ts`. If you add a categorical colour, run it through a colour-vision validator first; see `docs/DESIGN_SYSTEM.md`.

## Commit messages

Conventional commits:

```
feat: add hybrid search weighting control
fix: prevent chunk from spanning a page boundary
test: cover restricted-title leakage through related sources
docs: record the pgvector decision
```

Commits must be authored with your own Git identity.

## Project layout

```
app/          routes — pages and API handlers
components/   UI; server-safe primitives, client components where interactive
lib/          the actual system
  ai/         prompt construction, providers, citation validation
  auth/       password, session, RBAC, route guards
  database/   Prisma client and the pgvector layer
  documents/  extraction, chunking, ingestion
  embeddings/ provider interface and implementations
  retrieval/  query preparation, search, confidence, settings
  security/   injection detection, SSRF guard, upload validation, audit
prisma/       schema and migrations
scripts/      seed, demo reset, index repair
tests/        unit, integration, retrieval, security, e2e
docs/         architecture, decisions, security, deployment
```

## Reporting bugs

Include what you did, what you expected, what happened, and the correlation ID if the interface showed one — it ties directly to the server log entry.
