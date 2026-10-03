# Role and isolation matrix

Status: current as of 2026-10-02. Records Cameron's decisions D1–D9 on issue #102 as implemented, including D3
(chore photo ownership, expand phase) and anniversary own-edit (`Anniversary.created_by`), and owner decision O-37
(teens see the calendar, meals, Help, their notifications and their own Settings; see "Teen pages and personal
Settings" below).
Authority: `docs/architecture/AUTHORIZATION.md` (model and decision order) points here for per-domain
capability. The route-by-route evidence is `docs/security/API_ISOLATION_AUDIT.md`.

## How to read this

- **Household isolation applies to every cell.** Every private record is read and written only inside the
  caller's own household (`family_id`). A record from another household reads as not found or forbidden, and
  its data never appears in a response. That rule has no exceptions and is not repeated per row.
- **Roles.** `parent`, `teen` and `child` are human sessions. Teen and child are separate columns on purpose
  (AUTHORIZATION.md: "Do not assume teen equals child forever").
- **Shared device.** Device auth, pairing, sessions, elevation and revocation are **implemented (behind
  SHARED_DEVICE_ENABLED)** by #240, default off (`docs/architecture/SHARED_DEVICE.md` §18). What ships: the
  read surface (the Today board DTO with a device audience at `GET /api/device/today`, names-only
  `GET /api/device/me`), parent device management and the tablet PIN, and, under elevation, rename or remove
  **this** tablet. Every `no` in the column is enforced: existing routes accept only person sessions, guarded
  by the route-allowlist test. #274 adds the §9.2 writes (grocery tick/untick, grocery quick add, chore
  complete due today, and the tablet's own 2-minute chore Undo) behind a per-household opt-in that defaults
  off (`device writes (opt-in)` below), and board settings under elevation. Other cells marked `elevated only`
  remain **proposed** (#157 contract; no such device route exists yet). `O-n` points to an owner decision in
  SHARED_DEVICE.md §16. A tablet signed in as a person still has exactly that person's rights. Shared-device
  values:
  - `no`: a device session is refused (existing routes authenticate only person sessions). Elevation does not
    change this unless the cell says `elevated only`.
  - `elevated only`: allowed only while a parent is elevated on the tablet (5 min idle / 15 min max).
  - a field description (for example `open grocery items only`): read through the device Today board DTO only.
  - `device writes (opt-in)`: allowed only when the household's `Family.device_writes_enabled` is on (default
    off), with an `Idempotency-Key` and a "Who's this?" member of the device's household (unverified
    attribution, O-5; it grants nothing). Every changed row is audited as `device.member_action`.
- **Cell values.**
  - `yes`: allowed for any record of the household.
  - `own`: allowed only for records about or belonging to the caller (the column used is named in the notes).
  - `no`: refused by the API (403, or 404 where the record is not visible to that role).
  - `—`: the operation does not exist.
- **Where it is enforced.** Role rules live in the route handlers. The shared helpers are
  `src/lib/role-capabilities.ts` (per-domain capability) and `src/lib/kid-access.ts` (which `/dashboard` pages
  a teen or child may open: `canRoleAccessPath`, used by the middleware, the dashboard layout and every nav
  filter). Pages hide controls a role cannot use, but the API is always the enforcement
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
| Medications | R | yes | own | own | no | `person_id = self`. |
| Medications | C | yes | no | no | no | |
| Medications | U: log a dose | yes | own | own | no | `PATCH /api/medications/[id]` with `markDoseTaken`. A sibling's medication is 404. A logged dose clears `next_dose_at`; only a parent's explicit `next_dose_at` or `interval_hours` (1–48) sets the next one — it is never guessed from the schedule. |
| Medications | U: prescription fields | yes | no | no | no | A kid request without `markDoseTaken` is 403; prescription fields sent with a dose log are ignored. |
| Medications | D | yes | no | no | no | |
| Sick days | R | yes | own | own | no | `person_id = self`. Nested medications are also own-only. |
| Sick days | C | yes | own | own | no | A kid may report only themselves (`person_id = self`, else 403). |
| Sick days | U (temperature, symptoms, end) | yes | no | no | no | Own record 403, sibling's record 404. |
| Sick days | D | yes | no | no | no | Same as update. |
| Emergency contacts | R | yes | yes | yes | no (O-10) | Deliberately kid-readable: a child home alone must find them. |
| Emergency contacts | C / U / D | yes | no | no | no | |

Pages: `/dashboard/emergency` and `/dashboard/sick-days` are on the kid allowlist, read-only apart from
"report myself sick" and "mark dose taken" on the kid's own medication.

### Handoff (D2)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Sitter handoff | R | yes (all fields) | yes, without share token | minimal fields | no | Child fields: `id`, `sitter_name`, `arrival_time`, `departure_time` (`CHILD_HANDOFF_FIELDS`). Withheld from a child: sitter phone, code words, authorised pickups, pet care, snacks, bedtimes, emergency/house/general notes. The share token and its expiry go to parents only. |
| Sitter handoff | C / U / D / rotate share link | yes | no | no | no | |
| Public share page (`/handoff/[token]`) | R | token holder | token holder | token holder | n/a | Bearer token, rate-limited and expiring, allowlisted fields. |

Page: `/dashboard/handoff` is on the kid allowlist and read-only for teens and children.

### Capture (D4)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Capture (AI quick add) | use (`POST /api/capture`) | yes | yes | no | no | A child gets 403 `{"error":"Ask a parent to add this."}` before any provider call or rate-limit write. |
| Capture | status (`GET /api/capture`) | yes | yes | yes | no | Returns `allowed`; for a child also `message: "Ask a parent to add this."`, which the capture box shows instead of the input. |

### Money (D5)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Allowance | R | yes | own | own | no | `to_user_id = self`. |
| Allowance | C / U (mark paid, cancel) | yes | no | no | no | |
| Budget (categories, transactions, stats) | R / C / U / D | yes | no | no | no | Unchanged. |

Page: `/dashboard/allowance` is on the kid allowlist; for kids it hides Add / Mark paid / Cancel.

### Lists, notes, dates, pickups (D9)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Lists | R | yes | yes | yes | open grocery items only | |
| Lists | C (new list) | yes | yes | no | no | Child: 403 "Ask a parent to create a new list." The UI no longer offers type `meal_plan` for a new list (ADR-0007 O-8). The server still accepts it so installed Android bundles keep working; existing `meal_plan` lists stay readable and editable. |
| Lists | D | yes | no | no | elevated only | |
| List items | C (add) / U (tick) | yes | yes | yes | device writes (opt-in): tick/untick and add on the household's grocery/shopping lists only (`/api/device/lists/**`, #274); no other edit or delete | On an existing list of the household. Tick/untick may be queued offline and retried with an `Idempotency-Key` (#162, person sessions only; `docs/architecture/OFFLINE_SYNC.md`). Optional `amount`, `unit`, `ingredient_id` (ADR-0007, #251): `ingredient_id` must be an `Ingredient` of the household, else 400 "Ingredient not found" (same answer for a foreign and a missing id). Unticking a recipe row that already has an open twin: 409 `DUPLICATE_OPEN_ITEM`. `source` is not client-writable. |
| List items | D | yes | no | no | elevated only (not built; the person routes refuse or ignore a device) | `DELETE /api/lists/items/[id]` (#289; a paired device is refused, 403 `DEVICE_WRITE_NOT_ALLOWED`) and the deprecated `DELETE /api/lists/items/delete?itemId=` (installed Android builds) share one household-scoped delete: another household's item is 404, like a missing one. |
| Store section of an item ("Move to…", `PATCH /api/lists/items/section`, #273) | U | yes | yes | yes | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | Like editing an item (D9). Grocery/shopping lists only (400 otherwise). Sets the household's choice for that item name (`GrocerySectionPreference`, unique per household and normalized name) and, for a row linked to an ingredient, that ingredient's `section`; `null` clears it. The item is looked up with the caller's household (404, foreign and missing alike). Online only (not in the offline queue). |
| Store-section sorting of a list (`PATCH /api/lists/section-sort`, #273) | U | yes | yes | no (403 `SECTION_SORT_FORBIDDEN`) | no (403, before person auth) | Changes how the list looks for the whole household, so it follows list creation. Grocery/shopping lists only; the list is looked up with the caller's household (404). A child sees the current setting as text. |
| Walking order (shopping trips recorded by ticks, #273) | R (as section order) | yes | yes | yes | no | Recorded as a side effect of a person ticking a grocery row; section ids and times only; read back as the list's section order. Exported with the household. |
| Pinned notes | R / C | yes | yes | yes | no (O-11) | |
| Pinned notes | U | yes | own | own | no | `created_by = self`, else 403. |
| Pinned notes | D | yes | no | no | no | |
| Anniversaries | R / C | yes | yes | yes | no (O-11) | |
| Anniversaries | U | yes | own | own | no | `created_by = self`, else 403. `created_by` is set on create and is not writable by PATCH. Rows created before the column existed have `created_by` NULL and are parent-edit-only. |
| Anniversaries | D | yes | no | no | no | |
| Pickups | R / C / U (complete) | yes | yes | yes | no (O-11) | |
| Pickups | D | yes | no | no | no | |

Page: `/dashboard/lists` (and its sub-pages) is on the kid allowlist and in the kid nav. Create-list links are
hidden for a child; delete-list and swipe-to-delete-item are hidden for teens and children.

Feature gate (ADR-0007 O-11, #251): every `/api/lists/**` handler now calls `featureGate('lists')` after
authentication and answers 403 when the household has lists off, matching the UI gate. Lists is a core feature
(the features API refuses to turn it off), so this only affects a stored flag blob that already has `lists: false`.

### Meals and recipes (ADR-0007, #251)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Meals | R / C / U / D | yes | yes | yes | R: dinners only, recipe name, cook name, linked recipe title and prep time; C/U: elevated only (when tablet flows exist); D: no | `featureGate('meals')`. `cook_id` and the optional `recipe_id` are verified in the household (400, same answer for a foreign and a missing id). Several meals may share a (date, meal type) slot (O-1). Device never reads `notes` or recipe instructions/description. UI: `/dashboard/meals` and `/dashboard/meals/recipes/[id]` are open to parents and teens (O-37; the teen sees the same add/edit/delete meal controls, which the API allows, and the recipe page has no edit or delete control); children reach meals through the API and the Today board only. |
| Recipes (`/api/recipes`, `/api/recipes/[id]`) | R | yes | yes | yes | tonight's recipe title and prep time only (via the board DTO); never the missing-ingredient count, which only a member's board gets (#122) | `featureGate('meals')`. Every lookup is scoped by `family_id`; another household's recipe is a 404 identical to a missing id. |
| Recipes | C / U | yes | yes | no (403) | no | O-7. Nested ingredients: `ingredient_id` must be in the household (400 "Ingredient not found"); `name` is upserted by (household, normalized name) and never matches another household's ingredient. Bodies are strict: `family_id`, `created_by` or other unknown keys are a 400. |
| Recipes | D | yes | no (403) | no (403) | no | O-7. Meals and grocery items keep their rows (FK `SET NULL`; the meal keeps its `recipe_name` snapshot). A recipe still referenced by a frozen legacy `MealPlanEntry` is refused with 409 `RECIPE_IN_ARCHIVED_PLAN` (that FK cascades and legacy rows are never modified). |
| Recipe → groceries (`POST /api/lists/items/from-recipe`, #253) | C | yes | yes | yes | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | Needs `meals` and `lists`. Recipe, meal and list are looked up with the caller's `family_id` (404, foreign and missing alike); ingredients come from the recipe (a foreign `ingredientIds` entry is 400). Without `listId` the default grocery list is resolved or created, so a child's first add may create "Groceries". `Idempotency-Key` required; records scoped to `user:<id>`. |
| Undo recipe add (`POST /api/lists/items/undo-add`, #253) | D (own add only) | yes | yes | yes | no (403) | O-5: only the person who made that request, within 10 minutes, only its still-unticked rows (403 another member, 404 another household, 409 late). Every other item delete stays parent-only. |
| Default grocery list (`POST /api/lists/default-grocery`, #253) | R / C | yes | yes | no (403) | no | Find-or-create under a per-household advisory lock; used by capture (parent/teen, like list creation). |

### Food inventory (#263)

| Domain | Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Inventory items (`/api/inventory`, `/api/inventory/[id]`) | R | yes | yes | yes | no (no device inventory route; only the Today board "Use soon" tile, row below) | `featureGate('inventory')` (off by default for new and existing households). Every lookup is scoped by `family_id`; another household's item is a 404 identical to a missing id. |
| Inventory items | C / U / D | yes | yes | no (403 `INVENTORY_WRITE_FORBIDDEN`) | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | `ingredient_id` must be an `Ingredient` of the household (400 `INGREDIENT_NOT_FOUND`, same answer for a foreign and a missing id). Without it the item is linked to a same-household ingredient with the same normalized name, if any; no `Ingredient` is ever created from an item, and another household's ingredient is never matched. Bodies are strict: `family_id`, `added_by` or other unknown keys are a 400. Teens may delete (using up food is the main write). |
| Used it / Throw away (`POST /api/inventory/[id]/consume`, `/discard`, #158/#121) | U (+ history row) | yes | yes | no (403 `INVENTORY_WRITE_FORBIDDEN`) | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | The item is looked up with the caller's `family_id` (404, foreign and missing alike). Writes one `InventoryAdjustment` in the same household (kind, amount change, actor, time); nothing is deleted. Optional `Idempotency-Key` scoped `user:<id>`; the adjustment carries the record id, so a retry never adds a second row. |
| Undo a use / throw-away (`POST /api/inventory/adjustments/[id]/undo`) | U | yes | yes | no (403) | no (403 `DEVICE_WRITE_NOT_ALLOWED`) | Any parent or teen of the household may undo any member's change (the family shares one fridge). Adjustment looked up with `family_id` (404 `INVENTORY_ADJUSTMENT_NOT_FOUND`, foreign and missing alike). Only the latest change to an item (409 `INVENTORY_UNDO_CONFLICT` otherwise). |
| Inventory history (`GET /api/inventory/adjustments`) | R | yes | yes | yes | no | Household rows only, newest first, ≤ 100 per page; item name and status, actor id; never `family_id` or the idempotency record id. |
| Use soon (`GET /api/inventory/use-soon`) | R | yes | yes | yes | no (same as above) | Board-safe fields only: item id, name, location, expiry day, date kind, days left, status and label. Active items only; a passed use-by day is never listed. |
| Use soon on the Today board (#262 tile) | R | yes | yes | yes | item id, name, location, expiry day and date kind only, via the board DTO (`GET /api/device/today`), when `inventory` is on | Same household food names as the grocery items the board already shows. Read-only for every audience. Person boards link to `/dashboard/inventory` (on the kid allowlist); the device gets no link. No amount, author, ingredient link or notes. |
| What can I cook (`GET /api/inventory/cook`) | R | yes | yes | yes | no | Needs `inventory` and `meals`. Reads only the household's recipes and items. "Add missing to groceries" is the existing `from-recipe` route (row above), so its rules apply. |
| Fridge photo scan (`POST /api/inventory/scan`, #265) | Suggest (no write) | yes | no (403 `INVENTORY_SCAN_FORBIDDEN`) | no (403) | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | Off (404 `INVENTORY_SCAN_DISABLED`) until the deployment sets a provider key; then `featureGate('inventory')`. Parent only by decision: the scan spends the deployment's paid provider quota under one household daily cap, while teens keep adding items by hand. Returns suggestions only; adding them is the item create row above, so its rules apply. Rate limits per user and household; the photo is sent to the provider and never stored. |

Page: `/dashboard/inventory` is on the kid allowlist (teens edit, use up, throw away and undo; children read, with
the add/edit/used/throw-away/undo controls hidden) and, when the feature is on, in the user menu (touch) and the command palette. Its "View recipe" link is shown only to roles that
may open `/dashboard/meals/recipes/[id]` (parents and teens, O-37). "Scan fridge" is shown only to parents when the scan is configured.

### Other domains (unchanged by this round; recorded for completeness)

| Domain | R | C | U | D | Shared device (proposed) | Notes |
|---|---|---|---|---|---|---|
| Events (calendar) | all | all | parent | parent | R: `id`, title, start/end, is-task, imported-calendar name/colour only; C/U/D: elevated only (when tablet flows exist) | Pages: `/dashboard/calendar` and `/dashboard/calendar/create` are open to parents and teens (O-37); the teen month view serialises the same event fields `GET /api/events` already returns to them and has no edit link, because PATCH/DELETE are parent-only. `/dashboard/calendar/edit` stays parent-only (kid-access). Children: no calendar page. Device never reads `location` or `description`. |
| Event import (`POST /api/calendar/import-suggestions`, `…/commit`, `…/undo`, #270) | — | parent, teen: suggest (child 403 `EVENT_IMPORT_FORBIDDEN`); commit the reviewed events in one transaction (child 403) | — | own import only: `…/undo` takes the commit's signed undo token (HMAC over user, household, event ids and time), ≤ 10 min; 403 `UNDO_TOKEN_INVALID` for a forged, edited, another person's or another household's token, 409 late; never accepts event ids, so it cannot reach events made by hand; child 403 | no (403 `DEVICE_WRITE_NOT_ALLOWED` on all three, before person auth) | Suggestions are off (404 `EVENT_IMPORT_DISABLED`) until the deployment sets `EVENT_IMPORT_ANTHROPIC_API_KEY`; all three need `featureGate('calendar')`. Suggestions write nothing and read no household rows. Commit applies the `POST /api/events` field rules, writes only to the session household with `created_by` = caller, and is idempotent per batch key. Rate limits on suggestions per user and household; the text/photo/PDF is sent to the provider and never stored. Undo is the only event delete open to teens, and only for their own import of the last 10 minutes (same idea as the grocery undo, O-5); `DELETE /api/events` stays parent-only. The button is on `/dashboard/calendar`, which parents and teens open (O-37); it shows only when the provider is configured and the role may import. `docs/architecture/CALENDAR_IMPORT.md`. |
| Chores | all | parent | parent, or assignee for status | parent, or assignee | R: title, due day, status, assignee name, picture key (`icon`, #272); complete: device writes (opt-in), chores due today only, waits for a parent's check (O-4, #274), plus Undo of the tablet's own completion within 2 minutes; verify: elevated only (not built) | Completion open to any member for any household chore. Check (`POST /api/chores/verify`): parent only; `decision: 'approve'` verifies, `decision: 'reject'` sends a `completed` chore back to `pending` with the reason (a verified chore is 409). Undo (`POST /api/chores/uncomplete`, #268): parent, or the assignee (a sibling 403); only from `completed` (a parent-verified chore is 409 `CHORE_ALREADY_VERIFIED`), an open chore is a no-op success, a foreign chore 403. a legacy recurring chore's next occurrence is removed only by the id completion recorded (`successor_id`). Photo (D3): must be an `/api/upload` result owned by the household, else 400; see audit. Picture routines (#272): `icon`, `routine`, `routine_order` follow the chore's rules (create: parent; PATCH: parent or the assignee, a sibling 403, another household 403); the kid home groups the caller's own chores due today by routine. The shared device gets only the `icon` catalogue key, never the routine name. |
| Take turns on a repeating chore (`rotation` on `POST /api/chores/create` and `PATCH /api/chores`, O-39) | all (`GET /api/chores?id=` returns the series' `rotation`; the chores page shows "Takes turns · next: Alex") | parent | parent (the chore's own assignee 403, like `assigned_to`; another household 403/404) | parent (`rotation: null`) | no: the tablet and kid views only see each occurrence's assignee, as before | 2–8 distinct members, **all of the caller's household** (another household's member or an unknown id: 400 `Everyone taking turns must be in your family`, nothing written); repeating chores only (400 `Taking turns needs a chore that repeats`). The order is stored on the series template (`Chore.rotation_member_ids`), each occurrence's place in `rotation_index`; generation (`expandSeriesInTx`) only reads members of the template's household and skips anyone who left. Removing a member (O-34) or deleting an account drops them from every rotation of that household in the same transaction. `src/lib/chore-rotation.ts`; tests `src/app/api/chores/__tests__/rotation.test.ts` (two households), `src/lib/__tests__/chore-rotation*.test.ts`. |
| Rewards | all | parent | parent | — | no | Claim: all. Approve: parent. Every handler 403s unless Rewards AND Points & streaks are on (#248). |
| Wishlist | all | all | requester or parent | requester or parent | no | Status changes: parent. |
| Meals | all | all | all | all | see "Meals and recipes" above | `cook_id` and `recipe_id` verified in household. Device never reads `notes`. |
| Projects and tasks | all | all | parent | parent | no | Adding a task to an existing, active project (`POST /api/projects/[id]/tasks`, "Add task" on the project page, #289) is open to every member; the project and any assignee must be in the caller's household (404, foreign and missing alike). |
| Messages | all | all | all (mark read) | — | no | |
| Activity, analytics | all | — | — | — | no | `/api/analytics` (the leaderboard) 403s unless Analytics AND Points & streaks are on (#248). |
| Notifications | own | parent (to a household member) | own | own | no | Every row goes through `src/lib/notification-delivery.ts`, which honours the recipient's preferences (below). |
| Notification preferences (`/api/users/preferences`, #286) | own | — | own | — | no (403 `DEVICE_WRITE_NOT_ALLOWED` on GET and PATCH, before person auth) | Three switches: "Chores and rewards", "Calendar events", "Family messages" (default on). Strict body: nobody can read or change another member's, a parent included. Parents and teens (O-37) change theirs in Settings → Notifications (with quiet hours); children, who cannot open Settings, from the user menu → Notifications. Password reset, email verification, invites and a parent's `system` notices are always sent. |
| Locations | parent | parent | — | parent | no | Precise addresses. |
| Travel mode | parent | — | parent | — | no | |
| Family settings, features, invites, AI settings, feed token | parent (members list and features read: all) | parent | parent | parent | members: names only; features: calendar/chores/meals/lists booleans only; everything else no | Feature toggles, including Points & streaks (`gamification`, #248): PATCH is parent-only, teen/child 403. |
| Family code (`POST /api/family/invite-code`, "Get a new family code", O-34) | parent (GET /api/family shows it to parents only) | — | parent: replaces the code; the old one is refused at once | — | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | Teen/child 403. Only the caller's own household. Rate limited 10 an hour per parent. Audited as `invite_code.rotated` (never the code). New codes are 12 characters, shown `XXXX-XXXX-XXXX`; a unique collision is retried with a fresh code (503 after 5). Older 24-character and cuid codes are never rewritten and keep working. Join and lookup accept any case, spaces and dashes, and are rate limited per account and per IP before the code is read (join 10/hour per account, 30/hour per IP, 10/hour per account+IP; lookup 30/hour per account, 60/hour per IP; brute-force math in `src/lib/family-invite.ts`). |
| Remove a member (`DELETE /api/family/members/[id]`, "Remove from household", O-34) | — | — | — | parent, on **another** member of their **own** household; never themselves (400 `CANNOT_REMOVE_SELF`), never the last parent (409 `LAST_PARENT`); another household's member or a missing id 404 `MEMBER_NOT_FOUND`; teen/child 403 | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) | The removed person keeps their account; their `family_id` is cleared and `token_version` bumped, so their next request with any old session is 401 and they read nothing of the household. Tablets they paired or confirmed are revoked; their elevation, PIN, unfinished pairings, unaccepted invites, calendar connections, idempotency records, push subscriptions, notifications and activity rows go. Household content stays: created rows go to the removing parent, open chores are reassigned to the removing parent, finished chores and messages stay. Audited as `member.removed` (plus `device.removed` per tablet). `src/lib/member-removal.ts`; tests `src/app/api/family/__tests__/member-controls.test.ts`. |
| Household deletion (`DELETE /api/family`, D-3; joins wait on the same household lock and then fail cleanly) | — | — | — | the household's **only** parent, with the current password and the household name typed (another parent: 409 `OTHER_PARENTS_EXIST`); teen/child 403 | no (403 `DEVICE_WRITE_NOT_ALLOWED`) | Deletes every member account and all household rows in an explicit sequence (`src/lib/account-deletion.ts`), revokes device sessions, invitations, feed token, share links and calendar connections, and removes uploaded files. |
| Account (`/api/users`, export) | own | — | own | own | no | **Delete own account (D-3, `product/ACCOUNT_DELETION.md`):** every role, with the current password and typed `DELETE`; the only parent of a household gets 409 `LAST_PARENT` (they delete the household instead); household content the member created is handed to the earliest other parent; a paired device gets 403 `DEVICE_WRITE_NOT_ALLOWED`. `GET /api/users/deletion` describes the caller's own household only. Teens delete their own account from their own Settings (O-37); children, who cannot reach Settings, from the user menu ("Delete my account"). Both are account only, no household option. Export includes travel fields for parents only. Export (ADR-0007, #251) adds the household's `FamilyMeal` rows (`meals`) and the ADR-0007 backfill `ImportJob` summaries (`mealBackfillJobs`, every member, because they archive legacy rows every member already exports); the legacy `mealPlans`/`shoppingLists` stay; other import jobs stay parent-only. Export (#263) adds the household's `InventoryItem` rows (`inventory`, every member, without `family_id`; #158 adds date kind, category, bought/opened days and status, and used-up/thrown-away items stay in it) and (#158/#121) the household's `InventoryAdjustment` history (`inventoryAdjustments`, every member, without `family_id` or the idempotency record id). Export (#273) adds the household's `grocerySectionPreferences` and `groceryShoppingSessions` (every member, without `family_id`). Export (#286) adds the caller's own `notificationPreferences`. |
| Connected calendars — two-way Google/Outlook sync (#264) | parent (teen/child 403 `PARENT_REQUIRED`) | parent (own account only) | own connection only: calendar choice, push mode; any parent: Sync now | any parent in the household (disconnect) | no (401: a device is not a person session) | Implemented, **dormant unless configured** (every route 404 until `CALENDAR_TOKEN_KEY`, `APP_URL` and a provider's client id/secret are set). Listing a member's provider calendars is that member only (403 for another parent). Tokens are never returned. Imported events are ordinary events (rules of the Events row). `docs/architecture/CALENDAR_SYNC.md`. |
| Calendar subscriptions — read-only ICS feeds (`/api/calendar/subscriptions/**`, #232) | parent, teen (child 403); the host-only `url_hint` is parent only, the feed URL is never returned | parent (teen/child 403) | parent: rename/recolour only, the URL cannot change (teen/child 403); parent, teen: refresh now (child 403) | parent (teen/child 403); removes only that feed's imported events | no (a device cookie is refused) | Every lookup is `where { id, family_id }` via `authenticateWithFamily`: another household's id is a 404 identical to a missing one, and the role check runs before the lookup. Feed URL stored AES-256-GCM encrypted, public addresses only. Imported events are ordinary events (rules of the Events row). Added from source for route inventory F-4; tests in `src/app/api/calendar/subscriptions/__tests__/isolation.test.ts`. `docs/architecture/CALENDAR_IMPORT.md`. |
| Shared devices (list, rename, revoke, pairing codes, audit) | parent | parent | parent | parent (revoke) | this device only: rename/revoke elevated only | Implemented (behind SHARED_DEVICE_ENABLED), #240; teens and children get 403 `PARENT_REQUIRED`. |
| Tablet elevation PIN | own (parent) | own (parent) | own (parent) | own (parent) | used, never read | Implemented (behind SHARED_DEVICE_ENABLED), #240 (O-1 confirmed). Set/change needs the current password; a password reset deletes it. |

Teen and child: identical in this table unless a column names them, which is the D8 audit result for these
domains.

### Household search (route inventory F-3)

`GET /api/search?q=` (2–100 characters, case-insensitive "contains", at most 5 per type and 30 in all, fixed
order) and the `/dashboard/search` page. It only finds records the caller may already read through the domain APIs
above, and each result links to a page the caller's role may open (`src/lib/search-result-href.ts`, which uses the
kid allowlist), so search never widens what a teen or child can reach. A type is left out while the household has
its feature off.

| Searched | Feature | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|---|
| Members (name) | `family` | yes | no | no | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth; not on the device allowlist) | Name and role word only; never email, age or points. |
| Events (title, description, location) | `calendar` | yes | yes (O-37) | no | no | Links to the month on `/dashboard/calendar` (parents and teens). |
| Chores (title, description) | `chores` | yes | no | no | no | Assignee name and status in words. |
| Lists (name, description) | `lists` | yes | yes | yes | no | |
| List items (text) | `lists` | yes | yes | yes | no | Looked up through the list's household; links to the list. |
| Recipes (title, description) | `meals` | yes | yes (O-37) | no | no | Links to `/dashboard/meals/recipes/[id]` (parents and teens). |
| Pinned notes (title, body) | `notes` | yes | no | no | no | The body is matched but never returned. |
| Food inventory (name) | `inventory` | yes | yes | yes | no | Active items only; used-up and thrown-away items are left out. |
| Budget, transactions, allowance, messages, medical, sick days, locations, handoff, projects, rewards, wishlist, anniversaries | — | no | no | no | no | Not searched for anyone. |

Teen and child columns follow `canRoleAccessPath`: events, chores, recipes and notes are readable to them through
their APIs, but search returns a type only when the role may open its page. Since O-37 a teen may open the calendar and
recipe pages, so `GET /api/search` returns events and recipes to a teen (fields they already read through
`/api/events` and `/api/recipes`); chores and notes stay out. Page: `/dashboard/search` is parent-only (not
on the kid allowlist); the command palette offers "Search the household" only to roles that may open it.

### Household audit history (#285, PR101 D-4)

`GET /api/audit?limit=&cursor=` and Settings → Recent changes (`/dashboard/settings/activity`). ADR-0008.

| Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|
| Read the household's history | yes | no (403) | no (403) | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth; not on the device allowlist) | Own household only; newest first; cursor-paged, 1–50 per page; `private, no-store`. Reading prunes the household's rows older than 12 months. |
| Open Recent changes | yes | no (redirect: a teen may open only the Settings page itself, never a sub-route; page re-checks the role) | no | no | Linked from Settings → Family for parents only. |
| Rows written | a parent's feature toggles, board-settings changes, invites created/cancelled, tablet pair/rename/remove, beta usage counts on/off (#287), a new family code and a removed member (O-34) | — (they cannot make these changes) | — | the elevated parent's rename, removal and board-settings changes on the tablet (`actor_kind: device`) | Also `member.joined` for anyone who joins by code, invite or invite registration (their own row, with their role), and `member.left` (role word only, no actor) when a member deletes their account. Same transaction as the change. |
| Export (`GET /api/users/export`) | every row of the last 12 months | only rows they acted in | only rows they acted in | — | No `family_id` in the export. |

Summaries are fixed templates plus names (feature title, member or tablet name, role word): never an email, code,
token, place or colour. An actor who has left the household is shown as "A former member".

### Beta usage counts (#287, PR101 D-6)

`PATCH /api/family/beta-metrics` and the "Share beta usage counts" switch in Settings → Privacy & data.
Counts only (`BetaMetricDaily`: household, UTC day, fixed metric name, count), off by default.

| Action | Parent | Teen | Child | Shared device | Notes |
|---|---|---|---|---|---|
| Turn the household's counts on or off | yes (own household) | no (403) | no (403) | no (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth; not on the device allowlist) | Strict body `{ enabled }`; off deletes the household's counts in the same transaction; a real change adds a household audit line. `private, no-store`. |
| See the switch | yes (Settings, value read on the server) | no (a teen's Settings is personal sections only; the server never reads the value for them) | no | no | |
| Actions that are counted | whatever the existing routes already allow them (no role changes) | same | same | a tablet chore completion (through the shared `completeChore`) | Eight success paths add one to the household's number for the day: never who did it. No-op while the household is opted out. |
| Export (`GET /api/users/export`) | the household's counts and switch | same | same | — | No `family_id`, no user reference. |
| Read the counts | — (no app route) | — | — | — | Only `npm run beta:scorecard`, run by the operator, households as numbers. |

### Account export

`GET /api/users/export` (Settings → Data Export, and "Download my data" in the delete dialog). Per-person
domains: only the caller's own rows in their current household, no `family_id`, never another member's or
household's rows. Full key list: `architecture/API_CONTRACTS.md` "Export completeness, analytics days and the
event list".

| Domain | Parent | Teen | Child | Notes |
|---|---|---|---|---|
| Allowance (D5) | paid to them or given by them | paid to them | paid to them | |
| Wishlist, notes, pickups, anniversaries, chore assignments, upload metadata | own rows | own rows | own rows | Upload rows only, never file bytes; chore assignments without `idempotency_key`. |
| Sick days, medications, emergency card (D1) | about them | about them | about them | Another member's medical rows never appear, even for a parent. |
| Handoffs (D2) | they created | they created, without share expiry | they created, child fields only | `share_token` is never exported. |
| Saved places, budget categories, calendar connections | own rows | — (empty) | — (empty) | Parent-only like their GET routes; connections without tokens or sync cursor. |
| Calendar subscriptions | they added | they added | — (empty) | Never the feed URL. |
| Push registrations | own | own | own | `id` and dates only: no endpoint, no keys. |

### Today board page (#119 / #159)

`/dashboard/today` (the fridge/wall tablet view) is on the kid allowlist for parent, teen and child. It is read-only
and shows only data every member may already read above: events (without location or description), chores
(title, due day, status, assignee name), dinners (recipe and cook name, plus the linked recipe's title and prep
time, without notes) and open grocery items. It
reads no finance, allowance, messages, medical, location, handoff or account data. The page offers links to
calendar, chores, meals and features only to roles that may open them. DTO:
`src/app/dashboard/today/today-board-data.ts`.

#262 (FridgeCal-style 16:10 hub) adds, for every audience: each member's board colour (a palette key; always
shown next to the name), which member added a local event (`addedById`; not attendance, events have no attendee
field), the chore approval state as text ("waiting for a parent's check" for `completed`) and, when the household
opted in, a weather tile (place label, temperatures, summary; never coordinates). With the household's `inventory`
feature on, a read-only "Use soon" tile (#263 data): up to 5 items expired or due within 3 days of the viewer's day
(name, place, expiry in words), then "N more to use soon"; it is left out when nothing is due. Still no points, XP
or streaks on the board (see "Points & streaks setting" below).

| Board settings (#262) | Parent | Teen | Child | Shared device |
|---|---|---|---|---|
| `GET` / `PATCH /api/family/board-settings` (member colours, weather opt-in, place, unit) | yes | 403 | 403 | no (401, route allowlist) |
| `GET /api/family/board-settings/places` (place search) | yes | 403 | 403 | no (401, route allowlist) |
| Settings UI (`/dashboard/family/settings` "Today board") | shown | not rendered | not rendered | n/a |
| Weather tile on the board | read | read | read | read (same DTO) |

Weather is off per household by default (`Family.weather_enabled = false`); with it on, only the coarse place
(coordinates rounded to 2 decimals) is sent to Open-Meteo, server-side, and the server kill switch
`WEATHER_ENABLED` is off unless explicitly set to `1`/`true`, so weather is unavailable everywhere until it is set.

#271 (visible sync and calm display) adds a change check for the board, "Updated … ago" in words, and, in fridge
mode only, a calm frame after a household-set idle time (clock, date, weather when on, the next event's title and
time, tonight's dinner title) with optional night dimming and optional family photos.

| Visible sync and calm display (#271) | Parent | Teen | Child | Shared device |
|---|---|---|---|---|
| `GET /api/family/board-version` (`{ version }` of the caller's own board) | yes | yes | yes | no (401, route allowlist) |
| `GET /api/device/today/version` (`{ version }` of the device board) | n/a (device cookie only) | n/a | n/a | yes, own household (route allowlist) |
| `display.idleMinutes` / `display.night` in the board DTO | read | read | read | read (same DTO) |
| `display.photos` (chosen household uploads) in the board DTO | read | read | read | **no** (never sent; open question in SHARED_DEVICE.md §9.1) |
| Set idle time, night hours, photos (`PATCH /api/family/board-settings` `display`) | yes | 403 | 403 | no (401, route allowlist) |
| Settings UI ("Calm screen", "Night hours", "Family photos") | shown | not rendered | not rendered | n/a |

The version is an opaque hash of the caller's own board; it is computed from the same `family_id`-scoped reads as
the board and reveals nothing the caller cannot already read. Photos are the household's own `Upload` rows chosen
by a parent (another household's upload is refused exactly like a missing one) and are served by the existing
household-scoped `/api/files/chores/<filename>` route, so only signed-in members of that household can load them.

Implemented (behind SHARED_DEVICE_ENABLED), #240: the same DTO, built with `audience: 'device'` (all links
`null`, shopping only when the lists feature is on), is the entire shared-device read surface, served by
`GET /api/device/today`. The `/device/today` page (#241) fetches it on the client under a layout that loads no
person profile, so the page's HTML and RSC payload carry no household data. The earlier `?mode=fridge` gap is
closed by #241 too: the dashboard layout now passes only `{ id, name, role, avatar_url }` to the nav, so no
dashboard page serialises the signed-in person's email, age, XP, level or streak.

### Home and navigation (#268, #269)

Navigation is a view of `canRoleAccessPath`, never a second gate (`src/lib/nav-items.ts`,
`docs/product/NAVIGATION.md`). The child allowlist in `src/lib/kid-access.ts` is unchanged; teens add the O-37
routes.

| | Parent | Teen | Child |
|---|---|---|---|
| Home (`/dashboard`) | redirects to `/dashboard/today` | kid home (own missions; level/rewards with Points & streaks on) | kid home |
| Tabs (phone tab bar and top bar) | Today · Calendar · Meals · Lists · Family (Meals hidden while meal planning is off) | Today (kid home) · Calendar · Meals · Lists · Emergency (O-37; feature-gated) | Today (kid home) · Lists · Emergency |
| Emergency | Family → Emergency | own tab | own tab |
| Family → More (`/dashboard/family/more`) | Chores plus every enabled feature that is not a tab | not reachable (`/dashboard/family` is parent-only) | not reachable |
| Today board | Today tab | user menu → Today board | user menu → Today board |
| Help (`/dashboard/help`, #146) | user menu → Help (static text and links, no household data) | user menu → Help (O-37); pages a teen cannot open are named, not linked | not reachable |
| Settings (`/dashboard/settings`) | user menu → Settings | user menu → Settings, personal sections only (O-37) | not reachable; notification switches and "Delete my account" in the user menu |
| Notifications list (`/dashboard/notifications`) | bell in the top bar | bell in the top bar (O-37); own rows only | not reachable |

The kid home (#272) shows the child's own chores due today grouped into picture routines; it reads nothing new
beyond the child's own chore rows it already read (`docs/product/CHORES.md`).

The summary above the board on `/dashboard/today` (not in fridge mode) reads only chore title, due day, status,
assignee and member names for the caller's household (`src/app/dashboard/today/home-summary-data.ts`), the same
fields the board shows; parents also get the count of chores waiting for a check. A teen or child sees their own
chores there and no link to `/dashboard/chores`.

### Teen pages and personal Settings (O-37)

Owner decision O-37 (Cameron, 2026-10-02): teens may see the family calendar and meals, read Help, see their own
notifications and use their own Settings. They must not change family-level settings. Children are unchanged.

Pages, one rule (`canRoleAccessPath` in `src/lib/kid-access.ts`, read by `src/middleware.ts`,
`src/app/dashboard/layout.tsx`, the tab bar, top bar, user menu, command palette, Today board links and search):

| Route | Parent | Teen | Child |
|---|---|---|---|
| `/dashboard/calendar` (month view), `/dashboard/calendar/create` | yes | yes (exact paths) | no |
| `/dashboard/calendar/edit` | yes | no (redirect; PATCH/DELETE `/api/events` are parent-only) | no |
| `/dashboard/meals` and everything under it (recipe page) | yes | yes | no |
| `/dashboard/help`, `/dashboard/notifications` | yes | yes | no |
| `/dashboard/settings` (the page itself) | yes | yes (exact path) | no (redirect; the page also redirects a child) |
| `/dashboard/settings/*` (devices, activity, imports, any future sub-route), `/dashboard/features`, `/dashboard/family/**`, `/dashboard/search` | yes | no | no |

Settings for a teen (`src/app/dashboard/settings/page.tsx` reads the role from the database; `SettingsClient`
renders by `viewerRole`):

| Section | Parent | Teen | API and its role rule |
|---|---|---|---|
| Profile (name, age; email and role read-only) | yes | yes | `GET`/`PATCH /api/users`: own row only, `role`/`family_id` ignored |
| Notifications and quiet hours | yes | yes | `/api/users/preferences`: own only, any role |
| Theme, Language | yes | yes | this device only (no API) |
| Change Password | yes | yes | `POST /api/auth/change-password`: own account |
| Data Export | yes | yes | `GET /api/users/export`: own export, role-shaped (see "Account export") |
| Delete Account | yes (household option when the only parent) | own account only | `DELETE /api/users`; household deletion is parent-only (403) |
| AI capture key | yes | not rendered, not fetched | `/api/family/ai-settings`: parent only (403). The parent form is shown only with `CAPTURE_AI_SETTINGS_ENABLED` on, or when a key is already saved. |
| Calendar feed link | yes | not rendered, not fetched | `/api/family/feed-token`: parent only (403) |
| Subscribed calendars, Connected calendars | yes | not rendered | `/api/calendar/subscriptions/**` add/edit/remove parent only; sync `PARENT_REQUIRED` |
| Features, Import family apps, Recent changes links | yes | not rendered (pages redirect a teen) | `PATCH /api/family/features`, `/api/admin/imports`, `GET /api/audit`: parent only (403) |
| Devices, Tablet PIN | yes (kill switch on) | not rendered; the server never reads PIN presence for a teen | `/api/family/devices/**`, `/api/users/elevation-pin`: `PARENT_REQUIRED` |
| Share beta usage counts | yes | not rendered; value never read for a teen | `PATCH /api/family/beta-metrics`: parent only (403) |

Calendar and meals for a teen follow the API exactly: a teen may add an event but not edit or delete one, so the
month view has "Add event" and no edit link; meals are R/C/U/D for every member, so the meals page shows a teen the
same meal controls; recipe delete is parent-only and no page offers it. Neither page serialises anything a teen
cannot already read through `GET /api/events`, `GET /api/meals` or `GET /api/recipes` (there are no private events
and no finance data on these pages). Tests: `src/lib/__tests__/kid-access-nav.test.ts`,
`src/__tests__/teen-access-middleware.test.ts`, `src/app/dashboard/settings/__tests__/teen-settings.test.tsx`,
`src/app/dashboard/calendar/__tests__/teen-calendar.test.tsx`, the navigation and help tests, and the existing
two-household family-settings tests (`src/app/api/family/__tests__/isolation.test.ts`, `beta-metrics.test.ts`,
`src/app/api/audit/__tests__/audit.test.ts`), which already refuse a teen every family-level handler.

### Points & streaks setting (#248)

XP, levels, streaks, chore points and the leaderboard are a per-family setting, `gamification` in
`Family.features` (`src/lib/features.ts`). Owner decision (Cameron, 2026-09-27): new households default **off**;
households that existed before the flag keep it **on** (`scripts/migrate.js` stamps `gamification: true` on every
stored blob that lacks the key, and `normalizeFeatures` reads a missing key as on).

| Surface | Parent | Teen | Child | Shared device / Today board |
|---|---|---|---|---|
| Toggle (`PATCH /api/family/features`, Features settings) | yes | 403 | 403 | no |
| When OFF: XP / level / streak / chore points in `/dashboard` (home and kid home), `/dashboard/chores`, `/dashboard/rewards` HTML and RSC payload | none | none | none | never shown, whatever the setting |
| When OFF: `/api/auth/me`, `/api/auth/login`, `/api/users`, `/api/chores` (GET, PATCH), `/api/chores/create` | fields omitted | fields omitted | fields omitted | n/a |
| When OFF: `/api/analytics`, `/api/rewards`, `/api/rewards/claim`, `/api/rewards/approve` | 403 | 403 | 403 | n/a |
| When OFF: `/dashboard/rewards`, `/dashboard/rewards/create`, `/dashboard/analytics` | off state | kid allowlist redirect | kid allowlist redirect | n/a |

Rewards and Analytics require Points & streaks: `isFeatureEnabled` (used by `featureGate`, `FeatureGate`, the
command palette and the pages above) treats them as off while it is off, but keeps their own stored flag, so
turning Points & streaks back on restores the previous Rewards/Analytics choice.

Chore completion and verification are unchanged, and XP keeps accruing in the background while the setting is
off (verify still calls `awardChoreXP`; only the level-up notification is skipped). Switching it back on
therefore shows current totals rather than a reset; this is deliberate, not a regression. The account export
(`/api/users/export`) still includes the person's own XP/level/streak: it is their data. The Today board and
the shared-device DTO never carry gamification fields, independent of this setting.

## Deferred

- **D7 / #157 shared-device sessions.** Contract in ADR-0006 and `docs/architecture/SHARED_DEVICE.md`. The
  schema/auth/API child issue (#240) and the web UI (#241: pairing, tablet shell, elevation, device
  management, Tablet PIN) are implemented behind `SHARED_DEVICE_ENABLED` (default off); device writes (phase 2, O-4/O-5), other elevated actions and Android integration are not. Each later child
  issue updates the affected rows, the route-allowlist test and the isolation audit. Owner decisions: O-1, O-2,
  O-4 and O-11 confirmed by Cameron; the rest use the recommended defaults (SHARED_DEVICE.md §16).
- **D3 contract step.** Photo ownership is implemented with an `Upload` record (expand phase). Legacy files
  with no `Upload` row are still served through the referencing chore of the same household until they are
  backfilled and the fallback is removed; see the audit's "D3 legacy path and contract step".

## Changing this matrix

Change the route handler, `src/lib/role-capabilities.ts` / `src/lib/kid-access.ts`, the isolation test for the
domain and this file in the same PR. Add two-household negative cases for any new family-owned domain.
