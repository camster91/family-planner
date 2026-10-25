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
