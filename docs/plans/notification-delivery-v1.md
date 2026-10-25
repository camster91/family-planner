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
- `notification-destination.ts` deliberately accepts only `/dashboard/today`.
  Exact chore/event/list/recipe destinations and native cold-start resolution are
  unfinished, not completed by a stored arbitrary action URL.

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
