# Atlas Customer Intelligence — Final Architecture Specification

**Document Version:** 2.0.0  
**Target System:** Atlas Customer Intelligence Platform  
**Governance:** Governed RAG + Customer Intelligence CRM + Enterprise Operations

---

## 1. Product & Architecture Vision

Atlas Customer Intelligence transforms traditional RAG document Q&A into a governed, enterprise-grade customer intelligence CRM.

### Core Proposition

_"Every customer conversation, grounded in what your business actually knows."_

```
CUSTOMER / VISITOR
        ↓
Public Demo / Website / Authenticated Chat
        ↓
Identity + Session Resolution (Visitor → Contact)
        ↓
Security / Validation / Rate Limit
        ↓
Intent Router (Tier 0 Fast Conversational vs Knowledge Query)
        ↓
 ┌────────────────────────────┐
 │                            │
Conversational             Knowledge Query
 │                            │
Fast Response (~100ms)     Role Scope & Sensitivity Check
                              ↓
                       Hybrid Retrieval (pgvector + Lexical)
                              ↓
                       Reciprocal Rank Fusion (RRF)
                              ↓
                       Reranking Engine
                              ↓
                       Access Re-Check (AccessLevel vs User Role)
                              ↓
                       Material Conflict Analysis
                              ↓
                ┌─────────────┼─────────────┐
                ↓             ↓             ↓
            Supported      Conflict      Unsupported
                ↓             ↓             ↓
             Answer       Conflict-Safe     Refuse /
            + Citation       Response       Escalate
                └─────────────┼──────────────┘
                              ↓
                   Essential Persistence
                              ↓
                 Transactional Outbox Event
                              ↓
               Background Worker (SKIP LOCKED)
                              ↓
             ┌────────────────┼────────────────┐
             ↓                ↓                ↓
        Contact/Company    AI Insights       Routing
             ↓                ↓                ↓
          Customer 360     Intent / Need      Task
          Activity         Urgency            Ticket
          History          Product / Timeline Deal / Stage
                           Score Breakdown    Assignee
             └────────────────┼────────────────┘
                              ↓
                    CRM Workspace (3-Column Inbox)
                              ↓
                     Human Business Outcome
                              ↓
                 Knowledge Feedback Loop
                              ↓
            Gap / Conflict / Negative Feedback / Bad Answer
                              ↓
                      Source Improvement
                              ↓
                    Evaluation Workbench
                              ↓
                        Better RAG Engine
```

---

## 2. Multi-Tenant Workspace & Role Architecture

### Workspace Boundaries

- Every entity (`Contact`, `Company`, `Conversation`, `Deal`, `Task`, `Ticket`, `KnowledgeBase`, `AutomationRule`, `CrmActivity`) belongs to a `Workspace`.
- Database queries enforce server-side scoping: `WHERE workspaceId = :workspaceId AND id = :entityId`.

### Workspace Roles (`WorkspaceMember`)

- `OWNER`: Full workspace administration, billing, export, member management.
- `ADMIN`: Infrastructure settings, integrations, knowledge management, user roles.
- `MANAGER`: CRM operations, assignment, analytics, pipeline stage configuration.
- `AGENT`: Inbox handling, contact management, task/ticket execution.
- `VIEWER`: Read-only access to assigned CRM records and knowledge bases.

### Knowledge Sensitivity (`AccessLevel`)

- `PUBLIC`: Publicly accessible knowledge.
- `CUSTOMER`: Accessible to logged-in customers.
- `EMPLOYEE`: Internal employee knowledge base.
- `MANAGER`: Managerial policies and playbooks.
- `ADMIN`: Executive, compliance, and infrastructure documents.

_Note: Workspace roles control CRM execution rights. Knowledge AccessLevels control document retrieval permissions. The two are distinct and independently enforced._

---

## 3. Core CRM Data Model

1. **Contact**: Structured customer entity with normalized email, phone, lifecycle stage (`VISITOR` -> `LEAD` -> `QUALIFIED_LEAD` -> `OPPORTUNITY` -> `CUSTOMER`), lead status, and provenance metadata.
2. **Company**: Account entity linking multiple contacts with domain, industry, size, and account owner.
3. **ContactCompanyRelation**: Explicit relationship with role labels (`Decision Maker`, `Technical Evaluator`, `Billing Contact`).
4. **CrmActivity**: Universal immutable event timeline driving Customer 360.
5. **CustomerIntelligence**: AI-derived intent, urgency, sentiment, explicit needs, timeline, seat count, and buying signals with strict confidence scoring and provenance (`PROVIDED`, `DERIVED`, `HUMAN_EDITED`).
6. **LeadScore**: Explainable rule-based lead scoring model (Fit, Intent, Engagement, Timing, Commercial Signal) with factor breakdowns.
7. **Pipeline & PipelineStage**: Customizable sales pipeline stages (`New`, `Qualified`, `Evaluation`, `Proposal`, `Negotiation`, `Won`, `Lost`).
8. **Deal**: Opportunity entity with value, currency, close probability, and stage history.
9. **Task & Ticket**: Follow-up tasks and support tickets linked to conversations, contacts, and deals.
10. **Tag & Dynamic Property**: System and custom tags/properties with strict typed schema (`TEXT`, `NUMBER`, `BOOLEAN`, `SELECT`, `DATE`).

---

## 4. Transactional Outbox & Async Intelligence Architecture

To ensure conversational chat turns respond immediately (<1s), all CRM extraction, lead scoring, activity logging, and rule automation execute asynchronously via a transactional Outbox pattern:

```
[ HTTP Chat Handler ]
        │
        ├─▶ Write Message & Session to DB (Transaction)
        ├─▶ Write OutboxEvent to DB (Same Transaction)
        └─▶ Respond to User (<1s)

[ Background Job Worker (SELECT ... FOR UPDATE SKIP LOCKED) ]
        │
        ├─▶ Polls OutboxEvent table
        ├─▶ Executes AI Intelligence Extraction
        ├─▶ Upserts Contact & Company Context
        ├─▶ Computes Explainable Lead Score
        ├─▶ Evaluates Workspace Automation Rules
        └─▶ Records CrmActivity Timeline Events
```

---

## 5. Precise Conflict Detection Engine

A conflict occurs ONLY when:

1. **Same Subject/Entity** AND
2. **Same Property/Policy** AND
3. **Comparable Scope** AND
4. **Incompatible Claims** (e.g. Policy A: 25 days annual leave vs Policy B: 30 days annual leave).

Differences in scope (e.g., Annual subscription 30-day refund vs Monthly subscription 14-day refund) or unrelated negative wording are explicitly recognized as distinct non-conflicting rules.

---

## 6. Security & OWASP ASVS Standard

- **Tenant Isolation**: Strictly enforced at database layer.
- **PII Encryption & Access Control**: Masked in UI for unauthorized roles; encrypted at rest.
- **Prompt Injection Defense**: Untrusted customer inputs and retrieved passages pass through sanitizer rules before hitting LLM prompts.
- **Zero GHSA Allowlist**: Dependencies audited and updated to zero critical/high vulnerabilities.
