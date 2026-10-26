# Email-free current-occurrence routines (#480)

## Scope and design

Extend the existing [rounded routine editor spec](routine-stack-editor-ui.md) and
[all-age routine model](../product/ROUTINE_STACKS.md) to active name-only household
members. A parent can add picture chores, collect existing one-off chores into a
routine, add new one-off steps, reorder, save and reopen the same dated stack.
The person remains a HouseholdMember; no email, User, password, invitation or
account token is created. The original phone, portrait tablet, fridge and desktop
layout, draft recovery, cancel confirmation and keyboard controls remain shared.

Account options and profile options have distinct identities. Profile assignments
persist `assigned_to: null` and the original `assigned_member_id`; the editor's
namespaced selection key never becomes an account ID. Labels are presentation,
not stack identity. Stack IDs and member IDs preserve attribution and history.

## Compatibility and privacy

Profile catalog/read/write require `X-Member-Protocol: 2` and both existing
`HOUSEHOLD_PROFILE_CHORE_ENABLED` and `HOUSEHOLD_PROFILE_CHORE_ROLLBACK_READY`
acknowledgements. Legacy account-only payloads and the public member-protocol-1
manifest remain unchanged. Foreign, archived, erased, mapped or linked profiles
cannot receive new steps. Writes recheck eligibility under the household lock;
optimistic fingerprints and atomic idempotency receipts retain retry behavior.
Shared device selection remains attribution, never parent authentication or
permission elevation. Existing permitted device completion and parent verification
remain canonical. No profile XP, notifications, rewards or account-link conversion
is inferred from this slice.

The recurring profile extension has a third private release gate:
`HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED=1`. The profile-list response exposes
`profileChoreRecurrenceSupported: true` only when all three gates are enabled;
the public capability manifest remains unchanged. Turning this gate off retains
one-off profile work but refuses new repeating profile writes before idempotency
receipt replay, stops future expansion, and retains pending recurring work for
refresh/recovery. The gate is also required to complete, undo or verify an
existing repeated profile occurrence so a rollback cannot mutate one occurrence
while silently disabling the next one.

Readers use the same per-row `actionAvailability` projection on the chores API,
person Today board and shared-device Today board. A readable recurring profile
row remains paired with its real `subject`, name and status/history, but when
the recurrence gate is off it carries a paused state with reason
`RECURRENCE_CAPABILITY_UNAVAILABLE`, recovery `refresh-and-retain-pending`,
`requiresCompatibleClient: true`, and `complete`, `undo`, `verify` and `reject`
actions set to false. Clients must hide or disable those actions and preserve
the row. One-off profile rows carry the active action state, and account rows
keep their existing shape. Protocol-1 readers still receive the stable
compatibility refusal before rendering a profile row, so an older client cannot
silently treat paused recurring work as active. A rollback never assigns a
profile chore to an account or marks it complete.

The protocol boundary has two separate signals. Profile chore writes keep the
JSON body `{ "protocol": 2, "selection": { "memberId": "..." } }`; the
`X-Member-Protocol: 2` header negotiates compatible readers and routine-stack
operations. The header does not replace the write body and the body does not
implicitly upgrade a reader.

## Explicit remaining work

This edits one dated occurrence. New profile steps are one-time chores. Profile
rotation, future-series editing, account conversion, the wider member relation
migration and native installed-client/hardware acceptance remain under #480/#473.
The recurring profile candidate is separately gated and still needs disposable
PostgreSQL replay, concurrency, monthly-anchor and rollback evidence before any
activation review. Existing account recurrence is unchanged. A source deployment
does not activate name-only profile setup or profile chores: all production flags,
including the recurrence gate, stay off.

## Acceptance and recovery

Required candidate proof includes strict type/lint/copy/format checks, the complete
unit and existing PostgreSQL gates, additional profile routine persistence/replay
negatives, and gated real profile/routine/device journeys on all six responsive
projects. Preserve existing ordinary browser/visual/accessibility/performance and
Android gates. Export source-labelled synthetic captures for independent review.
The normal reviewed-head and exact-main release gates, protected backup/isolated
restore and serving revision/health proof precede any completion claim.

No schema migration is introduced. Rollback can revert routine editor/metadata
support while retaining profile records, chore rows, stack IDs and completed
history. Gates must remain off until the separate full-domain compatibility and
activation decision is accepted. Never delete profile history during recovery.

## Rotation identity preflight and profile namespace boundary — 2026-10-25

#134/#450 source: applyRotationEditInTx now resolves each distinct required
canonical account/member mapping once, before any template/order/assignee write,
instead of repeating the same eligibility queries for every future occurrence.
The existing household lifecycle lock remains held. Targets are visited in
stable ID order; normal accepted rotation inputs contain at most8 participants.
Legacy account-only rows still receive account-only assignment updates, while
canonical rows receive the same resolved account/member pair. Missing/contradictory
identity rejects before any rotation effect. Existing turn sequence, pending/
manual-override filtering, history and clearing rules stay unchanged.

The future pending-row read and per-row updates remain unbounded total work;
this removes repeated identity queries, not all transaction cost or concurrency
proof. Existing canonical lifecycle locking is relied on, not newly expanded or
claimed verified. No schema, profile capability or account credit rule changes.
Three source cases cover24 turns/two identity resolutions, pre-effect refusal and
legacy-row preservation; all UNRUN. No QA/tests/checks/build/browser/CI/API/DB/
provider/push/merge/deploy ran. #134/#450/#480 remain open.

Current rotation_member_ids are User IDs: rotationMembersInHousehold queries the
User delegate, and profile actions explicitly refuse nonempty legacy rotations.
They must not be reinterpreted as HouseholdMember IDs because their strings look
similar. Profile rotation still requires additive/versioned storage and strict
capability/read/write/rollback handling with explicit active stable-member
eligibility. It is not delivered by this query optimization. The unanswered
standalone-unlink retention decision remains independent and unresolved.

## Stable-profile rotation proposal — 2026-10-25

`profile-rotation-v1.md` now specifies the current account-ID boundary, proposed
versioned stable-member definitions, canonical generation/edit/history, short
parent picker and strict rollback/role obligations. This is planning, not profile
rotation code. Profile points/reward ownership has been asked explicitly and is
unanswered; #557 former-login erasure/independent-profile retention is also still
pending. No schema, capability, permission, data, credit or activation changed.


## Account rotation removal pages — 2026-10-26 source only

`dropMemberFromRotationsInTx` now reads matching roots in stable-ID pages of100
rather than retaining the full household template list and all removal plans.
A read-only first pass collects distinct canonical replacement accounts, all
of which are resolved before any rotation effect. A second keyset pass applies
the existing turn-shift/removal/assignment rules to every matching root, counting
each changed root. Updating a root removes it from the `has` predicate, but the
next page advances by immutable ID rather than an offset, so later roots are
not intentionally skipped. Empty results return without a second scan.

The caller's existing household lifecycle lock and transaction span both passes.
A newly contradictory canonical replacement refuses instead of silently dropping
its member assignment; errors must propagate through that transaction. Completed
canonical history and legacy account-only assignments retain their prior rules.
Two fixture cases describe205 roots across both passes and a required replacement
on the final preflight page refusing before any effects. They are UNRUN.

This bounds query-page/template-plan retention, not total transaction duration,
total rows/series writes, distinct replacement-account memory or DB query cost.
The extra scan and real query/index/lock/rollback behavior are unmeasured. It does
not alter `applyRotationEditInTx`'s retained complete future plan, add profile
rotation, decide profile credits or activate any flag. No QA/tests/checks/build/
browser/DB/CI/push/merge/deploy ran. #134/#450/#480 remain open.


## Routine catalog profile eligibility projection — 2026-10-26 source only

The profile assignee module now owns one eligibility select and shared snapshot
check. Its canonical writer/top-up loader still queries the exact household
member and calls that same check. The routine schedule catalog fetches the
eligibility fields with its existing bounded profile list and applies the check
to those snapshots instead of making another findFirst call for each profile.
The catalog's existing parent/user/household lifecycle transaction remains the
authority boundary; a snapshot is not an actor, a write grant or a login.

ID/household, valid presentation role and age, active/non-erased state, absent
legacy/account associations and feature/recurrence gates retain their checks.
The internal eligibility fields are not spread into the assignment response;
only the prior name/role/subject/canRepeat DTO is returned. No flag is enabled,
profile linked, credit ownership decided or profile rotation introduced.

Three source cases describe200 profile choices without per-profile rereads or
private eligibility fields in output, exclusion of ineligible loaded snapshots,
and disabled rollout avoiding profile reads. They are UNRUN. The1000 combined
assignment cap is unchanged. Account-member eligibility queries, relation/query
plans, synchronization through all lifecycle writers, actual latency and full
role/native/rollback acceptance remain separate. No QA/tests/checks/build/browser/
DB/generation/CI/push/merge/deploy or activation ran. #134/#450/#480 remain open.


## Routine catalog account eligibility batches — 2026-10-26 source only

The account side now calls `readChoreAssigneesInTx` in batches of100 distinct
User IDs, up to the catalog's1000 combined-choice boundary. It loads current
same-household accounts plus global mapping/link references for those IDs,
then the referenced household member states and global reverse associations.
Foreign or contradictory references are intentionally not hidden by a family
filter. Each choice is eligible, inactive or conflicted; the catalog preserves
its prior skip behavior without allowing one conflict to silently grant access.

Scalar writer/top-up lookup still queries its exact target. Shared reference
and projection functions keep its requireCanonical/historical behavior and
the batch reader's legacy/inactive/conflicting mapping behavior aligned. This
map is read-only eligibility under the existing household lifecycle transaction,
never an actor or a cached authorization grant to a writer. No profile namespace
conversion, credit/points decision or new flag is introduced.

Two source fixtures compare mixed scalar/batch outcomes (including foreign,
dual, reverse and missing mappings) and205 unique account choices over three
batches. They are UNRUN. Existing schema unique user/member association keys
are the expected reference-cardinality bound; actual deployed constraints,
SQL/query plans, all concurrent lifecycle writers, latency and rollback/native
acceptance have not been established. No schema/generation/DB/QA/tests/checks/
build/browser/CI/push/merge/deploy or activation ran. #134/#450/#480 remain open.


## Routine read original-principal renewal — 2026-10-26 source only

Catalog and full schedule readers copy/freeze their server-supplied actor at
entry and use that captured context for all household queries. They invoke the
existing routine authority check both before private work and after the final
DB/identity/root waits, before assembling a successful DTO. Parent role, original
token generation, household, chores feature and readiness refusal withhold the
loaded body. Current renewed gamification capability controls the catalog flag
and full-detail point fields rather than the initial capability snapshot.

Three catalog fixture cases describe late refusal without private choices,
latest capability projection and caller-object changes not rebinding queries.
They are UNRUN. The full-detail renewal is authored without a new runtime
result; actual database/role/concurrency acceptance remains open. Existing
transaction/lifecycle locks are retained, not newly certified. This is a final
point-in-time principal check, not response recall, original browser-session-ID
binding or serialization of every related person's later move. No schema,
profile policy, flag activation, QA/tests/checks/build/browser/DB/CI/push/merge/
deploy ran. #134/#450/#480/#136 remain open.
