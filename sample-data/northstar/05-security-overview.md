# Northstar Cloud Security and Privacy Overview

This document is fictional and exists to demonstrate Atlas Knowledge AI. It describes no real company's security posture and should not be relied on for any purpose.

## Purpose

This overview describes how the fictional Northstar Cloud platform protects customer data. It is written for prospective customers, security reviewers, and procurement teams.

## Encryption

All customer data is encrypted at rest using AES-256. Encryption keys are managed in a dedicated key management service and are rotated annually.

All data in transit is encrypted using TLS 1.3. TLS 1.0 and TLS 1.1 are disabled. HTTP requests to the platform are redirected to HTTPS, and HTTP Strict Transport Security is enabled with a one-year max-age.

Credentials stored in Vault receive an additional layer of envelope encryption. A Vault credential is write-only after it is saved and cannot be read back through the console or the API by anyone, including workspace administrators and Northstar Cloud staff.

## Data Residency

Customer data is stored in the region selected for the workspace. Three regions are available: the European Union in Frankfurt, the United States in Northern Virginia, and Asia Pacific in Singapore.

Data does not leave the selected region during normal operation. Region selection is available on the Enterprise plan. On other plans the region is set when the workspace is created and cannot be changed afterwards.

## Access Control

Northstar Cloud enforces role-based access control with four workspace roles: Viewer, Editor, Admin, and Owner. Permissions are enforced on the server for every request. Hiding an action in the interface is never the only control.

Single sign-on using SAML 2.0 or OpenID Connect is available on the Business and Enterprise plans. Enforced SAML removes the ability to sign in with a password, so account lifecycle is controlled entirely by the customer's identity provider.

Multi-factor authentication is available on all plans and can be made mandatory for a workspace by an Owner.

## Internal Access by Northstar Cloud Staff

Northstar Cloud staff do not have standing access to customer workspace data. Access to a customer workspace for support purposes requires an explicit, time-limited grant from a workspace Admin or Owner.

A support access grant expires automatically after 24 hours. Every action taken during a support access session is written to the customer's audit log and is visible to the customer.

## Audit Logging

Every security-relevant action is recorded in an append-only audit log. Recorded events include sign-in, sign-in failure, role change, member invitation and removal, Connector creation and deletion, Vault credential change, Flow publication, and data export.

Audit log retention is 30 days on Team, 180 days on Business, and 365 days on Enterprise. Business and Enterprise plans can export the audit log to CSV or stream it to an external SIEM.

## Certifications and Compliance

Northstar Cloud maintains SOC 2 Type II certification, with a report issued annually and available under NDA. It is certified to ISO/IEC 27001.

The platform supports customer obligations under the General Data Protection Regulation. A Data Processing Agreement is available and Standard Contractual Clauses are used where a transfer outside the European Economic Area is necessary.

Northstar Cloud is not certified for HIPAA and customers must not process protected health information on the platform.

## Vulnerability Management

Infrastructure and application dependencies are scanned daily. Critical vulnerabilities are remediated within 7 days, high within 30 days, and medium within 90 days.

An independent penetration test is performed annually by a third-party firm. A summary report is available to Enterprise customers under NDA.

## Responsible Disclosure

Security researchers may report vulnerabilities to the security address published on the Northstar Cloud website. Reports are acknowledged within 2 business days. Northstar Cloud commits not to pursue legal action against researchers who act in good faith, avoid privacy violations, and do not degrade the service.

## Business Continuity

Customer data is backed up continuously with point-in-time recovery available for the previous 35 days. Backups are encrypted and stored in the same region as the primary data.

The recovery time objective is 4 hours and the recovery point objective is 15 minutes. Disaster recovery procedures are tested twice a year.

## Subprocessors

A current list of subprocessors is published on the Northstar Cloud website. Customers may subscribe to notifications of subprocessor changes and receive at least 30 days' notice before a new subprocessor begins processing customer data.

## Incident Notification

If a security incident affects customer data, Northstar Cloud notifies affected customers without undue delay and within 72 hours of confirming the incident. Notification includes what happened, what data was involved, what has been done, and what the customer should do.

The internal procedure followed during an incident is documented separately and is restricted to Northstar Cloud staff.
