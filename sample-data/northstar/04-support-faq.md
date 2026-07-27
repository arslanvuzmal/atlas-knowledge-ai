# Northstar Cloud Customer Support FAQ

This FAQ is fictional and exists to demonstrate Atlas Knowledge AI.

## Contacting Support

### How do I contact support?

Support is reached from the Help menu in the console, or by email to the support address shown on the Help page. Every request creates a ticket with a reference number.

### What are your support response times?

First response targets depend on plan. Starter receives a first response within 48 business hours. Team receives a first response within 24 business hours. Business receives a first response within 8 business hours. Enterprise receives a first response within 1 hour for priority-one issues and within 4 business hours for all other issues.

These are first response targets, not resolution targets. Resolution time depends on the nature of the issue.

### What are your support hours?

Standard support operates Monday to Friday, 09:00 to 18:00 in the workspace's configured primary region, excluding public holidays in that region. Enterprise customers with priority-one issues have 24 hours a day, 7 days a week coverage.

### How do I report an outage?

Check the status page first, which is linked from the Help menu. If the status page shows all systems operational and you are still affected, raise a ticket and mark it as Service Unavailable. Enterprise customers may additionally use the priority escalation number in their contract.

## Accounts and Access

### I cannot sign in. What should I do?

Use the Forgot Password link on the sign-in page. A reset link is sent to your registered email address and remains valid for 60 minutes.

If your workspace uses single sign-on, password reset is handled by your identity provider rather than by Northstar Cloud, and you should contact your internal IT team.

### How do I add a user to my workspace?

An Admin or Owner opens Settings, selects Members, and chooses Invite Member. Enter the email address and select the role. The invitation is valid for 7 days.

Adding a member consumes a seat and may change your bill. See the Pricing and Subscription Guide for how mid-cycle seat changes are charged.

### How do I transfer workspace ownership?

Only the current Owner can transfer ownership. Open Settings, select Members, choose the target member, and select Transfer Ownership. The target must already be an Admin in the workspace. The previous Owner becomes an Admin.

### Do you support single sign-on?

Single sign-on is available on the Business and Enterprise plans. SAML 2.0 and OpenID Connect are both supported. Configuration is under Settings, then Authentication.

## Flows and Connectors

### Why did my Flow stop running?

The three most common causes are a Disconnected Connector, a reached overage cap, and a subscription in a read-only state after a failed payment.

Open Insights and check the last run for the Flow. The run detail shows which step failed and why. A Flow paused because of a Disconnected Connector resumes automatically once the Connector is reauthorised.

### Why is my Flow run marked Step Limit Exceeded?

A single Flow run may execute at most 200 steps. Loops over large collections are the usual cause. Split the work across multiple Flows, or reduce the size of the collection the loop iterates over.

### My step timed out. What is the limit?

An individual step may run for at most 90 seconds. A step that calls a slow external system should be redesigned to trigger the work and then poll for the result in a later step.

### Can I call an API that has no pre-built Connector?

Yes. Use the HTTP Connector, which supports GET, POST, PUT, PATCH, and DELETE against any REST endpoint that accepts JSON, including custom headers.

### How do I recover a Flow I broke?

Open the Flow, select Version History, choose a previous version, and select Rollback. The last 50 published versions are retained. Rollback publishes the chosen version as a new version, so nothing is lost.

## Billing

### How do I get a copy of my invoice?

All invoices are on the Billing page under Invoices. Each can be downloaded as PDF. Invoices are also emailed to the billing contact when they are issued.

### Can I change my billing email address?

Yes. Open the Billing page and edit the Billing Contact. This is separate from the workspace Owner and can be a shared finance mailbox.

### Am I eligible for a refund?

Monthly subscriptions can be refunded in full within 14 days of the first payment, and annual subscriptions within 30 days of the first payment. Full details, including what is not refundable, are in the Refund and Cancellation Policy.

## Data

### Where is my data stored?

Data is stored in the region selected for the workspace. Available regions are the European Union in Frankfurt, the United States in Northern Virginia, and Asia Pacific in Singapore. Region selection is available on the Enterprise plan and is fixed at workspace creation on other plans.

### Can I export my data?

Yes. Request a full export from Settings, then Data. Exports are delivered as JSON and CSV within 5 business days, and can be requested at any time including after cancellation while data is still retained.

### How long do you keep my data after I cancel?

Workspace data is retained for 90 days after a subscription ends, then permanently deleted within a further 30 days.

## Getting More Help

If your question is not answered here, raise a ticket from the Help menu. Include the workspace name, the Flow name if relevant, and the run reference from Insights, which lets support locate the exact execution without further exchange.
