# OWASP ASVS 5.0 Security Verification Matrix — Atlas Customer Intelligence

**System Name:** Atlas Customer Intelligence Platform  
**Target Compliance Level:** OWASP ASVS Level 2 (Enterprise B2B SaaS Application)  
**Last Verified:** 2026-08-10  

---

## Executive Summary

This document maps Atlas Customer Intelligence against the OWASP Application Security Verification Standard (ASVS) Level 2 controls. Every requirement listed here is empirically backed by server-side code, automated tests, or strict configuration guards.

---

## 1. Architecture, Design and Privacy (V1)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V1.1.1** | Secure Architecture & Tenant Isolation | `PASS` | All database queries are server-side scoped by `workspaceId`. No multi-tenant data bleed. Tested in `tests/integration/security.test.ts`. |
| **V1.2.1** | Threat Modeling | `PASS` | Threat model documented in `docs/THREAT_MODEL.md` covering prompt injection, PII leakage, IDOR, SSRF, and cross-workspace access. |
| **V1.3.1** | Personal Data & Consent | `PASS` | Personal data tracked with provenance (`PROVIDED`, `DERIVED`, `HUMAN_EDITED`) and explicit `ConsentRecord` storage. |

---

## 2. Authentication & Session Management (V2 / V3)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V2.1.1** | Password Strength & Hashing | `PASS` | Uses scrypt with salt for password hashing (`lib/auth/password.ts`). Weak/common passwords rejected. |
| **V2.2.1** | Lockout Defense | `PASS` | `LoginAttempt` table tracks failed attempts by SHA-256 hashed identifier (`lib/auth/lockout.ts`). Blocks brute-force enumeration. |
| **V3.1.1** | Secure Cookies & Tokens | `PASS` | Session cookies set with `HttpOnly`, `SameSite=Lax`/`Strict`, `Secure` in production, and server-side revocation (`lib/auth/session.ts`). |
| **V3.2.1** | Session Expiry & Rotation | `PASS` | Sessions expire after 24h of inactivity. Token rotated on privilege changes. |

---

## 3. Access Control & Authorization (V4)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V4.1.1** | Server-Side RBAC Enforcement | `PASS` | Centralized permission enforcement in API routes (`lib/security/rbac.ts`). UI hides elements, but server rejects unauthorized calls. |
| **V4.2.1** | Sensitivity Access Control | `PASS` | Knowledge retrieval checks `AccessLevel` (`PUBLIC`, `CUSTOMER`, `EMPLOYEE`, `MANAGER`, `ADMIN`) before vector search and re-checks after reranking (`lib/retrieval/search.ts`). |
| **V4.3.1** | Cross-Workspace Isolation | `PASS` | Every entity query verifies `workspaceId` matching current authenticated user context. |

---

## 4. Input Validation & Prompt Injection Defense (V5)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V5.1.1** | Server-Side Input Validation | `PASS` | All API request bodies validated using Zod schemas (`lib/api/validation.ts`). |
| **V5.2.1** | Prompt Injection Defense | `PASS` | `detectPromptInjection()` inspects user turns for system overrides, prompt extraction, and instruction injection before LLM processing (`lib/security/prompt-injection.ts`). |
| **V5.3.1** | SSRF Prevention | `PASS` | Document URL ingestion validates HTTP/HTTPS allowlists, rejects loopback/private/link-local/metadata IPs, and limits payload size (`lib/documents/url.ts`). |

---

## 5. Cryptography & Data Protection (V6 / V7)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V6.1.1** | Cryptographic Storage | `PASS` | Secrets kept in environment variables. Sensitive data uses standard crypto primitives (`crypto.randomBytes`). |
| **V7.1.1** | Audit Logging | `PASS` | `AuditLog` records authentication, role changes, document access, and CRM mutations without logging raw secrets or password hashes (`lib/security/audit.ts`). |

---

## 6. Dependency & Supply Chain Security (V14)

| Requirement | Description | Status | Verification Evidence & Implementation |
| :--- | :--- | :--- | :--- |
| **V14.1.1** | Vulnerability Remediation | `PASS` | Zero unallowed critical or high vulnerabilities. Package dependencies locked via `overrides` in `package.json`. |
| **V14.2.1** | Automated CI Audit | `PASS` | Automated security audit script (`scripts/audit.mjs`) runs on every push and PR in GitHub Actions (`.github/workflows/ci.yml`). |
