# Email-free profiles: compatibility and domain activation plan

**Scope:** reopened #480, based on `5b996a5` (2026-10-11)
**Status:** planning only. This document does not activate a route, capability, schema writer, account link, backfill, native client, provider or production migration.

This plan adds no scheduler, cron job or background worker. Profile creation, reconciliation, assignment and recovery remain request-driven or explicitly operator-run fixture/release actions; any future scheduled work needs its own approved contract.

This plan turns the original #480 acceptance into a sequence that can be reviewed and released one boundary at a time. The current repository has the dormant `HouseholdMember`, legacy mapping and optional account-link tables, an internal `manageHouseholdProfile` command core, account/profile lifecycle handling, and a public capability manifest that advertises member protocol 1 only. None of those facts means that a parent can currently create a name-only profile in the app or assign work to one.

The governing contracts are [ADR-0009](../architecture/adr/0009-household-members-and-login-accounts.md), the [dormant foundation rehearsal](../architecture/member-foundation-rehearsal.md), the [profile command contract](../architecture/member-profile-commands.md), the [lifecycle contract](../architecture/member-lifecycle-compatibility.md), the [chore subject compatibility contract](../architecture/chore-member-subject-compatibility.md), [the typed actor/subject boundary](../../src/lib/member-subject-contract.ts), and [native/API compatibility](../architecture/NATIVE_API_COMPATIBILITY.md). The original acceptance remains the authority for outcome and evidence:

- A parent can add every family member by name, including a preschool child with no email or personal device.
- A name-only member can receive chores and routines, participate in permitted shared-tablet actions, and retain identity/history when an account is later linked.
- A member profile is separate from a login account. Selecting a profile never authenticates a person, elevates a parent, or opens private parent data.
- Existing account-linked members, assignments, completions, points, rewards, history and actor provenance survive migration and conversion.
- Old and new installed clients have an explicit capability, pending-work and rollback path.
- Two-household, direct-API, role, shared-device, replay, revocation and no-login/no-mail evidence is disposable and reproducible.
- Adaptive member UX is shown separately on phone, portrait tablet, fridge landscape and desktop, with draft recovery and Finish later.

## Current boundaries

The first implementation slice preserves the full all-age profile contract: a parent may create a name-only `child`, `teen` or `parent` presentation profile with optional age metadata. The role describes how the person is presented in household features; it is never a login role, permission grant, elevation credential or authenticated actor. The server derives the family and stable profile identity, validates role/age bounds, and rejects email, account, credentials, invitation and access-policy fields. A verified teen or parent login continues to be a normal `User` account.

`HouseholdMember` owns the stable household-person identity. `User` continues to own authentication, verified email, providers, sessions, token versions, push/delivery settings, elevation credentials and authenticated actor provenance. `HouseholdMemberLegacyMapping` is a deterministic compatibility mapping, not proof of an active link. `HouseholdMemberAccountLink` is reserved for a future owner-verified link flow. Names and email matches are never identity evidence.

The current `manageHouseholdProfile` core is deliberately internal. Before a route calls it, the route must establish a real personal session, use the existing parent authority boundary, recheck current membership/token state under the existing lock order, and return only the allowlisted profile DTO. A shared-device selected profile cannot be passed as the actor context.

The existing account-backed `GET /api/family/members` contract remains unchanged during migration, including its current `User`-based fields and email behavior for authenticated account members. It must not be widened by adding name-only profiles or by replacing User IDs in-place. Future name-only/profile listing uses a separate parent-scoped route and allowlisted `HouseholdMember` DTO; readers and clients must not conflate that DTO with the existing account-backed members response.

The current `/api/capabilities` manifest advertises member protocol `[1]` only. Protocol 1 means account-backed IDs and existing payloads. Protocol 2 means explicit `HouseholdMember` subjects and separate optional linked-account identity; it must not be advertised until the domain and recovery gates below are complete.

### Next bounded end-to-end slice

The smallest useful activation path is deliberately narrower than the full 64-relation migration while preserving the all-age contract:

`Add Everyone` → create one `HouseholdMember` profile → parent assigns one **one-off** chore → Today/fridge renders the profile subject → a paired device completes it → a real parent verifies it.

The profile API and onboarding route remain gated until this slice has its supported reader. The chore writer accepts either the existing account target or an explicit protocol-2 `memberId`; it does not overload `assigned_to` or `actingMemberId`. The first profile activation remains one-off (`frequency: "once"`); recurrence, rotation, imports, rewards and offline replay are not enabled by that gate. A separately prepared recurring profile candidate may use daily, selected-weekday weekly or monthly schedules only when the private `HOUSEHOLD_PROFILE_CHORE_RECURRENCE_ENABLED=1` opt-in is added to both existing profile gates. Without all three gates, repeat creation is refused before idempotency replay and pending repeated work is retained.

The source dependency map is:

| Boundary          | Existing source                                                                                                                | Required next contract                                                                                                                        | Explicitly deferred                                                     |
| ----------------- | ------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| Profile/setup     | `src/lib/household-profile-http.ts`, `src/lib/household-profile-management.ts`, `OnboardingFlow.tsx`, `family/invite/page.tsx` | all-age profile DTO/create/edit/archive, no-email setup, idempotent draft/retry and Finish later                                              | account linking, invitations and mail side effects                      |
| Chore subject     | `prisma/schema.prisma`, `src/lib/validations.ts`, `api/chores/create`, `chore-member-subject.ts`                               | nullable legacy account bridge plus active same-family `assigned_member_id`; exactly one account/profile subject; one-off profile create/read | recurring profile candidate behind its third private gate, rotation, imports, other 64 member relations                |
| Today/read        | `today-board-data.ts`, `board-snapshot.ts`, `components/fridge/board-model.ts`                                                 | typed account/profile subject DTO and no silent hiding; protocol-1 clients receive recoverable incompatibility                                | private/profile data outside the shared allowlist                       |
| Paired action     | `device-writes.ts`, `api/device/chores/[id]/complete`, `use-device-board-actions.tsx`                                          | protocol-2 `memberId`, separate device actor, active-profile check, structured member attribution                                             | profile offline queue and native/store claims                           |
| Completion/verify | `chore-complete.ts`, `api/chores/verify`, `device-audit.ts`                                                                    | actor and subject fields remain separate; parent verification works for all profile roles                                                     | User-only XP/streak/notification migration until member progress exists |
| Compatibility     | `api/capabilities/route.ts`, `api-capabilities.ts`, `offline-queue.ts`, `NATIVE_API_COMPATIBILITY.md`                          | advertise protocol 2 only with readers/writers; protocol-1 refusal/filter and forward rollback                                                | any new queued profile operation until quarantine/retention exists      |

The typed source boundary in `src/lib/member-subject-contract.ts` validates all three presentation roles, separates person/device credentials from account/profile subjects, rejects profile subjects under protocol 1, and preserves the exact legacy `actingMemberId` shape. It does not authorize a request or replace the existing database/family checks; route code must still resolve IDs under household locks.

## Activation sequence

### 0. Freeze the contract and inventory

Before changing a domain, record the exact source SHA, schema migration, capability manifest, client versions, fixture family IDs and current row snapshots. Keep the dormant foundation migrations additive and reversible. Add a release record for each domain that names its old payload, new payload, reader, writer, erasure rule, capability version, rollback candidate and two-household tests.

Do not make `User.email` nullable, generate a synthetic email, reuse `assigned_to` for two ID types, make required legacy owners nullable, or create a second roster. Do not expose protocol 2 while only a subset of readers has been migrated.

The existing schema inventory has **64 original explicit User-owned relationships**. The current checker has **67 rows** because the dormant foundation adds three account-owned provenance relationships: `HouseholdMember.erasure_account`, `HouseholdMemberLegacyMapping.user` and `HouseholdMemberAccountLink.user`. Inventory coverage is a prerequisite, not proof that a relationship is migrated.

### 1. Add canonical subjects without breaking account readers

For each member-owned relationship, add a nullable canonical member reference with a composite `(member_id, family_id)` foreign key and an index. Keep the existing `User` foreign key, requiredness and payload field while the compatibility window is open. A row for an existing account-backed person must carry both the legacy User ID and the mapped canonical member ID after reconciliation; this is additive dual representation, not an XOR.

For actor/member relationships, add a separate member attribution field while retaining the authenticated User actor. For actor-only and account-only relationships, retain the User relationship and do not replace it with a profile. Every new writer must populate the canonical field and the legacy field atomically when the member is linked/mapped; every reader must prefer the canonical subject for member presentation while preserving the User actor for authorization, audit and existing history.

The database guard must reject a foreign-household member, an archived/erasure-owned member for new work, a mapping/link that disagrees with the retained User, and a canonical field cleared without the explicit erasure policy. Backfill and runtime dual-write helpers must take the same account-then-household/common membership locks used by lifecycle operations.

### 2. Reconcile existing account-backed members

Use the fixture-only rehearsal pattern from [member-foundation-rehearsal.md](../architecture/member-foundation-rehearsal.md): target guard before connection, one disposable `fx_` household, dry-run rollback by default, explicit apply, fixed error codes/counts, and no names/emails in output. The mapping ID is deterministic from the household/account tuple. Rehearsal runs twice and must preserve profile edits, archive state, revisions and all legacy rows.

The reconciliation sequence is:

1. Lock the family and current household users in stable order.
2. Select only actual users whose `family_id` is that family. Do not infer people from names, email addresses, old invitations, audit text or foreign rows.
3. Create or verify one canonical member per mapped User, refusing duplicate, foreign, contradictory, archived-erasure or already-owned mappings.
4. Populate every migrated member subject alongside the existing User subject in one transaction.
5. Re-read and compare counts, family IDs, User IDs, member IDs, completion/approval actors, points, rewards, rotations, dates and statuses.
6. Commit only after the complete reconciliation report matches the expected fixture snapshot. A failure rolls back all rows in that transaction.

Unassigned accounts remain unassigned. The rehearsal never creates an active account link, invitation, notification, credential, session, provider connection or mail event. A mapping is not a verified account conversion.

### 3. Ship the parent profile API and onboarding slice

Expose a narrow route around the existing command core only after the domain compatibility slice has a supported reader and erasure rule. The first route contract is:

| Operation | Request                                                      | Result                                                      | Required rules                                                                                                                             |
| --------- | ------------------------------------------------------------ | ----------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| List      | authenticated parent, current family                         | separate allowlisted active/archived `HouseholdMember` DTOs | current family only; no email, token, link, mapping or erasure fields; preserve `GET /api/family/members` as the existing User/account DTO |
| Create    | name, presentation role, optional age, idempotency key       | stable all-age profile                                      | server-derived family; role/age bounds; no account, invite, password or email                                                              |
| Edit      | member ID, expected revision, name/role/age, idempotency key | revised profile                                             | active unlinked profile only; role remains presentation metadata; stale revision is a generic conflict                                     |
| Archive   | member ID, expected revision, idempotency key                | archived profile                                            | retain history; stop new assignment; no implicit unarchive or account removal                                                              |

The route must authenticate a real User, lock/re-read User then household, verify parent role and token version before effect and replay, scope every target by family, and commit the idempotency record with the effect. A repeated key returns the original allowlisted result; a changed body/action/family refuses reuse; an uncertain create is refreshed by stable identity rather than retried as a new person.

Onboarding then uses the route in a short adaptive sheet/detail pane:

- After family creation, show the signed-in parent separately and prompt **Add everyone**.
- Add a child, teen or parent presentation profile by name with no email field. Save one member, refresh the roster, and offer Add another, Continue to Today and explicit Finish later.
- Keep saved members when the next draft fails. Preserve unsaved draft/key on network, timeout, conflict and process-death recovery; clear it on logout, household switch or revocation.
- Keep Back, Close, keyboard dismissal and Android system Back deterministic. Saving disables duplicate submit and does not report success until the canonical response is committed.
- Use original adaptive evidence for 390x844 phone, 800x1280 portrait tablet, 1280x800 fridge landscape and desktop. Report keyboard/focus, long text, empty/loading/error/offline/conflict, screen reader, 44px targets and draft recovery separately from source checks.

The setup route must not call invitation, mail, account-link, role-elevation, shared-device or AI-private-context code as a side effect.

### 4. Complete domain readers and writers

Activate a domain only after its canonical subject, all writers/readers, role policy, archive eligibility, erasure treatment, old-client behavior and two-household negatives are complete. The order should minimize mixed states:

1. chores, assignments, all-age routines, recurrence and rotation;
2. completion, approval, points, streaks, badges, rewards and redemptions;
3. meal cooks, allowance recipients, projects/tasks and wishlist requesters;
4. pickup assignees, sick-day/medication/emergency subjects and other member-facing health/private boundaries;
5. shared-device attribution and selected-member DTOs;
6. search, notifications, AI context, export and remaining non-FK identity surfaces;
7. verified account linking/conversion and permanent member erasure.

The first chore/assignment compatibility slice already retains required `assigned_to`, uses nullable `assigned_member_id`, and keeps completed canonical subjects/earned credit. It is still not profile-only activation. Before enabling name-only work, finish create/edit/manual reassignment, recurring generation, rotation edits/removal, completion successors, imports, reopen/undo and all readers. New work must require an active same-household member; archived history can remain readable under a distinct historical policy.

No member-only writer may fall back to the logged-in parent, a matching User name, a matching email, or a stale cached snapshot. Missing/foreign/conflicting member identity is a recoverable conflict with no partial write. No operation may transfer completion, XP, streak, reward or redemption credit to a parent or successor.

## User relationship inventory and migration rules

The 64 original relationships below are the complete explicit User-FK surface in the reviewed inventory. Each must receive an owner, read/write plan and erasure decision before protocol 2 or production backfill. The current 67-row inventory additionally covers the three dormant foundation account provenance rows named above.

### Member subjects — add canonical member ownership

These relationships represent the household person receiving, owning or being described by the record. Retain the User column during compatibility; after reconciliation, linked existing people carry both fields.

| Relation                     | User field     | Domain work required                                 |
| ---------------------------- | -------------- | ---------------------------------------------------- |
| `Allowance.to_user`          | `to_user_id`   | recipient member, balance/history and erasure policy |
| `Anniversary.person`         | `person_id`    | person subject, reminders and archive behavior       |
| `Chore.assignee`             | `assigned_to`  | chore subject, recurrence and rotation               |
| `ChoreAssignment.assignee`   | `assigned_to`  | occurrence subject, completion/credit history        |
| `EarnedBadge.user`           | `user_id`      | badge subject, earned history and no credit transfer |
| `EmergencyContact.person`    | `person_id`    | member DTO/private boundary and erasure policy       |
| `FamilyMeal.cook`            | `cook_id`      | cook subject and meal history                        |
| `HabitLog.user`              | `user_id`      | habit subject, streak history and erasure policy     |
| `Medication.person`          | `person_id`    | private subject, role/privacy and erasure ledger     |
| `Pickup.assignee`            | `assigned_to`  | assignment, shared-device eligibility and history    |
| `ProjectTask.assignee`       | `assigned_to`  | task subject, role visibility and history            |
| `Reward.claimer`             | `claimed_by`   | claimant/history; never award successor credit       |
| `RewardRedemption.requester` | `requested_by` | requester/approval boundary and erasure              |
| `SickDay.person`             | `person_id`    | private subject, role/privacy and erasure ledger     |
| `WishlistItem.requester`     | `requested_by` | requester and child/parent presentation              |

### Actor plus member attribution — keep both identities

These records need a separate canonical subject/attribution field while retaining the real authenticated/device User actor. The actor proves who performed the action; the member field says for whom or under whose selected profile the allowed action was performed.

| Relation                    | User field     | Required separation                             |
| --------------------------- | -------------- | ----------------------------------------------- |
| `Activity.user`             | `user_id`      | actor/session versus member attribution         |
| `ChoreAssignment.completer` | `completed_by` | device/personal actor versus completed subject  |
| `Event.creator`             | `created_by`   | actor provenance versus optional member context |
| `ListItem.adder`            | `added_by`     | actor audit versus selected member context      |
| `ListItem.checker`          | `checked_by`   | actor audit versus member attribution           |

The existing removal policy may clear nullable account actor references under its privacy rules. That must not be described as reassigning the actor or transferring credit; the canonical member subject and non-identifying history follow the reviewed per-domain erasure decision.

### Authenticated actors — retain User ownership

These are provenance, creator, approver, sender, uploader or administrative actor fields. A name-only profile must not substitute for them or gain their authority.

`Allowance.from_user.from_user_id`; `Anniversary.creator.created_by`; `AuditLog.actor.actor_user_id`; `BudgetCategory.creator.created_by`; `CalendarSubscription.creator.created_by`; `Chore.creator.created_by`; `ChoreAssignment.approver.approved_by`; `DeviceAuditEvent.actor.actor_user_id`; `DevicePairing.creator.created_by`; `FamilyGoal.creator.created_by`; `FamilyInvite.creator.created_by`; `FamilyMeal.creator.created_by`; `GrocerySectionPreference.updater.updated_by`; `Habit.creator.created_by`; `Handoff.creator.created_by`; `HouseholdDevice.creator.created_by`; `ImportJob.starter.started_by`; `InventoryAdjustment.actor.actor_id`; `InventoryAdjustment.undoer.undone_by`; `InventoryItem.adder.added_by`; `List.creator.created_by`; `MealPlan.creator.created_by`; `Medication.creator.created_by`; `Message.sender.sender_id`; `Pickup.creator.created_by`; `PinnedNote.creator.created_by`; `Project.creator.created_by`; `Recipe.creator.created_by`; `Reward.approver.approved_by`; `Reward.creator.created_by`; `RewardRedemption.approver.approved_by`; `ShoppingList.creator.created_by`; `SickDay.creator.created_by`; `Upload.uploader.uploaded_by`; and `WishlistItem.status_changer.status_changed_by`.

Each actor field keeps its existing family and authorization checks. If a product later needs “created for member” or “approved for member,” add a separately named member attribution field rather than changing the actor column.

### Account-owned data — keep User identity and private scope

These relationships must remain tied to a real login account and must not be included in name-only/shared profile selection: `AppFeedback.user.user_id`, `CalendarConnection.user.user_id`, `CalendarOAuthState.user.user_id`, `FamilyLocation.user.user_id`, `IdempotencyRecord.user.user_id`, `Notification.user.user_id`, `ParentElevationPin.user.user_id`, `PushSubscription.user.user_id` and `Transaction.user.user_id`.

The current inventory's other three account rows are foundation provenance and are handled separately: `HouseholdMember.erasure_account.erasure_user_id`, `HouseholdMemberLegacyMapping.user.(user_id,family_id)` and `HouseholdMemberAccountLink.user.(user_id,family_id)`. Mapping/link rows never become shared DTOs, login credentials, AI context or elevation proof.

### Non-FK identity surfaces

Before activation, audit and test the identities that the FK checker cannot cover:

- `User.xp`, level, streak and `last_chore_date`, board colors and any user-keyed gamification aggregates;
- `Chore.rotation_member_ids`, routine/step ownership and all recurrence/rotation templates;
- `Message.read_by`, notification recipient arrays, search result/member DTOs and export payloads;
- `HouseholdDevice.elevated_user_id`, device `actingMemberId`, selected-member state and audit records;
- session/token/elevation caches, local storage/IndexedDB queue keys, serialized old receipts and request hashes;
- AI context selection, prompt payloads, assistant action scopes and feature/private data filters;
- setup/member list DTOs, invitation state, account conversion state and deletion/revocation state.

Every item needs an explicit classification: account actor, member subject, member attribution, household-owned content, private account data or derived aggregate. A source field name or UI label is not migration evidence.

## Account linking and conversion

Linking is a separate parent-managed flow after the member and domain compatibility work. It must be verified by the intended account owner through a fresh authenticated personal session or an equivalent reviewed proof. A parent selecting a profile, possessing a name/email match, or holding a shared-device elevation is not proof of ownership.

The transaction contract is:

1. Lock the acting parent/account membership and the target member/account rows in the documented stable order.
2. Re-read both current household memberships, token versions, archive/erasure state, existing mapping/link rows and role/account status.
3. Require one target member in the same family and one intended real User account; reject foreign, archived, erasure-owned, already-linked, multiply-mapped or contradictory rows with a generic conflict before effects.
4. Record the verified link and revision atomically, preserving the member ID. Do not rewrite assignments/history, invent a User, change the account role, copy credentials, or send an automatic invitation.
5. Reconcile all dual subject fields under the same transaction and publish only the allowlisted linked-account state. The link itself never grants a parent role or makes a name-only profile a login.

Conversion tests must cover: name-only profile to an existing account with a compatible presentation role; existing mapped account to verified link; duplicate display names; wrong-account proof; foreign household; link already used by another member; member already linked; archived and erasure-owned profiles; account leaves/rejoins during conversion; stale token/revision; changed idempotency body; uncertain response replay; and provider/mail/notification counts unchanged unless the user explicitly starts a separate invitation flow.

Unlinking removes active access/link state under fresh authority and leaves the stable member identity and allowed history according to the domain ledger. It does not resurrect archived or erased identity, delete the login account, transfer work to the parent or silently revert canonical IDs to a different person. Rejoining an account must not adopt a same-name profile; it requires explicit reviewed conversion.

## Shared-device and AI contract

The paired fridge/tablet remains an authorized device session with its own household/device scope. A selected member is attribution for an allowlisted action, never a login principal. The protocol-2 device DTO must use an explicit `memberId` (or a similarly unambiguous member field) and must never overload legacy `actingMemberId`/User IDs. The server records the real device/session actor separately.

Allowed shared actions must be enumerated per domain. A selected profile of any presentation role can be eligible for permitted chores, routines or other explicitly shared operations without seeing parent finance, addresses, messages, medical data, account settings, tokens or provider connections. Profile role never grants parent routes or PIN/elevation authority. Device revoke, expired sessions, stale selected-member IDs and household switching must clear selection and refuse writes safely.

The family AI follows the same broker boundary. It may use selected-member context only from an allowlisted, sanitized DTO and only for an action the current personal/device role may perform. A profile selection cannot unlock private AI retrieval. AI writes use the same canonical routes, idempotency, conflict and member eligibility checks as the visible UI; no provider call receives raw private fields merely because a member was selected. Wake/voice commands are a later client surface and do not create an alternate authorization path.

## Client and server compatibility

Protocol negotiation must be operational, not metadata-only:

| Client/server state                                               | Required behavior                                                                                                                                                                     |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Existing web/native client, protocol 1                            | Continue account-backed reads/writes and existing payloads; no profile-only data is silently hidden or reassigned.                                                                    |
| New client, server protocol 1 only                                | Keep setup/assignment controls unavailable or use a clearly recoverable update/browser path; never send member IDs into legacy fields.                                                |
| New client and server protocol 2                                  | Use explicit member IDs, canonical readers/writers, profile eligibility and member-aware erasure rules.                                                                               |
| Missing/old `/api/capabilities`, invalid JSON or unknown manifest | Treat support as unknown; retain pending work and original key/body, refresh/recover, and do not interpret the state as permission to write.                                          |
| Old pending operation on new server                               | Parse and execute its original protocol-1 payload/hash/idempotency semantics; never rewrite it to a profile operation.                                                                |
| New pending member operation on old server/client                 | Do not persist it until the queue parser can quarantine/retain unknown versions. Offer update/browser recovery; never drop, hide, replay as User or auto-retry indefinitely.          |
| Server rollback before protocol-2 writes                          | Disable protocol-2 entry points, retain additive schema, and continue protocol 1.                                                                                                     |
| Server rollback after protocol-2 records exist                    | Do not return to an account-only server that ignores member rows. Keep a compatible reader/dual-write server, or stop writes and recover forward from the preserved candidate/backup. |

The existing queue parser currently drops unfamiliar container/action versions. That is a hard dependency: implement and test quarantine/retention before adding a profile operation or bumping a queue version. Preserve exact old key, body and request hash through network loss, process death, capability refresh, logout/revocation and retry. The live Capacitor shell loads the server, so web/API compatibility reaches installed clients without an APK update; native version/build evidence and real-device lifecycle evidence remain separate gates.

No minimum native version is raised by this plan. A new binary is required only for a native capability, permission or lifecycle change. Test current and previous supported Android shell versions, phone browser, portrait tablet, fridge landscape, desktop and process-death/revocation paths before claiming a release window.

## Archive, erasure and rollback

Archive is reversible only through a separately reviewed operation, retains member/history identity, and prevents new assignments and recurring generation. Existing unfinished work stays visible as needing reassignment/skip; it is never auto-completed or credited. Historical completed/verified/approved subject and credit remain governed by the domain policy.

Permanent name-only member erasure is a separate parent-authorized canonical operation. Before activation, create a per-domain ledger for every member subject, attribution, non-FK identity, mapping/link row, queue receipt, cache and DTO. Each row must say whether erasure clears, redacts, anonymizes or retains non-identifying history. It must never transfer earned credit, resurrect an erased member through backfill/replay/rollback, or leave a private profile undeletable because it has no login.

Account deletion and member removal keep their current contract: removal archives exclusively associated copied profiles and detaches active mapping/link access; account deletion erases current and historic profiles owned by that account under the lifecycle provenance rules; whole-household deletion removes links, mappings and profiles in child-before-parent order. A link, mapping or `erasure_user_id` is never an authorization grant. Provider revocation remains after the account transaction commits.

Rollback evidence must include:

- migration apply, retry, failure and backup/restore on disposable PostgreSQL;
- pre-backfill rollback with empty additive tables;
- post-mapping rollback with legacy readers/writers and unchanged actor/completion snapshots;
- post-dual-write rollback with canonical rows retained and no old server allowed to hide them;
- queued protocol-1 and protocol-2 operations across lost responses, process death, logout, revoke and capability failure;
- archive, unlink, account removal/rejoin and permanent erasure replayed after rollback;
- two households proving no cross-family member, link, assignment, notification, AI context or private DTO crosses the boundary.

Never drop constraints, clear canonical references, reset tombstones, manufacture Users or delete additive records merely to make a rollback appear green. A rollback is a compatible server/client recovery, not a return to an account-only interpretation of member-owned data.

## Verification matrix and release gates

The following evidence is required before enabling each boundary. All tests use guarded fabricated households and separate disposable data; no production family, provider, mail recipient or real account is used.

| Gate               | Required proof                                                                                                                      | Exit condition                                                                                |
| ------------------ | ----------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------- |
| Contract/schema    | Prisma/custom migration, composite family FKs, sorted startup, inventory checker, deferred deletion behavior, repeat apply          | No missing/duplicate/stale relation; old columns and 64 baseline decisions unchanged          |
| Rehearsal/backfill | dry run, apply, rerun, mismatch/foreign/unassigned refusal, atomic rollback, unchanged legacy snapshot                              | Counts and IDs deterministic; no account/link/mail/notification side effects                  |
| Profile API        | parent create/list/edit/archive, strict body, idempotent replay, stale token/revision, two-household and teen/child/paired denial   | Route returns only safe DTOs and never grants or creates login authority                      |
| Domain subjects    | every member relation above, all writers/readers, recurrence/rotation/import/completion/history, active/archive/erasure states      | Both legacy and canonical subjects agree; no credit/actor transfer or mixed-family row        |
| Account conversion | owner proof, link/unlink, wrong/foreign/conflict/duplicate/rejoin, stable member/history and retries                                | Account role/session/credentials stay intact; mapping/link state is explicit and atomic       |
| Shared device      | selected child/parent attribution, allowed action matrix, stale/revoked device, parent elevation, private route/DTO/AI negatives    | Selection is attribution only; no parent/private access or hidden writes                      |
| Client recovery    | previous/current web/native clients, missing/unknown manifest, old queue replay, new queue quarantine, server forward/rollback      | No pending work is dropped, rewritten or silently hidden                                      |
| UX/native          | adaptive Figma/spec, phone/tablet/fridge/desktop, keyboard/Back/focus/draft/offline/conflict/Finish later, process death and revoke | Rendered and physical evidence is labeled by surface; no source-only claim substitutes for it |
| Release            | exact SHA/schema/build identity, backup/restore, normal protected CI/review, security/privacy checks                                | Cameron separately approves migration, merge, deployment, signing/store and customer use      |

### Role and household matrix

Run each API/domain case for parent, teen, child, anonymous/no session, paired device and revoked/expired device, against household A and household B:

- parent A can manage profiles in A, never B;
- teen/child cannot call parent profile management, link, erase, finance/account/private routes or elevation controls;
- a selected child on a paired A device can perform only the explicitly allowlisted shared action in A;
- a selected parent cannot gain parent authority from the picker;
- every foreign ID, family mismatch, stale token, archived/erasure-owned subject and contradictory mapping fails without a write;
- AI/context/search/notification/export DTOs contain only the allowlisted fields for the current role and device.

Record direct API response/status, database snapshot before/after, notification/mail/provider counts, queue contents, actor/provenance rows, and cleanup result for each negative. Browser screenshots, host builds, native/device runs, deployment and customer validation are separate evidence classes.

## Work packages and stop conditions

1. **Compatibility foundation:** finish the 64-row member/actor/account treatment and non-FK ledger; add per-domain owners and erasure decisions. Stop if any relation lacks a canonical field, actor policy or rollback rule.
2. **Account-backed dual representation:** complete one domain at a time, beginning with chores/routines/rotation/points, while retaining required User fields. Stop if any writer can create mixed IDs or any old reader can hide canonical history.
3. **Profile route/setup:** expose the reviewed all-age route and adaptive setup UX after package 2 has the necessary member DTO/eligibility contract. Stop on any credential/mail/link side effect, foreign-family response, duplicate retry or lost draft.
4. **Shared attribution/client protocol:** implement protocol 2 only after queue quarantine and old-client/server evidence. Stop if a selected profile affects authentication, private AI data, parent routes or elevation.
5. **Conversion and erasure:** implement verified linking, unlink/rejoin and complete per-domain erasure ledger. Stop on unresolved ownership, history/credit ambiguity or replay resurrection.
6. **Full acceptance:** run the matrix above across all features/devices and request Cameron's separate decisions for production migration, deployment, native/store distribution and family/customer use.

Until all six packages have their exit evidence, keep `memberProtocols: [1]`, keep profile routes internal/unwired, keep production backfill and active account links off, and describe the product as account-backed with a dormant member foundation.
