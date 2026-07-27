# Northstar Cloud Product Manual

Northstar Cloud is a fictional workflow automation platform used to demonstrate Atlas Knowledge AI. Every person, price, policy, and figure in this document is invented for demonstration purposes and describes no real company.

## Platform Overview

Northstar Cloud lets operations teams connect the systems they already use and automate the work that moves between them. The platform has four components: Flows, Connectors, Insights, and Vault.

A Flow is an automated sequence of steps that runs when a trigger fires. A Connector is an authenticated link to an external system such as a CRM, a helpdesk, or a data warehouse. Insights is the reporting layer that records every run. Vault is the encrypted credential store that holds the secrets your Connectors need.

## Flows

Every Flow begins with exactly one trigger and continues through one or more actions. Three trigger types are available.

A schedule trigger runs a Flow at a fixed interval. The shortest supported interval is every five minutes on the Team plan and every one minute on the Business plan.

An event trigger runs a Flow when a connected system emits a matching webhook. Northstar Cloud verifies every inbound webhook signature before the Flow starts.

A manual trigger runs a Flow when a user presses Run in the console or calls the Flows API.

Flows support branching with conditional steps, loops over collections, and error handlers that catch a failed step and route it to an alternative path. A Flow that has no error handler stops at the failed step and records the failure in Insights.

### Flow Limits

The number of Flow runs included each month depends on your plan. Starter includes 2,000 runs, Team includes 20,000 runs, and Business includes 100,000 runs. Enterprise run volume is agreed during contracting.

A single Flow run may execute at most 200 steps. A Flow run that exceeds 200 steps is halted and marked as Step Limit Exceeded. A single step may run for at most 90 seconds before it times out.

### Versioning and Rollback

Every time a Flow is published, Northstar Cloud stores a new immutable version. The Flow editor shows the last 50 versions. Any stored version can be restored with the Rollback action, which publishes the selected version as a new version rather than deleting history.

## Connectors

Northstar Cloud ships with 140 pre-built Connectors. Popular Connectors include Salesforce, HubSpot, Zendesk, Jira, Slack, Snowflake, Google Workspace, and Microsoft 365.

Connectors authenticate using OAuth 2.0 where the target system supports it. Where OAuth is unavailable, Northstar Cloud accepts an API key, which is stored in Vault and never displayed again after it is saved.

If no pre-built Connector exists, the HTTP Connector can call any REST endpoint that accepts JSON. The HTTP Connector supports GET, POST, PUT, PATCH, and DELETE, and allows custom headers.

### Connector Health

Each Connector reports a health state of Healthy, Degraded, or Disconnected. A Connector becomes Disconnected when its credential is revoked, expired, or rejected three consecutive times. Flows that depend on a Disconnected Connector are paused automatically rather than failing repeatedly, and the workspace owner is notified by email.

## Insights

Insights records every Flow run with its trigger, duration, step outcomes, and any error message. Run history retention depends on plan: Starter retains 7 days, Team retains 30 days, Business retains 180 days, and Enterprise retains 365 days.

Insights provides four standard reports: Run Volume, Failure Rate, Slowest Steps, and Connector Health. Reports can be exported to CSV. Business and Enterprise plans can schedule a report to be emailed weekly.

## Vault

Vault stores every credential used by a Connector. Credentials are encrypted with AES-256 before they are written to disk, and the encryption keys are held in a separate managed key service.

A credential saved to Vault is write-only from the console. After saving, the value can be replaced or deleted but never read back, including by workspace administrators. This is deliberate: it means a compromised administrator account cannot be used to extract the credentials of connected systems.

## User Roles in Northstar Cloud

Northstar Cloud workspaces have four roles. A Viewer can see Flows and run history but cannot edit or run anything. An Editor can create and edit Flows but cannot manage Connectors or billing. An Admin can manage Flows, Connectors, Vault entries, and workspace members. An Owner has every Admin permission and additionally controls billing and workspace deletion. Each workspace has exactly one Owner, and ownership can be transferred by the current Owner.

## Getting Started

To build your first Flow, open the console and select New Flow. Choose a trigger, add at least one action, and connect the action to a Connector. Press Test Run to execute the Flow once against live systems, then press Publish when the result is correct.

A new workspace starts with a 14-day free trial of the Team plan. No payment card is required to begin the trial. At the end of the trial the workspace moves to the Starter plan unless a paid plan is selected.

## Supported Browsers

The Northstar Cloud console supports the current and previous major versions of Chrome, Edge, Firefox, and Safari. Internet Explorer is not supported. The console requires JavaScript and cookies to be enabled.

## Service Availability

Northstar Cloud targets 99.9% monthly uptime on the Business plan and 99.95% on the Enterprise plan. Uptime commitments and service credits for the Enterprise plan are defined in the customer's contract. Planned maintenance is announced at least 72 hours in advance and is scheduled outside business hours in the workspace's configured primary region.
