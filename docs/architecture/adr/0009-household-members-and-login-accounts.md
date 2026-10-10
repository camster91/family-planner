# ADR-0009: Household members are distinct from login accounts

**Status:** Proposed implementation contract; no runtime/schema migration yet.
**Date:** 2026-10-10
**Owners:** Codex implementation; Cameron product review.
**Related:** #480, #128, #446, #450, #136, #473.

## Context

A preschool child can participate without email, credentials or a personal device. Current User is both login identity and household person. Its required unique email and the 64 explicit User FK owners prevent treating a name-only child as a complete household member. Nullable email or a generated address would leave authorization, assignments, points and shared-device attribution conflated.

`member-relation-inventory.json` classifies each current owned User relationship as member subject, real account, authenticated actor, or actor plus separate member attribution. `node scripts/member-contract.cjs` and its test reject missing, stale, changed or duplicate decisions. This checks schema inventory coverage only. It cannot prove runtime migration, non-FK identity coverage or authorization.

## Target identity contract

Introduce one HouseholdMember with independent stable ID, immutable family_id, display name, role/age/avatar/color, archived_at, timestamps and revision. Add an explicit verified optional account link; no generated email, password, session or invitation. Keep User credentials/session/token version, verified email, providers, push subscriptions and elevation PINs account-owned. Profile role is presentation/domain eligibility; selecting a parent profile never grants an authenticated parent role.

Member IDs and User IDs are distinct contracts. New assignment DTOs use memberId and explicit optional linkedAccountId. Never overload assigned_to or actingMemberId with two ID types, infer links from names/email, or substitute the logged-in parent as the child's assignment owner. Member-subject records gain household-scoped member FKs. Composite (member_id, family_id) references prevent foreign household subjects. Actor fields preserve real User/device provenance; supported shared writes add member attribution separately.

Account linking requires fresh parent management authority plus proof from the intended verified account owner. Lock member/account membership rows, validate same household and active status, reject conflicting links, and update link/revisions atomically. Every household join/leave/link path must use the same membership invariant. A profile link never upgrades account role. Conversion preserves member ID, assignments, points and history; claims/retries use a canonical scoped idempotency receipt, not a matching display name.

## Migration and compatibility sequence

1. Add dormant member/link tables and a reviewed deterministic existing-User-to-member mapping. Backfill only actual household users; unassigned accounts remain unassigned. Rehearse twice on disposable data, checking counts, uniqueness, family FKs and immutable historical actor IDs. No merge/deploy should silently activate profile-only writes.
2. Add nullable member subject/attribution FKs to every classified domain, retaining current User fields. Copy existing ownership by the explicit mapping. Stage member points/streak history with the same mapping; preserve completed, checked, redeemed and financial history. Do not copy login/delivery settings into profiles.
3. Introduce common fresh member resolution and transactional dual writes for linked existing members. Existing account-backed readers remain compatible. Verify all inventory domains before using member-only writes; labels/schema presence are insufficient evidence.
4. Ship versioned capability negotiation under #473 and explicit legacy update/fallback. Old pending operations retain their original account-ID payload/hash/idempotency receipt. Resolve only their verified mapped linked member; never reinterpret old IDs or hashes. Name-only assignments require a compatible reader; an older client must receive a recoverable unsupported capability response rather than silently hiding work.
5. Enable supported name-only setup, assignment and shared participation only after schema, read/write and compatibility checks. Add account linking and migrate remaining domains before claiming all-feature support. Private finance, medical/address/chat and account views remain excluded from shared profile selection and AI private access.

No new scheduler is involved. Any production migration/activation is a separate release gate with the exact candidate, backup and recovery evidence. No store signing or provider activation follows from this ADR.

## Domain coverage and non-FK contracts

The executable inventory covers chores/assignment history, habits/badges, rewards/redemption, project tasks, meal cooks, anniversary/emergency persons, pickups, allowance recipients, wishlist requesters and sick-day/medication subjects. It also retains creator/approver/audit identities, private account-owned budget/locations, messaging, calendar providers, account notifications/push, uploads, feedback and idempotency scope. Per-entry classification is proposed migration work, not proof of migrated behavior.

Separate acceptance also covers User XP/level/streak/last_chore_date and board colors; Chore.rotation_member_ids; Message.read_by; HouseholdDevice.elevated_user_id; device member-picker/actingMemberId payloads; authorization/session caches; personal queue storage keys and old serialized receipts; page member DTOs, search/notifications/AI context and fixtures. These are not all foreign keys and must not be declared covered by the schema checker. The routine builder uses member IDs for ownership and explicit stack/step identity, never free-text name as a multi-record mutation key.

## Archive, deletion and recovery

Archive is parent-authorized, revision-checked and idempotent. Preserve every historical row and member ID; prevent new assignment and recurring generation for archived members. Existing unfinished work remains visible as needing reassignment/skip, never automatically completed or credited. If linked account access is removed, revoke household access/token version and device elevation through the existing fresh-auth boundaries in the same controlled operation; profile archiving cannot leave stale account privilege behind. Permanent deletion, data export/erasure and linked-account removal require their own policies and privacy checks.

Rollback retains additive records and mapping/history. Disable member-only writes and show explicit unsupported/update recovery on clients that cannot read them. Never delete new profiles, manufacture User rows, transfer completions to parents, or roll back to a server that silently ignores member-owned records. Rehearse forward and rollback with queued old/new writes and linked/name-only/archived members.

## Required evidence before activation

Two-household direct API negatives; real-account versus profile authorization; parent/teen/preschool shared journeys; no mail/login/token creation; repeated backfill and reconciliation; atomic failure rollback; conflicting/replayed conversion; archive plus retained history/rotation; all affected domains; revocation and fresh-session/PIN checks; previous/current client forward/rollback and queued writes. Significant onboarding/member/link/archive UX needs original adaptive Figma/spec evidence, keyboard/Back/draft handling and finish-later behavior. Physical, signed/store, production and customer acceptance remain separate from host/browser checks.

## Alternatives

Nullable User.email and synthetic emails are rejected because they retain a login/person conflation. A second tablet-only member store is rejected because identity and history must work across every surface. Renaming only chore assignment columns is rejected because rewards, health, role/private views and old client payloads would remain inconsistent.
