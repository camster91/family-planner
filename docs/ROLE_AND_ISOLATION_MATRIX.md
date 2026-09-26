# Role and isolation matrix

Status: current as of 2026-09-26. Records Cameron's decisions D1–D9 on issue #102 as implemented, including D3
(chore photo ownership, expand phase) and anniversary own-edit (`Anniversary.created_by`).
Authority: `docs/architecture/AUTHORIZATION.md` (model and decision order) points here for per-domain
capability. The route-by-route evidence is `docs/security/API_ISOLATION_AUDIT.md`.

## How to read this

- **Household isolation applies to every cell.** Every private record is read and written only inside the
  caller's own household (`family_id`). A record from another household reads as not found or forbidden, and
  its data never appears in a response. That rule has no exceptions and is not repeated per row.
- **Roles.** `parent`, `teen` and `child` are human sessions. Teen and child are separate columns on purpose
  (AUTHORIZATION.md: "Do not assume teen equals child forever").
- **Shared device.** The shared household tablet session does not exist in the API yet (ADR 0002). Its column is
  `deferred (#157)` everywhere. Until device auth ships, a shared tablet signed in as a person has exactly
  that person's rights. AUTHORIZATION.md's shared-device defaults apply when #157 lands.
- **Cell values.**
  - `yes`: allowed for any record of the household.
  - `own`: allowed only for records about or belonging to the caller (the column used is named in the notes).
  - `no`: refused by the API (403, or 404 where the record is not visible to that role).
  - `—`: the operation does not exist.
- **Where it is enforced.** Role rules live in the route handlers. The shared helpers are
  `src/lib/role-capabilities.ts` (per-domain capability) and `src/lib/kid-access.ts` (which `/dashboard` pages
  a teen or child may open). Pages hide controls a role cannot use, but the API is always the enforcement
  point. Direct API calls are covered by the isolation tests listed in the audit.
- **Current role and household (D6).** Role and `family_id` are read from the database on every request, in
  the same query as the session-generation (`token_version`) check (`resolveSession` in `src/lib/session.ts`).
  The claims inside the JWT are never used for authorization, so a role change or a move to another
  household takes effect on the member's next request.

Columns: R = read/list, C = create, U = update, D = delete.

## Matrix

### Medical and safety (D1)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Medications | R | yes | own | own | deferred (#157) | `person_id = self`. |
| Medications | C | yes | no | no | deferred (#157) | |
| Medications | U: log a dose | yes | own | own | deferred (#157) | `PATCH /api/medications/[id]` with `markDoseTaken`. A sibling's medication is 404. |
| Medications | U: prescription fields | yes | no | no | deferred (#157) | A kid request without `markDoseTaken` is 403; prescription fields sent with a dose log are ignored. |
| Medications | D | yes | no | no | deferred (#157) | |
| Sick days | R | yes | own | own | deferred (#157) | `person_id = self`. Nested medications are also own-only. |
| Sick days | C | yes | own | own | deferred (#157) | A kid may report only themselves (`person_id = self`, else 403). |
| Sick days | U (temperature, symptoms, end) | yes | no | no | deferred (#157) | Own record 403, sibling's record 404. |
| Sick days | D | yes | no | no | deferred (#157) | Same as update. |
| Emergency contacts | R | yes | yes | yes | deferred (#157) | Deliberately kid-readable: a child home alone must find them. |
| Emergency contacts | C / U / D | yes | no | no | deferred (#157) | |

Pages: `/dashboard/emergency` and `/dashboard/sick-days` are on the kid allowlist, read-only apart from
"report myself sick" and "mark dose taken" on the kid's own medication.

### Handoff (D2)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Sitter handoff | R | yes (all fields) | yes, without share token | minimal fields | deferred (#157) | Child fields: `id`, `sitter_name`, `arrival_time`, `departure_time` (`CHILD_HANDOFF_FIELDS`). Withheld from a child: sitter phone, code words, authorised pickups, pet care, snacks, bedtimes, emergency/house/general notes. The share token and its expiry go to parents only. |
| Sitter handoff | C / U / D / rotate share link | yes | no | no | deferred (#157) | |
| Public share page (`/handoff/[token]`) | R | token holder | token holder | token holder | n/a | Bearer token, rate-limited and expiring, allowlisted fields. |

Page: `/dashboard/handoff` is on the kid allowlist and read-only for teens and children.

### Capture (D4)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Capture (AI quick add) | use (`POST /api/capture`) | yes | yes | no | deferred (#157) | A child gets 403 `{"error":"Ask a parent to add this."}` before any provider call or rate-limit write. |
| Capture | status (`GET /api/capture`) | yes | yes | yes | deferred (#157) | Returns `allowed`; for a child also `message: "Ask a parent to add this."`, which the capture box shows instead of the input. |

### Money (D5)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Allowance | R | yes | own | own | deferred (#157) | `to_user_id = self`. |
| Allowance | C / U (mark paid, cancel) | yes | no | no | deferred (#157) | |
| Budget (categories, transactions, stats) | R / C / U / D | yes | no | no | deferred (#157) | Unchanged. |

Page: `/dashboard/allowance` is on the kid allowlist; for kids it hides Add / Mark paid / Cancel.

### Lists, notes, dates, pickups (D9)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Lists | R | yes | yes | yes | deferred (#157) | |
| Lists | C (new list) | yes | yes | no | deferred (#157) | Child: 403 "Ask a parent to create a new list." |
| Lists | D | yes | no | no | deferred (#157) | |
| List items | C (add) / U (tick) | yes | yes | yes | deferred (#157) | On an existing list of the household. |
| List items | D | yes | no | no | deferred (#157) | |
| Pinned notes | R / C | yes | yes | yes | deferred (#157) | |
| Pinned notes | U | yes | own | own | deferred (#157) | `created_by = self`, else 403. |
| Pinned notes | D | yes | no | no | deferred (#157) | |
| Anniversaries | R / C | yes | yes | yes | deferred (#157) | |
| Anniversaries | U | yes | own | own | deferred (#157) | `created_by = self`, else 403. `created_by` is set on create and is not writable by PATCH. Rows created before the column existed have `created_by` NULL and are parent-edit-only. |
| Anniversaries | D | yes | no | no | deferred (#157) | |
| Pickups | R / C / U (complete) | yes | yes | yes | deferred (#157) | |
| Pickups | D | yes | no | no | deferred (#157) | |

Page: `/dashboard/lists` (and its sub-pages) is on the kid allowlist and in the kid nav. Create-list links are
hidden for a child; delete-list and swipe-to-delete-item are hidden for teens and children.

### Other domains (unchanged by this round; recorded for completeness)

| Domain | R | C | U | D | Notes |
|---|---|---|---|---|---|
| Events (calendar) | all | all | parent | parent | Page `/dashboard/calendar` is parent-only in the UI (kid allowlist). |
| Chores | all | parent | parent, or assignee for status | parent, or assignee | Completion open to any member for any household chore. Photo (D3): must be an `/api/upload` result owned by the household, else 400; see audit. |
| Rewards | all | parent | parent | — | Claim: all. Approve: parent. |
| Wishlist | all | all | requester or parent | requester or parent | Status changes: parent. |
| Meals | all | all | all | all | `cook_id` verified in household. |
| Projects and tasks | all | all | parent | parent | |
| Messages | all | all | all (mark read) | — | |
| Activity, analytics | all | — | — | — | |
| Notifications | own | parent (to a household member) | own | own | |
| Locations | parent | parent | — | parent | Precise addresses. |
| Travel mode | parent | — | parent | — | |
| Family settings, features, invites, AI settings, feed token | parent (members list and features read: all) | parent | parent | parent | |
| Account (`/api/users`, export) | own | — | own | own | Export includes travel fields for parents only. |

Shared device: `deferred (#157)` for every row. Teen and child: identical in this table unless a column
names them, which is the D8 audit result for these domains.

## Deferred

- **D7 / #157 shared-device sessions.** No device-session concept exists yet. When it does, each row above
  needs a shared-device value, defaulting to AUTHORIZATION.md's shared-surface list (glanceable schedule,
  approved household tasks, meals, groceries) and excluding finance, messages, addresses, medical notes,
  account settings, tokens and destructive operations.
- **D3 contract step.** Photo ownership is implemented with an `Upload` record (expand phase). Legacy files
  with no `Upload` row are still served through the referencing chore of the same household until they are
  backfilled and the fallback is removed; see the audit's "D3 legacy path and contract step".

## Changing this matrix

Change the route handler, `src/lib/role-capabilities.ts` / `src/lib/kid-access.ts`, the isolation test for the
domain and this file in the same PR. Add two-household negative cases for any new family-owned domain.
