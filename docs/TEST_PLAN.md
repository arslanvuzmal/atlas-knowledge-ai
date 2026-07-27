# Test plan

265 automated tests: 221 across four Vitest projects, 44 in Playwright. All run in CI against real PostgreSQL with pgvector.

---

## Principles

**Test behaviour, not implementation.** Assertions target what a user or attacker would observe — an answer refused, a document not retrieved, a page that does not scroll sideways.

**Security controls get tests that fail without them.** Every access-control, injection, SSRF and upload control has a test that breaks if the control is removed.

**Real database, real corpus.** The integration, retrieval and security suites run against the seeded corpus rather than fixtures, because the point is to exercise the actual pipeline against actually indexed content.

**Honest expectations.** Where a limitation exists, a test asserts the limitation rather than being tuned around it. The pure-synonym paraphrase case expects demo-mode retrieval to _fail_, and asserts the system refuses rather than guessing. Rewriting that test to pass would be lying in code.

---

## Unit — 156 tests

No database, no network. Pure functions.

| Area                | Covers                                                                                                                      |
| ------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Text normalisation  | Stemming, stopwords, hyphenated compounds, token estimates                                                                  |
| Sentence splitting  | Abbreviations, decimals, paragraph boundaries                                                                               |
| Chunking            | Size limits, heading paths, page preservation, contiguous indices, metadata, never splitting a word, table detection        |
| Extraction          | CSV quoting and embedded newlines, DOCX heading conversion, HTML non-content stripping, entity decoding                     |
| Embeddings          | Determinism, unit length, relevance ordering, morphological matching, empty input                                           |
| Vector maths        | Normalisation, padding, truncation, zero-vector handling                                                                    |
| Reranking           | Coverage ordering, determinism, limits, rank fusion                                                                         |
| Confidence          | Zero evidence, uncovered terms, coverage response, grounding thresholds                                                     |
| Query preparation   | Follow-up detection, expansion from user turns only, never from assistant turns                                             |
| Prompt assembly     | Boundary delimiters, source numbering, forged-delimiter neutralisation, token budget                                        |
| Citations           | Valid markers kept, fabricated markers stripped, renumbering, no invention                                                  |
| Demo generation     | Source parsing, citation markers, **only emits text present in sources**, declines when nothing matches                     |
| RBAC                | The full role × access-level matrix, permission monotonicity, assignment rules                                              |
| Injection detection | Ten attack categories, benign questions not flagged, zero-width obfuscation, repeat-once scoring                            |
| SSRF ranges         | Fourteen blocked URL forms, IPv4 and IPv6 range classification including IPv4-mapped                                        |
| Upload validation   | Genuine PDF, renamed executable, unsupported extension, oversized, empty, MIME mismatch, binary-as-text, traversal filename |
| Passwords           | Verification, unique salts, no plaintext, malformed hashes, policy                                                          |
| Log redaction       | Provider key shapes, connection strings, key-name redaction, ordinary fields preserved                                      |
| Rate limiting       | Limit enforcement, independent identifiers, window expiry                                                                   |
| Environment         | Every required variable, cross-field rules, all problems reported at once                                                   |

## Integration — 19 tests

Real database. Every created document is tracked and removed afterwards so the suite is re-runnable.

**Ingestion** — full pipeline to INDEXED; every chunk carries an embedding (a chunk without one is invisible to retrieval, a silent correctness failure); provider metadata recorded; byte-identical duplicate rejected before any work; corrupt PDF recorded as a staged failure rather than throwing; reprocessing rebuilds the index and removes the old record; audit trail written; access level propagated to every chunk.

**Chat** — conversation and both messages created; citations point at real documents and chunks; model provenance and latency recorded; follow-ups stay in the conversation and are rewritten; retrieval log stores identifiers only; unsupported answers raise an escalation; negative feedback raises one; positive feedback does not; feedback rejected on a question; audit written per turn; **a conversation belonging to another visitor cannot be extended**.

## Retrieval evaluation — 15 tests

Eleven cases across the required categories — exact, paraphrase, follow-up, multi-document, unsupported, restricted (×2), injection, ambiguous, pricing, refund — plus latency, role-reach comparison, determinism, and the documented synonym limitation.

Each case asserts:

- Retrieval reached the expected document
- Expected concepts appear in the evidence
- Grounding matches expectation; a refusal carries **zero** citations
- Every citation traces to a genuinely retrieved chunk
- No invalid citation markers
- For access cases: the forbidden document appears in neither retrieval nor answer text

Prints a report on completion:

```
cases            : 11
passed           : 11/11
retrieval hit    : 11/11
mean confidence  : 59.5%
mean latency     : 7 ms
```

Labelled as demo evaluation results throughout. Not a general accuracy claim.

## Security — 31 tests

**Access control** — no chunk above the ceiling for any of the five roles on a query designed to touch every document; the post-filter drops nothing; direct database-layer calls with restricted ceilings prove the filter is in SQL; the keyword half filters identically; an empty permitted set returns nothing; restricted titles leak through neither answers nor related-source suggestions.

**Injection** — ten attacks asserted not to leak secret values, system-prompt text or restricted titles, with citation integrity intact. An injection attempt is flagged, escalated at HIGH priority, and audited.

**Authentication** — identical message for wrong password and missing account; lockout after eight failures, counted in the database; failed attempts never store the email.

**SSRF** — seven internal targets refused, with no document row created.

**Audit** — no plain IP in any entry; no secret-shaped value in metadata across the last hundred entries.

## End-to-end — 44 tests

Playwright against a **production build**, not the dev server.

A `setup` project authenticates each role once and saves the session; every other project reuses it. Signing in per test would trip the login rate limiter — correct product behaviour that would otherwise make the suite impossible.

**Public** (no session) — landing page content, no unverifiable accuracy claims anywhere in the body text, supported answer with citations, restricted refusal without naming the document, unsupported refusal, injection non-compliance, source drawer open and Escape-close, follow-up context, wrong-password message, unauthenticated redirects.

**Authenticated** — overview figures, **every one of the 16 dashboard routes resolves and renders a heading** (no dead links), document library, failed document with its error, passage list and live retrieval probe, three ingestion routes, SSRF refusal through the form, a written entry indexed end to end, chat with follow-up and feedback, negative feedback raising an escalation, explicit human request, escalation queue, analytics honesty text, health components, audit entries, settings validation rejecting a contradictory configuration, **no credential visible on the providers page**.

**Access boundaries in the browser** — an employee sees no admin navigation, is refused the audit page when typing the URL directly, is refused manager-only content in chat, and does reach employee-level content.

**Mobile** — five viewport checks asserting `scrollWidth <= clientWidth`. This caught a real bug: grid items default to `min-width: auto` and refused to shrink, so a chart panel forced the whole page to scroll sideways.

---

## Running

```bash
npm run verify        # format, lint, typecheck, all 221, production build
npm run test:e2e      # 44 browser tests
```

CI runs `verify` as one job and E2E as a second, both against `pgvector/pgvector:pg16`.

## Defects these tests found

Four real bugs, each caught by a test rather than by review:

1. **Chunks could span page boundaries**, making the recorded page number wrong for part of the content — a citation pointing at the wrong page.
2. **Grid items forced horizontal page scroll on mobile** — the `min-width: auto` default.
3. **Headings ran into sentences** in extractive answers, because sentence splitting ignored paragraph breaks.
4. **`.gitignore` pattern `storage/` also matched `lib/storage/`**, silently excluding the storage adapter from the first commit.

## Not covered

- Load and stress testing
- Cross-browser beyond Chromium
- Visual regression
- Fuzzing of document parsers
- Chaos testing of database failure mid-transaction
- Accessibility audited by assertion and manual review, not by an automated axe run
