# Existing canonical chore assignment compatibility (#480)

This continuation handles maintenance of existing reconciled chores. It does not run reconciliation, enable name-only assignment, change capability version or activate profile-only chore writers. The [fixture rehearsal](chore-member-subject-rehearsal.md) remains the schema/recovery contract.

`canonicalChoreAssigneeInTx` acquires/reuses the household lock (callers needing account locks take those first). It requires a current same-household User and exactly one explicit mapped/linked HouseholdMember with no other account mapping/link, no archive and no erasure owner. Names/emails are not identity evidence. Missing or conflicting reconciliation is refused; no profile is created or adopted.

## Implemented paths

- Member removal reassigns both IDs for open canonical chores inside its existing account-then-household transaction. Missing parent reconciliation returns identity conflict and rolls the entire removal back. Legacy-only rows, including sticky erased subjects, retain the existing legacy-only handover policy.
- Rotation removal changes both IDs for open canonical templates. Completed/verified/approved canonical templates retain their recorded subject while the rotation shrinks. Existing legacy-only rotation behavior is retained.
- Manual canonical PATCH reassignment locks, rereads current caller role/ownership and updates both IDs.
- Rotation edits validate current rotation membership under the household lock and update both IDs for canonical pending future copies. Started, completed and manually selected copies remain under the existing rotation policy.
- Reject/reopen locks before rereading the row within its household. When a canonical completed chore is reassigned to the rejecting parent, both IDs change together. Undo without a replacement also requires the recorded canonical subject to remain active. Personal edit/Undo/reject and device Undo return explicit 409 identity conflicts; device responses retain the standard nested error envelope and no-store policy. Status/retry and successor deletion still use the existing conditional transaction.

Occurrence history and earned credit are not transferred. The existing removal privacy policy still clears nullable account actor references such as `ChoreAssignment.completed_by`; this continuation retains that policy rather than claiming those account references stay populated. Canonical completed subject and `xp_awarded` remain intact. Archive is not permanent erasure.

## Creation and recurrence compatibility

- `POST /api/chores/create` resolves current explicit mapped/linked subjects under its existing account-then-household lock. Active unmigrated accounts retain legacy-only writes. AI continues using this endpoint.
- `expandSeriesInTx` locks before reading the template, resolves both IDs for each eligible participant and preserves weekday/window/idempotency rules. Archived or departed participants receive no new occurrences. If none remain, history stays and generation stops. Contradictory identities or missing required canonical reconciliation roll back generation.
- `completeChore` rereads the household-scoped chore under lock before conditional completion. Legacy successors preserve the current canonical subject; series successors use the same eligibility rules. Personal and device completion return 409 identity conflicts, matching other chore actions.
- Chore Champs imports require a fresh parent actor and current same-household membership for every supplied user mapping before recording a job, then revalidate before writing content. Each chore and assignment resolves its own explicit subject; mixed legacy-only and canonical historical assignments remain supported. Archived non-erased profiles are allowed only for historical records. Erasure-owned profiles are never adopted. Repeat imports reuse tracked content and preserve legacy actors, dates, statuses and credit.

## Remaining activation gates

The old required User fields still prevent profile-only chore creation. Read/device/AI identity protocols, installed-client recovery and compatible rollback must be accepted before activation. No production reconciliation is authorized by this continuation. Automatic generation currently stops quietly when nobody remains eligible; a visible paused-series state and reassignment recovery are still UX work. This source compatibility change is not the all-device or all-feature acceptance gate.

## Evidence

152 affected tests across nine suites passed, including 22 guarded PostgreSQL cases. They cover open handover, missing-parent rollback, rotation removal, completed template history, foreign/archive/erasure/conflicting-link refusal, pending future rotation edits and repeat reject after removal, archived-owner Undo refusal and an observed advisory-lock wait followed by fresh stale-participant refusal. Four route boundary cases verify explicit conflict responses without mutating work or device audit history. Full suite, typecheck, lint and build results are recorded in the PR and #480 execution comment. These are source/disposable database proofs; no browser, native hardware or production activation claim follows.

The writer continuation adds ten guarded PostgreSQL cases (32 total in the chore subject suite), covering explicit create resolution, unmigrated accounts, multiple weekdays, archived rotation eligibility, canonical reconciliation rollback, fresh completion snapshots, repeat imports, mixed assignment subjects, foreign unused mappings, parent-only imports and archived/erased history. Focused and full-suite results are recorded separately in its PR. No rendered journey or native-device claim follows from these database tests.
