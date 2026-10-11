# Copied household profiles: removal and permanent erasure (#480)

This extends existing account lifecycle operations for the dormant member tables. It does not activate name-only setup, backfill, assignments, linking or any shared-device grant. Existing account-owned data treatment in `account-deletion.ts`, `member-removal.ts` and `ACCOUNT_DELETION.md` remains the baseline. Full per-domain treatment of future member-subject/history columns remains required before those domains activate.

| Operation | Copied profile | Login account and authority |
| --- | --- | --- |
| Parent removes another account from household | Keep stable profile ID; archive it, retain display/history, remove active link and legacy mapping | Keep account, clear household, increment token version; preserve existing revocation and content handling |
| Account owner permanently deletes account | Explicitly erase exclusively associated copied profiles, including historic detached profiles | Preserve existing account/personal erasure and household handover; delete account |
| Sole parent deletes whole household | Explicitly delete links, mappings and profiles with household data | Preserve existing device/token revocation and account deletion |
| Name-only permanent member erasure | Not exposed by this slice; needs the member-domain ledger and parent-authorized canonical API | No login account may be invented |

## Private erasure provenance

Removal detaches composite membership references before clearing `User.family_id`. Detaching every reference would lose the connection needed when the account later deletes, leaving copied identifying profile data behind. An archived profile therefore records private `erasure_user_id` provenance. This is account erasure ownership only; it must never authenticate, authorize, appear in shared/member DTOs, grant private AI access, or imply current household membership.

The SQL trigger requires an archived profile and same-household account membership when that ownership is first established. Existing non-null ownership cannot be transferred or cleared. Moving the account to another household does not move the member or upgrade its archived state. Reactivation/conversion needs a reviewed ownership/erasure transition; this slice intentionally prevents clearing archive on an erasure-owned profile. The User foreign key cascades profile deletion as a database backstop, while the canonical account operation erases explicitly.

## Transaction and conflict contract

Removal uses existing actor/target account locks followed by the household lock. It validates exclusive same-household mapping/link identity, records archive/provenance/revision, deletes links/mapping, then clears account membership and revokes access in the same transaction. Previously archived profiles keep their archive time and record the erasure transition once. Retries after removal remain the existing member-not-found response; they cannot recreate a link.

Account erasure locks its account first, then its current and historic erasure households in sorted order. It refuses different current profile IDs, foreign current references, or another account's ownership/link to a selected profile with generic `409 IDENTITY_CONFLICT`, before changes or provider effects. Historic provenance is distinct from current membership; after valid removal/rejoin, both the current copied profile and prior archived profiles can be erased. A name-only/unrelated profile is not selected merely because it shares a name or household. No credentials, completed credit or subject records are transferred to a parent by this profile helper.

All database changes roll back if account mutation fails. Existing provider revocation occurs after successful commit; no profile ID, name, email or secret is added to logs. Future linking, conversion, member-only writes and erasure must use these account/household locking and provenance rules rather than direct table edits.

## Verification and remaining activation gates

Disposable PostgreSQL checks cover current account erasure, removal with retained completed ownership, removed-then-unassigned/rejoined account erasure, preservation of unrelated and other-account profiles, previous archive date, contradictory identity refusal, injected rollback for removal/erasure and SQL provenance guards. Existing direct role/household removal and account-deletion suites remain required. The executable inventory now classifies 67 User relationships; this alone does not prove member-domain migration.

Before production backfill: validate all join/create/leave/link/erasure paths and queued replay; review future per-domain subject/history erasure; implement explicit verified linking and name-only erasure; cover current/previous installed clients and rollback. Removed profile reactivation and conflicting identity resolution are deliberately unavailable, requiring explicit reviewed flows rather than guessing ownership. Schema presence and these host tests do not establish member UX, production, physical-device or store readiness.

Recovery keeps the additive column and provenance records. Do not drop ownership or restore erased profiles. An older server cannot be used for profile writes/removal after mappings activate without the compatibility gate. Production mutation remains separately gated; the fixture rehearsal has no production override.
