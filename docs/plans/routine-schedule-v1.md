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


## Continuation: original-request recovery and HTTP source — 2026-10-20

A new private `herewoven.routine-recovery.v1` contract stores only exact validated
schedule requests, not a general offline action queue. Each entry retains its
original bytes/key, actor/family, issued-at and viewer zone/day. Five entries and
2 MiB bound the journal; each command stays within the existing 256 KiB bound.
The routine-specific person owner scope derives from the current signed session,
role/family and queue retirement generation, separate from grocery and inventory
storage. No token or credential is persisted. Existing owned queue retirement and
Web Lock leases apply; unsupported/failed locks have no permissive fallback.

The inventory recovery controller's unchanged storage state machine was extracted
as `owned-request-journal.ts`; inventory remains a configured adapter with the
same contract/error class. Routine uses its own strict context/entry/journal
validators and recovery review callback. All candidate stores must be readable;
conflicting copies, unknown contracts, uncertain writes or mismatched ownership
hold rather than merge/reset. Recovered requests need explicit server review.
Unknown sends and confirmed sends both retain the entry until an explicit local
dismissal. The shared controller now renews owner and storage again after a send
settles, so a delayed reply cannot appear in a different owner's UI. Shared
stream-bounded JSON decoding was extracted with the existing inventory export
preserved. This cross-domain refactor still requires the consolidated fault tests.

`routine-schedule-client.ts` prepares an intent once, stamps actual viewer zone/day
and current actor context, and sends its exact saved bytes/key. A fifteen-second
settling deadline covers native fetch bridges that ignore AbortSignal; timeouts,
malformed success and server uncertainty remain unknown. Read-only recovery review
validates owner scope and byte-for-byte echoed entry before exposing its state.
It does not refresh timestamps/versions or mint replacement keys on retry.

The canonical coordinator now has a throwing `persistRoutineScheduleInTx` effect.
`routine-schedule-api.ts` renews actor authority, checks/reserves (user scope,key),
applies that effect and commits its proof in **one transaction**. Refusals translate
only after rollback; no partial roots or orphan reservation is committed. A changed
hash/action/household for an existing key refuses. An old proof is never deleted
here to reuse the key. Retained committed proof is checked before fresh intent
age/day and can confirm after nominal TTL or a writing pause; an actually pruned
proof plus an expired original request cannot recreate the routine. Read-only
inspection returns committed/removed with the original compact proof, or ready,
pending, expired, conflict, paused/unavailable without creating records. It checks
current authority/version/known control state; retry still renews all full target
and history rules inside the canonical write.

Gated parent-person HTTP source now exists at `/api/chores/routines` (GET exact
stack state / POST exact keyed effect) and `/api/chores/routines/recovery` (GET
owner context / POST inspect exact entry). Private/no-store includes auth/errors.
Mutation and review require the routine owner header; any supplied owner header
is enforced on reads too. Actual role, household, token generation and chores
feature renew under canonical locks. Admission also applies a per-person rate
limit and streamed byte limits, including requests without Content-Length. Paired
devices remain refused by normal person auth; existing middleware CSRF applies.
Schedule/rollback and owned-recovery gates stay default-off; no public/offline
capability, scheduler, environment or deployed app is changed.

Authored/unrun unit source covers frozen original body/key after reload, recovery
review before replay, changed intent/owner, unknown result retention, late-owner
switch, paused inspection/dismissal, malformed/oversized entries and malformed
network success. The existing protected PostgreSQL source adds atomic same-key
boundary saves, mismatched hash refusal, late retained proof during write pause,
expired missing proof with rolled-back reservation and foreign household refusal.
No tests/typecheck/lint/build/browser/DB/schema/client/native or hosted CI ran.

Still open: parent list/catalog, contextual editor/controls and recovery UI,
unsent form drafts, full current-subject choice presentation, scheduled-once action
availability, EN/ES, lifecycle/erasure/rollback audit, then consolidated QA and
normal release gates. Source HTTP wiring does not make #450 accepted or released.


## Continuation: parent catalog and three-stage management UI — 2026-10-20

New `routine-schedule-view.ts` validates private parent catalog/state DTOs, stable
root order, points visibility and catalog cursor continuity. Catalog GET uses
household-owned non-null stack definitions in stable ID pages of twenty; unknown
protocols remain visible as uneditable entries. Eligible current account/member
subjects use existing canonical resolvers, never name matching or account creation.
Name-only profile choices renew current age/role/link/erasure eligibility and carry
current repeat support. More than 1,000 combined members refuses rather than
silently truncating assignment identity. Parent authority renews under the usual
user/household locks, including negative teen/foreign-family behavior.

`RoutineScheduleManager` has a dedicated private `/dashboard/chores/schedules`
page and a parent-only entry in the existing Chores Routines view. Existing
rollback-ready support controls entry/page admission; actual API authority and
writing gates still apply. No gate, environment, manifest or deployed UI changed.
Catalog paging, create/future-edit, active/paused/stopped state and explicit
pause/resume/stop review use the same canonical HTTP and owned request helpers.
Controls load current version first and freeze the reviewed command before the
confirmation. Expired one-time routines explain why resume is unavailable.

The `RoutineScheduleEditor` reuses the rounded form Dialog, WeeklyDaysPicker and
RoutineIconPicker. Three short stages separate routine/schedule, focused ordered
steps and review. Cadence choices include selected weekdays, fixed monthly anchor
with short-month explanation and optional start. Each step has an independently
chosen canonical subject and optional minutes. Description, picture, effort and
available points are collapsed extras. Move buttons have explicit labels and
44px targets; a bounded, keyboard-focusable list navigates long stacks. Routine,
step and review focus targets change with the stage. Review shows cadence,
canonical first matching day, cue, each owner/duration and explicit removed-step
scope, rather than just a count. Existing root IDs remain stable even when titles
match. Persisted-step removal must choose independent continuation or stop; a
local restore retains the same step/identity/order. Final review freezes viewer
clock/zone so a delayed save must pass the original day/intent-age check.

The manager stages original body/key before any effect, disables conflicting
fresh edits while a saved request exists and exposes check-original-result,
reviewed retry and explicit local dismissal. Unknown/malformed/refused results do
not imply a new request or a cancelled server effect. Completed and later-removed
proofs remain distinguishable. Live owner checks, visibility holds and request
epochs suppress stale private results; the existing pending-navigation controller
protects writes. EN/ES copy covers these new surfaces. Native controls and existing
semantic tokens are reused, but no rendered/accessibility/device claim is made.

Unsent draft state is currently retained only while the manager is mounted;
closing its sheet preserves it and a beforeunload warning protects reload/leave.
This is **not durable draft recovery**. Durable owned unsent drafts, same-document
Back/native process-death behavior, handoff from legacy current-occurrence links
and future controls for detached roots are still required before activation. Do
not mark these requirements accepted because the new dedicated path exists.

A privacy gap was found in the prior parent definition read: points leaked while
Points & streaks was off. Authority now returns the current capability, reads omit
points server-side and the state codec rejects hidden numeric values. Draft
points may be null, meaning preserve the stored future value or zero for a new
step; disabled points controls always preserve stored values. This prevents both
leakage and an edit resetting hidden values if gamification changes between read
and save. Stored root definitions remain numeric and history snapshots stay
unchanged. Full export/legacy capability audits remain separate work.

Authored/unrun model cases cover equal-name root identity, explicit remove scope,
local restore without local-only fields entering the command, null hidden points
and frozen reviewed day/zone. Protected PostgreSQL source adds current catalog
role scope, no-points DTOs, null preservation and later enabled-point visibility.
No tests/typecheck/lint/build/browser/rendered/native, database/schema/client or
hosted CI command ran. Next: durable unsent drafts, legacy/detached management,
scheduled-once presentation and full lifecycle/rollback source reconciliation,
then the consolidated QA/release gates. #450 remains open at full scope.


## Continuation: durable unsent local documents and attached-link handoff — 2026-10-20

A separate `herewoven.routine-draft.v1` document now holds incomplete form state,
including canonical/client identities, explicit removals and stable neighboring
step IDs for restoration. Empty fields and invalid numeric ranges may be retained
locally; this is not a valid command or permission to execute. The one-document
journal is bounded to 2 MiB and its entry to 1 MiB. Current user/family metadata
must match the owner context. A draft-specific server scope derives from the
existing routine person scope while retaining owner ID, household scope and token
generation. The normal owned envelope/location format and retirement scanner are
reused, with no ad-hoc storage suffix that would escape existing purge matching.
The read-only `?draft=1` context mode authenticates/renews the same current parent
and returns capabilities/ownership, never the draft's content.

`createRoutineDraftStore` adapts the shared owned journal without exposing send.
Its explicit local-only compare-and-replace requires the exact prior body and
still checks fresh ownership, lease and candidate baselines. Ordinary saved
network intents do not opt in and stay immutable. Even a direct generic send call
on the configured local kind refuses before the transport callback. Begin,
replace, clear and explicit stored-version adoption serialize; document generations
invalidate queued old autosaves so discarded work cannot resurrect. Clear refuses
uncertain/conflicting state and checks the expected body before removing it.

Reload validates the whole stored document; it does not silently merge another
controller's newer body or an externally cleared document into an open form.
Such changes hold with explicit load-saved confirmation. Known partial writes keep
the exact proposed transition and only explicit storage recovery can repair that
transition. Disabled Points & streaks values are nulled, including removed steps,
and physically updated before a restored draft is returned. Canonical server
points remain untouched; a later command's null points preserve their stored
values. The controller never invents an account/profile from a label.

The manager now begins a verified local document before opening the form, restores
it after context checks, debounces edits for 1.5 seconds and flushes the latest
snapshot before closing/submitting. Saved status means read-back-confirmed owned
storage, not a family mutation. Pending drafts/request writes use the existing
navigation guard and beforeunload protection. Final request staging still freezes
the original body/key/date and requires an explicit recovered retry. A confirmed
save or explicit dismissal clears the local draft; the UI states when dismissing
a saved request also discards the open draft. Epoch checks retain only current
owner responses; unsent draft content never goes to a mutation endpoint. Restore
and member selection still require live owned context: this does not enable an
unauthenticated offline form or claim physical process-death acceptance.

Older direct/intercepted routine-stack and canonical-root edit pages now detect
exact attached owned schedule identities and present an EN/ES handoff before the
one-day form loads. The link deliberately performs full navigation to leave the
old intercepted slot. The old stack GET also renews canonical parent authority
and refuses scheduled metadata before serializing old step data; a raced legacy
client gets a localized new-controls link rather than another failed save loop.
Ordinary individual copies keep their occurrence editor and equal-named legacy
stacks are not adopted. Unknown definitions remain fail-closed; detached roots
are not falsely presented as editable through their former stack.

Authored, **unrun** cases cover incomplete drafts, same-key body immutability
outside local opt-in, local send refusal, multi-controller changed/cleared state,
explicit adoption, queued stale autosave rejection, quota-after-write recovery,
owner change and point-value purge on restore. Neighbor-based remove/restore
source covers multiple adjacent steps restored in either order. Existing guarded
PostgreSQL source adds owned/foreign attached IDs, equal-name legacy stacks and
individual-copy handoff boundaries. No tests, typecheck, lint, build, rendered/
browser/native, schema/client or hosted CI ran. No environment, public capability,
provider, real data, push/merge/deploy or release was changed.

Remaining before #450 code acceptance: detached-series future controls, clean
sheet Back behavior, recovery presentation/async-epoch review and scheduled-once
availability; then full lifecycle/erasure and supported-client rollback source
audit. Device/DB/EN/ES/accessibility behavior still needs the later consolidated
QA. Preserve the transferred #559 scope; this is not issue or goal completion.


### Scheduled-once profile actions — 2026-10-20

Source now derives one-time action availability from private canonical policy,
not the presence of a recurrence ID. Scoped selected-ID reads feed list/detail,
chores page and Today board projections. Metadata is never serialized into these
ordinary DTOs. Repeating/legacy profile gates and locked mutation checks remain.
Authored policy/projection cases are unrun; consolidated QA is still deferred.


### Routine sheet Back and saved intent review — 2026-10-20

Source opts the routine sheet into owned Back handling through the existing
navigation controller. The verified local close path retains the draft and
returns to the catalog; only dirty/pending work warns on unload. Defaults for
other forms remain unchanged. Browser/native navigation acceptance is unrun.

Saved request recovery now has read-only, collapsed EN/ES original-intent details.
The exact stored body remains the retry source. Current eligible identities only
supply display names, unavailable members remain explicit, and disabled points
are omitted. New authored navigation/UI cases are deferred to consolidated QA.
Independent detached root controls and lifecycle/rollback/device work remain.


### Independent detached future-step contract/coordinator — 2026-10-20

A distinct independent protocol now owns exact canonical root edit/pause/resume/
stop intent, optimistic revision, private state/catalog and receipt. Staged roots
without a revision parse as revision one. Every new stack write/removal advances
root revisions. Independent effects preserve original root/history content and
only prune locked untouched future copies whose stack association is null.
They reuse parent authority, subject eligibility, future partitioning, root writes
and canonical expansion. Atomic receipts bind the original actor/key/body and do
not expire into a second first effect. Disabled points are preserved in metadata
and omitted from state reads. Unknown/attached/erased roots hold.

Authored pure and guarded integration cases remain unrun. The new module is
unrouted: recovery owner/storage/client, editor/catalog UI and legacy root handoff
must be wired next before this requirement can count as implemented end to end.
No activation, migration, generated client, QA, build, native or release action.


### Independent request boundary and recovery — 2026-10-20

Private independent routes, separate owner scope, strict original-request journal,
read-only proof review and foreground client are now source-wired. The shared
admission/authority/body/rate/private-response rules still apply. Independent
scope retains normal retirement fields and never shares a stack journal. Exact
body/key survives reload and unknown responses; recovered entries require review.
Proof binds original root/action/next revision. Read-only review never reserves
or recreates anything and can confirm late committed intent while writes pause.
Unrun storage/client/guarded-DB cases were authored for these invariants.

Next integrations: independent editor/catalog UI, unsent drafts and legacy root
handoff; then lifecycle/rollback/device reconciliation and consolidated QA. Gates
remain unchanged and this is not a released or accepted user journey.


### Independent manager/editor/local document integration — 2026-10-20

The independent parent page/catalog/editor/control/recovery path is now wired in
source, with a Routine plans entry and exact detached-root legacy handoff. Main
fields stay compact, advanced step fields collapse, and explicit review captures
original intent time/zone before save. Account/email-free profile choices renew
from the current canonical catalog. Removed/ineligible identities never get a
substitute. EN/ES text and current points omission apply throughout.

A separate independent unsent document retains partial fields and original
root/revision. Both form types share the extracted owned local-document engine
for leases/CAS/conflicts/discard/repair and disabled-points sanitation. Close/Back
flushes the draft; requests still use immutable saved body/key and explicit review
before recovered retry. Confirmation clears only an exactly matching originating
draft, retaining unrelated/newer unsent work. Authored focused source cases remain
unrun; runtime/rendered/device/lifecycle/rollback acceptance is still unproven.

Next source reconciliation: household/profile lifecycle and erasure, reassignment,
rollback compatibility and remaining navigation/async presentation edges. Keep the
full issue goal active and defer consolidated QA until the candidate code is done.


### Identity-link and future-subject erasure — 2026-10-20

Verified same-person link now updates exact known future aliases transactionally
and invalidates root/stack prepared versions. Erasure discovers account-only
historical future aliases, locks those households in existing stable order and
redacts known subject IDs independent of gates. Root metadata can be redacted
without migrated stack storage. Unknown protocols remain unsupported rather than
being normalized. Stored subject tombstones are not valid command targets;
private parent reads show unavailable assignment and require explicit replacement.
Historical erased subjects/credit are not reconstructed by future reassignment.

Authored cases remain unrun. Outstanding deletion edge: a root historically owned
by a departing account can already carry a separately assigned future definition.
Its replacement control identity/stack references must survive deletion without
retaining that account's personal rows. Implement this handover next, then finish
profile archive, rollback and navigation reconciliation before consolidated QA.
