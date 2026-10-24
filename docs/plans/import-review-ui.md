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

The API path/body keys, source parser plans, ownership mappings and provenance
semantics remain. The subsequent authority pass below renews writer authority;
it is separate from the local reviewed-input guard. Import requests are not aborted on
navigation: a server write may continue; late UI application is discarded. No
client timeout or recovery receipt is claimed. No signing/provider/permissions,
new service, schema, scheduler or stored export was introduced.

## Remaining original work

This is a local input-review guard, **not** a signed server review receipt or a
same-transaction household snapshot. Current account/household changes between
preview and persistence, privileged bypass, exact database content drift,
concurrent/repeated imports and partial write recovery still require original
server/domain acceptance. Current role/session/mapping renewal now has source
coverage below, with real lock/race acceptance still deferred. The preview
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

## Writer authority source follow-through — 2026-10-24

`src/lib/imports/import-authority.ts` is used by all three persistence paths before
job creation and again in the effect transaction before provenance reads/writes.
It locks distinct actor/mapped User advisory keys in stable order, then the
household, then current User rows in ID order FOR UPDATE. Row locks fence ordinary
role/session UPDATEs as well as the existing membership advisory protocol. After
any lock wait it requires a live parent in the original household, each mapped
user still in that household and the household still present. HTTP dispatch
carries the initially verified session generation internally; mismatch refuses
with401 SESSION_CHANGED. The body cannot supply this authority. Internal callers
may omit a session generation, retaining compatibility, but still need a current
parent/household and current mappings. Dry-run planning remains non-writing.

Job creation and effects remain separate transactions, so a later refusal can
leave a running job that needs failure accounting. The internal failure helper
locks the household and updates only the exact family/source/job still marked
running. Deleted/completed jobs are not recreated or overwritten. It stores a
fixed content-free diagnostic and never masks the original error if operational
accounting fails. No token/session record is persisted, no new receipt exists,
and no user/household/source IDs or raw exceptions enter that failure log.

Effect transactions retain their existing60s timeout. The family lock serializes
cooperating household imports; it is not a latency/capacity or exactly-once claim.
A deadlock/timeout refuses rather than guesses authority. Current PostgreSQL lock
ordering, row/advisory interaction, held-lock removal/role/password changes,
account/family deletion, actual replay/partial outcomes and older-client matrix
remain unverified. Serial helper and API refusal cases are authored/unrun.
No migration, import, dry run or QA occurred. Full #104 remains open.
