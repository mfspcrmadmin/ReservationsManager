# Blueprint execution and recovery

Current architecture, 2026-11-11.

The widget executes Blueprint transitions only through the embedded user's
native CRM SDK. No shared-connection transition fallback is permitted.
blueprint_executetransition rejects legacy calls; blueprint_getbookingblueprint
provides appearance metadata only. Authorization and available transitions must
come from the user's native Blueprint response.

Create Ezus Project completes and confirms project, WorkDrive and Desk
preparation before the native transition. Assignment follow-up starts after a
confirmed native assignment event; failure does not authorize repeating that
transition. The recovery panel resumes only remaining phases.

See [workflow recovery](workflow-recovery.md) for phase receipts and the explicit
initiator/Administrator review policy, and [server authorization](shared-connection-authorization.md)
for the authenticated boundary.

Deployed CRM/Creator functions are the source of truth. There are no supported
local Deluge copies or local-source runtime tests. Local native SDK tests use
mocked responses and do not prove browser, profile or production acceptance.
Publish the updated widget and complete controlled live acceptance separately.
