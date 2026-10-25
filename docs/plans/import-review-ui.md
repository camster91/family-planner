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

## Reviewed actor/household intent — source 2026-10-24

The new web opts into reviewProtocol1 on its dry run. The server returns its
current authenticated actor/household IDs as review metadata. The form freezes
those IDs as expectedScope in the reviewed persistence request, without showing
them as reconciliation data. The API compares them to current authentication
before dispatch: missing protocol1 persistence scope refuses400; changed account
or household refuses409. Underlying locked writer authority remains mandatory.
An expected ID is a precondition, never authority to choose another family.

No signature, source-payload receipt, stored review or target-content epoch is
introduced. Manual privileged callers can still use the legacy no-protocol path;
that compatibility exception is documented, not treated as completed server
review coverage. The new web refuses to enable persistence against an old server
without review metadata, preserving uncertainty instead of silently downgrading.
Original real-data/PG/role/lock/old-client/reconciliation acceptance is deferred.

## Duplicate source identity refusal — 2026-10-25

The three export schemas now reject repeated source IDs within each currently
declared record collection, before their planners build source lookup maps or
persistence starts. Coverage is10 ChoreChamps, eight Meal Planner and14 Budget
collections, including source-person catalogs and all eleven passthrough archive
models. The shared refinement never trims/renames IDs, chooses first/last record,
merges by name/value, drops duplicates or mutates input. Identical duplicate
payloads also refuse pending explicit source review. Equal IDs across different
models and distinct IDs with equal content remain supported. Repeating a valid
export later still uses existing accepted mappings; this guard is per-input,
not a change to cross-import identity/reuse behavior.

At most one marked duplicate issue is added per collection, with the collection,
duplicate row index and ID-field path. No source ID, name, email, payload or
amount is copied into that issue message. This bounds only the new duplicate
issues, not all other Zod diagnostics or source parsing/query work. Callers list
every record collection explicitly; future source-model additions must include
this refinement and source cases. Defaults, ordinary record order, relationship
handling, target schema and existing accepted data/history remain unchanged.

The existing Invalid source export400 response retains details.flatten() and
adds at most32 content-minimal duplicateSourceIds pointers. The parent Imports
form validates the bounded metadata before rendering EN/ES record-number help
alongside its existing semantic error; JSON collection keys stay literal so
parents can find that collection in the export. Invalid/unknown metadata falls
back to the ordinary invalid-export message. File/source/map edits and new
attempts clear stale pointers. Existing request/revision guards prevent older
results from updating changed input. Locale changes only re-render semantic
copy; no new request or approval is granted. Invalid exports never arm a dry-run
preview/persistence checkbox or automatically choose a corrected source record.

Schema/planner source cases cover all32 declared collections, identical/conflicting
ID collisions, model namespace separation, equal names/different IDs, bounded
value-free diagnostics and caller input preservation. Form cases cover pointer
presentation, replacement cleanup, malformed metadata fallback and no approval.
They are authored UNRUN. No QA/tests/checks/scanner/build/browser/CI/API/DB/import/
migration/native/provider/push/merge/deploy ran. Existing accepted mappings,
approved #104 export/identity/count reconciliation, repeated/concurrent import,
unknown outcomes, source-version conflicts and original rollback/role/rendered
acceptance remain open. This is validation source, not completed #104 migration.
