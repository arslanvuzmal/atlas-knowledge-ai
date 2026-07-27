# Security

Atlas Knowledge AI is a demonstration project. It implements real controls and they are tested, but it has not undergone external security review or penetration testing. Do not deploy it as-is with production data without reading [`docs/PRODUCTION_HARDENING.md`](docs/PRODUCTION_HARDENING.md).

## Reporting a vulnerability

Open a private security advisory through the repository's Security tab, or contact the maintainer directly. Please do not open a public issue for an exploitable finding.

Expect acknowledgement within a few days. This is a portfolio project maintained by one person, so there is no formal SLA.

---

## Controls implemented

### Access control

Five levels — `PUBLIC`, `CUSTOMER`, `EMPLOYEE`, `MANAGER`, `ADMIN` — carried on every document **and denormalised onto every passage**, because retrieval filters on the passage.

Filtering is applied twice:

1. **As a SQL predicate**, inside the same statement as the vector search. A passage above the caller's ceiling is never read out of the database.
2. **After reranking**, in application code, as defence in depth. In correct operation this drops nothing; if it ever fires it logs at error level, because that would mean the SQL filter had been weakened.

Content classification and action permissions are separate concepts. Reading manager-level documents and deleting any document are different authorities, held in an explicit per-role permission list.

A document above the caller's level is reported as **not found** rather than forbidden, so the API cannot be used to confirm that a restricted document exists.

**Tested:** the full role × level matrix, direct database-layer calls with restricted ceilings, restricted-title leakage through answers and through "related sources" suggestions.

### Prompt injection

Treated as an architectural problem first and a detection problem second.

**Architectural boundary** — retrieved passages are wrapped in explicit untrusted-data delimiters; the system prompt states before the data appears that its contents are quoted material and never instructions; delimiter-forgery sequences and control tokens are stripped from passage text before it enters the prompt. Most importantly, the generator is given **no tools, no network egress and no secret access**, so "call this URL", "print your environment" and "show me restricted documents" have nothing to act on. Access filtering happens in SQL against the caller's role, so no text in any document can widen what is retrievable.

**Detection** — eight categories (instruction override, system-prompt extraction, secret extraction, access-control bypass, tool/network invocation, data exfiltration, false verification, role impersonation) with weighted scoring. Zero-width and control-character obfuscation is normalised before matching. A repeated phrase scores once, so a document repeating a trigger fifty times does not inflate its risk. Detection is a _signal_: it logs, surfaces to administrators, and escalates. It is not the control.

**Tested:** ten attack strings asserted not to leak secrets, system-prompt text or restricted titles, with citation integrity preserved throughout.

### Authentication

- scrypt, N=32768, r=8, p=1 — roughly 32 MB of memory per verification
- Session tokens stored only as SHA-256; the raw token exists only in the cookie
- HTTP-only, SameSite=Lax cookies; Secure when the app URL is HTTPS
- 8-hour expiry with sliding renewal
- Failed attempts counted in the database, so lockout survives restarts and applies across instances: 8 failures in 15 minutes locks the identifier
- Identical failure message and equal work for "no such account" and "wrong password", including a dummy verification when the account does not exist
- A role change or suspension revokes every active session immediately
- The last active administrator cannot be demoted or suspended
- Demo accounts are rejected at authentication when `DEMO_MODE` is off

### SSRF prevention

URL ingestion validates in two stages:

1. **Syntactic** — protocol allowlist (http/https only), no embedded credentials, port allowlist, blocked hostnames and suffixes, and IP-literal range checks. No network activity.
2. **Resolved** — the hostname is resolved and _every_ returned address checked against private, loopback, link-local (including `169.254.169.254`), carrier-grade NAT, documentation and reserved ranges. Stage 1 alone is defeated by a public DNS name pointing at the metadata service.

Redirects are followed manually so each hop is re-validated. Byte ceiling and wall-clock timeout are enforced on the response stream, not just on the declared `Content-Length`. This is not a crawler: it fetches exactly the page it is given and never follows links found in the content.

### File upload

Extension allowlist, declared MIME type checked for agreement with the extension, and magic-byte verification of the actual leading bytes. Formats without reliable magic are checked for binary content masquerading as text. Filenames are reduced to a safe basename under both path separator conventions, with control characters stripped, traversal sequences removed, and Windows reserved device names neutralised. Storage keys are verified to resolve inside the storage root.

Uploaded files are served with `Content-Disposition: attachment` and `X-Content-Type-Options: nosniff`, so an uploaded HTML or SVG file cannot execute in the application's origin.

### Application

- CSRF double-submit token plus origin checking on every mutating route
- Rate limiting on login, chat, upload, URL ingestion, feedback and mutations
- Content Security Policy, `X-Frame-Options: DENY`, `nosniff`, restrictive Permissions-Policy
- SQL injection prevented by the ORM; raw SQL uses bound parameters exclusively
- Request size limits, with oversized uploads rejected before buffering
- Public error messages carry no stack traces, provider details or query echoes — only a correlation ID that ties to the internal log

### Logging and audit

Structured JSON logs with correlation IDs. Values are passed through a redactor before serialisation, which strips provider API key shapes (OpenAI, Anthropic, Google, Hugging Face), JWTs and database connection strings, and redacts by key name for anything password-, token-, secret- or credential-shaped.

The audit trail is append-only and records authentication, document lifecycle, access-level changes, chat queries, injection detections, escalations, permission denials and configuration changes. IP addresses are stored as keyed hashes, so entries can be correlated without retaining a directly identifying value.

Retrieval logs store chunk **identifiers only**, never chunk text — so an operator reading traces cannot see content they would not be permitted to retrieve.

---

## Not implemented

Stated plainly rather than left to be discovered:

- No external security audit or penetration test
- Rate limiting is in-process; a multi-instance deployment needs shared state
- No WAF, DDoS protection or bot detection
- No automated secret rotation
- No MFA
- No field-level encryption beyond what PostgreSQL provides at rest
- No SBOM or automated dependency scanning in CI
- Sessions are not bound to a device fingerprint
- No anomaly detection on access patterns

[`docs/PRODUCTION_HARDENING.md`](docs/PRODUCTION_HARDENING.md) covers what a real deployment would need to add.

---

## Scope

This project processes **fictional demonstration data only**. The seeded corpus describes an invented company. Do not upload private, confidential, personal or copyrighted material to a demonstration deployment.
