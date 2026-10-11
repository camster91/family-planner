# Dormant chore member subjects (#480)

This expansion adds nullable, household-scoped `assigned_member_id` to Chore and ChoreAssignment while retaining required legacy `assigned_to` and all recorded actors. Startup applies `migration-z-household-member-chore-subjects.sql` after the member foundation; it does not run reconciliation. Existing application writers remain legacy-only. No profile-only assignment, new client protocol, capability version or production backfill is enabled.

## Fixture rehearsal

Run on Node 22 with the existing guarded disposable fixture environment:

```sh
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rehearse-chore-members.mjs --family fx_family_a
node --experimental-strip-types --disable-warning=MODULE_TYPELESS_PACKAGE_JSON scripts/rehearse-chore-members.mjs --family fx_family_a --apply
```

Default dry run rolls back. Apply validates every row before writing, locks the family and subjects, and fills only absent references from explicit same-household legacy mappings. Conflicting ownership, unmanaged mappings and nonfixture rows are refused. Repeated runs preserve existing ownership and skip erased subjects. The CLI guards the target before connecting, has no production override, and prints counts or fixed error codes. Its library requires an idle client and a caller-enforced target guard.

The database checks account/member agreement on ownership changes. Unchanged historical ownership remains writable after archive or detachment. Historical reconciliation intentionally permits archived mapped profiles with no erasure owner; this is not eligibility for new assignments. A canonical reference cannot be silently cleared. Explicit account erasure clears it and sets a sticky `member_subject_erased` tombstone before deleting the copied profile. Reconciliation cannot restore that identity. Existing legacy account-deletion policy still governs legacy actors, credits and retained history; this expansion does not transfer XP or establish complete member-only erasure.

Whole-household application deletion removes assignments and chores before profiles. Direct Family cascade deletion also passes with canonical rows present. Standalone profile deletion with retained canonical history is refused by the new NO ACTION foreign keys. The independent HouseholdMember subject inventory classifies four owning relations; the existing 67 User relation inventory remains intact.

## Verification and activation gates

72 affected checks passed in five suites, including eleven guarded PostgreSQL cases: repeated SQL, CLI dry run, repeat reconciliation, missing/foreign mapping refusal, account/subject mismatch, archive history, sticky erasure, account deletion, ordered household deletion, direct family cascade isolation and injected transactional rollback. The actual sorted startup migration, Prisma generation, typecheck, lint and webpack build passed. Full unit testing passed 4,958 tests with 241 skipped and the three existing macOS backup-prune failures. No browser or native runtime claim is made for this dormant slice.

Independent review found no blocker for dormant expansion, but these gates remain before any production reconciliation or canonical writers:

- Member removal currently changes legacy assignees after archiving/detaching copied profiles. It must atomically reassign both IDs, including pending chores and rotation templates; otherwise the consistency guard refuses the transition.
- Recurring expansion, rotation edits and imports currently write legacy IDs only. Complete dual writes and readers, preserving completion actors, credits, dates, retry behavior and old queued operation semantics.
- New canonical assignments must require an active eligible profile. Historical reconciliation and unchanged historical rows need a separate policy from new assignment eligibility.
- Complete the full member-domain erasure ledger, previous-client/server recovery and capability acceptance before name-only members can receive work.

## Recovery

For dormant deployment rollback, retain additive schema and revert consumers while no canonical references have been written. After any reconciliation, an account-only server's legacy reassignment/removal paths are not a safe rollback: they may fail the consistency guard. Keep a compatible lifecycle/dual-write server and a verified backup. Do not drop constraints, clear canonical references or reset tombstones to make rollback appear successful. Older server removal after reconciliation remains unverified and blocked. Production activation and native/store/customer validation remain separate from these fixture checks.
