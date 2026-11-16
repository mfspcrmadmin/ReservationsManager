# Remote function sources

CRM and Creator are the source of truth for their functions. Local function
copies and historical exports were removed at the user's request on 2026-11-06.
Do not recreate them. Read current source through the connectors in memory.

## Verified CRM update: 2026-11-06

- Function API name: `comm_sendcommunicationdraft`.
- Function ID: `616617000169865138`.
- CRM accepted the code update with SUCCESS; published source was reread.
- The published code requires draftId, matches that exact native draft inside
  the Communication, and returns without sending if it is no longer available.
- Subject/body remain sourced from that draft; To/CC remain sourced from the
  Communication fields. No mail was sent to validate the update.
- Readback matches the submitted code apart from Zoho whitespace formatting.

The widget communication and batch tests pass locally. Historical tests that
read removed Deluge sources are not evidence of live backend behavior and need
to be migrated to explicitly invoked remote verification. Do not restore old
function sources to satisfy them. Other audit corrections remain separate work.

## Verified sender correction: 2026-11-06

The same CRM function was updated directly to correct one attachment branch
whose literal sender differed from its selected sender condition. CRM returned
SUCCESS. Published source was reread and matched the intended change. All 27
sender branches (54 sendmail blocks, with and without attachments) now match
their respective sender conditions. Exact draft selection from item 1 remains
in place. This verifies published code, not mailbox delivery or sender-account
verification status. No emails were sent and no local function source was saved.

## Published persistent send protection: 2026-11-06

CRM accepted and published updates to comm_sendcommunicationdraft,
comm_createdraftforcommunication, comm_updatecommunicationdraft and
comm_regeneratedraftforcommunication. All four published sources were reread
in memory and matched the submitted changes apart from formatting.

The sender conditionally claims the Communication through Render_Error using
If-Unmodified-Since, requires a record version at least two seconds old to avoid
same-second timestamp reuse, and verifies its unique SEND_PENDING marker before
delivery. Unknown outcomes retain the marker; successful delivery clears it
together with confirmed Sent status. Draft creation, editing and regeneration
reject pending markers. Render-state writes are conditional, and rendering
exceptions no longer write over the marker. Recipients, exact draft selection
and the sender correction remain intact. No new fields were added.

Seventeen local communication/batch tests passed. Source-contract checks were
performed against reread remote code, not stored copies. No business function
was executed. Two-session concurrency, timestamp parsing at runtime, ambiguous
delivery recovery and mailbox delivery still require controlled acceptance.
Do not clear a SEND_PENDING marker merely to retry sending: first confirm
whether delivery occurred. A stale-version rejection before claiming is safe
to retry after waiting and refreshing.

Reference: https://www.zoho.com/crm/developer/docs/api/v8/update-records.html

## Unconfirmed delivery guidance: 2026-11-06

The sender's uncertainty messages were updated in CRM and verified by rereading
published code. They ask users to check their mailbox, any CC copy and the
Communication in CRM before sending again, and state that no automatic retry
will occur. CC is still read from Recipient_CC; the function does not guarantee
that the acting user is copied.

Local widget changes provide the same guidance for network failures, empty or
malformed replies and explicit unknown delivery status. Unknown overrides a
contradictory success flag. Confirmed pre-send rejection retains its validation
message and permits correction. Batch results count confirmed deliveries and
stop on uncertainty without repeating delivery. Thirty-one focused tests passed.
Widget source changes have not been published; no emails were sent for testing.

## Delivery and CRM-only recovery: 2026-11-06

Published and reread: comm_sendcommunicationdraft and the new Standalone Deluge
function comm_reconcilecommunicationdelivery (ID 616617000177734260), plus the
three draft functions' protection for confirmed deliveries awaiting recovery.
Runtime and category availability were checked before creation.

Before sending, the sender captures the complete linked-service plan, booking
ownership and service versions. Failure to verify that plan blocks delivery.
After delivery, it persists Sent plus a SEND_CONFIRMED recovery plan in
Render_Error; if that fails it attempts to persist the evidence alone. If both
writes fail, delivery remains confirmed in the response but requires manual
verification/reconciliation: automated recovery cannot assert unpersisted proof.

CRM-only recovery requires persisted confirmed evidence, never accepts a
SEND_PENDING marker as proof, and contains no sendmail or draft-send invocation.
It skips services already On Request, conditionally updates unchanged service
versions, retains conflicts for review, and clears the recovery plan only after
all services and Sent status are confirmed. Recent second-resolution versions
are deferred. Retries operate on pending work; completed work is not resent.
The snapshot is bounded by the existing field capacity and pagination limits.
Old deliveries without a persisted plan are not retroactively reconstructed.

Local widget source adds Retry CRM updates to the result dialog and selected
sent Communication, distinguishes confirmed delivery from persistence failure,
and blocks duplicate recovery clicks. Thirty-six focused tests passed. This
widget UI has not been published or visually accepted. Remote publication was
verified by source readback, not by executing business functions or sending mail.
Controlled failure/recovery acceptance in Zoho remains pending.

## Ezus traveller lead compatibility: 2026-11-10

The reported booking 616617000157853376 was read from CRM and its project
travellers were fetched read-only from Ezus. The response contained two rows:
one lead value was the string v and the other was empty. Ezus field metadata
identifies lead as a traveller text field. No passenger personal data or API
credentials were recorded here.

The deployed synchronizer is function ID 616617000144881519, API name
synctravellersfromezuswithtoken_1. The similarly named API function without _1
is the getter, not the synchronizer. The synchronizer now accepts V after its
existing case normalization and maps it to true in both validation and mapping.
Existing recognized values, empty-value preservation and unknown-value rejection
remain intact. CRM accepted the update and published source was reread in memory.
Ten lead-value contract cases were checked; no full function source was saved.
No business synchronization was executed and no traveller records were written
for this validation. A user-triggered retry remains the live acceptance step.

The separately reported Communication timestamp blockage is still under
investigation, deferred while this booking's synchronization error is addressed.

## Communication timestamp comparison correction: 2026-11-10

Communication 616617000177632761 was read-only checked: Draft, Modified_Time
2026-11-10T11:53:36+01:00. At the diagnostic clock check (10:58:23 UTC), it was
almost five minutes old, not a just-modified record. No delivery marker existed.
No recipient or message content was inspected.

The time guard added during hardening used implicit Date-Time epoch conversion
on a timestamp with an offset. Both comm_sendcommunicationdraft and
comm_reconcilecommunicationdelivery now parse the wall-clock part explicitly in
GMT, apply the supplied numeric offset, and compare UTC calendar order against
the UTC two-second cutoff. This avoids reliance on implicit Date-Time.toLong
timezone behavior. Invalid formats and offsets still block writes. Genuine
recent changes still require a short wait; sending returns retry_after_seconds.
Conditional If-Unmodified-Since, persistent claims, exact draft selection,
recipients and confirmed-delivery recovery were preserved.

CRM returned SUCCESS for both updates. Published source was reread and verified;
Zoho's only initial normalization was removing redundant boolean parentheses.
Ten in-memory clock cases and three invalid timestamp cases were checked,
including this record, equivalent offsets, the two-second boundary, DST dates,
fractional-hour offsets and year rollover. These tests model documented parsing,
not an executed business function or actual Deluge runtime acceptance.
The example Communication's status, modification time and marker were rechecked
unchanged. No email was sent and no recovery or record update was executed.
This server-only correction needs no widget publication; deliberate user retry
remains the live acceptance step.
