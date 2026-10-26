# Notification event identity and delivery follow-through — #141

2026-10-25. Source-backed implementation contract, not implemented event/outbox
infrastructure or accepted behavior. Existing #141 taxonomy, preferences, privacy,
quiet-hours/timezone, native/deep-link and telemetry criteria remain authoritative.
No provider, scheduler, schema, data, permission or release setting changes here.

## Current source and the missing behavior

- `notification-policy.ts` maps every existing in-app type to a category,
  always-send or opted-in morning summary. Do not replace that policy table.
- `notification-delivery.ts` takes ordered User then household lifecycle locks
  for household sends, checks current membership/sender role and preferences,
  writes an in-app Notification and returns the current quiet-hours result.
  Quiet hours do not discard the in-app record. The helper does not persist a
  generic event identity or suppress duplicate ordinary upstream invocations.
- `notifications-server.ts` catches delivery failure and returns a boolean.
  Parent manual POST and chore/reward sources use that shared path. There is no
  general durable delivery/retry/failure state implied by those booleans.
- `Notification` has user ownership, text/type/read/snooze/action URL/time fields;
  its current schema has no upstream-event deduplication key. Text/title equality
  cannot distinguish replay from a second deliberate announcement/completion.
- `morning-summary-server.ts` claims a person's day before send. Preserve that
  special existing at-most-one-attempt behavior and #470 authority repair. It is
  not an atomic general outbox, delivered-mail receipt or proof that a failed
  recipient can be retried without a separate reviewed contract.
- At the initial inventory, `notification-destination.ts` accepted only
  `/dashboard/today`. Dated source sections below add exact chore and reward
  focus. Event/list/recipe and native cold-start resolution remain unfinished;
  an arbitrary stored action URL is never authority.

In-app paging, read/snooze/Undo recovery and typed preferences are existing source
candidates. Their presence does not complete #141's upstream event, provider,
exact destination or physical-device requirements.

## N1 — canonical occurrence identity and same-transaction admission

Define a versioned internal event envelope, not client-supplied title matching:
fixed event kind, originating household/account scope, immutable source identity,
accepted domain-transition identity, recipient User ID, schema version and
original dispatch deadline. Source references are checked canonical IDs, never
provider/model-returned IDs or profile selection as an actor. Content is a
minimal allowed projection, not a generic persisted whole household snapshot.

The domain transaction creates or reuses one accepted event occurrence alongside
the canonical state change and its receipt. A fresh client key cannot manufacture
a second event for an already accepted transition. Reopening and legitimately
completing a chore again may create a new transition/event; hashing chore ID alone
would lose it. Recurring chores use actual occurrence identity, not title/root
alone. Two deliberate identical parent announcements remain two commands; an
exact retry of one command reuses its event. Do not retrofit this identity by
name, timestamp proximity, current assignee or arbitrary text hashes.

Propose exact additive event/admission schema and its export/departure/erasure
inventory before coding. Unique admission coordinates must include the immutable
origin, event occurrence, recipient and channel. Deleting a visible Notification
must not delete the only dedupe evidence and allow an old event to reappear.
Retain a minimal terminal decision/tombstone independent of inbox-row deletion.
A stored deadline plus supported old-operation/rollback window must prevent
recreating a receipt after its dedupe evidence expires. The concrete retention
window remains a reviewed rollout input; generic idempotency TTL is not silently
reused as a complete delivery-retention contract.

Preference suppression is a recorded terminal decision for this occurrence, so
turning a category on later does not replay old muted events. Quiet hours still
allow a single in-app row; interruptive channels make their own fresh decision.
Unsupported/expired event versions hold/refuse rather than falling back to an
unkeyed legacy send. Keep legacy callers unchanged until explicitly migrated;
optional adoption alone cannot prove all upstream notifications deduplicated.

## N2 — in-app dispatch and bounded recovery

Dispatch atomically claims/adopts an admitted event and creates at most one
canonical in-app row, with compact result identity and terminal disposition in
the same transaction. Recheck current actor where required, recipient membership,
originating household, role/category/privacy and source validity under the
existing lifecycle lock order before projection. A departed person must not
receive newly projected old-household content. Preserve current account-only
safety mail as its own policy; no invented family association.

Use bounded explicit event-driven dispatch/recovery with a finite claimed set,
original event ID and deadline, version/CAS and expired-claim handling. Do not
start a cron, autonomous retry loop or provider campaign. Any later worker needs
separate scheduler/queue approval. Errors distinguish held, suppressed, pending,
unknown and confirmed; `delivered: false` alone is insufficient evidence for
retry or a new event. No partial batch may be reported as complete.

A parent-facing support/recovery view exposes content-minimal failure code,
channel, attempt state and safe next action under fresh authority. It must not
expose another recipient's private message or reusable credentials. Canonical
notification read/snooze/delete/Undo remains the inbox interaction model, not an
outbox editing UI or a second notification centre.

## N3 — interruptive channels and restrained reminders

Treat provider acceptance, device receipt and person seeing a message as separate
states. Claiming a local event cannot guarantee exactly-once provider delivery.
An uncertain provider result retains the same delivery identity; retry requires
an explicitly supported provider idempotency/reconciliation contract. Otherwise
hold for safe inspection, never promise retry without duplicates. Record stale
registration/revocation terminal state without logging tokens or payloads.

Check current opt-in/category/quiet-hours/timezone, membership, role, session or
device authority and provider readiness immediately before a send. Shared device
or lock-screen payloads default to neutral app/action-needed copy; no child names,
event titles, address, message/medical/finance text or private source references.
Permission denial and provider failure preserve in-app/manual workflows. No new
push service, paid tier, camera/microphone permission, background listener or
wake lock is activated by this plan. Existing summary email is not silently
converted into retrying outbox work.

## N4 — typed destinations and client compatibility

Extend the existing destination resolver only with versioned allowlisted domain
kind plus canonical target/occurrence identity. Authorization is resolved at open
time; a notification is not a capability to read its source. Known deleted,
foreign, disabled or unsupported targets reach a neutral destination-unavailable
state and a useful permitted fallback without revealing which private condition
applied. Never execute arbitrary stored schemes, external URLs or model links.

Use existing web router and native universal/app-link contract, retaining a safe
Today fallback for older clients. Review cold/warm/already-open, sign-in return,
revoked/paired device, unlinked profile and source-deletion paths. Do not mark
native delivery complete from a web click or an authored resolver. Keep existing
snooze/read/Undo behavior and exact request recovery separate from navigation.

## N5 — migration, acceptance and rollback

Migration order: accepted internal contract/schema plus lifecycle inventory →
canonical source-transition admission → atomic in-app consumer/recovery → migrate
all ordinary producers with stable identities → typed destination UI → separately
approved provider/native rollout. Inventory every producer (manual POST, chore
assignment/verification and reward claims/approvals); inspect actual call sites
before converting. Existing helper methods that have no production caller do not
establish coverage. Morning summary remains a separately reviewed producer.

Rollback pauses new admissions/dispatch and keeps original events, dedupe evidence,
receipts and inbox content readable. Never replay a strict event through legacy
unkeyed delivery or drop its evidence when hiding the new UI. Old-client support,
expire/restore behavior, additive DDL and export/erasure need explicit acceptance.

Deferred cases: concurrent duplicate admission/send, same text distinct events,
recompletion and recurrence, muted→enabled, quiet-hours/DST, deletion then replay,
late/unknown provider acceptance, expired lease/deadline, old operations/rollback,
role/family change, direct foreign target requests, revoked registrations,
shared lock-screen privacy, EN/ES keyboard/Back/focus and named physical devices.
No case was run; no acceptance criterion is checked by this document. Execution
stays in #141 with source/compatibility #134/#135/#136/#473, native #138/#465 and
release #377; no duplicate issue is needed.


## N1 pure envelope/identity foundation — 2026-10-25

`src/lib/notification-event-contract.ts` now supplies an unconnected strict v1
envelope for household chore/reward/manual-announcement transitions only. Account
safety mail and special daily summaries are deliberately outside this first
contract, not silently converted. Fields include exact family/kind/source ID,
required durable UUID source generation and transition ID, canonical UTC accepted
instant and original exclusive dispatch deadline. No title/message/payload/role
or actor-credential fields are accepted. No current caller synthesizes these
fields and no schema/producer/dispatch entry point was changed.

Occurrence coordinates exclude recipient/content/deadline; separate in-app
delivery coordinates include the exact recipient User ID and channel. Reusing
coordinates with changed immutable event fields conflicts; unknown persisted
versions are unsupported, never absent. Pure window checks hold future/expired/
invalid clocks and do not choose a retention duration or prove authority.
Four source cases cover domain/household/generation/transition/recipient
separation, deadline conflicts, unsupported/privacy fields and time boundaries;
all are unrun. This is only N1 contract code: durable accepted-transition
identity, reviewed DDL/admission, terminal evidence, lifecycle/export, original
retention/compatibility, all producers and N2–N5 remain unfinished. Existing
reward and chore producers already guard some fresh-mutation notification
fanout; this contract does not claim those paths previously had no retry guards.
No QA, DB operation, provider/scheduler activation or release ran.


## N1 dormant occurrence admission storage — 2026-10-25

Additive `NotificationEventOccurrence` schema/migration and
`notification-event-admission.ts` now author the internal record/reuse step.
Admission requires the private default-off `NOTIFICATION_EVENT_ADMISSION_ENABLED=1`
acknowledgement; no environment changed and no producer/endpoint invokes it.
It locks original User then household, takes the actual User row FOR SHARE,
checks original family/role/token version, and requires a caller-supplied
canonical source guard in the same transaction before effects. The caller must
follow that lifecycle order before its other source/receipt locks. That guard
must lock/recheck accepted source generation/transition/role/feature; returning
true from a cached DTO is not a valid integration.

The private SHA-256 occurrence coordinate is unique per household. Insert-or-
reuse then locked read compares the full strict immutable envelope; changed or
unsupported evidence throws to abort the enclosing transaction. Deadline is
checked before/after the source wait and after storage. This metadata row is
not a visible Notification, delivery claim, suppressed-recipient decision or
provider-send receipt, and contains no title/message/recipient credential.
DDL makes ordinary updates immutable. Household FK cascade and explicit
account-deletion inventory remove it on household erasure; individual departure
does not transfer it or expose it to the former member. There is no User/profile
FK or new member-owned field, and no guessed credit/identity policy.

Parent account export now includes original envelope/id/created time after fresh
original-session/family/parent checks. This portability read remains available
with admission off, preserving rollback access; no child/teen/shared export.
Full export intentionally keeps complete metadata, not a truncated UI page;
large-export memory/latency is not bounded by this source. Rollback must retain
the additive table and immutable evidence; do not drop it or invoke legacy send.
No time-based pruning policy/scheduler exists. `scripts/migrate.js` discovers
the new SQL through its existing sorted per-feature mechanism; it was not run.

Six mocked source cases are authored/unrun for disabled gate, guarded insert,
matching/conflicting replay, stale principal/source refusal, deadline while
storage waits and retained parent export while off. Real DDL repeat/immutability,
FK/erasure/export, concurrency/collision, rollback and isolation remain
unverified. New Prisma types are ungenerated. N1 canonical producer transition
persistence/adoption remains unfinished, and N2–N5 are not implemented by this
primitive. Existing delivery and fresh-mutation fanout guards remain unchanged.


## N1 chore-creation source adapter — 2026-10-25

`chore-create-notification-event.ts` now authors the first internal source guard.
It takes only the actual newly created row from the canonical parent/account
creation transaction and an explicit original reviewed dispatch deadline. The
existing DB-generated `Chore.responsibility_generation` is reused only as immutable
birth continuity, not consent/actor authority. Existing SQL preserves that
generation across edits; this adapter never writes it or invents it from an ID.
The fixed `created` transition is birth-only per source generation; later
reassignment/recompletion needs its own accepted transition identity.

The adapter requires current parent/account and matching creation family/creator,
then composes generic admission with Family FOR SHARE/current chores feature and
Chore FOR UPDATE checks. Generation, birth time, original account assignee,
creator, pending status and erasure tombstone must still match. No retroactive
series/history adoption or profile-as-login is allowed. Invalid local inputs or
unavailable state hold; full generic admission still validates canonical dates,
original principal, dispatch window and immutable event reuse.

Source cases cover canonical identity derivation, changed assignee/generation/
birth/status/erasure, disabled feature and unsupported local contexts; all unrun.
This helper is intentionally not wired into `createPersonChore` yet: N2 recipient
admission/dispatch is unfinished, and shadow recording followed by the legacy
sender must not later deliver twice. Existing fresh-mutation notification guards
remain untouched. Wire the canonical effect+event+recipient decision+receipt
together when N2 can replace the old send in one reviewed slice. No flag, schema,
provider or deadline policy is activated; no QA/DB/release action ran.


## N2 terminal in-app recipient primitive — 2026-10-25

Additive `NotificationRecipientDecision` and sorted SQL now author one terminal
recipient slot per occurrence, with same-household composite event FK and direct
Family ownership. A frozen accepted slot (0–99) is not a recomputed roster
position. Account recipient and visible Notification references use SET NULL:
account erasure clears identifying User linkage while retaining the occupied
slot, and deleting an inbox item cannot erase the decision and cause resend.
No cleared/erased slot may be reassigned. A SQL update guard preserves slot,
status/time/quiet and permits only nulling recipient/inbox links, never refilling
or redirecting them. Household erasure deletes decisions
before occurrences; parent portability includes them even while admission is off.

The unconnected `admitNotificationRecipientInTx` is parent-only for the initial
producer slice. It locks actor/recipient User IDs in sorted order, household and
actual User rows, renews original generation/role/family plus recipient membership,
parses the scoped event and requires a canonical same-transaction source/content/
original-recipient guard. Source locks precede the event FOR UPDATE lock to match
producer order. Existing created/suppressed decisions return without sending;
null/mismatched recipients and unknown terminal states hold. New decisions call
the existing central delivery primitive and record the result in the SAME caller
transaction. Preference suppression is terminal; quiet hours retain in-app policy.
A deadline crossed after writes throws for enclosing rollback. This is not a new
provider/outbox queue, exactly-once external delivery or autonomous retry engine.

`deliverNotificationInTx` is now the exported internal name of the existing
central policy/row-create primitive; ordinary deliverNotification behavior is
unchanged. All callers of this internal primitive must supply fresh canonical
authority; it is not an endpoint or independent auth check. N2 restricts content
lengths/type-to-event mapping and current allowlisted destinations. Future source
guards must derive/compare the exact canonical content and recipient rather than
passing arbitrary content or a cached DTO. No current producer invokes N2.

The User FK inventory gains its81st source relationship, explicitly account-owned
delivery, separate from profile membership/credit. Original80-row publication
remains historical evidence, not acceptance of this addition. Account erasure
explicitly nulls the recipient FK; departure leaves household-owned decisions
accessible only through current-parent export and never grants former members
access. A physical User deletion also nulls the FK. No message text, tokens or
private payload is stored in the new decision table. Seven mocked source cases
are authored/unrun. DDL/FK/SET NULL, concurrency, canonical source integration,
export/erasure, rollback and all acceptance remain unverified. Producer wiring
and the complete recipient-roster freeze contract still precede activation.


## First producer: canonical account-chore creation — 2026-10-25

`createPersonChore` now composes the birth event, fixed original account-recipient
slot0, central preference-controlled inbox create/suppression and compact chore
receipt inside its existing canonical transaction. Opt-in mode takes actual
participant User rows and Family row locks before writing chores, then reuses
those locks through admission. Canonical title/due date and current locked creator
name determine the same assignment copy as before; source checks bind title/date,
original assignee, birth/generation/status/feature and the exact stored event.
A held event/recipient aborts the whole canonical transaction rather than falling
back to a second sender or committing a chore with missing required evidence.

After commit, the old assignment sender is skipped ONLY for the chore already
handled atomically. Default mode keeps the existing post-commit notification
behavior. A completed command receipt replays before new effects, so it neither
regenerates the event nor invokes the old sender. Missing visible inbox records
and preference changes do not turn a completed birth into another notification.
The initial recipient is the creation transaction's exact assignee, never a later
roster/current-assignee reconstruction. Profile-only work, reassignment, routine
generation, verification/recompletion and reward/manual/summary producers are
not silently adopted by this birth-only slice.

Private readiness inputs, all unchanged/unset here:

- `CHORE_CREATE_NOTIFICATION_EVENTS_ENABLED=1` explicitly opts into this producer.
- `NOTIFICATION_EVENT_ADMISSION_ENABLED=1` is also required.
- `CHORE_CREATE_NOTIFICATION_DISPATCH_MS` must be an explicitly reviewed positive
  integer, at most the existing seven-day canonical receipt horizon. There is no
  default duration; that cap is not a new retention/pruning policy. Missing, zero,
  normalized/ambiguous or oversized values in opted-in mode fail before creation.

The original dispatch deadline is birth timestamp + that fixed reviewed duration,
not the next retry time or due date. This is an immediate in-app transaction, not
an activated deferred provider queue. Keep all inputs off pending migration,
producer/old-client/rollback/privacy review and consolidated acceptance. Do not
roll back to legacy sending for events that an adopted strict command already
accepted; retain their canonical command receipts and additive evidence.

Pure policy source cases plus three guarded disposable-DB source cases are
authored/unrun: single/replayed delivery without legacy duplication, suppression
remaining terminal after opt-in, and final receipt refusal rolling back chore/
event/recipient/inbox. Existing integration fixture now clears new local rows and
restores mocked environment state. No fixture, DB, migration/generation, check,
provider, browser or deployment ran. Wider producers, explicit recovery/dispatch
UX, typed exact destinations, native/provider behavior and all #141 criteria
remain open. Earlier unconnected notes describe preceding checkpoints; only this
account-chore-birth producer is now connected in source behind private gates.


## First typed exact destination: chore focus — 2026-10-25

New gated chore-birth notifications now store only the strict canonical internal
`/dashboard/chores?focus=<plain-canonical-ID>` destination. The shared allowlist
also retains Today; extra query keys, encoded aliases, fragments, separators and
invalid IDs remain unsupported. An URL is not source permission. Old clients
that only understand Today withhold the new link; native cold/warm link and
rollback compatibility acceptance remain open. No external/scheme navigation.

Opening that target uses a narrow server read with original verified session
generation, role and household. Sorted lifecycle locks and actual User/Family/
Chore row locks renew current principal, chores feature and same-household target;
child/teen selection additionally scopes to their own account and reconciles
canonical subject links. Erased or archived/nonmatching own subjects, inactive/
unsupported routine occurrences, unknown statuses, foreign/deleted/disabled
targets and read failure share one neutral unavailable UI. No private routine
definition, member names, photo, points or actor proof is included in this focus
DTO. Only the exact one requested row is queried; board/history caps and data
are unchanged. Total SQL relation/query-plan cost is not a measured claim.

The existing Chores page hosts a compact read-only From notification card with
EN/ES copy, Gregorian date-only display, default-closed details, focused region,
current-parent link to the canonical editor and Open chores fallback. It grants
no new completion/edit permission; canonical action APIs still authorize. This
is exact read context only: a child action handoff for a target outside loaded
board rows, complete activity-target families and native/old-client journeys
remain unfinished. No attempt to reveal a missing target through a new editor
or to expand the full chores/history collection is made.

Strict-link, scoped reader and localized/focus source cases are authored/unrun.
The screen directory gains one dated embedded context, not a new page pattern
or measured visual coverage. No browser/rendered/accessibility/native, DB,
migration, test/check/build or release execution ran. #141/#499 remain open.


## Exact chore completion/Undo handoff — 2026-10-25

The focus projection now explicitly carries canComplete only for currently open,
reconciled account subjects (never profile-only/erased/archived account aliases).
Child/teen focus remains own-account scoped. The card's optional Mark complete
uses ChoresContent's EXISTING canonical completion handler, which now updates the
matching focus state as well as loaded rows. It does not insert the target into
paging, invent a second completion API/store or change the documented any-member
completion policy. Parent edit and all action APIs retain their own authority.

The shared completion lane has a synchronous per-ID busy guard, existing pending
navigation protection, owned15-second/32KiB full reply read and mounted actor/
household/role epoch retirement. Changing owner aborts outstanding owned reads;
late replies/Undo cannot repaint a new owner. Cancellation is not server rollback
or proof a write failed. A valid fresh completion offers the existing canonical
Undo and updates the matching focused/loaded state; Undo's outer foreground wait
is bounded too, without claiming physical cancellation of its legacy helper.
No generic new offline journal, receipt or authenticated owner header is added.

Already-completed responses may mean verified rather than completed. They now
request canonical refresh without local status downgrade or a manufactured Undo.
Unknown/refused focused completion or Undo keeps the focused fields, disables
another action and offers explicit Check current chore (read only). A successful
SSR projection re-admits supported current actions; no automatic write retry.
Other routine/board callbacks retain support for canonical IDs outside loaded
rows; the new focused capability does not restrict those existing callers.

Direct source/card cases plus four mocked shared-handler cases are authored/
unrun: unloaded exact target + one send/Undo, owner retirement, already-terminal
refresh and uncertain-result read recovery. The earlier child action-handoff
gap is now source-connected for this supported account case; profile actions,
full current-resource/version/actor headers, multi-device status convergence,
other notification domains/native and original rendered/privacy/PG/compatibility
acceptance remain. No QA, app/API/DB/browser/migration or release execution ran.


## Account-check producer adapter and category correction — 2026-10-25

Source inspection confirmed that responsibility_epoch excludes completion/verify
status: it cannot identify accepted check transitions. The new internal
`chore-check-notification-event.ts` instead requires the actual Activity ID/time
created in the successful check/XP transaction, linked to the immutable chore
birth generation. Same-type/title/date guesses and current edit-counter values
are not accepted transition evidence. The guard locks/rechecks current family
feature, chore status/title/notes/subject and active canonical account mapping,
then the exact same-family activity type/actor/time/chore metadata.

Verification notices historically use `reward` (which central policy maps to
chores preferences), while returns use `chore`. The strict event-to-type matrix
now records that explicitly; prefix guessing would incorrectly hold valid
verification. This is a correction before that producer's activation, not a
retroactive policy change. For the proposed opted-in check mode only, a real
level-up may be appended to the verification notice rather than interrupting
twice. It requires current gamification on and the actual same-transaction award
result matching the recipient's locked canonical level. XP/streak/credit rules
and existing default-mode messages are unchanged.

Shared private dispatch-window parsing now serves create and the separate
`CHORE_CHECK_NOTIFICATION_EVENTS_ENABLED` /
`CHORE_CHECK_NOTIFICATION_DISPATCH_MS` opt-in. No default/reviewed duration or
environment value has been chosen or changed. Generic admission acknowledgement
is still required. The adapter is not yet wired into verify/reject: ordered
participant/actual row locks, original token generation and simultaneous skip of
legacy send must be composed in the canonical transaction next. Profile-only
checks and other reward/manual/summary producers are not adopted by this helper.

Source cases cover exact activity identity/category, approved coalescing and
gamification-off omission, rejection provenance, changed/erased subject/status
and mismatched activity/level. All unrun. No migration, DB/API/app import, QA,
provider, flag/scheduler activation or release ran; #141 stays open.


## Account approval/return producers connected — 2026-10-25

`POST /api/chores/verify` now composes the account check adapter after a fresh
successful approval or rejection and its canonical Activity. In the separate
private check cohort, ordered actor/preflight-recipient User locks, household
and actual User/Family row locks precede source writes. The chore is re-read;
a changed assignee holds with409 instead of acquiring a new User late. Original
session generation is rechecked before any transition. Event, terminal recipient
decision/inbox, status, activity and (approval only) unchanged XP award share the
canonical transaction. Failure aborts it; no external provider send is introduced.

Only an actually eligible account assignee is notified. Profile-only checks and
inactive/erased/removed-account rules retain their existing no-account-notice
behavior; no fake login or positive profile-credit policy is inferred. An
accepted account notice suppresses the old post-commit sender in that mode.
Default mode preserves the existing best-effort sender and existing level-up
message behavior. Strict-mode coalescing includes a valid visible level-up in
one verification notice. Reverify/reject with unchanged terminal state invokes
no new transition/notifier; a deliberate new completion/check gets a new Activity.

Private check/admission gates and dispatch duration remain unconfigured/off.
These endpoints still use their pre-existing conditional-state request contract,
not a new exact-command receipt/CAS across intervening reject/recomplete cycles.
A delayed old unversioned command cannot yet be distinguished from a new command
after such a cycle. Versioned original-command/expected-state client negotiation
and previous-client/rollback behavior are REAL remaining source/rollout work;
do not claim this wiring finishes that contract or safely enables all old queued
checks. No activation before that work and consolidated migration/privacy/PG QA.

Five mocked route source cases are authored/unrun: accepted activity binding and
same-state replay/legacy exclusion, distinct later rejection transition, revoked
original generation, changed assignee hold and default sender preservation. The
fake does not prove rollback/SQL/FK/concurrency. Real atomic failure, multi-device
cycles, profile/credit compatibility, export/erasure, provider/native and all
original acceptance remain. No QA, migration/generation, app/API/DB execution,
provider, flag/scheduler change or release ran.


## Original check snapshot/CAS foundation — 2026-10-25

Strict command contract/shared builder and `lockOriginalChoreCheckInTx` are now
authored, not yet connected to an endpoint/client. They bind explicit original
parent user/family/session-generation preconditions, exact chore ID/decision,
immutable source generation, material responsibility epoch and completion
preparation epoch. Existing SQL preparation_epoch counts status/photo/check/
completion changes even when timestamps repeat; combining it with material epoch
protects reassignment/points/title/recurrence changes. No new clock/version column
is inferred, and absent/negative/saturated counters never default to a valid0.

The atomic predicate requires the same household/ID, completed status and all
three original version coordinates while acquiring FOR UPDATE. A later cycle or
material edit holds before effects, not just before a separate unguarded query.
Caller must first renew current authenticated parent and ordered lifecycle/
actual User locks; the typed owner is only a precondition. Strict schema requires
explicit approve/reject and rejects unknown fields. There is no receipt/replay
confirmation, HTTP fallback, lifetime/restore policy or client activation here.

Four source cases cover same-time completion cycles, material/birth changes,
missing/saturated versions, explicit owner/decision and full SQL predicate; all
unrun. Next: one shared verify handler plus separate strict endpoint, original
context/capability projection and retained-review UI behavior without silently
refreshing an old command's expected version. Legacy endpoint stays compatible.
All PG/old-client/restore/receipt/role/concurrency acceptance remains unfinished;
no QA, DB, generation/migration/build/browser or release action ran.


## Shared owned check endpoint and atomic guard — 2026-10-25

Legacy and new `/api/chores/verify/owned` POST now call the SAME
`chore-check-http.ts` implementation. The route wrappers select their fixed mode;
there is no second status/XP/profile/notification engine. Owned mode requires the
private default-off `CHORE_CHECK_COMMANDS_ENABLED=1` acknowledgement, current
parent authentication,8KiB strict JSON and exact original actor/family/session
preconditions before target lookup. Foreign/absent initial targets both404. All
owned results, including denials, are private/no-store. Legacy body/response and
conditional-state behavior remain in the original path. No fallback from owned
to legacy is provided.

Owned approval/rejection always takes ordered participant/actual principal/
household locks and renews original role/token, independent of notification mode.
After that it atomically locks ONLY the still-completed chore with original birth,
material and completion epochs. Failed comparison returns409 CHORE_CHECK_CHANGED
before status/XP/activity/notification/profile effects. Already-verified or a
later pending/completed cycle is not silently treated as original success. The
existing actual transaction then performs the canonical action, including gated
notification composition where enabled. No new migration/version column is added.

Five mocked route source cases cover exact source to shared mutation, later-cycle
refusal, owner mismatch, disabled/malformed refusal and claimed-parent bypass.
All unrun; mocks do not prove the actual SQL guard, concurrent legacy updates,
rollback, isolation or trigger behavior. Parent capability/context projection,
immutable command transport and explicit retained-review recovery UI are next.
There is no durable exact-command receipt/current-outcome proof here: a retry
after original success may409 and must be inspected, never automatically renewed.
Backup restore/epoch rollback and supported old-client retirement remain separate
real rollout gates. No QA, DB, generation/migration/build/browser or release ran.


## Owned check context and immutable transport — 2026-10-25

Source now includes GET on the existing private owned endpoint. It validates the
bounded original-owner header and exact target query, requires current parent
and the default-off command gate, and renews the original session/family/chores
feature before and after canonical detail reads. The canonical single-chore
reader was extracted unchanged from the existing chores route; no second data
projection or subject engine is introduced. Missing targets are neutral. Current
versions can describe pending/verified rows for explicit recovery; only completed
rows qualify as new check snapshots. Unsupported counters never default to zero.

Owned writes renew original authority inside the transaction before effects and
again before response disclosure. A late authority loss may follow a committed
mutation: the resulting hold is NOT rollback or proof that the command failed.
Clients must retain the original intent and inspect rather than blindly create a
replacement. Generic old endpoints retain their existing compatibility behavior.

Browser transport freezes exact original owner/version/decision/notes bytes,
uses only the owned endpoint, bounds foreground work to the existing15-second
request helper and caps write/read replies at64/256KiB. Unknown transport/body or
malformed success remains unknown; explicit reads require matching owner echo,
target household and source version. No auto-retry or automatic snapshot renewal,
legacy fallback, persistent command journal or exact-outcome receipt is claimed.

Authored source cases cover immutable retries, malformed/foreign replies, current
version reads, original parent authority and late withdrawal after a private read.
They are unrun. Parent SSR capability and retained-review UI are still pending,
as are actual role/session/concurrency/SQL/restore/legacy-client and device QA.
No gates enabled, DB action, generation, test/build/browser or release ran.


## Original-parent review UI connection — 2026-10-25

The Chores SSR now carries its original verified actor generation to negotiate
only the feature-specific parent check precondition. The full internal actor DTO
is never serialized. The existing default-off command flag selects owned mode;
a failed authority renewal produces a held capability, not a legacy fallback.
The shared-device reader supplies no actor. Current parent/user/family projection
must match that original actor, and original parent/feature authority renews just
before capability serialization. This is not a whole-page SSR privacy redesign.

Parent Verify/Send back opens a deferred shared rounded Dialog. It reads current
canonical chore context first and uses that exact source version; the first send
freezes original decision/notes/version bytes. All controls retain the uncertain
intent on failure. Retry uses those exact bytes. Check current chore reads only;
an unchanged version retains the original request. A distinct completed version
can be adopted only through Review latest version. Missing/unsupported/noncompleted
current data never silently produces a new writable snapshot. The explicit v2
member read header allows supported email-free profile context through the same
canonical reader; no account identity is fabricated.

Current 401/403 or explicit original-owner refusal masks private source and notes.
Parent owner/family/role/generation changes unmount the old keyed review, abort
its foreground request and retire late callbacks. Busy work prevents local close;
Back and app draft-aware navigation preserve the review. Deliberate local discard
requires a visible warning that the local notes/request are removed and that a
sent command may still commit. No cancellation, disk journal, exact-command
receipt or recovery after process death is claimed. A confirmed check applies
the canonical returned state; closing refreshes the board and schedules its
existing stable focus fallback. Legacy controls remain when the flag is absent.

Typed EN/ES UI and authored cases cover uncertain exact retry, deliberate adoption
of changed completion and access-loss masking. Cases are unrun. Full keyboard/
focus/Back/long text/light-dark/role/device, original-owner races, real PostgreSQL
CAS/rollback, durable outcome/restore and supported old-client acceptance remain.
Other event producers/recipient recovery/provider/native N1–N5 work remains open.
No flag, provider, scheduler, migration, generation, QA/build/browser or release
was activated. This connection is source progress, not acceptance or #141 closure.


## Exact reward claim and approval destination — 2026-10-25

The shared destination allowlist now admits only
`/dashboard/rewards?focus=<plain-canonical-ID>` for reward focus, with no encoding
aliases, extra query keys, fragments, schemes or arbitrary nested URLs. Existing
fresh reward-claim parent notifications and approval claimant notifications now
store that exact pointer. Their existing after-commit best-effort sends and
fresh-mutation/idempotency behavior are unchanged. This does NOT add durable
reward event admission, recipient roster freezing or dispatch recovery. New
reward-creation notices remain unchanged and do not pretend to be claim focus.

The exact server read renews original current account role/family/session and
effective Rewards/Points feature under User/household and actual User/Family
row locks, then locks one household Reward row. Parents can inspect household
claim history; child/teen targets require their own claimed_by account. Only
claimed/approved/redeemed lifecycle states are supported. No related account
names, unrelated reward history, actor DTO or XP balance are in the focused
projection. Absent/foreign/unsupported/disabled/revoked reads return a neutral
unavailable view with permitted ordinary navigation. A failed focus returns
before serializing the earlier shelf/balance reads. This is not a rewrite of
normal unlinked Rewards SSR authorization.

The focused card is separate from the24-row shelf/history page and removes its
same-ID duplicate there. It uses the existing RewardRow, canonical approve
handler, original idempotency key and recovery controls; no new mutation engine,
XP calculation, approval receipt policy or personal/profile account is added.
Confirmed state updates both focused and loaded-page representations. Page
counts/cursors remain about the original page. The focused region receives
keyboard focus and uses typed EN/ES copy. Existing action-origin/retirement and
whole-application privacy/native acceptance are not established by this source.

Authored unrun cases cover strict links, one-household projection, child/teen
claim predicates, original-session revocation, missing/disabled/malformed neutral
fallback. Real two-household SQL, concurrent membership/feature/claim changes,
focus/Back/cold-warm/locale/device/rendered and complete #141 acceptance remain.
No QA, provider/native/scheduler activation, DB action, generation, migration,
build/browser/CI or release ran. #141 remains open.


## Reward atomic claim source contract — 2026-10-25 (source authored; unverified)

Add a DB-generated immutable notification_generation to Reward plus a nullable,
write-once notification_claim_id transition UUID.
These are domain state, not caller keys or inferred legacy history. Existing
claim/approval timestamps remain the actual accepted event time. Additive source
only; no migration/generation/rollout. Existing row defaults assign a birth fence
without retroactively creating transitions or notifications. No new User FK or
provider credential; current Reward export/household erasure already owns the row.

First connect fresh claims only behind REWARD_CLAIM_NOTIFICATION_EVENTS_ENABLED,
general event-admission readiness and an explicitly configured private dispatch
window. Bound the accepted parent roster to100, reject overflow rather than
truncate, lock all candidate User IDs in sorted order before household/source/
receipt rows, then compare the entire current parent roster before effects.
Current original actor role/session/features and actual principal rows must hold.
Persist the transition UUID, XP deduction, event, all parent terminal slots and
existing HTTP receipt in one transaction. Source/recipient failure throws to
rollback all effects; never fall back to a postcommit send for this cohort.
Nonparent event dispatch is allowed only for reward.claim to a current parent,
with canonical source guard; other event kinds retain parent-only admission.
Approval producer identities are not added by this claim slice. Remaining
approval/source creation/reassignment, durable recovery and all acceptance stay
open. No paid provider or autonomous worker is introduced.


The fresh canonical claim path now prepares that bounded original-parent roster,
locks/compares it before receipt/source rows, persists the UUID only with the
successful available→claimed conditional write, then composes the existing XP
charge, event/terminal decisions and HTTP receipt before commit. Original session
generation comes from HTTP auth and is never renewed from a later DB value.
Unsafe stored costs hold the enabled cohort before XP charge. Every event or
recipient hold throws to roll back the claim/XP/receipt; disabled mode does no
new roster preflight and retains the original postcommit send. The HTTP route
skips that legacy fanout only when atomic handling completed, so muted slots or
an accepted empty roster cannot accidentally fall back to a second send.

Nonparent delivery policy is expanded ONLY for reward.claim to current parents,
with the same canonical guard and original token checks. Other event kinds
remain parent-produced. Stored parent slots are terminal even after inbox deletion
or recipient-reference clearing. Historical claims get no invented transition.
Source generation/reward ID/family and assigned transition UUID cannot be changed
by ordinary updates under the authored SQL trigger. No new User relation is added:
existing Reward scalar export and row erasure own these two fields, while event/
recipient evidence follows the existing parent export/deletion contract.

Rollout requires the additive Reward migration and regenerated Prisma client
BEFORE deploying regenerated ORM code, including flag-off mode; the flag alone
is not old-schema compatibility. Both migration and generation remain unrun.
Switching the claim flag off preserves stored identity/event/terminal evidence;
never clear it to replay an old operation. Real backup/restore epoch, original
receipt horizon and legacy-client retirement acceptance remain separate gates.
The existing transaction timeout is retained; latency for100 parent decisions
has not been measured and may hold/rollback. No capacity or throughput promise.

Authored unrun cases cover disabled no-op, roster overflow/change, same-tx event/
recipient composition, recipient refusal rollback propagation and narrow child
producer admission. Actual SQL trigger, claim/XP/receipt atomicity, competing keys,
roster/role/token/feature races, preference/quiet-hour/expiry/deletion/export and
rendered/device/provider acceptance remain. Approval still uses the existing
best-effort producer and exact link; it is NOT adopted by this claim slice.


## Atomic approval source contract — 2026-10-25 (source authored; unverified)

Add a nullable write-once notification_approval_id on Reward, preserving the
existing generation and claim ID. Use the actual accepted approved_at time and
conditional claimed→redeemed transition; do not infer a historical approval.
A separate default-off REWARD_APPROVAL_NOTIFICATION_EVENTS_ENABLED and explicit
REWARD_APPROVAL_NOTIFICATION_DISPATCH_MS select adoption. Preflight only original
actor and candidate claimant IDs; lock all participants before household/source/
receipt, compare actual source claimant after waits, and renew current parent,
original session and effective Rewards feature. A still-current household claimant
gets slot0. A removed/erased/departed claimant gets no recipient projection; this
must not invent a new person or block the ordinary parent approval solely because
a former claimant cannot receive a notice. Persist approval event/eligible terminal
slot and existing receipt atomically, skip only the adopted legacy send. Any
admission failure throws for rollback. No new XP charge or second approval writer.


Canonical approval now prepares the original claimant candidate, reuses the same
participant authority lock primitive as claim, compares the current scalar
claimed_by before effects, persists a fresh approval UUID only with the successful
claimed→redeemed write, and composes approval event/recipient decision/HTTP receipt
before commit. Approved/redeemed times use the same accepted transition instant.
Original authenticated session generation is forwarded by the existing route;
no new approval/XP engine or different claim-price calculation is introduced.
The separate approval flag and general admission/window readiness remain off.
Only an atomically handled approval skips its old aftercommit send. A changed
claimant throws before effects, so a lost attempt cannot silently acquire an
unlocked replacement recipient. Existing normal conditional/replay behavior stays.

One shared participant primitive now locks sorted actual User candidates and
Family, requiring original role/session/household and effective Rewards authority.
Approval excludes a current departed/deleted claimant from delivery, without
fabricating a recipient or changing the parent approval's business outcome. The
recipient primitive now accepts an explicit null target ONLY for reward claim/
approval events. It verifies the same accepted event/source, creates a suppressed
null-user/null-notification terminal slot and never calls the central inbox writer.
Claim's empty accepted parent roster now seals that same slot0. A later nonnull
recipient cannot fill it. This is distinct from simply leaving the event without
recipient evidence; erased existing slots also cannot redirect to another account.
No absent/erased profile becomes a User, and no roster is rebuilt after acceptance.

The additive approval migration extends the earlier immutable identity function;
ordinary updates cannot clear/replace accepted claim or approval IDs. Both Reward
identity migrations and regenerated Prisma client are still prerequisites, even
for deploying regenerated code with flags off; none ran. Existing full Reward
scalar export/row erasure and parent event/terminal-slot portability apply without
a new User FK. Flag rollback must retain all identity and terminal evidence.

Authored unrun cases cover disabled/no-actor admission, departed recipients,
same-tx approval composition, explicit empty slots, refusal propagation and
no refill of a sealed slot. No SQL trigger/transaction/expiry/concurrency/token/
role/quiet-hour/erasure/export/runtime/rendered/provider/device acceptance is
claimed. Durable dispatch/recovery, manual/new-reward/reassignment/summary source
coverage and original #141 acceptance remain unfinished. No QA, DB, migration,
generation, build/browser/CI, provider/scheduler/native activation or release ran.


## Reward original-access receipt and response boundaries — 2026-10-25

All four HTTP reward writers (create/update/claim/approve) now forward the
original authenticated session generation. Their shared actor check requires
that original generation and role as well as household, effective Rewards and
parent-only policy where applicable. User and Family FOR SHARE locks follow
ordered User/household lifecycle locks before source or receipt reads. Internal
legacy callers without session context keep their existing compatibility path;
no current HTTP writer silently reconstructs a missing original generation from
later DB state. Atomic notification cohorts already own stronger participant
locks and continue to use the same shared actor check.

All four canonical mutations now authorize before reading a completed internal
receipt; previously that internal branch could return the cached private body
first. The outer withIdempotency beforeReplay guard uses the same original-access
check. After successful mutation/replay and any legacy notification/metric waits,
a shared response guard renews original access again before disclosing reward/XP
content. Late loss returns private/no-store REWARD_ACCESS_CHANGED, while an
unavailable renewal returns503 REWARD_ACCESS_UNCONFIRMED. Both explicitly say a
request may already have saved: this is no rollback claim. Known non-success
refusals preserve their original status/reason and receive no-store headers.
No generic idempotency engine, lease, retention window or retry key is changed.

Authored unrun cases cover actual-row locking, revoked generation before receipt,
changed original role even on non-parent-only operations, late successful-body
withholding, unavailable renewal and preserving known refusals. No actual SQL,
concurrency/session/feature/receipt/interleaving/device/rendered acceptance ran.
Normal reward collection/SSR authority and client uncertain-key retirement remain
separate source/acceptance concerns; no whole-Rewards privacy certification.
No schema/migration/generation, QA/build/browser/CI, flag activation or release ran.


## Reward uncertain retry retention — 2026-10-25

The claim/approval board now tracks unresolved attempts synchronously as well as
in displayed recovery state. After an unknown response, a later400/401/403/etc.
refusal preserves the same original key/recovery instead of deleting it. A first
REWARD_ACCESS_CHANGED/UNCONFIRMED response is also uncertain regardless of HTTP
status, because final access withdrawal may follow commit. Explicit retry restores
the recovery's exact key and refuses a conflicting active key; it never silently
converts that recovery to a new request. Bodies remain the same reward ID/action.

A claim current-state read now resolves only for the original account claimant
in known claimed/approved/redeemed states. Another claimant, a cleared identity,
or an unsupported lifecycle keeps the original recovery and does not report a
successful own claim or adjust XP. Still available remains unresolved. Approval's
existing desired-state observation remains distinct from proof of which request
performed it. Typed EN/ES recovery copy no longer promises all retry ages are safe.

Authored unrun cases cover unknown→refusal→original-key retry, first late-access
hold and another person's claim after an uncertain own action. This in-memory
follow-through does not add disk recovery, original-session HTTP owner commands,
receipt-age retirement, request cancellation or account/unmount retirement. Those
source/acceptance gaps and real concurrency/receipt/role/device/rendered evidence
remain open. No QA, schema/migration/generation, flag activation or release ran.


## Reward board owner/lifecycle retirement — 2026-10-25

The Rewards SSR projects only feature-specific original account/family/role/
session-generation fields to the board. A keyed inner board remounts on any owner
boundary, removing old rows, balance, confirmations and local recoveries before
a new owner renders. This is not a generic internal actor DTO or action grant.
Older internal/fixture callers may omit added context; current SSR supplies it.

Every claim/approval/status foreground request now has an AbortController under
the existing15-second bounded request/body helper. Unmount increments the work
epoch and aborts owned transports; all post-await/catch/finally paths ignore
retired work, so it cannot update rows/XP, raise toast, refresh the new route or
clear another request's state. One synchronous board latch serializes mutations
and recovery reads, including rapid activations before React state commits.
Pending state disables actions/recovery/page links, provides read feedback and
uses the existing Back/draft-navigation guard. Local raw create/analytics/page
links also refuse while the work latch is held. No server rollback/cancellation
claim follows browser abort; a request may already have committed.

Current401/403 and explicit access-changed/unconfirmed results mask the private
board and its dialogs/recovery. Their original uncertain keys stay in the mounted
owner scope, but only explicit full-document Reload rewards is offered. Typed
EN/ES copy says a request may have saved and that this local recovery will not
survive leaving. A full reload deliberately discards in-memory state; no durable
journal, original-owner HTTP header or process-death recovery is invented. This
also avoids a same-owner router.refresh leaving a permanently masked inner board.

Authored unrun cases cover owner replacement/unmount with abort-ignoring late
responses, no late refresh/toast, access-loss masking and shared rapid-activation
latch. The prior unknown→later refusal source case now uses400;401/403 instead
retain uncertainty behind the privacy hold. Receipt-age hold, owner-bound HTTP
contracts, durable recovery and all real Back/navigation/lifecycle/concurrency/
role/device/rendered acceptance remain open. No QA/schema/migration/generation,
flag/provider/scheduler/native activation, build/browser/CI or release ran.


## Original reward request age and payload — 2026-10-25

Claim/approval memory now retains a frozen request object: action, canonical
reward ID, original serialized body, idempotency key and first creation time.
The first send records it; status reads, retries, later refusals and refreshed
reward display fields never renew that timestamp or payload. Recovery and active
map must agree on every original field before another send. A mismatched source/
action/body/key/time holds instead of reconstructing a new request.

A browser-safe predicate uses the existing server IDEMPOTENCY_TTL_MS7-day upper
bound, without changing server cleanup/retention policy. At/past that original
age, a reversed clock before the original issue time, nonfinite/invalid time or
unsupported payload holds before foreground transport. Try again disables once
rendered outside the window; Check status remains available. Typed EN/ES copy
states that original timing is no longer confirmed. The uncertain request stays
in memory; no replacement key, automatic resubmit or new server intent is issued.

This is a local precondition, not proof of the server's authoritative clock,
receipt existence, request arrival time or outcome. Arbitrary wall-clock changes,
network/server delay near expiry, backup restore and process-death recovery still
need the original-owner/server-admitted intent protocol and rollout acceptance.
Existing canonical single-use claim/approval predicates remain necessary; do not
claim the client predicate alone prevents all old-operation replay. No disk
journal or server retention extension is added. Explicit reload still discards
local memory under the existing warning.

Authored unrun cases cover horizon/future/invalid time, changed payload/action/
time, exact frozen request and old approval→read→still-held retry without a new
POST. All receipt/clock/expiry/concurrency/role/device/rendered acceptance remains
open. No QA/schema/migration/generation, flags/providers/schedulers/native,
build/browser/CI or release actions ran.


## Reward API/SSR original-authority reads — 2026-10-25

Current issue reconciliation still finds39 genuine open trackers; inspected
#473/#464/#470/#465 include runtime or external-input requirements, not completed
planning-only duplicates. The outside-worktree issue snapshot preserves current
bodies. No acceptance criteria are closed solely from source authorship.

Reward one-target, opt-in keyset and compatible unpaged GET now read inside one
shared original-actor transaction scope. The existing authorizer takes ordered
User/household and actual User/Family FOR SHARE locks, renewing original session/
role/household and effective Rewards/Points feature before canonical queries.
The same low-level readRewardPage remains the paged reader; no second collection
engine or altered cursor/status/target semantics. API success renews original
access once more before disclosure and always uses private/no-store. Read-only
holds have reload guidance, without implying an attempted write may have saved.

SSR balance/current role plus24-row reward page use that same transaction scope,
not independent unguarded data reads. Before client serialization, original access
renews again after focused-context and projection waits. The outer household
header also carries its original cookie generation and renews access before
returning private family-name context. Ordinary failures use a typed EN/ES read
unavailable view; notification failures keep their neutral focus fallback. A
changed original family or deleted family is now REWARD_ACCESS_CHANGED for
session-bound actors, so the client privacy hold recognizes it. Internal legacy
callers lacking generation retain their existing No family compatibility error.

Read transactions keep the existing5-second timeout/max-wait budget. Legacy
unpaged response is still unbounded in row cardinality; timeout is not pagination,
query-plan/capacity proof or justification for silent truncation. Related-person
projection and browser-to-server original-owner command protocol are separate
concerns; this scope is not whole-app privacy or isolation certification.

Authored unrun cases cover supplied original actor/transaction, refusal before
private read, missing original generation, household move before receipt and
read-only late response masking without save language. All actual PG locks,
concurrent role/token/feature/family/XP changes, cursors, multi-household/privacy,
load/timeout and rendered/device acceptance remain. No QA, schema/DB/migration/
generation, flags/providers/schedulers/native activation, build/browser/CI or
release ran.


## Owned reward action endpoint contract — 2026-10-25 (source authored; unverified)

Separate default-off `/api/rewards/claim/owned` and `/approve/owned` wrappers
select strict mode on shared legacy handlers. No duplicated claim/approval/XP/
receipt engine or fallback to an unversioned endpoint. Require bounded strict
JSON and a valid idempotency key: fixed protocol, explicit kind, original account/
household/role/session, immutable Reward source generation, original issue time
and reward ID. Claim also binds reviewed cost; approval binds original claimant
(including explicit null). These are preconditions, not authentication or owner
proof. Auth/current parent policy precedes target access.

Bind the entire owned packet into the existing key hash. Under actual principal/
household locks, before internal/outer receipt replay or effects, require original
session/role/features, original7-day server-checked issue window and exact Reward
birth/cost or claimant under source row lock. Current source change holds, never
silently reprices or selects a replacement claimant. Existing conditional status
write adds the source generation. Cached outcomes may replay only while original
access/source/window still holds; late response refusal is not rollback proof.
Legacy routes keep established shapes/optional-key behavior. Schema expansion/
client generation are existing rollout prerequisites. Flag activation, SSR/client
negotiation, owned read/recovery and all actual acceptance remain separate.


Both strict POST endpoints now call the same extracted reward-claim-http and
reward-approve-http handlers used by original legacy route wrappers. Owned mode
requires REWARD_ACTION_COMMANDS_ENABLED (default off),8KiB strict JSON, matching
original authenticated owner, correct fixed kind and a required existing valid
Idempotency-Key. Foreign/missing preflight targets both404. Responses are private/
no-store and acknowledge the fixed protocol header; no automatic fallback route.
The entire canonical parsed packet, not just rewardId, binds the existing key hash.

Canonical claim/approval and outer/internal replay now check that strict packet
under principal/household and source locks. Birth generation plus reviewed cost
(claim) or original claimant including null (approval) must still match before
cache or effects; conditional writes include generation too. Server checks the
original issue time before target access, after source/receipt waits and after
all effect/receipt writes. Expiry after possible effects THROWS for enclosing
rollback; returning an ordinary refusal there would have committed changes.
Late final disclosure renewal retains source/time command codes separately from
actual access-loss codes. A held response still is not proof that an earlier
attempt failed or that a prior committed action rolled back.

No schema/version counter is added by these endpoints: they require the already
authored Reward generation migrations/client generation before deployment. Claim
price changes hold rather than charge an unreviewed price in this owned mode;
legacy current-price behavior remains compatible. This protocol binds birth/cost/
claimant, not every text/material field or a complete signed server preview.
Current browser remains on existing paths until explicit SSR capability, frozen
owned-packet transport and owned current-state recovery are connected. No flag
is enabled and no minimum supported native client is changed. Restore/old-client
retirement remain separate actual rollout gates.

Authored unrun cases cover strict schema/owner/time, locked source predicate,
shared-handler canonical mutation, missing key, owner/source refusal, disabled/
unversioned refusal and current-parent enforcement. Mocks do not prove actual
SQL, competing requests/prices/claimants, committed receipt replay, rollback or
clock/arrival/restore safety. All API/client/native/role/device/rendered and full
#135/#136/#141 acceptance remain. No QA, DB/schema/migration/generation,
build/browser/CI, provider/scheduler/native activation or release ran.


## Owned reward browser negotiation and current-state read — 2026-10-25

The Rewards SSR now negotiates original account/family/role/session context only
when the existing private command flag is enabled. It renews original authority
before serializing that feature-specific precondition. The full internal actor
DTO/credential is never sent. Reward cards and exact notification focus include
the canonical immutable birth generation, never a fabricated default. A held
capability or missing source generation cannot create a legacy request.

Browser-safe protocol constants/types are separated from server schema/Prisma
code. Owned intents freeze original owner, birth, reviewed cost/claimant, action,
body/key/issue time. Claim and approval use only their strict endpoints once
selected; protocol acknowledgement and matching returned household/birth are
required before success. Existing request bounds, lifecycle epochs, synchronous
latch, uncertainty preservation and receipt-age hold remain. Selection is
monotonic within the mounted owner: a later absent capability does not downgrade
an owned packet. Old frames never selecting strict mode retain compatibility.
An in-memory legacy packet cannot silently become a newly owned packet on upgrade.

New default-off GET `/api/rewards/owned?rewardId=...` requires a bounded strict
original-owner header and exactly one canonical target query. Authentication and
owner match precede target access; the shared locked read scope and final original
access renewal apply. Success echoes protocol/owner and only one minimal current
reward projection (no related names, creator or XP balance). Absent/foreign is an
empty result; unsupported/disabled/owner refusal holds, never a legacy read/write
fallback. Expired write age does not prevent an explicit current-state read.

The board requires protocol acknowledgement, exact owner/household/target,
supported lifecycle and birth evidence before admitting current read data. A
recreated same-ID reward cannot resolve the old packet. Reads do not renew the
old expected cost/claimant/source/time/key, or automatically create a replacement
review. Source changes use typed EN/ES guidance, not protocol codes in product UI.
Deliberate new-review/reload after a held price/claimant/source remains distinct
from evidence that an earlier attempt rolled back. No persistent journal or
process-death guarantee is introduced.

Authored unrun cases cover immutable owned packets, missing context, protocol/
owner/scope/future-status refusal, matching read/owner mismatch, owned-only retry,
held capability and same-ID replacement after unknown approval. They do not prove
runtime, actual PG/clock/receipt/price/claimant/concurrency/old-client/restore,
Back/role/device/rendered behavior. Command and notification flags remain default-off in source; none were activated.
Additive schema/Prisma generation prerequisites remain unperformed. No QA, DB,
schema/migration/generation, build/browser/CI, provider/scheduler/native activation,
push/merge or deployment ran. #135/#136/#141 remain open.


Uncertain actions now route through their explicit Recovery controls: ordinary
Mark as given and duplicate Claim submits disable while a recovery exists.
Reopening an uncertain claim uses its original reward display snapshot, so a
current price/name refresh cannot visually imply that the retained old packet
was replaced. Deliberate replacement review is still separate unfinished work;
current-state inspection never silently clears the original uncertainty.


## New reward birth producer source contract — 2026-10-25 (source authored; unverified)

Add closed event kind reward.created (existing in-app category reward) for a fresh
canonical available Reward birth. Source identity is actual DB generation/id and
created_at, fixed created transition; never infer historical births from titles
or caller keys. Default-off REWARD_CREATE_NOTIFICATION_EVENTS_ENABLED plus the
existing admission acknowledgement and explicit REWARD_CREATE_NOTIFICATION_DISPATCH_MS
select adoption. Bound/freeze the entire current household account roster except
the creator at100; overflow/unsupported roles or roster drift hold before effects.
Reuse ordered actual participant locks and central preference/quiet-hour sender.

The same transaction creates Reward, event, every terminal slot and existing
HTTP receipt, or throws for rollback. Seal an empty accepted roster explicitly.
Skip legacy postcommit fanout only after atomic handling. Older envelope readers
must hold the unfamiliar kind; do not activate before supported-client/rollback
acceptance. Extend exact focus to currently active available household rewards
with existing deliberate claim confirmation, while child/teen claimed history
remains own-claim only. No new reward/points engine, provider or scheduler.


Canonical createReward now composes fresh birth admission and all original
recipient decisions before its existing receipt. Its HTTP route skips the old
postcommit fanout only when that atomic handling completed; disabled mode keeps
the previous behavior. Birth and claim producers share one bounded roster
preflight/lock/recheck primitive (creator-excluded household versus parent-only
claim audience), plus the existing actual principal/feature locks. Recipient IDs
are frozen; a changed/oversized/unsupported roster holds before the new Reward
exists. Central policy still owns the only inbox create, quiet hours/preferences
and terminal dedupe. A suppressed/empty roster never falls back to a later send.

The closed reward.created kind maps to the same existing reward category. Old
readers hold the unfamiliar envelope; storing it requires later supported-reader/
rollback acceptance. Existing JSONB event/decision storage, scalar Reward birth,
parent export and household/recipient erasure contracts are reused; no new schema
or User FK. Prior additive migrations and generated client remain prerequisites,
unperformed. This deduplicates a particular accepted birth/recipient, not every
new key or unkeyed create: legacy optional-key command semantics and receipt
expiry/process-death still require their own recovery acceptance. A fresh new
Reward is a different deliberate source, never title-based global deduplication.

Exact focus now admits an active available household reward for personal parent/
teen/child viewers under original role/session/feature and source locks. Other
claim history stays parent or own-claim only; inactive available, missing/foreign
or unsupported targets are neutral. Focus and shelf share one claim control and
the existing deliberate confirmation/owned-or-legacy action handler, points
availability, uncertainty and recovery. Same-ID loaded focus is deduplicated.
No automatic claim, navigation grant, shared-tablet auth or extra XP engine.

Authored unrun cases cover source-kind closure/category, own readiness flags,
whole/empty recipient roster composition, hold rollback propagation, roster
bounds/drift, available/retired focus and opening one canonical confirmation
without writing. Existing claim source cases follow the shared roster primitive.
No real PG/source/receipt/FK/concurrency/role/quiet-hour/expiry/export/latency,
provider/native/device/rendered or full #141 acceptance.100-recipient latency is
unmeasured and may hit the retained transaction timeout. No QA, DB/schema/
migration/generation, flags/providers/schedulers/native activation, build/browser/
CI, push/merge or deployment ran. All activation flags remain default-off source.


### 2026-10-25 — reward creation retains original retry timing (source only)

Creation now records the first local issue time alongside its existing owner-scoped request key and draft. Reusing a signature cannot replace its key or renew timing. Recognized legacy intents with missing or unsupported timing retain their original contents and hold retries; the existing seven-day receipt interval is a local hold boundary, not server admission or clock proof. Explicit Retry sends the original details even after editing the form. Uncertain work survives later refusals; 401/403 and access-change responses mask private fields.

The foreground request uses the shared 15-second/256-KiB transport, aborts on unmount and ignores retired completions/navigation. Permission/account/family boundary changes remount the form. Error keys relabel with locale rather than rehydrating saved private drafts. Authored regression cases cover original payload/key reuse, legacy timing hold and late completion after unmount; all are UNRUN.

Remaining: creation still uses the legacy endpoint and does not capture/admit an original session-generation command, inspect exact receipts or enumerate every saved signature. The existing whole-envelope loader still removes invalid/unsupported records and treats storage-read failures as empty; this change does not certify journal fault safety, multi-tab behavior, durable storage or old-reader acceptance. No test, build, browser, DB migration/generation, provider/scheduler activation, push, merge or deploy ran. #135 and the release criteria remain open.


### 2026-10-25 — preserve unknown reward-create journal history (source only)

The owner-scoped loader now retains exact persisted bytes for malformed, unsupported-version, mismatched-owner or otherwise invalid envelopes. Storage access/get failures establish a sticky in-memory hold rather than an empty writable store. The persistence helper does not overwrite held history, new intent admission refuses it, and creation checks before minting a key or dispatching. The form presents typed EN/ES guidance and read-only navigation to Rewards. Merely regaining storage access does not clear a held owner store. Explicit existing cleanup remains separate; no automatic purge/retry is introduced.

Existing regression sources now describe byte preservation, refused admission and held read failures; they are UNRUN. This supersedes the prior note about automatic invalid-envelope removal in this loader. It does not resolve stale in-memory stores or cross-tab write races, failed writes/durability, compatible recovery/import, failed-purge lineage, original-session creation admission or exact server receipt inspection. No tests, checks, build, browser, DB/generation, CI, push, merge, deployment or activation ran; #135 remains open.


### 2026-10-25 — expose unfinished reward saves independently of edited drafts

The journal now provides cloned, owner-scoped intent snapshots from the existing maximum-32 persisted record set. Held/unreadable journals disclose no parsed entries. After post-mount hydration, the creation form lists all recognized unfinished saves even when the latest draft has a different signature or is absent. Each row shows original name/icon/description/cost and invokes the same canonical submit handler with that exact saved intent; no second mutation route or automatic retry is added. A collapsible summary and bounded scroll area keep the recovery section compact, and each retry control describes its own reward.

Retries retain original keys and timing; expired or unknown-age rows remain visible with retry disabled and read-only Rewards navigation. Removing a confirmed original updates the list and does not clear a differently edited latest draft. Owner/permission retirement and access/storage masks continue to contain private content. Typed EN/ES messages and an edited-draft recovery fixture were authored, UNRUN; an existing unknown-time fixture was adapted for both alert and row copy.

This supersedes the prior latest-signature-only discovery limitation. It does not prove rendered/accessibility behavior, cross-tab consistency, stale-cache races, write durability, old-reader compatibility, original-session command admission or exact receipt outcome inspection. No tests/checks/build/browser/CI/DB/generation/push/merge/deploy or activation ran. #135 remains open.


### 2026-10-25 — household-scoped reward people reads (source only)

Reward GET exact-target, paged and legacy collection reads, plus the shared SSR page reader, now load scalar reward rows and project creator/claimant names from current same-household User queries. Absent or moved people become null; scalar creator/claimant history remains. Each related-person lookup covers at most 100 rewards and 200 distinct IDs. Paging lookahead and cursor position remain based on reward rows, without a second reward engine. The original viewer read gate and final response renewal remain in place.

One focused projection fixture is authored, UNRUN. This is query-time scope, not recall after a related person moves. Mutation response relationship projections still need separate work. Legacy unpaged total response volume, actual database behavior, generated types, rendered roles and runtime acceptance remain unverified. No QA, migrations, release or activation ran; #136 remains open.


### 2026-10-25 — reward mutation relationship disclosure (source only)

The existing shared successful mutation response boundary now discards cached creator/claimant objects, including those in completed idempotency replays, and projects current same-household people through the reward read helper. This covers ordinary and owned create/edit/claim/approve handlers that already use the boundary. The original actor is renewed before processing, inside a five-second projection transaction, and again after projection. Missing household/scalar identity or projection failure holds the response without disclosing the original snapshot. Successful refusal handling retains its original reason; uncertainty can follow a committed effect and never authorizes a replacement command. Receipt/effect bodies in storage are not rewritten. Response status and receipt/protocol headers are retained; stale content size/encoding headers are removed when rebuilding JSON.

Focused replay projection, missing-identity hold and late-authority-loss fixtures are authored, UNRUN. Scalar effect-time history and XP remain receipt history, not a fresh canonical reward state. Current reward birth/state replay admission, stored private receipt minimization/retention, related-person moves after lookup, DB/runtime and role/installed-client acceptance remain open. No QA/checks/build/migration/release/activation ran; #136/#135 remain open.


### 2026-10-25 — new reward receipts omit person display relationships (source only)

Fresh create/edit/claim/approval effects no longer include creator/claimant display-name relations in their result, so the canonical effect receipt and outer idempotency response store scalar reward history without those duplicated person objects. The existing HTTP disclosure boundary adds current same-household names, preserving the public relationship fields for current callers. The approval preflight also stops reading an unused claimant name; the canonical ID-only claimant existence check used for notification routing is retained. No new writer or replay engine is introduced.

Existing opt-in guarded PostgreSQL fixture source now describes stored create/claim/approval receipts without creator/claimer objects; UNRUN. No old receipt is rewritten or erased. Reward name/description, scalar creator/claimant IDs and effect-time XP remain sensitive receipt history. Historical redaction/retention, canonical source birth/state replay admission, original-client compatibility and all actual DB/runtime/QA acceptance remain open. No QA/checks/build/DB/migrations/push/merge/deploy/activation ran; #136/#135 remain open.


### 2026-10-26 — retire inbox foreground writes on route exit (source only)

Mark-read, snooze and delayed-delete requests now register per-request controllers
with the mounted inbox. Unmount aborts those foreground jobs; signal and page
lifetime guards suppress late row restoration, success/error toasts and busy-state
updates even if a native bridge ignores cancellation. The retained Undo callback
refuses work after its originating inbox retires. Existing read sequencing and
canonical notification endpoints remain the same. Waiting Undo deletes still
flush once via the existing page-exit keepalive path; a delete already dispatched
is removed from that waiting set and is not resent on unmount.

Aborting a request does not establish whether its server mutation committed.
Returning to the inbox uses its normal canonical read; no automatic retry,
durable outcome journal, new ownership protocol or provider action is added.
This is mounted route lifetime, not proof of actor/household continuity when the
route remains mounted. Three fixture sources retain the global toast host while
a late mark-read/delete error or snooze success settles after route exit, and
assert cancellation and a single dispatch. They are UNRUN. Existing Undo timing,
unknown-outcome, owner/concurrency, physical lifecycle and all #141 acceptance
remain unverified. No QA/checks/build/browser/DB/CI/push/merge/deploy or activation
ran.


### 2026-10-26 — bounded personal inbox writes and atomic owner predicates

The existing notification POST uses the shared streamed JSON reader with16KiB;
mark-read, delete and snooze use8KiB. Authentication (and POST parent admission)
still precedes body decoding. Oversized requests return413 before domain work;
malformed JSON keeps400. The legacy decoder fallback has a post-decode byte
bound only, as documented by the shared reader. This is no body-read deadline
or transport-wide allocation guarantee. Current accepted shapes remain intact.

Single-row mark-read and delete now use updateMany/deleteMany with both the
notification ID and authenticated user ID in the actual mutation predicate.
Affected count other than one returns the existing neutral404. This removes
the separate ownership preflight and subsequent ID-only write. Mark-all/clear-all
retain their existing user predicates. Snooze already used an owner predicate.
Its relative delay is recalculated when deliberately chosen again, so it is
not an exact original-command retry; unknown outcomes still require canonical
refresh. No new receipt, automatic resend, scheduler or delivery provider.

Seven fixture cases cover the two owner predicates and streamed/declared body
refusals; all are UNRUN. This does not supply original-session renewal across
body/DB waits, immutable notification birth identity, same-owner replacement
protection, multi-device ordering, slow-body deadlines or acceptance of current/
previous installed clients. No QA/checks/build/browser/DB/migration/CI/push/merge/
deploy or activation ran. #141/#136/#134 remain open.
