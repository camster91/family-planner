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
