# Northstar Cloud Sales Enablement Guide

ACCESS LEVEL: EMPLOYEE. This document is fictional and exists to demonstrate access-controlled retrieval in Atlas Knowledge AI.

## Who We Sell To

The primary buyer is a head of operations or a head of revenue operations at a company with 50 to 2,000 employees. The economic buyer is usually a VP or director; the technical evaluator is usually an operations manager who will build the first Flows.

The strongest signal of fit is a team that has already tried to solve the problem with spreadsheets, manual copying between systems, or an unmaintained internal script.

## Qualifying Questions

Ask which systems the team moves data between today, and how that movement happens now.

Ask how many people spend time on that movement each week, and roughly how long.

Ask what breaks when it goes wrong, and who notices first.

Ask who would own the automation once it exists. A deal without a named owner on the customer side rarely completes.

Ask what their timeline is and what is driving it. A deal with no internal deadline typically stalls.

## Discovery to Close

The standard motion is a discovery call, then a scoped demonstration, then a 14-day trial with a defined success criterion, then commercial agreement.

The trial should always have one written success criterion agreed in advance, such as "the weekly reconciliation between the CRM and the warehouse runs automatically without manual correction". Trials without a criterion convert at roughly half the rate.

## Positioning Against Alternatives

Against a general-purpose automation tool, lead with governance: versioned Flows with rollback, an append-only audit log, role-based access control, and write-only credential storage in Vault. General-purpose tools are usually strong on connector count and weak on control.

Against an internal script, lead with continuity and visibility. A script is owned by one person, has no run history, and fails silently. Insights records every run, and Connector health monitoring pauses dependent Flows instead of failing repeatedly.

Against doing nothing, quantify the current manual effort in hours per week using the customer's own numbers from discovery. Never assert a saving figure the customer has not given you.

## Handling Common Objections

"It is too expensive." Move the conversation to the cost of the current manual process using their own figures. Confirm whether annual billing, which carries a 20% discount, changes the picture. Do not offer a discount before understanding the objection.

"We are worried about security." Send the Security and Privacy Overview. The points that resolve this objection most often are AES-256 encryption at rest, SOC 2 Type II certification, no standing staff access to customer data, and write-only credential storage.

"We already have a tool." Ask what it does not do. The gap is usually governance, run visibility, or error handling rather than raw connectivity.

"We do not have time to implement it." Offer to build the first Flow together during the trial. This objection is usually about risk, not time.

## Pricing Conversations

Quote list price first. The published plans are Starter at 29, Team at 79, and Business at 149 US dollars per user per month, with Enterprise priced individually.

Annual billing carries a 20% discount and is the standard concession. Offer it before discussing any bespoke discount.

Discounts beyond the annual rate require director approval. Non-profit and education customers receive 40% on Team and Business, which cannot be combined with the annual discount.

Never commit to a custom uptime figure, a custom retention period, a custom refund term, or a security certification the platform does not hold. Route all of these to the deal desk.

## What Not to Say

Do not state that the platform is HIPAA compliant. It is not certified for HIPAA and protected health information must not be processed on it.

Do not promise a feature that is not on the published roadmap. If a prospect needs something we do not have, record it as a gap and pass it to product.

Do not quote an uptime commitment above 99.9% outside an Enterprise contract, and do not describe service credits as cash refunds. They are credits against future invoices.

Do not share the internal incident response procedure with a customer. If a prospect asks how incidents are handled, send the Security and Privacy Overview, which contains the customer-facing commitment including the 72-hour notification window.

## Handover to Customer Success

Every closed deal is handed to customer success with the agreed success criterion, the systems in scope, the named owner on the customer side, and any commitments made during the sale.

Anything promised during the sales process must be written into the handover. An undocumented promise is the single most common cause of a poor first quarter for a new customer.
