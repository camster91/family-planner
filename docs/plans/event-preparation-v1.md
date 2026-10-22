# Event preparation — #123 implementation contract

Approved full journey: reusable event-linked packing/forms/departure checklists,
using canonical tasks/routines and showing the relationship, without a competing
completion/assignment store. Planning/implementation scope is approved; this does
not authorize activation, live mutations, providers or release.

## Canonical meaning

- Event remains the calendar source. Chore remains the task, assignment, due-day,
  completion/check/photo/points source. RoutineStack remains the reusable routine
  identity. No EventPreparationTask, copied checkmarks or alternate role model.
- One optional EventPreparation plan orders links to concrete canonical Chore
  occurrences. A concrete chore belongs to at most one event preparation plan,
  preventing one accidental checkmark from preparing unrelated events. Reuse a
  routine to create distinct one-off chores for a new event instead.
- Parent can link existing tasks, add explicit new once-only tasks, detach and
  reorder links, or use selected steps from one exact dated routine occurrence.
  Source selection binds stack/occurrence/step IDs and fresh source versions,
  not labels. Copy source content only; new work starts pending with no photo,
  completion, parent check, recurrence expansion or historical credit. Do not
  change the source routine or its future definition.
- Existing task linking never reassigns/completes/verifies/deletes it. Detaching
  and deleting an event remove links, not chores. Existing canonical chore
  deletion cascades the link. Shared/recurring task dates may not be quietly
  retimed; only explicitly eligible open standalone once-only chores can move.
- Optional cues choose event start/end, before/after and a bounded minute amount.
  They derive a proposed canonical due DAY in an explicit IANA zone, not a second
  due timestamp, reminder, scheduler or buffer calendar event. A cue must agree
  with the final chore day. Fixed/custom days use no active relative cue.
- Event edits never silently retime tasks or reset completion. A changed event
  needs an explicit decision: keep current days (remove mismatched active cues),
  or preview selected eligible date changes. Neither implies acceptance by an
  assignee. Normal chore completion/check APIs remain authoritative.
- Parent overview distinguishes open, marked-done/waiting-check and checked.
  Unavailable/hidden/capped tasks and changed-event timing cannot yield a whole-
  event readiness claim. A child's own progress is not the household's readiness.

## Permissions, storage and continuity

Person parent configures; selected profiles are subjects, never actors. Readers
follow existing calendar + chores and current role/feature/profile/age/link/
erasure/occurrence policy. Child/teen projection includes only their authorized
account task details; no other-person directory/private notes leak through an
event link. Parent profile reads/creation remain gated and labelled; no synthetic
email/login, inferred identity, reassignment or credit transfer. Paired-device
support must use its canonical scoped protocol, not person routes by fallback.

Additive EventPreparation + ordered EventPreparationStep tables carry only real
family-scoped Event/Chore FKs and cue metadata. No participant/description/status
JSON. Event/Family deletion cascades metadata, Chore deletion drops its link,
and moving a canonical record out of the family must detach the old association.
A delete/recreate or unlink/relink must invalidate pending work even with the
same visible IDs/content. Event insertion/material epochs from schedule review
are reused; a preparation lifecycle epoch closes plan absent/create/delete ABA.
Plan revision advances for additions/updates/review and step insertion/update;
external Chore cascades only delete links. Their changed membership is part of
the scope token, and recreating membership necessarily advances the plan. Do not
add a shared parent-row update to every legacy chore deletion: bulk canonical
writers must not acquire chore->plan->another-chore locks.

Use default-off preparation readiness and existing owned-recovery/rollback
contracts. Every consequential action binds original actor/family/event/source/
full-plan token, age, exact body/key, canonical task/routine sources and explicit
changes. Freshly lock/renew identities and source routine stacks before sorted
Chores, then Event, plan/links and receipt, matching canonical cascade direction.
Never acquire participant/stack locks late from linked rows. Mutations and minimal
receipts are atomic; takeover/replay does not duplicate chores or links. Raw
metadata/schema adapters must work without regenerating the shared client here.
No ordinary chore/Calendar API is replaced or bypassed.

## Required full flow / later code

1. Fresh bounded current Event/plan/task/routine/subject projection, caps, unknowns,
   before/after cue/day/source preview and current authority. Include unavailable
   linked rows honestly; do not silently drop them to manufacture completeness.
2. Short EN/ES rounded sheet: event header, existing task picker, new-step fields,
   reusable routine/dated occurrence picker, ordered step panel and cue/date
   disclosure. Show exact removed links separately from deleted chores (none).
   Preserve unsubmitted choices on failures and adapt to all device surfaces.
3. Parent preview/confirm through canonical Chore subject/content/date validation
   and routine-source reads. New rows use canonical once-only fields; hidden
   points become zero for new work, never copied/completed history. Explicit
   retiming refuses scheduled roots/occurrences or completed/verified work.
4. Exact owned journal stages before send; pending inspect/retry/forget, expiry,
   unknown acknowledgements, owner retirement, close-before-stage completion and
   stage-versus-dismissal repair follow the established coordination pattern.
   Historical proof is separate from fresh current task/event state.
5. Canonical calendar/Today/chores/routine/weekly discovery and backlinks. Normal
   task completion/check actions keep their existing authorization, idempotency,
   offline and profile gates; a preparation view is not an alternative writer.
6. Scope-safe exports, lifecycle/delete compatibility and pause-time recovery.
   Event/routine/template changes do not overwrite already-created task history.
   Existing/previous installed clients keep normal domains working during rollout.

Source checks/real later acceptance must cover two-household/role/device/profile
negatives, stale/foreign/unknown/erased subjects, source routine changes, task
completed after preview, no duplicate clone after timeout/takeover, due-day/zone/
DST cue calculations, event edits and kept-versus-retimed days, link cleanup and
away/back/recreated IDs, partial/capped summaries, exact receipts/storage/Back,
source deletion, all viewports/EN/ES/a11y and physical/native compatibility.

Current status: required contract, pure transition planning, reviewed-scope
fingerprints, additive schema/SQL lifecycle definitions, compatibility cleanup
and parent scoped export source are authored. Unit and disposable lifecycle
case source is authored and unrun. API/source loading/canonical mutation/receipts/
UI/integration/recovery remain code work, followed by the
consolidated QA pass. No provider, live data, schema/client/SQL/DB, tests/build/
browser/native/CI, activation or release evidence exists for this new workflow.
Do not close #123 or substitute a planner/link-only shortcut for the full journey.


## Canonical API/effect continuation — 2026-10-20

Authored `src/lib/event-preparation/{runtime,read-contract,source,state-store,
mutation,server,http,route,view,owner}.ts` and default-off API entry points:
GET/PATCH `/api/coordination/event-preparation` and POST its `/preview` child.
Initial GET reads linked work; selected-source POST refreshes exact chosen task,
subject and dated-routine scope. Command preview/write reconstruct that exact
scope server-side; arbitrary supplied view tokens are never server authority.
Refresh the final selection before preview/confirmation. No broad household
picker query is substituted for exact command source scope.

Person parent only. Current actor token/household/role/features renew inside the
transaction. Dependencies are collected before stable User/profile/stack/Chore/
Event/metadata locks and rechecked; source changes outside that locked set refuse
instead of acquiring late locks. Routine controls/inactive/unsupported work is
not actionable. Source copy content is validated from actual fields; display
truncation is not copy content. Unavailable task content/state and invalid routine
copy content are withheld. Current identity versions and exact link rows further
bind the review, separately from content/material and status/proof source epochs.

Additive Chore preparation epoch/trigger source catches completion/proof changes
including complete/undo; it does not alter existing responsibility consent epoch
meaning. Schema probe requires those columns/triggers plus existing material and
identity-retirement dependencies. No schema operation or client generation ran.

The effect uses canonical fresh once-only Chores, scoped date updates and ordered
metadata; no duplicate completion/points model. Empty intended set removes plan
metadata. Same transaction stores minimal exact proof (IDs/digests, no descriptions
or private content). Matching complete claim replay does not reread target or
clone work. This is not yet the full owned recovery journey: UI/context/journal/
inspection, strict client DTO schema, pickers and canonical discovery remain next.

Request bound is 1 MiB so 99 full canonical steps are supported, including escaped
content. Recovery must bound exact bodies/storage explicitly and handle quota
failures before any send. Do not copy the smaller schedule-review body limit or
silently truncate a preparation request to make it fit.

Runtime/source/effect/receipt/projection case source is authored and unrun. No API
request, SQL/DB/migration, tests/types/lint/build/browser/native/CI or activation/
release has been executed. Full feature and #123 stay open pending remaining code
and later consolidated QA.


## Exact recovery and client continuation — 2026-10-21

Authored strict browser-safe `view-contract`, owned `recovery`, independent
`recovery-server`, foreground `client`, owned `browser` journal and browser
canonical Web Crypto digest source. GET/POST `/api/coordination/event-preparation/
recovery` renews current parent authority without requiring target existence or
new-feature readiness for historical proof inspection. Context reports current
calendar/chores, owner, readiness and schema availability without a target DTO.

Only matching exact command/key/owner/digest proof can report committed. Otherwise
inspection distinguishes expiry, pause, source conflict, unavailable inputs and
ready/pending, reconstructing the current locked canonical context/pure plan
before allowing a deliberate retry. It never mutates tasks or claims current
readiness from an old receipt. Unknown/generic/private/changed acknowledgements
are held. No background send/retry or inferred successful write.

A browser-safe receipt contract takes an expected digest; Node hashing lives in
`receipt-server`, while browser Web Crypto uses equivalent validated canonical
JSON. The client recomputes effects from the strict explicit projection before
freezing an intent. Available task/routine projections cannot smuggle arbitrary
DB fields; unavailable rows retain only ID/availability, and summaries must agree
with actual linked visible/unknown work.

Two exact pending requests, each at most 1 MiB, fit a bounded 6 MiB owned journal
subject to actual browser quota. Inspection envelope/response bound is twice the
request plus 16 KiB. Stage/initialize/storage repair and inspect/send use existing
owned generation/household/lease/divergence/retirement contracts. Initial load
never resends. Quota failure holds before send; paused inspection/local forget is
allowed; restored retry requires explicit current inspection.

Minimal proof changed from potentially 99 new-ID pairs to createdCount plus
full request digest/source/owner/event/plan/key. This stays below the generic
idempotency wrapper's 8 KiB receipt bound and prevents its outer store replacing
proof with a generic marker. Refresh canonical state for resulting task IDs; do
not cache a privileged full task DTO in a receipt.

Client/server/journal/schema/proof/body-limit cases authored, all unrun. No live
request, tests/types/lint/build/schema/SQL/DB/Prisma/browser/native/CI/activation or
release operation occurred. Canonical paged pickers, EN/ES sheet, close/stage/
storage repair integration and canonical discovery/backlinks remain required code.


## Pickers and compact UI continuation — 2026-10-21

Authored GET `/api/coordination/event-preparation/picker` for parent task/account/
gated profile/routine discovery, scoped literal-search/keyset pages and strict
reply kind/subject-ID/cursor validation. Candidate IDs are reprojected through
current canonical authority, not treated as write permission. Filtered empty
windows retain a next cursor. API window 20 plus lookahead; UI shows five at a
time before fetching the next window. Selection is separately refreshed under
exact source scope before command preview/write.

Authored `src/components/calendar/preparation/*`: gate/role-only provider, short
rounded EN/ES form sheet, paged picker, step editor, pending requests and guarded
session. New/link/reorder/unlink, points/difficulty/duration/details, person picker,
fixed/relative due days, explicit event keep/retime decision and stale task-source
acknowledgement are wired. Stored routine day selection creates chosen new work
through the exact reuse command, with subject/points/day/cue overrides. Finish
pending set-plan edits before starting a routine copy. Copy choices can be edited,
resumed, locally cancelled or explicitly reloaded after source changes. No source
routine/status/credit is mutated. Invalid/unsupported occurrence scopes are held.

Review is bounded and explicit: before/after task dates, source people, cues, new
work and removed links. Removing links preserves tasks. Native event details and
parent weekly rows have default-off canonical entry controls; linked chores open
the existing edit sheet. Weekly sibling dialogs yield focus/scroll while the child
sheet owns them. Fridge/child/teen/device hosts are omitted; personal recovery URL
survives readiness pause. Back/direct URL, heading focus and native theme styles
reuse current shell contracts. Actual rendered/native behaviour is still unrun.

Recovery initializes first; private projection/draft display is held or cleared
on owner mismatch. Async hashing and durable stage each check the live operation
before a send. Pending inspect/retry/forget and stage-versus-dismissal storage
repair are connected; no automatic resend or cached success inference. Proof
refreshes calendar/current route and then current preparation separately. Unknown
reads do not display a cached whole-event checked claim as current readiness.

Authored picker/schema/role/window and component privacy/navigation/hash/stage
case source, all unrun. No tests/typecheck/lint/build, API/schema/SQL/DB/client,
browser/native/CI/activation/release operation was run. Parent UI code slice is
authored; broader role/device readers, Today/task/routine provenance discovery,
and the rest of #123 remain required implementation, then consolidated QA.


## Personal Today and chore preparation discovery source — 2026-10-21

Personal parent Today now has preparation entry points on its bounded event rows,
in both configurable and fallback personal layouts. Linked tasks in the personal
summary, Next up and open chore board rows have an event-preparation backlink.
The existing Chore completion/check/Undo controls remain canonical; the backlink
is a separate button, outside the completion control. EN/ES labels and a hydrated,
validated viewer IANA zone feed the existing reviewed preparation host. No zone
is guessed if the browser cannot supply one. Opening renews canonical authority;
a link is not a freshness, due-day or whole-event readiness assertion.

The additive server projection renews parent/household membership in the same
scoped relationship SELECT, joins both canonical Event and Chore household keys,
filters to already-visible non-template Chore IDs and active domain features,
and returns only Chore-to-Event IDs. Readiness/schema absence omits discovery.
It deduplicates/bounds the supplied window at 300 IDs; absence from this map is
not an exhaustive assertion that a task has no preparation relationship. Older
history fetched later and non-open chore presentations still need their own
explicit bounded discovery integration.

The personal map is a separate prop: it is never added to shared/persisted board
DTOs or device responses. Fridge, device, child/teen and cached-snapshot entry
controls are omitted, and the parent host remains default-off. No linked Event
content, cue details, private task content, progress or names are copied into the
relationship projection. Confirmed preparation writes continue using the existing
content-free canonical refresh; no polling, scheduler or alternate task store was
introduced.

Projection role/readiness/schema/window/source case code is authored, unrun. Only
source inspection and explicit-file formatting occurred; no tests/types/lint/build,
rendered/browser/native/API/schema/SQL/DB/client generation/CI, activation or
push/merge/deploy occurred. Remaining code includes narrower authorized reader
projections, dated-routine/canonical-editor provenance and remaining task views,
unified review inbox/what-changed, grounded planning/evaluation and broader ledger
scope. Consolidated QA remains deferred; neither #123 nor release is complete.



## Role context, routine links, initial review inbox and AI source renewal — 2026-10-21

Child/teen personal home source now adds read-only event-preparation context to
its already-selected own canonical tasks and picture-routine steps. The scoped
SQL renews the exact account role/household and requires Chore assigned_to to
match that account, no profile subject, no erased subject and no template. Only
shared-schedule Event title is projected (bounded); no Event ID, plan tokens,
other people's work/verification, cues, assignment or edit capability is sent.
This is optional context, not a whole-plan summary or completion claim. Empty
context does not imply no relationship. Default-off preparation/schema/domain
gates apply. Profile subjects are not authenticated actors; paired/shared-device
readers and profile-targeted context remain separate unfinished scope.

Parent routine-stack views now receive the existing bounded exact task-ID
backlinks, including concrete dated steps and history where present in the
initial page. Embedded canonical rows keep their existing action gates. No
routine-label matching, source-history copying or promotion of a copied one-off
back into a routine was added. Durable source-routine provenance for new copies,
canonical-editor context and later history-page discovery still need code.

The initial parent Review inbox is authored at /dashboard/review, linked by a
labelled 44px header control. It renews current parent household scope in every
canonical query and has two sources: actual completed Chores awaiting a check,
and Event preparation whose stored reviewed source differs from current Event
generation/epoch. Invalid/saturated Event source versions remain review items.
It reads 21 candidates per keyset window, returns 20 and displays five at a time;
filtered empty preparation windows retain their next cursor. No all-clear or
whole-household pending count is inferred. Items open canonical chore checks or
the existing reviewed preparation host; no bulk approval, second completion store,
new automatic action, provider call or migration is introduced. Optional missing
preparation substrate is a paused section. Source errors retain the normal page
error boundary. EN/ES copy describes current inbox scope. Notice/recipe/capture
and saved-request adapters are NOT yet a unified review inbox; see its new plan.

Assistant replies now renew person authentication/role/household/token, provider
configuration and normalized features after provider latency, before returning
private reply/action content. Opt-in Today responses must still be within the
original 60-second lease, with the gate on and a fresh canonical typed projection
identical to the original. The second read anchors the original day/window while
reading current source values; failures, changed/deleted projected records and
expired context withhold the old answer with a content-minimal refresh response.
Provider credentials are compared only in memory and never logged/returned.
Canonical actions still require their own target authorization and confirmation.
This is projected-value freshness, not a signed reference/citation protocol,
semantic hallucination proof, source-generation/ABA guarantee or snapshot-wide
transaction isolation. Wider grounded planning and #144 evaluation remain open.

New role/projection, inbox window/stale-plan and delayed-provider source cases
are authored, all unrun. Only source reads/edits and formatting occurred. No
tests/typecheck/lint/build/browser/rendered/API/native/schema/SQL/DB/client/CI,
provider/flag activation or push/merge/deploy occurred. QA stays after remaining
code. #123/#144/#499 and the integrated goal remain in progress.


## Routine copy provenance and personal chore context source — 2026-10-22

Routine reuse now appends a minimal `preparation_routine_copied` Activity fact
inside the canonical new-Chore/effect/receipt transaction. A deterministic fact
primary key binds the exact household and new task. Only exact source stack,
source step and original occurrence day are retained; no source content,
completion credit, proof, recurrence, future definition or private token is copied.
Manual creates cannot supply provenance through the strict public command.
Receipt replay returns before another copy/fact. Detaching preparation keeps the
independent task and its fact. Existing Activity account/household export and
erasure apply; absent provenance never claims that a task was manually created.

A bounded parent-only read endpoint renews current actor/family/session generation
under membership locks, accepts at most300 explicit current task IDs, and returns
separate event backlinks and routine origins. Both copied and source task,
routine, original due day, profile availability, erased-subject state and enabled
domains are checked. Current source labels are read fresh; unavailable source
returns only a generic state and copy time, with no old source IDs/name/link.
Source links use exact identity and original occurrence, never label matching.
No schema/migration or alternate task store is introduced. Private copy actions
are excluded from the legacy member Activity/Analytics feeds.

Personal parent chore rows, parent-check rows, done/history pages, routine rows
and canonical page/sheet editor now read this separate memory-only projection.
Later history windows trigger bounded reads; the context stays out of canonical
Chore, shared-device and offline/cache DTOs. Blur/background/storage/identity
changes abort and clear it; late replies cannot install data. Owner or session
generation replacement retires the reader instead of adopting the new identity.
Optional context failure never blocks normal chore edits/completion. EN/ES source
and independent-task wording is authored; source actions stay outside completion.

Planner, fact/projection, API admission, lifecycle and personal-hook cases are
authored and unrun, including exact replay, real-DB rollback/detach/foreign-family/
erasure cases prepared for the disposable database pass. This checkpoint used
source inspection/edits and selected-file formatting only. No tests/typecheck/
lint/build/browser/application API/SQL/DB/schema/client/native/CI, activation,
push/merge/deploy or issue closure. Broader role/profile/shared-device readers,
other domain history, batch-refusal UX and grounded AI/planning/evaluation/usage
remain implementation work before consolidated QA. Full goal stays active.


## Shared/profile preparation labels source — 2026-10-22

The existing Today board builder now optionally projects
`sharedPreparationContext: { [visibleChoreId]: { eventTitle } }` after its canonical
account/profile task resolution. This is a new shared-safe title projection,
separate from parent backlinks/origin maps. It uses only the already-shared
schedule title (bounded to512 characters), and includes no event/routine/plan IDs,
source tokens, cue times, completion/proof/parent-check state, descriptions,
addresses, names of other assignees or parent edit capability. A profile remains
a task subject, never an authenticated actor.

The reader is bounded to80 deduplicated validated current board task IDs. Every
relationship joins Event, Chore, preparation and Family ownership keys, rejects
erased/templates, renews current account membership or active valid unlinked
profile subject, and requires calendar/chores enabled. Profiles additionally need
explicit protocol2 and the existing profile gate. Paused preparation, missing
storage and protocol incompatibility omit context. Caller authentication and
family authority remain the canonical person/device board route responsibilities;
this is not a standalone endpoint or authorization grant.

Live fridge task rows show the existing EN/ES read-only getting-ready label for
both account and eligible email-free subjects, without another button/input.
Canonical completion, subject selection, parent checks and Undo remain unchanged.
The optional field participates in the existing whole-board version hash, so
source title/link changes use ordinary board refresh. The cache allowlist
intentionally excludes this field, and cachedSnapshot rendering omits labels even
if a retained in-memory live response has them. Protocol2 stays online-only.
Older clients ignore the additive field; no schema/migration/provider/scheduler,
new persistence or polling is added.

Reader/window/privacy/gate, disposable-DB household/profile/archive, cache omission
and EN/ES presentation cases are authored and unrun. Source edits/inspection and
selected formatting only; no tests/types/lint/build/browser/application-API/SQL/DB/
client/native/CI, activation, push/merge/deploy or issue closure. Shared/profile
preparation labels are source-authored, not accepted on rendered/physical devices.
Own-account chore/history context beyond the existing child home/routine surfaces,
other domain history/refusal UX and grounded AI/planning/evaluation/usage remain
implementation work before consolidated QA. Full goal remains active.


## Own-account chore/history preparation context source — 2026-10-22

The personal chore-context endpoint now admits current parent, child and teen
accounts through the same authenticated person/family/session lock renewal.
Projection branches remain explicit: parents may receive event backlinks and
routine origins; child/teen requests never invoke those readers and return only
`ownContext: { [taskId]: { eventTitle } }` for the account's current own canonical
unerased, non-template task. The existing own-task query renews role/household,
requires assigned_to exactly that account and assigned_member_id null, and checks
both domain features. Client-supplied profile/family/owner authority is rejected.
A selected email-free subject never becomes an authenticated account.

Requests now accept at most150 unique explicit task IDs (superseding the initial
unreleased parent endpoint cap300). The personal memory-only reader uses150-ID
batches so the own-task reader's bound cannot silently omit later requested rows.
It verifies owner and generation throughout; no partial multi-batch projection is
installed. Existing blur/background/storage/identity cancellation and replacement
retirement apply. No new cache/local store, provider, schema or mutation is added.

Child/teen open chores, routine rows and loaded completed-history windows now
show the existing EN/ES read-only getting-ready note. Paging triggers fresh context
for the loaded exact IDs. Parent references stay under parent render guards;
canonical completion/check/Undo/edit permissions remain unchanged. API branch,
current membership/generation, window and own-context filter cases are authored
and unrun. Earlier child-home and shared/profile fridge readers remain distinct.

This checkpoint used source inspection/edits and selected formatting only. No
checks, browser/application API/SQL/DB/client/native/CI, activation, push/merge/
deploy or issue closure. Rendered role/history acceptance remains for consolidated
QA. Remaining implementation includes other domain history/refusal interactions,
review inbox draft follow-through and grounded AI references/planning/evaluation/
privacy-safe usage/cost controls. Full goal and #123/#128 stay in progress.

