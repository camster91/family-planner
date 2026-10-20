# Durable routine schedule extension

2026-10-20 source foundation for #450 (including consolidated #559), #449/#536/
#480. This extends the current-occurrence editor; it does not replace it or claim
the requested future editor, coordinator or pause controls are implemented yet.
No QA, client generation, migration execution or runtime activation.

## Source gap found

Current `routine-stack.ts` / `routine-stack-mutation.ts` accept one dated
occurrence and refuse template/new-recurring/future-series branches. Existing
RoutineStacks presentation gives per-member/day progress and canonical actions,
but a stack cannot yet own shared future scheduling, cue/duration definitions or
pause/resume. These are unmet #450 requirements, not optional polish.

The ordinary chore forms already have weekday multi-select, canonical template
metadata, local hydration-safe minimum and series collapse. One actual #449 gap
was optional weekly start control: Create now has a collapsed EN/ES Start later
field. It defaults to the viewer's local day and computes the first selected
weekday on/after that date for account, rotation and gated profile requests.
It posts the existing due_date + weekly_days contract; it adds no API field or
mandatory weekly due date. Existing same-key profile retries retain original
bytes; edit/series history policy is unchanged.

## Identity and data design

Use the existing RoutineStack identity and version, never a label match. Keep
canonical Chore root IDs as stable step/series identities; generated Chore IDs
remain occurrence completion/history identities. Each step carries an explicit
account or email-free profile subject; no email/name inference or synthetic User.
Fresh server-side account/member resolution remains required.

Authored additive storage fields:

- `RoutineStack.schedule_config`: nullable versioned shared state, effective day,
  optional authored cue, shared schedule and ordered canonical root IDs only.
  It is not another completion store, and it does not duplicate per-step content.
- `Chore.routine_series_config`: nullable root-only future definition. It holds
  future step content/assignee/duration, reviewed schedule/cue, effective day and
  attached stack ID or explicit detached state. Historical Chore title, assignee,
  amount/points, due day, completion and verification fields are snapshots; a
  future edit must not rewrite them. On deliberate unstack, the root definition
  keeps its last reviewed future schedule/content independently of stack pause.
- `Chore.routine_anchor` / `routine_duration_minutes`: nullable authored snapshots
  for an occurrence. Changing a future cue/duration does not rewrite history.

`database/migration-zzzz-routine-schedules.sql` and matching schema/startup guards
are authored. Existing rows stay null, with no backfill/adoption. JSON protocol
and duration bounds are constrained. Generation and migration/schema drift are
still unrun. Current API validators cannot write these new definitions; no new
route advertises support or writes a non-null definition in this source slice.

Private cross-member definitions require a dedicated parent read projection.
Parent account export now includes existing RoutineStack records under current
household parent membership; non-parent exports strip root future-definition
metadata. Household erasure already inventories RoutineStack and canonical
chores. Before any non-null runtime writer is exposed, ordinary Chore GET/detail/
completion/profile/board/cache/recovery responses must explicitly strip private
future definitions, showing only authorized occurrence snapshots. Do not rely on
Prisma's default selection or the absence of a UI control for privacy.

## Authored command and planning contract

`src/lib/routine-schedule.ts` defines strict `herewoven.routine-schedule.v1`:
create, replace-future, pause, resume and stop with original actor/household,
issued-at, viewer-local date, original request key owned by the later sender,
expected existing stack version and strict step identities. Up to 99 steps,
existing 40-character chore-routine label and 256 KiB request boundary are defined.
The future route must enforce streamed body bounds and age/key contracts; a
constant alone does not enforce transport limits.

- Shared once/daily/weekly/monthly schedule; optional draft starts_on, required
  normalized stored start, weekly distinct weekdays, monthly original day1–31.
  Dates stay UTC date-only representations of the authored calendar day; no UTC
  now guess or before-hydration minimum. Monthly clamping never changes anchor.
- Cue is optional authored text, not an automatic trigger. Duration is optional
  whole minutes1–1440, not a live timer or reason to lock subsequent steps.
- Create cannot adopt existing chores by ID or matching label. Later explicit
  migration must select/review exact canonical rows under its own contract.
- Every replaced root is retained or explicitly removed with unstack-future or
  stop-future; foreign, duplicate, retained-and-removed and omitted roots refuse.
- Pause/resume/stop use explicit future-after-today scope. Today/past work remains
  available. Resume starts on the next selected future day, without synthetic
  catch-up or completed entries. A spent one-time routine has no new date; a
  stopped routine cannot silently resume. Stop archives future scheduling,
  preserving historical chores rather than deleting the routine's history.
- Pure future-row partition preserves every root, today/past, started, check-
  pending, completed/verified/approved, evidence/photo, successor and erased-
  subject row. Only untouched future pending copies can be pruned/replanned.
  Partitioning is not permission: the later transaction must lock/re-read and
  compare current identities/versions before any effect.

`chore-recurrence-dates.ts` extracts the existing canonical UTC daily/weekly/
monthly arithmetic and retains exports from recurringChores. Both ordinary
chores and the new pure routine planner use that shared rule. No alternative
scheduler or cron is introduced. Account/profile expander behavior is otherwise
unchanged in this source foundation.

## Required implementation sequence still open

1. Complete private read projections and parent canonical state/step loading.
   Validate null/known/unsupported metadata and original household/role/token,
   chore feature, profile recurrence capability and existing server flags.
2. Implement the bounded parent coordinator under User → household → stack/root
   → receipt locks, original request age/body/hash/key, expected stack version,
   atomic config/root/copy changes plus compact receipt. Reject unsupported
   legacy template writes rather than let them compete with the shared future
   definition. Keep current-occurrence edits separate and version-aware.
3. Adapt canonical expansion: null metadata keeps legacy cadence. Known metadata
   uses current root definition and stack state, preserves stack/order/cue/duration
   snapshots and current profile/account eligibility, never merges by title.
   Unknown metadata must hold expansion. One-day-per-root uniqueness and existing
   locks guard concurrent top-up. Resume skips missed days; unstacked definitions
   continue independently. Existing root/history snapshots remain unchanged.
4. Expose explicitly gated read/write/control routes; no public/offline capability
   until their original-body recovery/rollback contracts exist. Saved unknown
   requests retain original owner/key/body and cannot be reconstructed as new
   commands. Pause during provider/storage uncertainty is a refusal, not success.
5. Extend the approved rounded parent editor with shared Schedule and optional
   cue/duration sections, named subject choices, accessible move controls, exact
   future-change summary, per-removal policy and pause/resume/stop scope. Keep
   completion-only child/teen views canonical, truthful Done versus Checked,
   no artificial next-step lock, EN/ES and short forms.
6. Later consolidated gates: exact schema/generated client/migration drift,
   repeated/concurrent create/edit/pause/stop/lazy top-up, stale versions/actors,
   old-client refusal, roots/history/evidence preservation, account/profile
   transitions, private projections/export/erasure, uncertainty/process death,
   EN/ES/six viewports and real native lifecycle. Source tests authored here
   exercise dates, anchor, explicit removal, conservative partitions and export;
   none ran. No release claim is attached to this plan.

## Compatibility and rollback

Never activate these definitions while a rollback server/expander can ignore
non-null metadata and generate old cadence or expose private future definitions.
A support/rollback-ready gate and all compatible readers/writers must precede
activation. Leave new fields nullable and retained on code rollback; no destructive
migration, historical deletion or automatic conversion. Existing legacy clients
keep ordinary chores and current-occurrence stacks; unsupported scheduled-template
edits need a clear upgrade/refusal response. Source only is not support proof.

## Canonical runtime source — 2026-10-20 continuation

The parent coordinator/read source is now authored in
`src/lib/routine-schedule-runtime.ts`. It is not routed or activated. Support
requires `ROUTINE_SCHEDULE_ROLLBACK_READY=1`; fresh writes also require
`ROUTINE_SCHEDULE_ENABLED=1`. Both remain unset/off. Reads and matching historical
receipt confirmation can remain available while fresh writing is paused.

The transaction renews actual parent role, household, token version and chores
feature under User then household locks, then locks the original keyed receipt,
stack and canonical roots. Actor/family/action/request hash must match. A compact
validated result commits with stack/root metadata and copied-row changes.
Create/replace/control use an expected version; unknown or inconsistent root
metadata holds. Role/household/token changes refuse before replay. Historical
confirmation never recreates deleted stack/roots and does not claim its old
state is still current. Parent reads return current config/order separately.

New first effects require issued-at within fifteen minutes and the original
viewer day still current in the explicitly supplied validated IANA `view_zone`.
Cross-midnight unknown outcomes check the original receipt; they do not rebase
the body or silently execute yesterday's prune scope. The extra timezone is
private request context, not device analytics or a household timezone guess.

All new/changed targets resolve through existing canonical account/member
authority before writes; profile subjects require protocol2 and existing profile
write/recurrence gates. Pause/stop remain possible when an old assignee becomes
unavailable. Root Chore title/owner/due/points/history snapshots stay unchanged
on future edits; only future definitions and explicit series control fields
change. Control operations preserve author order independently from sorted lock
order. Every candidate copy is re-read under row locks and a bounded total of
10,000 rows before conservative prune/unstack. Exceptions after the first write
roll back the whole transaction rather than return a partial success.

Ordinary chore GET/create/edit/complete/undo/verify JSON and the server chore
page now recursively strip private future-definition keys, while retaining
occurrence cue/duration. Profile create and board/device paths already use
explicit snapshot DTO/selects. Dedicated parent definition export/read remain
separate. Ordinary legacy root/future-series edits and root deletes refuse
private/unknown scheduled definitions under the household lock. Ordinary PATCH
now rechecks actor/ownership for every path instead of an unlocked fast path.

Canonical expansion currently **holds** any non-null root definition; it does
not yet consume the new schedule. This prevents old snapshot expansion from
ignoring pause/state/version. It is a deliberate intermediate source guard, not
a completed recurrence adapter. The coordinator creates initial canonical roots
and replans metadata/eligible pending rows, but does not claim a full upcoming
window or usable pause controls until the adapter and UI are wired. No runtime
HTTP entry or public/offline action advertises this source.

Authored/unrun coverage now includes public projection, legacy root refusal and
a guarded PostgreSQL suite for same-record concurrency/paused replay, root and
evidence preservation, future definition edits, order, pause/resume/stop, stale
version/actor/day and household/role reads. Existing small route fakes reflect
the added transaction/read shape. The new DB file is wired into the existing
required later CI step; no suite or migration was executed.

Remaining before exposing a writer: canonical metadata-aware top-up (including
detached steps), pending-anchor visibility/action guards, current-occurrence
editor interaction/versioning, exact owned request recovery, bounded route
contracts, parent list/editor/control UI and EN/ES/role/device behavior. Lifecycle
erasure/reassignment and old-client rollback still need the consolidated source
and acceptance audit. Keep this issue open at full transferred #559 scope.


## Continuation: canonical future expansion source — 2026-10-20

Replaces the prior intermediate hold for **known active** root definitions only.
`routine-schedule-expansion.ts` is called by canonical `expandSeriesInTx` under
the existing household lock, before the legacy one-off early return. Unknown
metadata never downgrades to old snapshot expansion. Flags are factored into a
small independent module to avoid a coordinator/profile/expander import cycle.
Both rollout controls remain unset/off; no route exposes the coordinator.

Attached roots must match their household-owned stack's schedule, state,
effective day and habit cue and appear in its unique authored step IDs. Label and
position come from that stack. Detached roots instead use their saved definition
and create unstacked copies; historical root stack references are not rewritten.
Current account/member resolution requires the reviewed canonical member ID to
still match, and profile expansion shares the existing legacy profile-series
eligibility checks through `chore-profile-assignee.ts`. Ineligible or erased
subjects do not receive invented fallback assignments or login identities.

The adapter fills a fixed date window rather than counting unrelated retained
evidence: seven daily slots, four weeks of selected weekdays (maximum 28), three
monthly slots, or the fixed once day. Dates reuse canonical UTC date-only helpers,
respect future start/effective floors and monthly anchor clamping, and skip past
days. Once uses max(reviewed start, effective day); after that day it creates no
catch-up. Existing occupied dates of any status are preserved. Only newly created
UUIDs get cue/duration snapshots, along with reviewed title/description/points/
icon/subject and stack order; no historic row is updated to new content.

The coordinator fills active attached roots after storing all root definitions
and stack configuration and before committing the original receipt. Thus initial
and future-edit windows are atomic with the request; receipt replay does not
reapply expansion. Later existing lazy top-up still bounds additional dates.
There is no scheduler or notification side effect. Removed detached roots retain
an independent schedule; later canonical top-up handles their repeating windows.

Authored, **unrun** focused unit source covers bounded selected weekdays,
month-end retention, once-no-chase, occupied history, detached content snapshots,
canonical subject remap refusal, profile authority, attached order/coherence and
unsupported/paused/stopped/erased/rollout holds. Existing guarded DB source now
calculates the untouched pending-copy count for pause after initial generation.
No test/build/typecheck/lint/browser/DB/schema/client/native command was run.

Still before exposure: inactive future-root visibility and completion policy on
account/profile/device paths, legacy current-occurrence stack-edit interaction,
original-body owned retry recovery, bounded routes, parent list/editor/control
UI and EN/ES. Lifecycle/reassignment/erasure and supported-client rollback remain
required, then consolidated QA. This is source progress, not #450 completion,
activation, release or verified behavior.


## Continuation: occurrence read/action and legacy-stack guards — 2026-10-20

`routine-occurrence-policy.ts` is a server-private pure policy plus scoped SQL
read. It joins an occurrence only to its own household's canonical root. Known
paused/stopped definitions hide pristine pending work dated on/after the saved
effective day; prior days, started work, photos, verification fields, completion,
successors and erased historical subjects are preserved. Empty stored notes and
photo strings also count as evidence, matching conservative preservation rather
than treating them as absent. Unknown/contradictory metadata holds open work.

Ordinary chore lists/single reads, the server chores open query, Today board and
personal summary exclude hidden IDs before their caps/paging and their profile
compatibility probes. The private SQL consumes metadata/evidence solely for the
policy; clients receive ordinary projected snapshots, never these fields. Board
and version wrappers share the same read path. Direct account/device completion
rechecks under the household lock and returns a stable private no-store 409
CHORE_ROUTINE_INACTIVE, rather than reporting a paused tap already completed.

Profile completion now distinguishes legacy profile recurrence from a known
scheduled occurrence. It renews the occurrence's own current unlinked profile
subject; a later future owner can differ from the historical root's original
account/profile. Canonical due-today, audit, no-account/no-XP, completion/undo and
parent verification paths stay authoritative. Scheduled-once definitions use
base profile gates in expansion, completion, undo and parent subject verification;
the existing per-row UI availability projection must still learn this distinction
before activation. Full old-client/lifecycle/role audit remains open.

Resume exposed a no-catch-up edge: immutable paused roots must not become overdue
when a later active definition replaces pause metadata. The root definition now
has a private default-false anchor_retired boolean. Before changing control state,
a pristine inactive root whose original due day is before the new effective day
is retired. That retained control anchor stays hidden/action-refused after resume
or unstack; ordinary real copies and any evidence/history are unaffected. No root
ID, owner, due day, status or proof is rewritten. A once routine whose reviewed
start is today/past refuses resume rather than inventing a new one-off task.

The old current-occurrence stack command may replay its matching receipt first;
a new effect then refuses any non-null scheduled stack or selected root/copy
metadata. It cannot silently overwrite label/version or adopt a future step.
Ordinary legacy edit/delete also refuse inactive copies after their existing
locked authority check. Unknown versions always refuse rather than downgrade.

Authored/unrun source covers pure preservation/unknown/retired-anchor behavior,
scoped read/effect parameter binding, legacy occurrence-editor rejection and
real-PG-source pause stale-tap refusal/resume without overdue-root resurrection.
Existing fixture sources were adapted; no test, build, typecheck, lint, browser,
DB, schema/client or native command was executed. Rollout gates remain off and
parent HTTP/UI remains unwired. Next is exact owned request recovery, bounded
routes and parent controls, then capability presentation/EN/ES/lifecycle/rollback
source reconciliation and the consolidated QA phase. #450 remains open in full.
