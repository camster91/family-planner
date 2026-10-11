# Existing canonical chore assignment compatibility (#480)

This continuation handles maintenance of existing reconciled chores. It does not run reconciliation, enable name-only assignment, change capability version or complete all chore writers. The [fixture rehearsal](chore-member-subject-rehearsal.md) remains the schema/recovery contract.

`canonicalChoreAssigneeInTx` acquires/reuses the household lock (callers needing account locks take those first). It requires a current same-household User and exactly one explicit mapped/linked HouseholdMember with no other account mapping/link, no archive and no erasure owner. Names/emails are not identity evidence. Missing or conflicting reconciliation is refused; no profile is created or adopted.

## Implemented paths

- Member removal reassigns both IDs for open canonical chores inside its existing account-then-household transaction. Missing parent reconciliation returns identity conflict and rolls the entire removal back. Legacy-only rows, including sticky erased subjects, retain the existing legacy-only handover policy.
- Rotation removal changes both IDs for open canonical templates. Completed/verified/approved canonical templates retain their recorded subject while the rotation shrinks. Existing legacy-only rotation behavior is retained.
- Manual canonical PATCH reassignment locks, rereads current caller role/ownership and updates both IDs.
- Rotation edits validate current rotation membership under the household lock and update both IDs for canonical pending future copies. Started, completed and manually selected copies remain under the existing rotation policy.
- Reject/reopen locks before rereading the row within its household. When a canonical completed chore is reassigned to the rejecting parent, both IDs change together. Undo without a replacement also requires the recorded canonical subject to remain active. Personal edit/Undo/reject and device Undo return explicit 409 identity conflicts; device responses retain the standard nested error envelope and no-store policy. Status/retry and successor deletion still use the existing conditional transaction.

Occurrence history and earned credit are not transferred. The existing removal privacy policy still clears nullable account actor references such as `ChoreAssignment.completed_by`; this continuation retains that policy rather than claiming those account references stay populated. Canonical completed subject and `xp_awarded` remain intact. Archive is not permanent erasure.

## Remaining writers before activation

| Path                             | Current remaining work                                                                                           |
| -------------------------------- | ---------------------------------------------------------------------------------------------------------------- |
| `POST /api/chores/create`        | Canonical create and new series initialization                                                                   |
| `expandSeriesInTx`               | Canonical occurrence generation and active assignee resolution, including rotated/removed members                |
| `completeChore` legacy successor | Preserve canonical subject in generated successors with active eligibility                                       |
| Chore Champs import              | Chore and assignment canonical subjects, historical actor/credit compatibility                                   |
| Read/device/AI paths             | Identity and client compatibility after writer conversion; AI uses canonical create rather than a separate store |

A completed canonical rotation template with no remaining participant must not generate new work for its archived owner. Recurrence eligibility/recovery is still an activation gate. The old required User fields, profile-only erasure ledger, unsupported installed-client operations and compatible rollback gates remain open. No production reconciliation is authorized by this continuation.

## Evidence

152 affected tests across nine suites passed, including 22 guarded PostgreSQL cases. They cover open handover, missing-parent rollback, rotation removal, completed template history, foreign/archive/erasure/conflicting-link refusal, pending future rotation edits and repeat reject after removal, archived-owner Undo refusal and an observed advisory-lock wait followed by fresh stale-participant refusal. Four route boundary cases verify explicit conflict responses without mutating work or device audit history. Full suite, typecheck, lint and build results are recorded in the PR and #480 execution comment. These are source/disposable database proofs; no browser, native hardware or production activation claim follows.
