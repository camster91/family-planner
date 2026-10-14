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

## Explicit remaining work

This edits one dated occurrence. New profile steps are one-time chores. Profile
recurrence, rotation, future-series editing, account conversion, the wider member
relation migration and native installed-client/hardware acceptance remain under
#480/#473. Existing account recurrence is unchanged. A source deployment does not
activate name-only profile setup or profile chores: production flags stay off.

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
