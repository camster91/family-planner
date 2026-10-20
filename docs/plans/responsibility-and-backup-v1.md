# Responsibility and backup — implementation contract

#123 approved coordination workflow; source design 2026-10-20. This is required
implementation in the existing goal, not provider work or a replacement task.
The complete journey includes canonical task/pickup/handoff ownership, awaiting /
accepted / declined confirmation, an optional named backup, short EN/ES controls,
exact owned recovery, current-authority checks and ordinary domain links.

## Ownership and meaning

- Chore primary ownership remains Chore's current account/profile subject. A
  confirmation belongs to this exact occurrence, never all future occurrences.
- Pickup primary ownership remains Pickup.assigned_to. An unassigned pickup is
  visibly unowned; selecting a backup does not assign or complete it.
- Handoff.sitter_name is an external display name, never a User or authenticated
  identity. A separately chosen household **coordinator** is the person handling
  the handoff plan, not a claim that the sitter has accepted or signed in.
- An acceptance is an explicit statement by the currently authenticated account
  for its own slot. A parent may record a statement for an eligible email-free
  chore profile only; label that **parent-recorded**, including which account
  recorded it. Never label it self-confirmed or grant profile login authority.
- Assigning a primary, choosing a backup, reviewing a weekly-reset step and
  completing a task are different actions. None implies the others. Naming a
  backup does not activate it or send an invitation/message/notification.
- Declined stays distinct from awaiting. Clearing confirmation returns to
  awaiting and does not pretend that another account declined. Reassignments
  continue through canonical domain controls with fresh confirmation afterward.

## Roles and targets

Parent reads/configures within the current household. Teens/children review only
chores where their own account is the primary or named backup through this
feature; a selected profile never expands that authority. Pickups retain their existing shared-person read scope, but only
the account named for a slot can make its own acceptance/decline. Handoff coordination
is parent/teen only to preserve the child's existing name/time-only handoff DTO.
Only parents choose/reset a backup or coordinator. Handoff coordinators must be
eligible parent/teen accounts; pickup/handoff backup references are account-only,
matching their current domain identity model; handoff backups also use eligible
parent/teen accounts to preserve the child boundary. Chore backups may be eligible
accounts or active unlinked profiles under the canonical profile rollout gates.
No new age/legal/transport claim is inferred from a display role.

The server resolves every reference afresh in the current family. Account/profile
aliases, archived/erasing/foreign/invalid subjects, unknown protocols, completed
or unavailable targets and paused capabilities refuse new statements. Authorized completed-record reads may still show prior provenance. The primary and
backup cannot be the same canonical subject. A parent cannot self-confirm for
another account; parent-recorded confirmation is limited to profile subjects.

## Persistence and concurrency (implementation contract; latest source status below)

Use one additive target-attached ResponsibilityState table with real nullable
FKs to Chore/Pickup/Handoff and a database exactly-one-target check. Target and
family deletion cascade, so no polymorphic untracked target IDs survive deletion.
Target IDs are unique per responsibility row. This table does not replace or
copy the canonical chore/pickup assignment. It owns only the new handoff
coordinator, named backup, explicit statement provenance and monotonic revision.
Persist identity references as FKs/typed columns, not opaque consent JSON that
cannot be erased. The pure state DTO is a projection of those columns, not a
second household/assignment store. No existing broad domain DTO gains new fields.

Every mutation locks actor-user then household, renews token/role/membership and
current feature/domain/subject permissions, and renews/locks canonical target
and state. The command binds original actor/family/target/source token/revision
and issuedAt; a receipt commits atomically with the metadata effect. A strict
source token must be refreshed/invalidated whenever assignment, schedule or
material target instructions change, including away-and-back changes. Database
invalidation must protect legacy writers too; a content hash alone cannot close
ABA. Completed/deleted targets cannot receive a new confirmation.

Projecting a new source invalidates both old statements. It retains an eligible
backup choice unless that subject became the new primary (then it ceases to be a
backup). Handoff coordinator identity is kept only while still eligible. No old
acceptance becomes authority for changed work. The effect reports invalidations
for the user-facing preview/receipt. Every later statement needs the current
source token and metadata revision, not a last-write-wins update.

Member/account/profile detachment, deletion, merge/link/erasure and household
deletion must remove or clear metadata participation under the existing lifecycle
locks, including during rollout rollback. Account/member FKs cannot leave actor
IDs in consent JSON or receipts with content. Add schema-probed export/erasure
compatibility before exposing the feature. Keep generation/household retirement
and exact owned request staging/inspection/retry; no unowned storage fallback,
background replay or cached privileged target DTO in an idempotent receipt.

## Compact intended UI and acceptance

Use small inline owner/confirmation/backup summaries on relevant canonical
records, with a rounded short sheet for choosing a backup or confirming intent.
Show current target/owner, the exact statement, self versus parent-recorded,
awaiting/accepted/declined status and named backup. Return to the same record.
Weekly reset consumes the same role-filtered projection, not a separate status.
Preserve EN/ES, 44px targets, keyboard/focus/Back, long names and pending/unknown/
paused/conflict states. Preserve the exact request through interruption and
require explicit recovered review. Empty, no owner and unknown are different.

Implementation order: pure contract/planner (this slice); additive FK persistence
and legacy-writer invalidation plus lifecycle/export; locked person API/atomic
receipts/owned recovery; full canonical UI and weekly-summary integration. All
are required code, not optional suggestions. After the remaining repository code,
run real PostgreSQL/concurrency/two-household/profile/role/erasure/import/rollback/
receipt/route tests and rendered phone/tablet/desktop/native acceptance. No QA,
migration, activation, user mutation or release occurs while authoring this slice.


## Pure contract/planner source authored — 2026-10-20

`src/lib/responsibility.ts` now defines strict versioned account/profile/target,
statement, state and command contracts plus pure role/subject/source/revision/
intent-age planning. It requires a server-resolved person actor, current family,
canonical primary, eligible subjects/coordinators and same-household statement
actors; these inputs are explicitly not trusted API claims. A pure planner is
not a substitute for locked authentication, domain lookup or a persistence API.

The source distinguishes self versus parent-recorded profile statements, accepted
versus declined versus awaiting, primary versus backup and handoff coordinator
versus external sitter name. Parent configuration never accepts for an account.
Named account backups can respond for their own slot without becoming primary;
non-participating child/teen chore readers are refused. Source-epoch changes
invalidate statements, and a backup that became the canonical primary ceases to
be a backup. Same backup choices preserve an unchanged statement. Unknown future
states, wrong owners/households, stale revisions/tokens/age, unavailable subjects,
paused or completed writes and profile impersonation refuse rather than overwrite.
The output changes metadata only and reports source/duplicate-backup invalidation.

Authored pure source cases cover these consent/role/subject/source/clock/state
boundaries, including handoff identity and changed source epochs. They are unrun
and do not prove actual source-epoch generation, target/FK integrity, legacy-writer
invalidation, locks, transactional receipts, erasure or any rendered journey.
No DB/schema/migration/endpoint/UI/client generation or activation is included in
this slice. Required next work is the FK persistence/legacy invalidation/lifecycle/
export slice, then locked API/exact owned recovery and the full EN/ES canonical UI
and weekly-summary integration above. Full #123 and repository scope remains open.


## FK storage, source continuity and lifecycle source — 2026-10-20

`prisma/schema.prisma` and the new transaction-wrapped additive
`database/migration-zzzzzz-responsibility.sql` now describe ResponsibilityState.
Exactly one target is required, with family-scoped target/account/profile FKs,
unique target/family keys, statement-shape/identity checks and indexed identity
participation. Handoff coordinator is the only new primary ownership field;
chore/pickup primaries remain in their original domain rows. Statement subject
FKs preserve historical consent identity for comparison, never current assignment.
Unknown protocol text is not silently migrated or overwritten. No opaque consent
JSON stores untracked person IDs. Identity/target/family cascades remove metadata;
canonical domain retention/deletion remains under existing policy.

Canonical Chore/Pickup/Handoff rows gain an immutable per-insertion DB-generated
UUID and nonnegative monotonic epoch. SQL triggers advance the epoch on explicit
material-field changes by legacy clients too; a replaced row receives a new UUID.
A content hash alone is not used as continuity. Material source is not copied to
metadata or a provider. Epoch saturation holds new responsibility operations
instead of overflowing or blocking ordinary target edits. Root epochs also bind
child-occurrence consent. `responsibility-storage.ts` locks target/root rows in
stable ID order and rejects missing/changed/unlocked roots, malformed generations
and saturated counters. It still requires caller-authenticated actor/household
locks and fresh domain/subject authorization; it is not an API or capability.

User detachment/role/deletion, profile age/role/archive/erasure/deletion and mapping/
link changes now have source-level DB retirement hooks independent of rollout.
They advance existing canonical primary work even before a metadata row exists,
then advance affected target counters and remove participation metadata. This
closes metadata deletion/recreation and first-confirmation identity ABA. Mapping/
link retirement runs after the FK mutation; account/profile retirement runs before
identity changes and FK cascades. New services must lock the relevant current
account/profile identity rows in stable order **before** target/root/state locks,
then renew their relationship snapshot. A related identity or root discovered
outside that locked snapshot is a hold, not a late out-of-order lock acquisition.
Actual legacy/concurrent FK/trigger ordering remains an explicit real-PG gate.

The raw transaction store reads explicit typed columns under a row lock, verifies
returned family/target, refuses unknown/partial/contradictory states, and persists
only a changed planner result with exact target/protocol/revision CAS. Creation
uses insert-on-conflict refusal, never destructive replacement. It does not grant
auth, change canonical ownership, create a transaction itself or commit a receipt;
the next locked API slice must commit effect + minimal receipt atomically.

Own export now probes schema compatibility and selects current-household own
participation (including current canonical primary), renews current family/role
in the statement, omits child handoffs and excludes source tokens, target text,
emails, ages and bearer secrets. Export remains available during rollback. The
explicit HOUSEHOLD_DELETION_PLAN names ResponsibilityState before targets/links;
a table-probed SQL branch clears only the authorized family even on an older
generated client. Metadata cascade is additional defense, not a missing plan row.

Authored source/unit cases cover source generation/epoch/root/saturation, pre-DDL
compatibility, export scope, typed statement decoding, foreign/unknown rows and
CAS/no destructive replacement. Authored opt-in disposable-DB cases cover legacy
away/back edits, same-ID recreation, root edits, family/statement constraints,
member/profile retirement, target cascade, pre-metadata role changes and counter
saturation. They require the fixture target guard and already-applied migration;
none was run. Fakes do not prove FK, locking, migration or actual retirement.

No Prisma generation/validation, migration, SQL/DB/API invocation, unit/types/lint/
build, browser/native/provider/CI, push/merge/deploy or flag activation occurred.
Old generated overlays remain unchanged. Before later activation, validate the
Prisma/DDL mapping, repeatable protected migration/restore and old/new client
compatibility, SQL lock graph, FK/trigger constraints/erasure and source identity.
Required next code remains fresh-authority person API/atomic receipts/owned recovery,
full compact EN/ES domain controls and weekly-summary integration. Full #123 and
repository scope is active; storage source is not verified feature delivery.


## Authenticated API and owned request source — 2026-10-20

Person-only `/api/coordination/responsibilities` GET/PATCH now has source. The
private FAMILY_RESPONSIBILITY_READY flag is new and defaults off; no flag was changed; writes also
preserve existing queue-recovery enable/rollback gates and require an exact
session/role/generation/household-scoped owner header plus Idempotency-Key. The
normal authenticateWithFamily boundary refuses paired devices. Queries/bodies
are strict and bounded; responses are private/no-store and names are bounded.
No family preference, assignment, external invitation or provider is activated.

The runtime renews actor role/token/family under actor then household locks,
preflights current identity references without a state lock, locks related
account/profile identities in stable order before family/target/root/state,
renews permissions/source/relationships and refuses an identity discovered outside
that locked set. Parent-only configuration is refused before private reference
retrieval. Chore reads for teens/children require their account as primary or
backup; handoff context remains parent/teen only; feature-off/archived/erased/
unknown/inactive/profile-rollback cases remain distinct holds. Chore subjects use
the canonical validator and same-household locked identity projections, never
foreign related names or profile-as-actor authority. Parent-recorded provenance
requires a current parent account. Existing profile recurrence action pauses
remain enforced. Handoff coordinator is still separate from sitter_name.

The read DTO contains only target title/link, current safe names/slot statements,
source/revision and role-appropriate controls. Parent configuration choices are
bounded to 50 with explicit more and name search; an existing chosen identity is
resolved separately from that cap. Children/teens receive no household directory.
No notes, addresses, ages, email, share/provider/session secrets or arbitrary
stored state are copied to a client/provider. Closed records may be read but
cannot receive a new statement. Assignment/completion still use canonical routes.

The write service applies the pure planner, FK/CAS metadata effect and a minimal
receipt in one transaction. It checks exact user/key/family/action/body hash and
completed receipt before takeover can reapply an effect. Receipts carry only
original actor/target/key/action/source/revision, not a privileged target DTO or
names. Replays renew current person authority and validate proof shape/binding.
A receipt proves that an earlier request committed, not that current work remains
accepted; current target state always requires a fresh role-safe read.

Recovery GET/POST remains read-only during a write pause. Committed own receipts
can be inspected after target/role/age changes without returning old target data.
Unconfirmed requests require fresh target/identity/source/revision/intent age and
planner validity before a retry is offered; no unavailable transaction is turned
into empty success. The separate owner-bound journal reuses physical-store
probes, Web Locks, account/household/generation retirement and exact transition
repair. It retains up to ten distinct immutable requests, has no unowned fallback,
and never sends on initialize/read/focus/locale. A recovered retry needs explicit
inspection and preserves original body/key; malformed acknowledgements remain
unknown. The UI must still stage before send, guard closing/lifecycle, distinguish
stage versus dismissal storage repair and reload current state after proof.

Authored source cases cover stale/foreign/current-role authority, identity lock
ordering and changed relationship holds, own named-backup scope, private child
handoff/directory exclusion, minimal effect/receipt layering, completed takeover,
receipt write failure, original body/key and malformed/mismatched ack, expired/
paused recovery and prior own proof without stale target context. All unrun;
fakes do not prove Postgres transaction/trigger/lock behavior. No tests/types/lint/
build, Prisma/schema/migration/SQL/DB/app-API, provider/browser/native/CI, push,
merge, deployment or flag activation occurred. No live data was changed.

Required next code is the complete compact EN/ES canonical owner/statement/backup/
coordinator UI, exact pending-request lifecycle and storage repair presentation,
and weekly-reset integration using the same safe projection. The API/journal is
not a substitute for those screens. Full migration/client/FK/concurrency/receipt/
role/storage/export/erasure/rendered/native acceptance remains in the later
consolidated pass; broader #123/#144 and repository scope stays active.


## Canonical controls and weekly-review integration source — 2026-10-20

`ResponsibilityProvider` is a gate/role-only layout boundary. It lazy-loads the
short EN/ES `ResponsibilitySheet` from canonical occurrence, pickup, handoff and
personal Today entry points. Query fields preserve the containing weekly review;
normal Back closes an owned opening, while direct URLs remove only this sheet's
fields. The provider receives no family/user owner context; opening explicitly
fetches that context. Fridge mode and child handoff controls are hidden. No
household directory is seeded into page props. Server authority remains decisive.

The sheet projects primary/coordinator and backup independently, explicit
awaiting/accepted/declined and self/parent-recorded provenance including account
and timestamp. A parent can record only an eligible profile answer, never another
account's self statement. Choosing/removing a backup or coordinator and clearing
an answer have explicit previews. Search is bounded and eligible through the
same server API; selected references never confer authority. Naming does not
reassign canonical ownership, activate a backup, complete a task or send a
notification. External sitter identity is not a household coordinator.

The owned journal is initialized before the current target read. Thus a missing/
forbidden target can still leave its original request inspectable without
returning target content. Each new command is staged before send, retaining its
exact body/key on malformed/unknown/refused results. Closing marks the operation
inactive synchronously before router navigation, including while stage awaits
storage. Already-started sends stay journaled. No mount/focus/locale read sends.
Inspection is explicit; only a valid receipt permits local dismissal, and a fresh
read supplies current statements. Requests for other targets have an explicit
open action, not inferred target names. Forgetting requires confirmation and
never undoes a server change. Uncertain storage tracks stage versus dismissal,
so recovering an empty deletion cannot resurrect stale memory. Owner changes
hold controls and clear the prior owner's projections; no unowned fallback.

Weekly-reset rows receive canonical target references only under the readiness
gate. At most three visible records per group (nine total) instantiate small
read-only projections, each in its own existing authorized transaction. The
weekly-summary transaction never recursively acquires new target/identity locks.
Preview labels identify a checked snapshot, not send authority. Editing unmounts
previews; returning loads afresh. Child handoff rows have no new target reference.
Flag-off summaries keep acceptance/backup unknown. Weekly review marks remain
personal progress only. Installed older strict clients may hold on an unfamiliar
flag-on summary; rollout compatibility remains a later gate, with readiness off.

Authored source cases cover parent-recorded preview/stage/send ordering, another
account's self-only restriction, closing before navigation during staging,
deleted-target recovery, no automatic resend, expired retry refusal, uncertain
local-deletion repair without resurrection, shared-mode/child/flag hiding and
Back/direct URL preservation. These cases have not been executed. Formatter
output is not QA. Real DB migration/trigger/lock/FK checks, type/build/tests,
rendered EN/ES/role/long-text/a11y/viewport flows, cross-tab/storage/session/native
lifecycle and release acceptance remain for the consolidated pass. No flags,
live data, providers, messages, push/merge/deploy or production changed.

The required responsibility/backup journey now has source across schema,
lifecycle, planner, API, owned recovery, canonical controls and weekly review.
It is not verified or closed. Continue the remaining #123 coordination workflows
(conflicts, event preparation, unified review inbox, what changed and grounded
planning) and #144 quality/telemetry; the broader repository goal remains active.
