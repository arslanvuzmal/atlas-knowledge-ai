# Production hardening

What this project implements is real and tested. What it does **not** implement is listed here, because a demonstration project that quietly omits production concerns is more dangerous than one that names them.

Read this before deploying with data that matters.

---

## Must fix before real data

### Rate limiting is in-process

`lib/security/rate-limit.ts` holds counters in a single Node process. On Vercel, each serverless instance keeps its own map, so the effective limit is the configured number multiplied by the instance count.

Login lockout is already immune — it counts failures in the `LoginAttempt` table, so it survives restarts and works across instances. Everything else needs shared state.

**Fix:** move the counters to Redis (Upstash suits serverless) or a Postgres table with the same sliding-window logic. The `checkRateLimit` interface does not need to change.

### No secret rotation

`AUTH_SECRET` keys the session HMAC and the audit IP hashes. Rotating it invalidates every session and makes historical IP hashes uncorrelatable with new ones.

**Fix:** accept a list of secrets, verify against all and sign with the first. Rotate by prepending a new value and removing the oldest after the session TTL has elapsed.

### No MFA

Password only. The `User` model has `externalId` for an external identity provider, which is the cleaner path than building TOTP.

**Fix:** enforced SSO via SAML or OIDC, so account lifecycle moves to the customer's identity provider.

### No dependency scanning

Nothing in CI checks for known vulnerabilities.

**Fix:** add `npm audit --audit-level=high` to the CI job, enable Dependabot, and generate an SBOM on release.

---

## Should fix before scale

### Ingestion runs in-request

A large PDF holds a request open for the duration of extraction and embedding, and a serverless timeout mid-ingestion leaves a job stuck in `RUNNING`. The health page detects this — it reports jobs running for over fifteen minutes as degraded — but nothing recovers them automatically.

**Fix:** move ingestion behind a queue. `IngestionJob` already models the state a worker would need; only the invocation changes.

### Analytics compute on every request

Every dashboard load runs a dozen aggregate queries. Correct and always current, but linear in table size.

**Fix:** materialised views refreshed on a schedule, or a rollup table. Do this when the numbers get slow, not before.

### No connection-pool tuning

Prisma's defaults with the Supabase pooler are adequate at demonstration load and untested beyond it.

**Fix:** measure under expected concurrency and set `connection_limit` deliberately.

### Embedding provider changes require a manual re-index

Provider, model and dimensions are recorded per chunk, so drift is _detectable_. Nothing acts on it — switching providers without reprocessing leaves incomparable vectors in one index, silently degrading every similarity score.

**Fix:** detect the mismatch at startup and refuse to serve retrieval until reprocessing completes, or reprocess automatically in the background.

---

## Infrastructure not provided

- **WAF and DDoS protection.** Cloudflare or the platform equivalent.
- **Bot detection.** The public demo endpoint is open by design.
- **Log aggregation.** Logs are structured JSON with correlation IDs, ready to ship, but nothing ships them.
- **Alerting.** Nothing pages anyone when the health endpoint degrades.
- **Uptime monitoring.** `/api/health` returns a liveness signal for unauthenticated callers and is ready to be polled.
- **Backup verification.** Supabase backs up; nobody tests a restore.

---

## Operational gaps

### No data retention policy

Conversations, retrieval logs and audit entries accumulate indefinitely. A real deployment needs a retention schedule, and in many jurisdictions a documented one.

### No GDPR subject-access or erasure flow

Cascade deletes exist at the schema level, so erasing a user removes their conversations. There is no interface for it and no export.

### Audit log is append-only by convention

The application never updates or deletes audit rows, but the database user has permission to. A determined attacker with database access could rewrite history.

**Fix:** a dedicated role without `UPDATE`/`DELETE` on `AuditLog`, or stream entries to an external append-only store.

### No anomaly detection

Nothing notices a user suddenly retrieving ten times their usual volume, or a single IP enumerating document ids.

---

## Known accepted risks

**In-process rate limiting on a single instance.** Correct for the demonstration deployment. Documented rather than fixed because the fix requires infrastructure the free tier does not include.

**Demo accounts with a published password.** Deliberate, and gated: demo accounts are rejected at authentication when `DEMO_MODE` is false, so a production deployment cannot accidentally ship with them.

**Public demo endpoint without a captcha.** The demo is the portfolio piece; requiring a captcha would defeat it. Rate limited per address, bound to the `PUBLIC` role, and reaching only public documents.

**Lexical demo providers.** Retrieval quality under demo mode is term-overlap based. Stated in the README, on the dashboard, in the code, and asserted by a test that expects a pure-synonym paraphrase to fail rather than quietly pass.

---

## Checklist

Before deploying with real data:

- [ ] Rate limiting moved to shared state
- [ ] `AUTH_SECRET` rotation supported
- [ ] MFA or enforced SSO
- [ ] `npm audit` and Dependabot in CI
- [ ] Ingestion moved behind a queue
- [ ] WAF in front of the application
- [ ] Log shipping and alerting configured
- [ ] Backup restore tested, not just configured
- [ ] Data retention policy defined and enforced
- [ ] Subject-access and erasure flow built
- [ ] `AuditLog` write-protected at the database role level
- [ ] External security review
- [ ] `DEMO_MODE=false` and demo accounts removed
- [ ] Real embedding and language model providers configured, corpus reprocessed
