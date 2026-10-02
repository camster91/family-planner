# Account & Household Deletion Contract

This document defines product/engineering requirements; exact legal copy is finalized before public launch.

## Principles
- Account deletion must be discoverable in-app for eligible account owners and satisfy current Play requirements at release time.
- Destructive actions require fresh authorization and explicit confirmation.
- A member deletion is not automatically a household deletion.
- Last-parent/household-owner rules must prevent accidentally orphaning a household.
- Shared-device sessions must be revoked when their household/account authority disappears.
- Deletion must not silently leave private content accessible through old links/tokens/caches.

## Required behaviours
Define and test:
- member leaves/is removed;
- parent deletes own account when another parent exists;
- last parent tries to delete/leave;
- whole household deletion;
- shared device/session/token revoke;
- pending invitations/recovery tokens;
- uploaded media;
- analytics/audit retention rules;
- third-party integration disconnect/delete behaviour;
- billing entitlement cancellation only after billing exists.

## Retention: household audit history (#285)
- `AuditLog` (Settings → Recent changes, ADR-0008) is household data: deleted with the household, explicitly as the
  `auditLog` step of `HOUSEHOLD_DELETION_PLAN` (and by `ON DELETE CASCADE` as a backstop).
- Deleting one member keeps the household's rows, in the deletion transaction: their actor references are cleared
  (the page then shows "A former member"), the line recording when they joined loses their name and id ("A former
  member joined as a teen"), and a `member.left` line is added with their role word only ("A teen deleted their
  account and left the household"). No name of theirs stays in the history. Lines by other members are unchanged.
- Rows are kept 12 months, then pruned when a parent next reads the history (no scheduled job). The account export
  includes the last 12 months: every row for a parent, only the rows they acted in for a teen or child.

## Retention: beta usage counts (#287)
- `BetaMetricDaily` holds counts only (household, UTC day, fixed metric name, count), never a user id, so deleting one
  member changes nothing in it. It is deleted with the household, explicitly as the `betaMetricDaily` step of
  `HOUSEHOLD_DELETION_PLAN` (and by `ON DELETE CASCADE` as a backstop).
- A parent turning "Share beta usage counts" off (`PATCH /api/family/beta-metrics`) deletes all of the household's
  rows in the same transaction. Counting is off by default.
- Rows are kept 13 months: the recorder deletes the household's older rows each time it records (no scheduled job),
  and the scorecard ignores older rows. A household that stops recording keeps its older rows until it records
  again, turns counting off or is deleted. Every member's export includes the household's rows.

## Data execution
Prefer a documented job/transaction sequence with observable status for large cascades. Do not rely on accidental database cascades as the entire deletion policy. Retention exceptions must be explicit and minimal.

## Export
Where required/valuable, offer export before deletion. Export authorization must not leak another household.

## Testing
Use synthetic households. Test direct API authorization, last-parent protections, token/link invalidation, device revoke, retries/idempotency and partial-failure recovery.

## Approval boundary
Do not execute deletion against real production accounts/data during normal agent work.

---

## Implemented behaviour (D-3)

Code: `src/lib/account-deletion.ts` (the sequences), `src/lib/account-deletion-http.ts` (re-authorization,
idempotency, cookie), `src/app/api/users/route.ts` (`DELETE`), `src/app/api/family/route.ts` (`DELETE`),
`src/app/api/users/deletion/route.ts` (`GET`, what the member may delete), `src/components/account/DeleteAccountDialog.tsx`.
Request/response contract: `docs/architecture/API_CONTRACTS.md` "Account and household deletion (D-3)".

### Where it is in the app

Settings → Privacy & data → **Delete Account** (and the same dialog from Family settings → Danger Zone). The
dialog is built in the page (no browser `confirm`):

1. It loads `GET /api/users/deletion` and decides the mode: own account, or (only parent) the whole household.
2. It offers **Download my data** first (`GET /api/users/export`, the same as Settings → Data Export).
3. It asks for the **current password** and a **typed confirmation**: `DELETE` for an account, the household name
   for a household (case, surrounding and repeated spaces are ignored). The delete button stays disabled until
   both are filled in and the text matches.
4. On success the browser goes to `/login?deleted=account|household`, which says so.

Teens (O-37) delete their own account from their own Settings → Privacy & data → Delete Account, which opens
the same dialog with household deletion switched off. Children cannot open Settings (`src/lib/kid-access.ts`). They
find **Delete my account** in the user menu
(the avatar button in the top bar, on every page they can reach), which opens the same dialog with household deletion
switched off (`allowHousehold={false}`): own account only, `DELETE` typed, password required. Parents and teens do
not get that menu entry; they use Settings. The API rule is the same for every role (the role matrix gives every member "D own" on
`/api/users`).

### Rules

| Situation | Result |
| --- | --- |
| Teen or child deletes own account | Allowed (`DELETE /api/users`). Household content is handed to the earliest parent. |
| Parent deletes own account, another parent exists | Allowed (`DELETE /api/users`). Content is handed to the earliest other parent (by `created_at`, then id). |
| Only parent tries to delete own account | 409 `LAST_PARENT`. The dialog offers "invite another parent" or deleting the whole household. |
| Only parent deletes the household | Allowed (`DELETE /api/family`). Every member account in it is deleted too. |
| A parent deletes the household while another parent exists | 409 `OTHER_PARENTS_EXIST`. Each parent deletes their own account; the last one can then delete the household. Deleting another adult's account without their consent is not offered. (Before D-3, any parent could, without re-authentication.) |
| Teen or child tries to delete the household | 403. |
| Paired shared tablet (device cookie) | 403 `DEVICE_WRITE_NOT_ALLOWED` on both deletion routes, before person auth, even with a person cookie beside it. |
| Wrong or missing password, wrong confirmation | 400 `INVALID_PASSWORD` / `PASSWORD_REQUIRED` / `CONFIRMATION_MISMATCH`; nothing changes. 5 attempts per member per 15 minutes (429). |
| Teen/child who is the last member of a household with no parent | 409 `NO_SUCCESSOR` (should not occur; households are created by a parent). |

### Member account deletion (`deleteMemberAccount`)

One transaction, after the rules are checked again inside it under a per-household advisory lock:

1. **Sessions and credentials.** `token_version` is bumped and reset/verification tokens cleared (then the user row
   is deleted, which ends every JWT). A tablet in parent mode for this member leaves it (elevation fields cleared).
   Their tablet PIN, unfinished pairing codes they started, pending invitations they sent, OAuth states, calendar
   connection and idempotency records are deleted. Paired household tablets they set up stay paired (creator
   reference cleared): the tablet belongs to the household.
2. **What was only about them is deleted:** chores assigned to them and their assignments, allowance paid to them,
   their sick days and medications, wishlist items and reward redemptions they requested, habit logs, badges,
   notifications, push subscriptions, activity entries, and messages they sent. Import provenance rows pointing at
   deleted rows go too. They are removed from every message's `read_by`.
3. **Household content they created is handed over** to the successor (not deleted): chores they created, events,
   lists and list items they added, rewards, budget categories and transactions, projects, meals, notes, saved
   places, pickups, allowance they gave, sitter handoffs, sick days/medications they recorded for others, ICS
   subscriptions, import jobs, recipes, legacy meal plans/shopping lists, habits and goals.
4. **Other references are cleared** (`NULL`): who ticked a list item, cook of a meal, claimer/approver of a reward,
   project task assignee, anniversary person, emergency card person, pickup assignee, inventory adder/actor, grocery
   section setter, device audit actor, household audit actor (#285), upload uploader.
5. **Uploaded photos** they uploaded stay with the household (uploader cleared) and are removed with it. Whether a
   photo is still used cannot be decided atomically: attaching a photo to a chore, an assignment or the calm
   display is a separate write without the household lock or a foreign key to `Upload`, so removing an
   "unused" photo could break one another member is attaching at that moment.
6. The user row is deleted.

Inside the transaction, their calendar connections are read (the encrypted grants are kept in memory) and each
one's links, imported events and row are deleted. After commit, each grant is revoked at the provider (best effort,
see "Partial failure") and the photo files are removed from disk.

### Whole household deletion (`deleteHousehold`)

1. Check: the actor is a parent of this household and its only parent (again inside the transaction, under the lock).
2. **In one transaction** (under the household membership lock, see "Concurrency"):
   1. Every member's `token_version` is bumped and reset/verification tokens cleared; every device session is
      marked revoked; the calendar feed token is cleared.
   2. Every calendar connection is read (encrypted grants kept in memory for step 4) and its links, imported events
      and row are deleted.
   3. The files to remove are collected: every `Upload` of the household, and legacy chore photos
      (`/api/files/chores/<f>`, `/api/files/<f>`, bare `<f>`) referenced only by this household. A legacy file that
      another household also references, in any of those three spellings (compared by filename), or that another
      household owns through an `Upload` row, is kept (legacy files have no household namespace).
   4. Every household-scoped table is deleted explicitly, in the order of `HOUSEHOLD_DELETION_PLAN`: device
      sessions (access and refresh tokens), pairing codes, device audit, household audit history (#285), beta usage counts (#287), devices, tablet PINs; invitations, OAuth
      states, idempotency records, push subscriptions, sitter handoffs (share links); calendar event links, events,
      calendar connections, ICS subscriptions; then all household content (inventory, groceries, lists, budget,
      projects, chores, gamification, legacy and canonical meals/recipes, imports, messages, notifications,
      activity, notes, anniversaries, places, emergency cards, pickups, allowance, wishlist, medical rows),
      upload rows, the weather cache; then the member accounts.
   5. The household row is deleted.
3. **After commit:** each calendar grant is revoked at the provider (calendar sync's `revokeProviderGrant`, no
   database writes, best effort), then the collected files are deleted from disk.

A unit test fails when a model in `prisma/schema.prisma` is neither in the plan nor listed as not household data
(`Family` itself and `RateLimitEntry`), so a new table cannot be silently left to cascades.

### Tokens and links after deletion

| Credential | After member deletion | After household deletion |
| --- | --- | --- |
| Person session cookie (JWT) | 401 (user gone) | 401 for every member |
| Password reset / email verification token | gone with the user row | gone |
| Shared-device access/refresh token, pairing code | household tablets unaffected; their unfinished codes deleted | deleted (each tablet is signed out on its next request) |
| Tablet parent mode held by the member | ended | ended |
| Family invitation | their pending invitations deleted | all deleted |
| Calendar feed URL (`/api/calendar/feed?token=`) | unchanged (household's) | 404 (token cleared, family gone) |
| Sitter share link | handed over with the handoff | 404 |
| Calendar OAuth grant | revoked at the provider (best effort), tokens deleted | same, for every connection |
| Idempotency records | deleted | deleted |

### Observable status

Each route answers with counts: `{ success, mode, filesRemoved, filesNotRemoved }` (household also
`membersRemoved`), and logs one content-free line (`account_deletion.member` / `account_deletion.household`, with
role and counts only). The work is small enough to run inside the request; there is no background job (AGENTS.md:
no scheduler without approval).

### Retries and idempotency

Both routes accept an optional `Idempotency-Key`. A duplicate while the first request runs gets 409
`IDEMPOTENCY_IN_PROGRESS`. The deletion removes the caller's idempotency records with everything else, so after
success a retry is answered by authentication with 401 (the account is gone), and nothing else is deleted. The
dialog sends a key, retries once with the same key after a network error, and treats a 401 on that retry as
"already deleted" (a 401 on the first attempt is shown as "session ended"). The library functions are convergent: run
again, they find nothing and return `deleted: false`.

### Concurrency

Two transaction-scoped advisory locks (`src/lib/household-lock.ts`), always taken in the same order, **user lock
first, then household lock** (nothing takes a user lock while holding a household lock, so there is no deadlock):

| Lock | Held by deletion | Taken by | Outcome of a write that loses the race |
| --- | --- | --- | --- |
| Household (`household-membership:<familyId>`) | Household deletion and member deletion, from before they read the member list until commit | `POST /api/family/join` (code and email invite; the invite is consumed in that transaction), `POST /api/auth/register` with an invite, the calendar OAuth commit (`commitConnection`), `POST /api/upload` | Waits, re-checks the household (and for calendar, that the member still belongs to it), then refuses: join 404, register 400, calendar callback `calendar_sync=forbidden` with the just-issued grant revoked, upload 404 with its file removed. Nothing is created or moved. |
| User (`user-membership:<userId>`) | Member deletion, from before it reads the member's `family_id` | `POST /api/family` (create) and `POST /api/family/join`, which then re-check the account | Create/join refuse (401 for a deleted account); no Family without members is left. |

Write-ups of the races this closes:

- A join committing between the deletion's delete of the members and of the Family row left the account with
  `family_id = NULL` (`User.family` is ON DELETE SET NULL) while the deletion reported success.
- A household created for an account being deleted left a Family with no members.
- A calendar connection committed after the deletion's snapshot, or a failed commit after the provider issued the
  token, left a grant nothing would revoke. The callback now revokes the new grant whenever it is not stored, for any
  reason (limit, no refresh token, household or member gone, a failed transaction).
- An upload committed its row and then wrote its file, so a deletion could miss the file or the file could appear
  after cleanup. Now the file is written first (temporary name, then rename), the row is written under the household
  lock after re-checking the household, and a refused or failed transaction removes the file it wrote. A deletion that
  runs after sees the row with its file on disk and removes both.

Ordinary household rows written concurrently need no lock: every table's `family_id` foreign key cascades, and an
insert holds a key-share lock on the Family row, so a row inserted while the deletion runs is removed with the
Family row (or the insert fails if the Family is already gone). `User` is the only SET NULL reference. The only other
places that create files or external grants are the ones above: `POST /api/upload` is the only filesystem write,
and the calendar OAuth callback the only stored provider grant (fridge scan and event import send content to a
provider and keep nothing; recipe images are URLs; calm-display photos are ids of existing uploads).

### Partial failure

- Database work is all-or-nothing (one transaction). If it fails, nothing is deleted and the request can be retried.
- Provider revoke runs only after commit and is best effort. A revoke cannot be undone, so doing it first would
  leave calendar rows with a dead grant whenever the transaction failed; after commit it only ever affects data that
  is already deleted. If the provider is unreachable, the stored tokens are still gone; the grant can outlive the
  account at the provider until the member revokes it there or it expires. A failed transaction leaves every
  calendar connection, link and imported event as it was (proved in the Postgres suite).
- File removal runs after commit. A file that cannot be removed is counted in `filesNotRemoved` and logged by file
  name only; it is no longer reachable through the app (its `Upload` row and every chore reference are gone, and
  both file routes serve a file only through those).

### Retention exceptions

Explicit and minimal:

| What | Why it stays | How long |
| --- | --- | --- |
| Database backups (`scripts/backup.sh`) | Restores need them | Until rotated out: every copy from the last 14 days, then one a week, none older than 35 days (`scripts/backup-prune.sh`, `docs/runbooks/BACKUPS.md`), where backups are scheduled |
| `RateLimitEntry` counters | Abuse protection; keys hold an IP or an opaque id (e.g. `account-delete:<userId>`), never content | Until the window ends (at most a day) |
| Server logs | Operational; deletion logs carry role and counts only, no names or content | The host's log retention |
| Provider-side copies | Events already pushed to a member's Google/Outlook calendar stay in that calendar (as on a normal disconnect); a provider grant whose revoke failed | Controlled by the member at the provider |
| Legacy photo file shared with another household | The other household still shows it | While referenced |
| Photos a deleted member uploaded | They stay with the household (uploader cleared); another member may be attaching one | Until the household is deleted |
| Files that could not be removed from disk | Reported as `filesNotRemoved`; unreachable through the app | Until removed by an operator |

The audit stores are the device audit (`DeviceAuditEvent`) and the household audit history (`AuditLog`, #285, 12
months, pruned on a parent's read); both are deleted with the household and a deleted member's actor references are
cleared. The only usage store is the opt-in beta usage counts (`BetaMetricDaily`, #287): counts per household and
day with no user reference, 13 months, deleted when turned off and with the household. Page views are no longer
recorded (#136, #140); the legacy page-view/click rows (`Activity` types `event_page_view`, `event_cta_click`) follow
the `Activity` deletion rules above and are also pruned 90 days after they were written (`src/lib/legacy-analytics.ts`).

### Not implemented (open)

- **Member leaves the household without deleting their account**, and **a parent removes a member**: no API exists.
  The old Family settings "Leave" button called `PATCH /api/users` with `family_id`, which that route ignores (it
  answered 400); the button is removed. Needs a product decision (a person without a household cannot use the app).
- **Billing entitlement cancellation**: no billing exists.
- **Asynchronous job with status polling** for very large households: not needed at current sizes; the request
  returns the counts.

### Tests

- `src/lib/__tests__/account-deletion.test.ts` (fake two-household DB): household A fully removed and household B
  identical, explicit sequence, sessions revoked first, shared/foreign legacy files kept, file and provider failures,
  roles, only-parent and other-parent rules, member hand-over, tablet parent mode, photos, retries, options per role,
  and the schema coverage check.
- `src/app/api/users/__tests__/deletion.test.ts`: both routes and `GET /api/users/deletion` (401, roles, password,
  confirmation, rate limit, last parent, other parents, device 403, idempotency 409 then 401 after success, cookie).
- `src/lib/__tests__/account-deletion.integration.test.ts` (Postgres, `RUN_DB_INTEGRATION=1`, in `release.yml`):
  one row in every household-scoped table for two households; a household delete leaves no row of A in any
  `family_id` table or child table, B unchanged, files removed, and A's session, device refresh token, invitation,
  feed token, share link and pairing code no longer resolve while B's do; member deletion through RESTRICT keys.
- `src/components/account/__tests__/delete-account-dialog.test.tsx`, `src/app/dashboard/settings/__tests__/privacy-controls.test.tsx`,
  `src/components/layout/__tests__/dashboard-nav-delete-account.test.tsx`: the dialog (including a retained key after
  an unknown or in-progress attempt, whose later 401 counts as deleted), the Settings controls and the teen/child
  user-menu entry.
- `src/app/api/family/__tests__/join-vs-deletion.integration.test.ts` (Postgres, in `release.yml`): with a second
  connection holding the household lock, a join by code, a join by email invite and registration with an invite
  wait, then fail cleanly once the household is deleted, and no account is orphaned; `deleteHousehold` waits on the
  same lock; a real deletion racing a join always ends consistent.
- `e2e/account-deletion.spec.ts` also covers a teen deleting their own account from their Settings.
