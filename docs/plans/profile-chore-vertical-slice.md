# All-age profile chore vertical slice

**Status:** planning only. This document does not add a migration, route, capability, client behavior, queue action or production flag.

**Goal:** make one one-off chore usable by a name-only `child`, `teen` or `parent` presentation profile on the shared device:

`Add Everyone` → create a profile → a real parent assigns one one-off chore → Today/fridge shows the profile → the paired device completes it → a real parent verifies it.

The profile is a household subject, never a login principal. The authenticated parent or paired device is the actor. The profile role controls presentation only; it never grants parent authority, device elevation, private data access or progress-account ownership. This is the first bounded slice of the full all-age migration. Recurrence, routines, rotation, points, streaks, rewards, imports, profile offline replay and the remaining member-owned relations stay disabled.

## Verified current boundary

The current repository already has the dormant identity columns, but they do not support a profile-only chore:

| Area                 | Current source                                                                                                                                 | Verified limitation                                                                                                                                                                                                                                       |
| -------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Chore storage        | `prisma/schema.prisma:406-484`, `database/migration-z-household-member-chore-subjects.sql:3-60`                                                | `Chore.assigned_to` is required and has a required `User` relation. `assigned_member_id` is nullable, but the trigger requires a same-household legacy mapping or verified account link. A name-only profile cannot be stored.                            |
| Future occurrences   | `prisma/schema.prisma:489-520`, `src/lib/recurringChores.ts:109-252`                                                                           | `ChoreAssignment.assigned_to` is also required. Recurrence and rotation resolve User IDs through `eligibleChoreAssigneeInTx`. They are outside this one-off slice.                                                                                        |
| Profile command      | `src/lib/household-profile-management.ts`, `src/lib/household-profile-http.ts`                                                                 | All-age create/edit/archive groundwork exists, but the HTTP gate defaults off with `HOUSEHOLD_PROFILE_SETUP_ENABLED`; it does not create chore subjects or advertise protocol 2.                                                                          |
| Account chore writer | `src/app/api/chores/create/route.ts:18-156`, `src/lib/validations.ts:51-79`                                                                    | Parent-only, User `assigned_to`, User lookup and account notification. It requires a legacy account target and can expand recurrence.                                                                                                                     |
| Completion           | `src/lib/chore-complete.ts:28-145`, `src/app/api/chores/complete/route.ts`                                                                     | `completeChore` writes `Activity.user_id` from a real User actor and creates recurring successors through the User subject helper. The person route has no profile subject path.                                                                          |
| Paired completion    | `src/lib/device-writes.ts:1-103`, `src/app/api/device/chores/[id]/complete/route.ts:16-67`                                                     | The body is exact `{ actingMemberId }`; the helper resolves that value through `prisma.user` and passes the selected User to `completeChore`. `DeviceAuditEvent.actor_user_id` records that selected User, not a profile subject.                         |
| Paired Undo          | `src/app/api/device/chores/[id]/uncomplete/route.ts:16-104`, `src/lib/chore-reopen.ts:31-76`                                                   | Undo rereads `assigned_to` and canonical account mapping. Its fallback and audit path must be made profile-safe before a profile-only chore can be undone.                                                                                                |
| Today reads          | `src/app/dashboard/today/today-board-data.ts:277-416`, `src/app/dashboard/today/board-snapshot.ts:98-135`, `src/app/api/device/today/route.ts` | Members come from `db.user`; chores select and filter only `assigned_to`. A profile chore would be omitted or fail the required User relation. Both person and device board DTOs need a typed subject reader before activation.                           |
| Parent verification  | `src/app/api/chores/verify/route.ts:68-244,255-379`                                                                                            | Approval calls `currentChoreAssigneeInTx`, awards XP through `awardChoreXP(User.id, ...)`, and notifies a User. Rejection assigns an unresolvable chore to the verifying parent when no assignee is resolved. Both are unsafe for a profile-only subject. |
| Audit                | `prisma/schema.prisma:992-1008,1507-1520`, `src/lib/device-audit.ts:21-80`                                                                     | `Activity.user_id` is required. `DeviceAuditEvent` has device and optional User actor but no explicit member subject. A profile action must not manufacture a User row or place the parent in the assignee/actor field.                                   |
| Capability and queue | `src/app/api/capabilities/route.ts:10-21`, `src/lib/api-capabilities.ts`, `src/lib/offline-queue.ts:97-170,345-377`                            | The manifest advertises member protocol `[1]`. Chore completion is not queueable. Unknown queue actions/versions are currently dropped or quarantined by compatibility checks, so this slice must not add a profile completion queue action.              |

The existing chore-subject SQL is therefore an expand-only foundation, not an activation migration. It must be extended deliberately; changing only the TypeScript type or writing `assigned_member_id` directly would violate its trigger and leave old readers unsafe.

## Subject and actor contract

The existing typed boundary in [`src/lib/member-subject-contract.ts`](../../src/lib/member-subject-contract.ts) is the source contract for the next implementation. The storage and API work must preserve these three representations:

| Case                        | Chore storage during the compatibility window           | Request subject                                            | Authenticated actor                                                        |
| --------------------------- | ------------------------------------------------------- | ---------------------------------------------------------- | -------------------------------------------------------------------------- |
| Existing account-only       | `assigned_to = userId`, `assigned_member_id = NULL`     | Protocol 1 `assigned_to` or legacy device `actingMemberId` | Real person User or paired device; existing behavior stays unchanged       |
| Existing reconciled account | `assigned_to = userId`, `assigned_member_id = memberId` | Protocol 1 account subject until protocol 2 is accepted    | Real person/device actor; mapping agreement remains required               |
| New profile-only one-off    | `assigned_to = NULL`, `assigned_member_id = memberId`   | Protocol 2 explicit `memberId`                             | Paired device for completion, real parent User for assignment/verification |

The profile subject must be one active `HouseholdMember` in the actor's family, with `archived_at IS NULL` and `erasure_user_id IS NULL`. `role` may be `child`, `teen` or `parent`; optional age must satisfy the existing bounds (child 0–17, teen 13–17, parent 18–120). A parent presentation profile is still not a parent account.

### Proposed review contract: actor records, erasure and protocol

This is a contract decision for the next implementation review, not an accepted production behavior. A profile-only completion has a device actor and a profile subject. It must update the one-off chore in a subject-aware transaction and write a `DeviceAuditEvent` with `device_id`, `actor_user_id = NULL` and the profile subject. It must not call the current User-only `completeChore` activity path, manufacture a User, credit the parent, or create XP, streak, reward, notification or recurring-successor records. A parent verification may write an `Activity` with the real parent's required `user_id` and the profile's subject field, but that verification event also carries no progress credit. Account-backed completion and verification remain unchanged.

Every new subject-bearing history row (`Activity` and `DeviceAuditEvent`) must use a nullable `subject_member_id` plus a non-identifying `subject_member_erased BOOLEAN NOT NULL DEFAULT FALSE` marker. Profile erasure clears the nullable subject foreign key and sets the marker in the same locked transaction; it never substitutes the parent, a later same-name profile or an account ID. The marker contains no name, email or re-identifying value, is not an eligibility signal, and prevents later writes from restoring the erased subject. The existing `Chore.member_subject_erased` tombstone remains part of the same erasure ledger.

Before the migration is considered complete, add both relations to the member-subject inventory/checker and to the account/profile/household deletion runbooks. The required ordering is: lock the account and all current/historic affected households; redact subject-bearing history and set its markers; clear active/future chore subject references and set their existing tombstones; then detach/archive or delete the member and its mapping/link according to the existing lifecycle order. Whole-household deletion must remove every dependent history/reference row before a `HouseholdMember` can be removed and must preserve unrelated households. Add direct FK, profile-erasure, account-deletion and whole-household regression coverage for both new relations before either gate is enabled.

Profile-aware HTTP/device requests need an explicit versioned wire envelope at the route boundary. The envelope is:

```json
{ "protocol": 2, "selection": { "memberId": "opaque-member-id" } }
```

The legacy account body and `actingMemberId` remain the protocol-1 shape. A missing `protocol` is exactly protocol 1; the server must never infer protocol from the presence of `memberId`, a name or an email. Invalid, unsupported or protocol-1 profile selections return the stable refusal envelope without private identifiers:

```json
{
  "code": "MEMBER_PROTOCOL_UNAVAILABLE",
  "recovery": "refresh-and-retain-pending",
  "requiredProtocol": 2,
  "receivedProtocol": 1
}
```

The caller retains the original key/body and may offer refresh or browser fallback. It must not translate the selection, retry it as an account action or discard a profile row. `memberProtocols: [2]` is not advertised until the schema, deletion/erasure ledger, readers, writers, native/device client and rollback evidence all pass the proof below.

The request boundary must reject:

- both `assigned_to` and `memberId` in one create request;
- a profile ID in `actingMemberId`;
- a profile target under protocol 1;
- a foreign, archived, erased, mapped or linked profile in the new profile-only path;
- `frequency` other than `once`, `rotation`, `weekly_days` or any recurring/routine-only field for the first profile write;
- a missing or reused idempotency key;
- any attempt to use a profile role as the authenticated actor or elevation proof.

Protocol-1 refusal must be explicit and recoverable (`MEMBER_PROTOCOL_UNAVAILABLE`, retain the original request intent). It must never translate `memberId` to the parent, match a name/email, or silently hide a profile chore from a reader that cannot represent it.

## Smallest expand/contract migration

The first database migration should be additive and reversible before the new writer is enabled. It must run after `database/migration-household-members.sql` and the existing chore-subject expansion.

### Expand

1. Change only `Chore.assigned_to` from `TEXT NOT NULL` to nullable in SQL and Prisma. Keep the existing User foreign key while `assigned_to` is present, and make the Prisma `assignee` relation optional. Do not change `ChoreAssignment.assigned_to`; no profile recurring occurrence is created in this slice.
2. Add a `Chore` check that at least one subject exists: `assigned_to IS NOT NULL OR assigned_member_id IS NOT NULL`. Keep the existing sticky-erasure check. The trigger must allow the profile-only branch only when `assigned_to IS NULL`, the composite `(assigned_member_id, family_id)` exists, the profile is active, and no mapping/link or erasure owner is present.
3. Preserve the existing dual-field branch: when both IDs are present, the User and member must remain in the same family and the mapping/link must point to that exact User. A canonical account row cannot be converted to a profile-only row by clearing `assigned_to` as a convenience; the new writer must explicitly choose a profile subject under the household lock.
4. Add `Activity.subject_member_id TEXT NULL` and `Activity.subject_member_erased BOOLEAN NOT NULL DEFAULT FALSE` with the same composite household foreign key and index. Keep `Activity.user_id` required for existing and parent-verify activity rows. A parent verification may record the profile subject with the real parent in `user_id`; a profile completion must use the separate device-audit path above and must not create an Activity row with a fabricated actor.
5. Add `DeviceAuditEvent.subject_member_id TEXT NULL` and `DeviceAuditEvent.subject_member_erased BOOLEAN NOT NULL DEFAULT FALSE` with the same composite household foreign key and index. Keep `device_id` as the device actor and `actor_user_id` nullable. For a profile completion/Undo, `subject_member_id` identifies the profile and `actor_user_id` remains null; for the legacy account path the current `actingMemberId` compatibility behavior remains until its reviewed migration.
6. Keep all existing account-only indexes, unique keys and foreign keys. Add a profile-only lookup index on `(family_id, assigned_member_id, due_date)` if the query plan requires it. Do not loosen `ChoreAssignment`, `rotation_member_ids` or any of the other 64 User-owned relations for this slice.

The trigger must be tested as a database invariant, not left to API code. It must reject no subject, a foreign family, an archived/erased subject, a profile plus a mismatched User, a mapped profile with a different User, and a canonical subject cleared without the explicit erasure path. Existing legacy-only rows and existing mapped rows must continue to pass.

### Contract and readers before the new writer

Deploy the expanded schema and readers first with both gates off. Existing account clients must continue to read/write account rows. The server must not advertise protocol 2 while any reader would select only `assigned_to` or require `assignee`.

The typed reader shape should be additive for existing clients and explicit for new clients:

```ts
type ChoreSubject =
  | { kind: "account"; accountId: string; name: string }
  | {
      kind: "profile";
      memberId: string;
      name: string;
      role: "child" | "teen" | "parent";
    };
```

New board/chore DTOs should carry `subject` (or an equivalent typed `assigneeKind` plus ID). They must not overload `assigneeId` with two namespaces. Old protocol-1 consumers receiving a profile-only row must receive a stable compatibility refusal before rendering a partial board; no profile row may be discarded as an “orphan.”

### Contract and readers after the new writer

Once the writer and readers pass the gates, retain both representations during the compatibility window. The account path remains unchanged. Profile-only rows are enabled only for protocol-2 requests and the server flag below. A later contract migration may make `assigned_to` optional in all generated code and remove profile-incompatible readers only after the supported-client window and rollback candidate are accepted; this slice does not perform that cleanup.

## Route and domain changes for the next implementation

These are the subsequent source owners, not changes made by this plan:

| Boundary            | Files to change                                                                                                                                                                                       | Required behavior                                                                                                                                                                                                                                                                                                                               |
| ------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Parent assignment   | `src/lib/validations.ts`, `src/app/api/chores/create/route.ts`, `src/lib/chore-member-subject.ts`                                                                                                     | Add a discriminated account/profile target. Parent auth, current family and household lock remain mandatory. Profile target requires protocol 2, active unlinked profile, `once`, no rotation, and a required idempotency key. Return a typed subject; do not send account assignment mail/notification to a profile.                           |
| Chore reads         | `src/app/api/chores/route.ts`, any chore DTO/select helpers                                                                                                                                           | Select the nullable User and profile subject explicitly. Scope by family. Keep account response compatibility; expose profile rows only to a protocol-2 reader or return the stable refusal. Preserve points visibility policy.                                                                                                                 |
| Today board         | `src/app/dashboard/today/today-board-data.ts`, `src/app/dashboard/today/board-snapshot.ts`, `src/app/dashboard/today/home-summary-data.ts`, `src/components/fridge/board-model.ts` and affected tests | Read active Users plus active unlinked profiles for the shared board, select only name/role-safe presentation fields, and associate chores by typed subject. `GET /api/device/today` and the person board/version route must agree on the same subject version. No email, age, private notes, XP, finance or account-link fields enter the DTO. |
| Device completion   | `src/lib/device-writes.ts`, `src/app/api/device/chores/[id]/complete/route.ts`, `src/components/device/use-device-board-actions.tsx`, `src/components/device/DeviceTodayScreen.tsx`                   | Preserve `{ actingMemberId }` for legacy account actions. Add a protocol-2 `{ memberId }` branch that verifies the selected profile is the assigned active subject, keeps the device as actor, requires idempotency and writes the subject-aware audit. Completion is online-only in this slice; no offline queue action.                       |
| Device Undo         | `src/app/api/device/chores/[id]/uncomplete/route.ts`, `src/lib/chore-reopen.ts`                                                                                                                       | Prove the same device completed the same profile chore within the existing two-minute window. Preserve the profile subject on reopen; never fall back to the parent account. Refuse stale/foreign/verified rows without changing status.                                                                                                        |
| Parent verification | `src/app/api/chores/verify/route.ts`, `src/lib/chore-complete.ts` or a subject-aware completion helper                                                                                                | A real parent may approve or reject any active profile subject. Approve changes status and records the parent actor plus profile subject. It must not award XP/streak/points, create a User notification, or credit the acting parent. Reject preserves `assigned_member_id` and never reassigns to the verifying parent.                       |
| Audit               | `prisma/schema.prisma`, `src/lib/device-audit.ts`, affected activity/audit tests                                                                                                                      | Enforce actor/subject separation at the DTO and write boundary. Device completion has `device_id` actor plus `subject_member_id`; parent verification has `user_id` actor plus `subject_member_id`. Fixed metadata may contain IDs only where the existing audit policy allows them; never names, email, credentials or raw request bodies.     |
| Capability          | `src/app/api/capabilities/route.ts`, `src/lib/api-capabilities.ts`                                                                                                                                    | Keep `memberProtocols: [1]` while either gate is off. Advertise 2 only after schema, readers, writer, device client and rollback evidence pass. Manifest support is not authorization.                                                                                                                                                          |

The person `POST /api/chores/complete` and person Undo remain account-only for this first slice. If they encounter a profile-only chore, they return the typed compatibility refusal rather than attributing the action to the current parent. A later member-action slice can add explicit personal profile selection under a real account actor.

## Flags and permission order

Use separate default-off gates:

1. `HOUSEHOLD_PROFILE_SETUP_ENABLED=1` for the existing profile roster route.
2. A new server-only `HOUSEHOLD_PROFILE_CHORE_ENABLED=1` for profile-targeted chore writes/readers.
3. Existing household `features.chores` and `device_writes_enabled` for the relevant route.
4. Protocol negotiation from the client/request; a manifest response never grants authority.

The order is:

- paired-device refusal and device/session validation before body interpretation;
- real parent authentication, current family membership, token version and parent role for assignment/verification;
- server/domain gate and protocol support;
- household feature/device-write gate;
- idempotency key and strict body schema;
- household lock, active profile lookup and exact chore subject comparison;
- status/due-date conditional mutation and audit in one transaction;
- post-commit presentation only.

Profile roles are never used in this order as permission checks. A name-only parent profile cannot call parent routes, verify a chore or enter elevation mode. A paired device can complete only the exact assigned subject through the allowlisted shared-device action.

## Recovery, rollback and compatibility

- Account-only protocol-1 create, read, complete, Undo and verify behavior must remain byte/semantics compatible when no profile rows exist.
- Protocol-1 requests for profile targets return `MEMBER_PROTOCOL_UNAVAILABLE` with the original intent retained by the caller. They do not translate IDs, retry automatically or create an account.
- Profile completion is deliberately not offline-queued. The current queue allowlist has no chore completion operation, and unknown actions/versions cannot be safely replayed. The UI must show a retryable network state and preserve no secret or raw profile payload locally. A future queue action requires its own quarantine/retention contract and capability version.
- Every profile create and chore create/complete/verify test must prove same-key replay does not duplicate a person, chore, status transition or audit row. Changed bodies under a reused key must refuse.
- A schema-only expand with both gates off is reversible. Before any profile rows are written, revert readers/writers and leave the additive fields in place. After profile-only rows exist, an account-only server is not a safe rollback because it requires non-null `assigned_to` and would either fail or invent a User. Rollback then means restore the compatible reader/writer candidate or restore from a verified backup; never fill the parent ID as a repair.
- Account deletion/profile erasure must clear `assigned_member_id` and set the existing sticky `member_subject_erased` tombstone in Chore, and clear each new `subject_member_id` while setting its non-identifying `subject_member_erased` marker in Activity and DeviceAuditEvent, according to the approved erasure ledger. Retained history must not be relinked to a later same-name profile. A missing or failed redaction is a transaction failure, not permission to delete the member or continue with a partial audit.

## Required proof before enabling either gate

### Source and unit checks

- Contract tests for all three presentation roles, null/valid/invalid age, account/profile discriminators, actor/subject family mismatch, protocol-1 refusal, strict legacy `actingMemberId`, and device actor without a User ID.
- Validation tests for exactly-one target, one-off-only profile writes, idempotency and no account/invite/email fields.
- Subject helper tests for active same-family profile, foreign/archived/erased/mapped/linked refusal, profile-only storage, account-only compatibility and same-household dual representation.
- Completion/Undo/verify tests proving profile assignment is retained, device audit actor/subject fields are separate, parent verification is allowed for all roles, no XP/streak/notification is awarded, rejection never assigns the parent, and repeated requests are no-ops.
- Board tests proving profile rows are present in both the person/device reader contract or receive the explicit protocol refusal, old account rows retain their shape, board version changes, and no private fields reach the DTO/RSC payload.

### Guarded database/API proof

Use the disposable `fx_` household harness and assert the target before opening a database client. Cover two families and three profiles (child, teen, parent), with no fake User/email rows:

1. Apply the expand SQL twice; confirm existing account-only and mapped account rows are unchanged.
2. Insert one profile-only one-off per role and confirm the required FK/checks, active-family scope and typed reads.
3. Reject missing subject, foreign subject, archived/erased subject, mapped/linked profile in the profile-only branch, mismatched account/member pair and both target fields.
4. Create, read Today, complete on the paired device, replay the same idempotency key, Undo within the device window, complete again and parent-verify. Check exact status/audit counts and no User/Activity fake actor.
5. Verify profile approval has no user XP/streak/reward/notification delta and records the real parent actor separately from the profile subject.
6. Prove protocol-1 direct API and old DTO paths refuse rather than hide/translate, while account-only paths still pass.
7. Exercise profile archive/erasure, device revoke/expiry, session revocation, concurrent completion, lost response and two-household negatives. Cleanup must be independent and report zero owned rows.

### Rendered and release proof

Only after source/API proof: run the actual phone, portrait tablet, fridge landscape and desktop journeys in EN/ES, with keyboard/Back, 44px targets, offline/retry, process resume, stale board and long names. Verify the loaded web/server identity and the protocol manifest. Physical Android/native/store proof remains separate; this plan does not claim it.

## Full-goal boundary

Passing this slice does not complete #480. The full all-age acceptance still requires recurring chores and routines, weekday selection, rotation, completion history, verification/progress migration, all 64 member-owned relations, profile linking/conversion, offline/native compatibility, erasure, AI/privacy boundaries and rollback evidence. The one-off slice is useful only if it preserves those contracts and leaves the later domains explicitly gated.
