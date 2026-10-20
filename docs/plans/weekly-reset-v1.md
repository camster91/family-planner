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

## Bounded canonical summary source — 2026-10-20

A separate GET `/api/coordination/weekly-reset/summary` now requests exactly one
strict step/week/zone, under the same unchanged readiness gate. Fresh locked
account token/membership/role/features authorize the step before domain reads.
The response binds actor/household/scope/step, includes generatedAt, and caps each
preview at eight rows with explicit more/unknown notes. An unavailable source
fails the step instead of returning an empty success. It never calls a provider,
refreshes external calendars, generates routine occurrences or mutates a domain.

Authored projections cover shared-safe stored event titles/overlap times using
DST-aware local-week bounds; current account chore rows with canonical routine
visibility checks and teen/child own-account predicates; pickups and handoffs
without private notes/address/share token; weekly meal snapshots; current food
using the canonical use-soon policy; and actual open grocery totals. Bulk prep
retains verified-email/role restrictions, multiple dishes, planned/prepared
distinction, next-prep dates and exact active-consumption sums per displayed dish
(never a capped history sum). Earlier prepared sessions can be previewed too.
Food safety always uses actual local today, not a previous review's Monday.

This remains a partial summary slice. Email-free/profile routine review is
explicitly referred to canonical chores, not presented as fully summarized;
accepted responsibility/named backup remain unknown in these legacy models.
Open groceries do not mean recipe coverage was assessed: canonical ingredient
gap review still needs integration. Capped summaries and stored-only schedule
do not establish that a week is conflict-free or complete. No UI/discovery entry
is authored yet; typed EN/ES compact review/resume/recovery remains required.
New schema/window/role/query/cap/source-failure/food/prep/authority test source is
unrun. No tests/typecheck/lint/build/schema/DB/API/browser/native/provider/CI or
release operations were performed. No flag, deployed runtime or client changed.


## Compact UI and owned recovery source — 2026-10-20

The personal Today page now has a readiness-gated Review your week entry, omitted
in fridge mode and for unsupported roles. It lazily loads one compact EN/ES
review sheet. The URL query carries the open state using normal Next navigation:
opening pushes an entry, Back removes it, and a direct link closes by replacing
only the review query. No custom history marker competes with the router.
The source reuses the shared Dialog focus trap/restore, rounded mobile sheet,
bounded scrolling/fixed footer, current theme tokens and 44px controls. Larger
screens get a step rail; phones show one step. Each group previews at most three
rows with an explicit full-section link/more notice. Week/zone and each review
state are visible. Start for a different week warns that it replaces personal
review metadata; explicit skip/back/restart/finish and final skipped counts are
implemented. Finish means reviewed, never domain work complete.

Commands and minimal receipts now explicitly bind the original user as well as
family/week/zone/action. New commands carry issuedAt; a missing receipt cannot
replay an intent older than 15 minutes or more than one minute in the future.
A completed exact receipt remains inspectable before age/revision checks. This
hardens only an unactivated source endpoint, not a shipped installed-client API.
User progress metadata itself is unchanged and still contains no domain content.

The new browser adapter reuses createOwnedRequestJournal, owned storage locations,
Web Locks, physical-store probes, owner retirement and storage-transition repair.
A distinct hashed session/user/generation/household/role owner prevents journal
collision with groceries/routines. Recovery GET renews canonical authority;
explicit POST inspection checks exact user-scoped idempotency action/hash/body,
receipt, current revision/protocol/step availability and age. New writes require
both the weekly-reset readiness flag and existing queue-recovery enable/rollback
flags, an exact owner header and the normal current person session. No flag was
changed. Recovery inspection remains available during a write pause; it performs
no domain or progress write. Old/unknown journals are held, never silently erased.

Each action persists its immutable body/key before its one foreground send.
Opening, locale, focus, recovery and read retries never send a mutation. Recovered
requests require explicit inspect/retry; stale/expired/conflicting requests remain
held with local-dismissal confirmation. A receipt is validated against original
actor/family/week/zone/action before local dismissal and a fresh role projection.
Unknown HTTP/parse/timeout/storage outcomes retain the request. Closing during
staging prevents a later send; closing during an already-started request retains
its key for later inspection. Late read/results cannot update a closed/older
opening. Storage repair distinguishes staging from dismissal, so repairing a
confirmed deletion cannot restage the dismissed request. Local dismissal never
claims to undo a server effect. No unowned fallback or background queue is added.

Client-safe summary schemas are separated from server-only canonical loaders.
Authored UI/client/recovery-server source cases cover no automatic sends, exact
retry receipts, other-account/scope refusal, duplicate activation, durable-stage
failure, closing during staging, restored committed receipts, partial dismissal
repair, expiration/revision/rollout/unknown protocols and unavailable previews.
All remain unrun. Formatting/source inspection only: no tests, typecheck, lint,
build, generated client/schema/SQL/DB/API operations, browser/native/provider/CI,
push, merge, deployment or activation. No rendered/device/release claim.

Required next code remains profile/email-free routine summary integration and
canonical recipe ingredient-gap review. Current account-chore/open-grocery
previews explicitly say what they cannot assess. Accepted/backup responsibility,
conflicts/event prep/unified review inbox/what changed and broader grounded #123/
#144 still remain. The full goal is active, not narrowed to this weekly UI.
