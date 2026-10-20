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

## Persistence and concurrency (required next slice)

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
