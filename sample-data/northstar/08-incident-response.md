# Northstar Cloud Internal Incident Response Procedure

ACCESS LEVEL: MANAGER. Restricted to Northstar Cloud managers and above. This document is fictional and exists to demonstrate access-controlled retrieval in Atlas Knowledge AI.

## Scope

This procedure covers security incidents and availability incidents affecting the Northstar Cloud platform. It is internal and must not be shared with customers or prospects. The customer-facing commitment is in the Security and Privacy Overview.

## Severity Levels

SEV1 is a confirmed breach of customer data, a full platform outage, or a confirmed active intrusion. SEV1 is declared immediately and paged 24 hours a day.

SEV2 is a partial outage affecting multiple customers, a suspected data exposure not yet confirmed, or the loss of a critical security control such as audit logging. SEV2 is paged during extended hours.

SEV3 is a degraded service affecting a subset of customers with a workaround available, or a vulnerability with no evidence of exploitation. SEV3 is handled in business hours.

SEV4 is a minor defect with no customer impact and is handled through the normal backlog.

## Declaring an Incident

Anyone may declare an incident. Under-declaring is treated as a more serious failure than over-declaring, and no one is criticised for raising an incident that turns out to be benign.

An incident is declared in the incident channel with the severity, a one-line description of the observed impact, and the declarer's name. Declaring immediately pages the on-call engineer and, for SEV1 and SEV2, the on-call incident commander.

## Roles During an Incident

The Incident Commander owns the response. They make decisions, and they do not perform hands-on remediation themselves. For SEV1 the Incident Commander must be a director or above.

The Operations Lead performs the technical investigation and remediation.

The Communications Lead owns all internal and external messaging and is mandatory for SEV1 and SEV2.

The Scribe records a timestamped log of every observation, decision, and action. The log is the basis of the post-incident review and of any regulatory notification.

## First 30 Minutes

Confirm the impact and set the severity. Escalate the severity as soon as the evidence supports it; never delay escalation to avoid the paging burden.

Preserve evidence before remediating. Capture logs, snapshots, and the state of affected systems first. Remediation that destroys evidence makes both the review and any notification obligation impossible to satisfy.

Contain the incident. Containment takes priority over root cause analysis. Revoking a credential, disabling an integration, or isolating a host is appropriate before the cause is understood.

Post an initial internal update in the incident channel within 15 minutes of declaration, and every 30 minutes thereafter for SEV1 and SEV2.

## Customer Notification

For any incident affecting customer data, the 72-hour notification clock starts when the incident is confirmed, not when it began.

Draft notifications are prepared by the Communications Lead and must be approved by Legal and by the Incident Commander before they are sent. No individual may notify a customer directly outside this process.

Notification content states what happened, which data was involved, what has been done, what the customer should do, and a contact point. Speculation about cause is never included in a first notification.

The status page is updated for any incident with customer-visible availability impact, within 30 minutes of declaration.

## Regulatory Notification

Where personal data of individuals in the European Economic Area is involved, the Data Protection Officer assesses whether supervisory authority notification is required within 72 hours under the GDPR.

The Data Protection Officer makes this assessment, not the Incident Commander. Where the assessment is uncertain, the default is to notify.

## Credential Compromise

On any suspected credential compromise, revoke first and investigate second.

Rotate the affected credential, invalidate all sessions associated with the affected principal, and review the audit log for the full period during which the credential could have been in use, not only the period in which suspicious activity was observed.

If a Vault credential may have been exposed, the affected customers must be notified even where there is no evidence of use, because Vault credentials grant access to third-party systems outside Northstar Cloud's visibility.

## Standing Down

An incident is stood down by the Incident Commander only, and only when impact has ended and containment is confirmed. Standing down is announced in the incident channel with a short summary.

Standing down an incident does not close it. Follow-up actions remain tracked until complete.

## Post-Incident Review

Every SEV1 and SEV2 incident requires a written post-incident review within 5 business days. SEV3 requires one at the Incident Commander's discretion.

The review is blameless. It examines the conditions that allowed the incident, not the individuals involved. Naming an individual as a cause is not permitted.

The review must produce a timeline, an impact assessment, a contributing-factors analysis, and a list of actions with named owners and due dates.

Actions from a SEV1 review are reviewed weekly by the engineering leadership team until all are closed.

## Retention

Incident records, including the Scribe log and the post-incident review, are retained for 7 years. They are stored with restricted access because they contain detail about security controls and their failure modes.
