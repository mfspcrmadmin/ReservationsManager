# Ezus passenger participation synchronization

Published in CRM on 2026-10-30. Both functions compiled, are active with no draft, and their downloaded published sources match the local files apart from formatting.

| Local source | CRM API name |
| --- | --- |
| syncTravellersFromEzusWithToken.dg | synctravellersfromezuswithtoken_1 |
| getEZUSTravellersByProjectWithToken.dg | synctravellersfromezuswithtoken |

## Behavior

The existing full-sync entry point still calls the same writer with the same arguments. Its public contract is unchanged.
The writer validates that Booking.Ezus_Project_ID matches the requested project, uses the supplied token and reads only that booking's passenger relations through COQL.

- New and existing matched relations receive Participation_Status=Active and Source_System=Ezus.
- An explicit Y/true/yes/1 or N/false/no/0 lead flag updates Lead_Passenger on this relation. A missing lead flag preserves an existing relation's value; a new relation starts false.
- A source traveller id is stored in Source_Passenger_Reference when supplied. It is scoped to this booking and source; it is not asserted to be a global person identity.
- On subsequent syncs, that reference takes precedence over the existing global matching helper.
- The existing helper remains the fallback for relations without an Ezus reference. Email/name matching across journeys has not been redesigned. If two incoming travellers resolve to the same PAX, or a different stored source reference would be overwritten, the writer fails and does not perform cleanup.
- Existing PAX.Lead_Pax and PAX.Special_Requests are not rewritten by trip synchronization. Only newly created PAX receive initial legacy copies, while consumers are being migrated.
- Blank/missing Ezus profile values do not erase populated personal data. Nonblank supplied profile values retain the existing update behavior.
- Special_Requests in the relation is populated only when empty. Existing manual requests and Booking_Notes are preserved.

The reader checks HTTP status, source error flags and the presence of a travellers collection. The writer rejects malformed rows, duplicate source IDs, duplicate relations and truncated relation reads before starting writes. A booking with over 2,000 existing relations is rejected explicitly rather than treated as a complete page.

## Removal and errors

An explicitly empty Ezus list preserves the current records and returns emptyTravellersList=true, matching the previous conservative no-cleanup behavior.
Only when the incoming list is nonempty, every passenger/relation upsert has succeeded and skipDeletes=false can absent Ezus-source relations be removed.
Only the PAX_X_Bookings record for this booking is deleted, with its API response checked. Global PAX, other bookings' relations and manual/TP/unknown-source relations are preserved. Service assignments are not edited.
Any write error is returned as error=true with counters of confirmed successful operations. The process is not transactional; earlier successful upserts may remain. Cleanup is not started following an upsert error.

Do not run simultaneous synchronizations for the same booking. Do not rerun the historical migration function to maintain new participations: it reads the legacy global lead and could replace a newer, trip-specific lead.

## Validation and remaining work

- 26 local tests passed across ezus-traveler-participation, pax-booking-migration, ezus-sync-server and travelers-refresh.
- The relation COQL query, including the new fields, was checked live in read-only mode.
- Both functions were compiled/published and re-downloaded to verify source equality and active state.
- No real Ezus traveller request or passenger synchronization was executed during this change. End-to-end source/API/write acceptance remains to be checked on a scoped booking.
- The 22 unfilled relations found in the earlier audit were not backfilled by deployment. Their booking must be synchronized or they must be explicitly updated separately.
- Common passenger reading, widget panels, templates and Ministry export still need adapting to relation-level values. The existing consumers may continue to display the legacy global lead until that work is completed.

Previous published sources and publication verification are saved in `_local/crm/pax-sync-20261030/`.

Validation command:

```
node --test tests/ezus-traveler-participation.test.cjs tests/pax-booking-migration.test.cjs tests/ezus-sync-server.test.cjs tests/travelers-refresh.test.cjs
```

Official API references: https://www.zoho.com/crm/developer/docs/api/v8/update-records.html and https://www.zoho.com/crm/developer/docs/api/v8/COQL-Limitations.html.
