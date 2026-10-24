# Import review UI source — #104 / #142

2026-10-24 local source only, unverified/unreleased. No real export, dry run,
import, migration, database, QA or production action was performed.

## Current form boundary

The parent-only existing ImportsClient now uses typed EN/ES controls and semantic
local/known-server error keys. Locale changes re-render feedback without sending
requests. File names, source app names, JSON identity examples and the complete
source/result JSON remain literal; no identities are guessed or translated.
Twelve migrated copy records were removed; four source-label/example inventory
records remain intentionally tracked. No copy scanner ran.

Every source/file/map edit invalidates the form's local preview. A file-read
generation prevents an older file from replacing a later selection. While an
import request is pending, mutable controls are disabled and synchronous guards
refuse another request or event-handler edit. Only a valid result envelope with
a null jobId can establish a dry-run preview; unexpected/malformed responses do
not enable approval. Created/reused counts and skipped-record shape are checked,
but this envelope is not a source/target reconciliation proof.

The preview freezes the exact selected source and serialized data/identity map
for the next explicitly approved persistence request. An old render cannot use
newer input revision state. Confirmation plus the current preview are required
inside the handler, independently of the button's disabled state. Persistence
consumes local review before sending; a second click cannot start another write.
Any unknown result keeps uncertainty explicit and requires a fresh validation
and review before another attempt. There is no automatic retry or background
replay. A non-null jobId is required before the form labels a returned response
an import result. A completed result cannot authorize another import by itself.

The API path, body keys, parent/family guards, identity checks, importer ownership,
provenance and writer behavior are unchanged. Import requests are not aborted on
navigation: a server write may continue; late UI application is discarded. No
client timeout or recovery receipt is claimed. No signing/provider/permissions,
new service, schema, scheduler or stored export was introduced.

## Remaining original work

This is a local input-review guard, **not** a signed server review receipt or a
same-transaction household snapshot. Current account/household changes between
preview and persistence, privileged bypass, current role/session renewal in each
importer, exact database content drift, concurrent/repeated imports and partial
write recovery still require the original server/domain acceptance. The preview
must not be presented as a completed migration or ownership proof.

#104 still needs approved source exports, explicit identity maps, source inventory
and SHA-256 provenance, an isolated restored-backup rehearsal, canonical value/
count/balance/status comparisons, twice-run duplicate evidence, ImportedRecord/
ImportJob verification, rollback/cutover evidence and recoverable source repos.
The referenced [migration rehearsal guide](../MIGRATION_REHEARSAL.md) has now
been restored from current source; it records a procedure, not an executed run
or old passing evidence. Prepare the actual operator rehearsal only from approved
inputs and current backup/restore source. No real household import or erasure is authorized here.

Source cases are authored for preview invalidation, exact reviewed persistence,
double click/consumed review, unknown writes and out-of-order file reads. None
ran. Current/old API compatibility, malformed responses, map/source/file edits,
EN/ES mounted drafts/focus/long text, role/device privacy and all original import
integration/reconciliation checks remain deferred. Keep #104 and #142 open.
