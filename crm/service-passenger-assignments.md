# Service passenger assignments

Prepared and published on 2026-10-30. The canonical assignment module is **PAX_Booking_Services**. The empty automatic linking module **Booking_Services_X_PAX** is retained for compatibility, but is not used as a second assignment source.

## CRM and source changes

- Added Assignment_Status (Active/Cancelled), Assignment_Source (CRM/Ezus/Legacy), Room_Group, Service_Notes and a unique Assignment_Key.
- Kept existing Booking, Booking_Service, PAX and Room_Type fields and all historical assignment records.
- Marked the old multi-select fields as **Service (legacy)** in PAX and **PAX in Service (legacy)** in Booking Services. API names, relationships and records were not removed.
- Published `servicepax_manage` / standalone.servicePax_manage. It reads assignments, previews changes, then saves only with explicit commit and the loaded version.
- Protected standalone.settlements_deleteService: a service with any canonical passenger assignment/history cannot be deleted automatically. A failed guard read also blocks deletion.
- Protected the passenger sync: active or legacy service assignments block removal of that passenger's PAX_X_Bookings relation. All planned unlinks are checked before any unlink begins.
- Filled the 22 previously identified PAX_X_Bookings records' missing Participation_Status/Source_System with Active/Ezus, based on their current Bookings.Ezus_Project_ID. Lead flags were not changed. A fresh query found no remaining blank status/source records at that time.

## Bookings Manager flow

The source now includes **Assign travelers** under Service details → Actions.

1. Open a selected service. The editor loads that service's Booking and the shared Booking participants.
2. Select participating travelers. No assignment does not mean all travelers; no checkbox is selected automatically for an unassigned service.
3. Optionally expand Room and passenger notes: Room Type, Room Group and Service Notes. Room Group is local to that service; it is not a global room identifier.
4. Review changes. The server validates membership, duplicate IDs, supported room types and lengths before returning a plan.
5. Save assignments explicitly. The UI prevents double submissions, reloads the data, and compares the selected IDs/room values/notes with the result before claiming a verified save.

Removing a checkmark cancels the existing assignment; it does not delete the record or clear its historical room/notes. Selecting that passenger again reactivates the same record.
The person ID remains PAX. Assignment_Key is service ID plus person ID, independent of display names and email.

## Validation, concurrency and errors

- Service and selected passenger must belong to the same Booking. The actual service record is checked directly, rather than relying on a multi-hop COQL Booking join.
- Cancelled Booking participations are excluded by the common participant reader. No Booking membership is created implicitly.
- Legacy multi-select links on the selected service, duplicated canonical pairs, missing lookups, foreign Booking IDs or active assignments to people no longer in the Booking block editing with a review message.
- Blank Assignment_Status on old rows is treated as an existing active assignment by this editor. Old records are not bulk-normalized or marked with a guessed source. Native CRM filters must include blank statuses when looking for historical active rows.
- Assignment_Key protects newly managed rows from duplicate creates. Manual CRM changes that leave the key blank can still create legacy inconsistencies; the editor detects those rather than silently merging them.
- The version includes the service's Booking/Modified_Time and each assignment's ID, Modified_Time and field values. Even same-second changes to notes invalidate the previous preview.
- A stale version requires reload/review. Saves are not transactional; an API error may leave earlier confirmed changes applied. The editor blocks another save until reload and never automatically resends a commit.
- The function bounds the view to at most 2000 current assignments and 200 requested passengers/changes. Larger or truncated sets require separately reviewed batches, not silent truncation.
- Historical Room_Type capitalization is only normalized on a reviewed edit. No field is rewritten just to adopt internal source/key metadata when business values are already unchanged.
- Explicit empty trigger lists are used for the manual assignment CRUD operations. No external API sends or communication creation are implemented.

## Historical audit

Read all **177,529** canonical assignment records. The automatic linking module returned no records.
The audit flagged **4,333** records with at least one missing Booking/service/person reference and **132** duplicate service-person pairs with valid pair IDs. These groups can overlap.
Multi-hop Booking_Service.Booking.id values came back null even for records whose actual service Booking was confirmed directly. Those nulls were not classified as wrong-booking assignments.
The new editor checks the actual parent Booking per service. No historic assignment was merged, moved, cancelled or deleted during this work.

Review artifacts:

- `_local/artifacts/service-pax-review-20261030.html`
- `_local/artifacts/service-pax-review-20261030.json`
- `_local/crm/service-pax-20261030/participation-backfill.json`

## Deployment and acceptance

CRM fields and functions were compiled/published and their live sources re-read for verification. The widget source remains local until deployed. No ZIP or packaging command was run.
Server read/preview/commit logic and sync guards are covered by local mocked tests; the dialog was tested in Edge at mobile width, including review, explicit save, double-submit, reload and focus restoration.
No real service assignment save, passenger sync, service deletion, AXUS/TP send or email was executed. Validate the SDK invocation and one deliberately chosen assignment after deployment.
The Standalone function is invoked from the widget through ZOHO.CRM.FUNCTIONS.execute. No new API key or authentication settings were changed.

Service assignment selection is not automatically used to change outgoing template recipients/content or Ministry export eligibility in this phase. Those retain the previously reviewed Booking-level behavior until explicit service-specific rules are agreed.

Official references:

- https://www.zoho.com/deluge/help/crm/update-record.html
- https://www.zoho.com/deluge/help/crm/create-record.html
- https://www.zoho.com/deluge/help/encryption/sha256.html
- https://www.zoho.com/crm/developer/docs/functions/triggers-and-associations.html

Local validation:

```
node --test tests/service-travelers.test.cjs tests/service-assignment-delete-guard.test.cjs tests/ezus-traveler-participation.test.cjs tests/ezus-sync-server.test.cjs tests/booking-participants-reader.test.cjs
node tests/service-travelers-browser.cjs
```
