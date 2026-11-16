# Shared Booking participant read model

Updated 2026-10-30. The read path combines a reusable PAX person with one PAX_X_Bookings participation. No passenger records, communications or drafts are created/updated by this reader.

## Contract

`standalone.crm_getBookingParticipants(bookingId)` returns a JSON envelope with `schema_version: 1`, `error`, `message`, `count`, `result` and compatibility alias `travelers`.
On failure, both lists are empty and error=true; a partial list is never reported as successful.

Each participant has:

| Field | Meaning |
| --- | --- |
| id / PAX_ID | Reusable person ID. Keep using this for PAX profile links. |
| Booking_ID | Booking ID. Validate it when consuming data for a selected booking. |
| PAX_Booking_ID | Participation record ID. Use for identity/deduplication of trip rows. |
| Lead_Passenger / Lead_Pax | Relation-level boolean, including explicit false. Lead_Pax is a compatibility alias only. |
| Booking_Notes / Special_Requests | Relation values. Empty does not fall back to global PAX text. |
| Participation_Status / Source_System / Source_Passenger_Reference | Existing relation values, without inference or automatic repair. |
| Name, Forename, contact, birthdate, passport, nationality, profile needs | Personal fields from PAX. |
| Age / New_Age | Same effective current age: New_Age if present, otherwise legacy Age. This is not age at the trip date. Zero is preserved. |

Cancelled relations are excluded. Pending and blank statuses remain visible with their actual status, preserving the ability to inspect incomplete legacy records. Lead participants are returned first in stable relation order.
The reader validates booking/person references, detects duplicate PAX relations in a booking, paginates by relation ID and fails if its safe page bound is exceeded. It uses COQL and the existing EU `crm_oauth_connection`.

The existing CRM entry points remain:

- `gettravellersforbooking` / standalone.crm_getTravelersForBooking
- `templ_getpaxlistforbooking` / standalone.templ_getPaxListForBooking
- `crmget_getpaxlistforbooking` / standalone.CRMGet_getPaxListForBooking

All delegate to the same reader. The first now returns an envelope instead of the former concatenated object output; existing Bookings and 24h parsers support that envelope.

## Consumers adapted

- **Bookings Manager:** relation-first lead selection/rendering, shared function output, trip requests/notes in traveler view and Communication context. Profile ID and selection lifecycle retained.
- **24h Manager:** relation-first boolean, separate participation/booking IDs, notes in Travel notes, per-participation normalization, foreign-booking response rejection. Open profile still opens PAX.
- **Reconfirmation Manager:** context panel obtains the shared function output, validates booking scope and shows relation requests/notes. It no longer independently loads relation IDs and global PAX values.
- **Accounting Manager / Ministry:** uses the existing correctly named function, refuses reader errors instead of falling back to global values, and caches by booking plus relation. Export passenger options retain the real person ID and include the participation ID. Existing hotel/date/report eligibility filters and one-person-per-service export behavior are retained; no service assignment is inferred.
- **Communication/Reconfirmation models:** primary and legacy model builders use the shared wrappers, retain person/booking/relation IDs, and expose trip lead, notes and requests. Communications deduplicates repeated occurrences of one participation instead of name/email. Reader failures stop model building rather than generating an apparently complete model without passengers.

The configured Template_Sections and Section_Field_Mappings were not modified. Existing mapped fields retain their meaning; new trip keys are available for deliberate configuration. In particular, internal Booking notes are not automatically added to outgoing email content.

## Deployment and verification

- Shared reader, three entry-point wrappers and five model builders compiled and published in CRM; downloaded code checked against UTF-8 local source and active state.
- The joined COQL query, including personal and relation fields, was checked live in read-only mode.
- Client widget source changes remain local until the widgets are deployed. No ZIP/packaging commands were run.
- Existing email drafts and Render_Model_JSON snapshots were not rewritten. Regenerate and review a draft to check the new model; no emails were sent or drafts generated during this change.
- No full passenger sync or data migration was run. End-to-end acceptance using a real deployed widget/function invocation remains pending.
- Existing AXUS and external TP integrations are outside this read-only widget/template step and were not modified.

Backups and the publication verification manifest are in `_local/crm/booking-participants-20261030/`.
Canonical template source is in `crm/participants/`. The separate reconfirmation CRM source copy was patched only in its passenger-loading block, preserving its unrelated local differences.

Validation includes:

- Deluge reader logic: opposite lead values for one person across journeys, false/empty/zero preservation, IDs, cancelled participation, pagination and failures.
- Communications relation-ID deduplication with identical names/emails and repeated services.
- Ministry shared-person cache and export identity, plus existing date-filter tests.
- Reconfirmation context and selected existing request/link tests.
- 24h TypeScript check, all 189 unit tests and both passenger browser tests, including mobile/focus/profile opening.
- Bookings passenger lifecycle and selected Communication regressions.
