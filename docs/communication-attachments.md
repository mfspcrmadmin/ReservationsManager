# Communication email attachments

The paperclip beside **Email content** opens a dialog with drag-and-drop, a native file picker, saved and pending files, removal, and **Save attachments**. Closing with pending changes cancels those changes. Sent Communications expose a read-only list.

Files are stored in `Communications.Email_Attachments`, a multiple-file upload field. The widget allows five files and 15,000,000 bytes total. It uploads through the existing Zoho widget SDK, using the same upload-then-update process as Card Purchases. Field reads and writes explicitly use `https://www.zohoapis.eu/crm/v8/Communications/{id}` through `ZOHO.CRM.CONNECTION.invoke("crm_oauth_connection", request)`. The generic SDK 1.2 `updateRecord` does not expose an API version; both attempted payload keys previously produced a success acknowledgement with zero saved files in live use. Switching the transport is intended to address that failure, but needs live validation.

The v8 update uses `{File_Id__s: uploadedId}` additions and explicit `{id, _delete: null}` removals. Connection parameters are objects (the SDK serializes them), with `param_type: 2` for the JSON update body. Both connection errors and nested CRM/HTTP errors are checked. It reads the record back before confirming a save, allowing three additional reads for delayed visibility without repeating a write. Pending upload IDs remain available after errors so retrying does not re-upload files or recreate already-confirmed links. The Communication ID is captured when the popup opens.

If CRM reports success but changes cannot be verified, the popup exposes **Technical details** and logs `[Communication attachments]`. This diagnostic contains the transport revision (`crm-v8-connection-20260910`), counts and returned field key names, not document content, names, recipient details, URLs or upload IDs. A diagnostic without this transport revision comes from the previous widget code. A success response alone never confirms a saved attachment.

## CRM deployment required

The attachment dialog now requires the existing `crm_oauth_connection` to be callable by the widget with read/update access to Communications. Connection access is checked by the initial read before any files are uploaded. This widget change does not add a new CRM function. Connection availability from the widget has not been verified against live CRM.

Publish the updated local functions from the sibling workspace:

- `../reconfirmationManager/_local/crm/functions/templates/comm_sendCommunicationDraft`
- `../reconfirmationManager/_local/crm/functions/templates/comm_createFollowUpDraft`

Keep their existing API names and arguments. No new CRM function is required. `comm_sendCommunicationDraft` downloads every saved field attachment through `crm_oauth_connection`, checks the HTTP result and actual file size, then adds the files to each authorized sender's `sendmail` branch. Emails without attachments retain their existing sendmail path. A failed download or excess total size stops the send. The connection needs read access to Communications and its attachment field.

`comm_createFollowUpDraft` copies the file references to resend/forward Communications and verifies them before creating the native draft. This prevents an immediate resend from silently omitting the source documents.

The native CRM email draft stores the HTML; `Email_Attachments` on the Communication is the attachment source for this widget's sender. Sending directly through a different CRM email UI is outside this integration.

## Validation

Revision `attachments-readback-20260910-2` reads v8 `Size__s` as bytes. Verification first matches upload IDs or previously confirmed link IDs. If CRM returns a different stored file ID, it accepts only a unique new link (absent before the write) with the exact selected filename and byte size. The pre-write link IDs remain on pending entries across failures so a lost readback can be retried without linking the same upload again. Existing same-name files and ambiguous matches do not confirm the save.

For attachment debugging, filter the browser console by `[Communication attachments]`. Revision `attachments-logs-20260910-1` logs each save with a shared `traceId` and elapsed milliseconds: initial read, validation, upload response shape, v8 request configuration and field payload keys, connection/CRM status codes, returned field shape, verification retries, and completion or failing stage. Lines are serialized JSON so copying them preserves values. Logs omit document names/content, recipient values, record IDs, uploaded IDs and credentials. Copy from `save-start` through `save-failed` or `save-complete`; initial dialog reads have separate trace IDs.

- Automated tests cover size/count limits, CRM field metadata normalization, preserving existing attachments, removal, upload/update/readback failures, retries and sent-record guards.
- A local Edge browser check with mocked SDK responses exercises the paperclip, file chooser, drag/drop, save, removal, retry, size error, Escape and read-only sent email view.
- Live CRM file uploads, Deluge compilation, downloads, sends and resend/forward delivery still need verification after deployment. No emails were sent during local testing.

## API references

- [CRM file-field update payloads](https://www.zoho.com/crm/developer/docs/api/v8/update-records.html)
- [Embedded SDK connection requests](https://help.zwidgets.com/help/latest/ZOHO.CRM.CONNECTION.html)
- [Download field attachments](https://www.zoho.com/crm/developer/docs/api/v8/download_field_attachments.html)
- [Deluge sendmail attachments and size limit](https://www.zoho.com/deluge/help/misc-statements/send-mail.html)
