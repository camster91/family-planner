# Five-minute weekly reset — implementation contract

#123 approved coordination workflow, with #499/#132 UI alignment. Source design
2026-10-20, using the approved rollout's coordination review/reset/history phase.
Provider-free operation is required; AI may later suggest but never complete or
mutate a household record without canonical review. This is not a replacement
for calendar, chores, pickups/handoff, meals/prep, inventory or lists.

## Complete intended journey

A personal dashboard entry opens a compact weekly review with six possible
steps: coming schedule, responsibility/backup gaps, meals, several-dish bulk prep
and remaining portions/next prep, food to use soon, and grocery gaps. Show one
step at a time, short canonical summaries, clear read/loading/unavailable states,
and links/contextual actions into the existing domain controls. Skip is explicit
and available. Review status means the person reviewed or skipped that step; it
never means events/tasks/food/prep are completed or responsibility was accepted.
A final review reports skipped steps and finishes only after each currently
available step was reviewed or skipped. Progress resumes on another signed-in
surface. No AI, microphone, provider, scheduler or notification is required.

Use existing semantic tokens, native/44px controls, back/close/focus/pending rules,
EN/ES and the approved compact sheet/card conventions. Phone uses one step and
small progress text; tablet/desktop may show a compact step rail beside the same
content. All roles use only canonical authorized reads/actions: children fall
back to permitted Today schedule/task presentation, not direct Calendar/Meals.
Disabled/inaccessible meal/prep/inventory/responsibility steps do not leak data or
block completion. Shared paired/fridge surfaces do not expose this personal
planning flow or stored account progress.

## Progress identity and ownership

Store only the current personal review's metadata on User, in separate nullable
weekly_reset_progress JSON and monotonic weekly_reset_revision columns. It is
account-owned review state, not household task completion and not shared approval
by another parent/profile. Protocol v1 binds current family ID, Monday weekStart,
IANA timeZone, known step states and optional server finishedAt. No names, events,
recipes, food quantities, household record IDs or provider content are copied.
User/account deletion removes it with the user; household deletion removes its
users; member detachment clears it even after rollout is disabled. Export own
metadata through a compatibility-probed path. Old clients ignore both columns.
Unknown future protocols refuse writes rather than being silently replaced.

A new week/zone/family is an explicit Start. Reading a different scope shows an
unstarted view with the current monotonic revision; it does not erase old state.
Start in the same scope retains progress. Restart is explicit, clears only review
metadata and retains a monotonically increasing revision. Set-step changes one
currently permitted step, preserving others; Finish requires all visible steps
handled and records server time. Any later step edit clears finishedAt. Feature/
role changes recompute available steps; a newly required pending step makes a
previous finish incomplete. No last-write-wins overwriting across devices.

## Mutation/recovery contract

New person-only /api/coordination/weekly-reset GET/PATCH is gated by an explicit
FAMILY_WEEKLY_RESET_READY=1 setting, unchanged/off in this work. Strict bounded
scope/command schemas; required Idempotency-Key; actor-user then household and
User-row locks; renew token generation, role, membership and current features.
Expected revision prevents stale overwrite. Existing IdempotencyRecord stores
exact action/body identity and atomic progress/receipt completion; fresh auth
also guards receipt replay. No automatic send/drain on load, focus or locale.
The client must freeze body/key after a write starts, retain unknown outcomes,
review conflict/current server state and never copy a prior account's progress.
No new public capability advertisement or installed-client activation yet.

## Delivery slices and acceptance (all remain open until demonstrated)

1. Contract, additive schema source, strict state machine and transactional
   service/API, personal export/erasure compatibility. This is the first slice.
2. Canonical authorized bounded step summaries, including partial/error/empty
   handling and real multi-dish prep/portions/next-prep links; never invented data.
3. Typed EN/ES compact parent/teen/child UI and discoverable personal entry, saved
   exact-request recovery, skip/back/resume/restart/finish and roles/features.
4. After all candidate code: contract/state/lock/replay/two-household/role/export/
   erasure/unknown-schema and real PostgreSQL migration cases, full rendered six
   viewports/native pending/focus/offline/locale/reflow, existing domain/regression
   gates and normal exact-source release review. No deployment/activation now.

Remaining slices are required work, not replaced by a links-only tour. No full
weekly-reset, broader #123 AI/coordination or release acceptance is claimed by
the progress foundation. Rollback keeps nullable columns, disables the new entry
and API, and preserves canonical domains; erasure/export still handle stored
metadata. No destructive migration or reclassification of external provider,
store, signing, hardware or customer dependencies.

## Progress foundation authored — 2026-10-20

The first delivery slice now has source: strict v1 Monday/zone/family/command/
record schemas and role/feature-derived section targets; pure start/restart/
set-step/finish transitions; private User progress/revision columns with an
idempotent additive migration file; and person-only GET/PATCH route gated off
unless FAMILY_WEEKLY_RESET_READY is explicitly 1. No flag was changed.

The transactional service renews token/role/membership, takes actor-user,
household and User-row locks, validates known stored protocols, checks expected
revision, and commits changed metadata with the existing keyed receipt in the
same transaction. A takeover reads a completed effect before reapplying it.
Receipts contain only protocol/scope/action/revision, not role-dependent routes,
step contents or household records; GET projects current permitted steps. A
fresh actor lock also guards outer receipt replay. Failed/unknown scopes, hidden
steps, incomplete Finish and stale revisions do not silently replace progress.

Compatibility-probed helpers export own stored metadata and clear it on member
detachment even with rollout disabled or a future payload. Account/household
user deletion removes the columns with the user. No new household-content table,
private record copy, provider read, task completion, shared-profile login or
background job is introduced. Client generation and migration execution remain
explicitly deferred; old-runtime probes avoid selecting absent columns.

Authored pure/transaction/compatibility source cases cover strict scopes, explicit
new review, skip/finish/edit, feature/child filtering, changed authority, revision/
unknown protocol hold, minimal atomic receipt/no reapply, different-week reads,
pre-migration export and erasure compatibility. They are unrun; fakes do not prove
Postgres locks, atomicity, migration or real household isolation.

Next required code: bounded canonical domain step summaries and the complete
localized adaptive review/resume/skip/restart/finish UI with discoverable entry
and frozen owned request recovery. The API/progress foundation does not deliver
that journey by itself. These remain implementation work, not a provider blocker
or a substitute links-only tour. Full PostgreSQL, schema/client, existing-domain,
role/offline/native/rendered/source/hosted and release acceptance follows all code.
