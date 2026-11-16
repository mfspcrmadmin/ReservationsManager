# Project instructions

## Zoho widget packaging

Never generate ZIP files or run zet pack or equivalent packaging commands.

## CRM and Creator function sources

The deployed functions in CRM and Creator are the source of truth. Read the
current remote function before changing it, update it remotely when authorized,
and reread it to verify publication. Do not execute business functions merely to
verify publication.

Do not save local copies, backups, exports or fixtures containing function
source in this project. This includes Deluge files, extensionless function files
and API response dumps containing full function source. Keep fetched source in
memory while working. Documentation may record API names, contracts and verified
publication status without embedding the function source.

Local widget tests must not claim to verify deployed function behavior by
reading old local sources or sources in sibling checkouts.
