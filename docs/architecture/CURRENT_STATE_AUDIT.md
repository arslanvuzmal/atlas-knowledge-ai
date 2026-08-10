# Atlas Knowledge AI — Current State Audit

**Audit Timestamp:** 2026-08-10  
**Target Repository:** `arslanvuzmal/atlas-knowledge-ai`  
**Current SHA:** `75f519410c12a363c6cdfe97ebf8c2d7d1e4eb8c`  

---

## Executive Summary

An exhaustive inspection of the baseline repository was conducted across `.github/workflows`, `package.json`, `prisma/schema.prisma`, `app/`, `components/`, `lib/`, `scripts/`, `tests/`, and documentation.

While Atlas possesses a solid single-tenant RAG core (Prisma vector integration, hybrid RRF search, reranking, and RBAC sensitivity filters), **it lacks the Customer Intelligence CRM, multi-tenant Workspace architecture, durable event outbox, explainable lead scoring, and professional Inbox required for an enterprise governed customer intelligence engine.**

Furthermore, empirical testing uncovered **false-positive conflict detection bugs** causing Playwright strict selector collisions and **dependency security advisories hidden behind an ignore list**.

---

## Audit Matrix by Feature Area

| Feature Area | Classification | Root Cause & Observations |
| :--- | :--- | :--- |
| **Governed RAG Core** | `IMPLEMENTED` | Hybrid search (RRF), vector embeddings (pgvector), reranking, and RBAC sensitivity filters work cleanly. |
| **Conflict Detection** | `BROKEN` | `lib/rag/conflict.ts` falsely flags complementary documents with different scopes (e.g. 30-day annual refund vs 14-day monthly refund) as contradictory, generating false `Conflicting approved sources` UI warnings and breaking E2E selectors. |
| **Workspace & Multi-Tenancy** | `NOT IMPLEMENTED` | Schema is globally single-tenant. No `Workspace` or `WorkspaceMember` models. `workspaceId` server-side isolation is absent. |
| **CRM Core Entities** | `NOT IMPLEMENTED` | `Contact`, `Company`, `ContactCompanyRelation`, `CrmActivity`, `CustomerIntelligence`, `LeadScore`, `Pipeline`, `Deal`, `Task`, `Ticket`, `Tag`, `CustomProperty` models do not exist. |
| **Customer Intelligence Inbox** | `NOT IMPLEMENTED` | `/dashboard/inbox` missing. Only basic `/dashboard/conversations` list exists without 3-column layout or Customer 360 panel. |
| **Visitor Identity & Provenance** | `NOT IMPLEMENTED` | Anonymous visitor linking to contact identity is absent. No provenance model (`PROVIDED`, `DERIVED`, `HUMAN_EDITED`). |
| **Explainable Lead Scoring** | `NOT IMPLEMENTED` | No rule-based lead scoring engine or factor breakdown. |
| **Durable Event System & Outbox** | `NOT IMPLEMENTED` | CRM operations run synchronously or not at all. No `OutboxEvent` or transactional worker (`SELECT FOR UPDATE SKIP LOCKED`). |
| **Automation Rules Engine** | `NOT IMPLEMENTED` | No workspace rules engine (`Trigger -> Conditions -> Actions`). |
| **TypeScript / Type Safety** | `PARTIAL` / `SECURITY RISK` | 20+ `@typescript-eslint/no-explicit-any` warnings across API routes, ingestion queue, and data lifecycle modules. |
| **Dependency Security** | `MISLEADING CLAIM` / `SECURITY RISK` | `package.json` contains 21 ignored GHSAs. `npm audit` reports 4 High and 1 Critical vulnerabilities. |
| **Evaluation Workbench** | `PARTIAL` | Basic schema and pages exist, but retrieval evaluation metrics and historical run comparisons are incomplete. |
| **Supreme Demo Scenario** | `NOT WIRED` | Multi-step Maya Chen / Northstar Cloud visitor-to-deal journey is not wired to CRM persistence. |
| **Design System & UI** | `PARTIAL` | Dashboard layout uses basic cards with scattered Tailwind styles rather than a unified B2B design token system. |

---

## Detailed Findings

### 1. Conflict Detection Flaws (`lib/rag/conflict.ts`)
- **Issue:** The existing heuristic flags any co-occurrence of negation keywords or differing numbers across retrieved documents as a material conflict.
- **Empirical Evidence:** E2E test `public.spec.ts` asking *"What is the refund window for an annual subscription?"* retrieved both the Annual Refund Policy (30 days) and Customer Support FAQ (14 days for monthly plans). The system emitted a false `Conflicting approved sources` warning, causing Playwright strict selector collisions.

### 2. Missing Workspace Multi-Tenancy Boundary
- `User` model has a global `Role` (`PUBLIC`, `CUSTOMER`, `EMPLOYEE`, `MANAGER`, `ADMIN`).
- There is no concept of a `Workspace` entity or tenant isolation on queries. Cross-workspace isolation cannot be tested because all data belongs to a single global database namespace.

### 3. Missing CRM Entities & Customer Intelligence Layer
- There are no database tables or domain services for `Contact`, `Company`, `Deal`, `Task`, `Ticket`, `CrmActivity`, or `CustomerIntelligence`.
- Conversation turns do not extract customer attributes, intent, urgency, seat counts, or buying signals into structured CRM records.

### 4. Dependency Security Allowlist
- `package.json` `auditConfig.ignore` hides 21 GHSA advisories.
- Security script `scripts/audit.mjs` swallows these vulnerabilities.

---

## Action Plan for Transformation

1. **Phase 1:** Resolve green test baseline (fix Playwright selector collision).
2. **Phase 2:** Refactor conflict detection (`lib/rag/conflict.ts`) to enforce strict entity, property, scope, and contradiction criteria with thorough unit tests.
3. **Phase 3 & 4:** Build Design System primitives & Workspace Multi-Tenancy (`Workspace`, `WorkspaceMember`, server-side isolation).
4. **Phase 5 – 17:** Implement complete Customer Intelligence CRM (Entities, Visitor Identity, Provenance, Activity Timeline, Customer Intelligence, Explainable Lead Scoring, 3-Column Inbox, Contacts, Companies, Deals/Pipelines, Tasks, Tickets, Tags/Custom Properties, Automation Rules Engine, Transactional Outbox & Worker).
5. **Phase 18 – 23:** Fast Chat Router (~100ms Tier 0), Governed RAG Pipeline, Knowledge Health CRM integration, Evaluation Workbench completion, Supreme Demo (Northstar Cloud / Maya Chen), Real Analytics.
6. **Phase 24 – 32:** Security Hardening (eliminate GHSA allowlist, OWASP ASVS, zero `any`), API quality, performance tuning, UX polish, full testing & CI pipeline green verification.
