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
- **Shared device.** Device auth, pairing, sessions, elevation and revocation are **implemented (behind
  SHARED_DEVICE_ENABLED)** by #240, default off (`docs/architecture/SHARED_DEVICE.md` §18). What ships: the
  read surface (the Today board DTO with a device audience at `GET /api/device/today`, names-only
  `GET /api/device/me`), parent device management and the tablet PIN, and, under elevation, rename or remove
  **this** tablet. Every `no` in the column is enforced: existing routes accept only person sessions, guarded
  by the route-allowlist test. Cells marked `elevated only` for other domains and every `phase 2 candidate`
  remain **proposed** (#157 contract; no such device route exists yet). `O-n` points to an owner decision in
  SHARED_DEVICE.md §16. A tablet signed in as a person still has exactly that person's rights. Shared-device
  values:
  - `no`: a device session is refused (existing routes authenticate only person sessions). Elevation does not
    change this unless the cell says `elevated only`.
  - `elevated only`: allowed only while a parent is elevated on the tablet (5 min idle / 15 min max).
  - a field description (for example `open grocery items only`): read through the device Today board DTO only.
  - `phase 2 candidate`: planned device write after #162, not in the first release.
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
| Medications | R | yes | own | own | no | `person_id = self`. |
| Medications | C | yes | no | no | no | |
| Medications | U: log a dose | yes | own | own | no | `PATCH /api/medications/[id]` with `markDoseTaken`. A sibling's medication is 404. |
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
| Lists | C (new list) | yes | yes | no | no | Child: 403 "Ask a parent to create a new list." |
| Lists | D | yes | no | no | elevated only | |
| List items | C (add) / U (tick) | yes | yes | yes | no (phase 2 candidate, O-5) | On an existing list of the household. |
| List items | D | yes | no | no | elevated only | |
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

### Other domains (unchanged by this round; recorded for completeness)

| Domain | R | C | U | D | Shared device (proposed) | Notes |
|---|---|---|---|---|---|---|
| Events (calendar) | all | all | parent | parent | R: `id`, title, start/end, is-task, imported-calendar name/colour only; C/U/D: elevated only (when tablet flows exist) | Page `/dashboard/calendar` is parent-only in the UI (kid allowlist). Device never reads `location` or `description`. |
| Chores | all | parent | parent, or assignee for status | parent, or assignee | R: title, due day, status, assignee name; complete: phase 2 candidate (O-4); verify: elevated only | Completion open to any member for any household chore. Photo (D3): must be an `/api/upload` result owned by the household, else 400; see audit. |
| Rewards | all | parent | parent | — | no | Claim: all. Approve: parent. |
| Wishlist | all | all | requester or parent | requester or parent | no | Status changes: parent. |
| Meals | all | all | all | all | R: dinners only, recipe name and cook name; C/U: elevated only (when tablet flows exist); D: no | `cook_id` verified in household. Device never reads `notes`. |
| Projects and tasks | all | all | parent | parent | no | |
| Messages | all | all | all (mark read) | — | no | |
| Activity, analytics | all | — | — | — | no | |
| Notifications | own | parent (to a household member) | own | own | no | |
| Locations | parent | parent | — | parent | no | Precise addresses. |
| Travel mode | parent | — | parent | — | no | |
| Family settings, features, invites, AI settings, feed token | parent (members list and features read: all) | parent | parent | parent | members: names only; features: calendar/chores/meals/lists booleans only; everything else no | |
| Account (`/api/users`, export) | own | — | own | own | no | Export includes travel fields for parents only. |
| Shared devices (list, rename, revoke, pairing codes, audit) | parent | parent | parent | parent (revoke) | this device only: rename/revoke elevated only | Implemented (behind SHARED_DEVICE_ENABLED), #240; teens and children get 403 `PARENT_REQUIRED`. |
| Tablet elevation PIN | own (parent) | own (parent) | own (parent) | own (parent) | used, never read | Implemented (behind SHARED_DEVICE_ENABLED), #240 (O-1 confirmed). Set/change needs the current password; a password reset deletes it. |

Teen and child: identical in this table unless a column names them, which is the D8 audit result for these
domains.

### Today board page (#119 / #159)

`/dashboard/today` (the fridge/wall tablet view) is on the kid allowlist for parent, teen and child. It is read-only
and shows only data every member may already read above: events (without location or description), chores
(title, due day, status, assignee name), dinners (recipe and cook name, without notes) and open grocery items. It
reads no finance, allowance, messages, medical, location, handoff or account data. The page offers links to
calendar, chores, meals and features only to roles that may open them. DTO:
`src/app/dashboard/today/today-board-data.ts`.

Implemented (behind SHARED_DEVICE_ENABLED), #240: the same DTO, built with `audience: 'device'` (all links
`null`, shopping only when the lists feature is on), is the entire shared-device read surface, served by
`GET /api/device/today`. The `/device/today` page (#241) fetches it on the client under a layout that loads no
person profile, so the page's HTML and RSC payload carry no household data. The earlier `?mode=fridge` gap is
closed by #241 too: the dashboard layout now passes only `{ id, name, role, avatar_url }` to the nav, so no
dashboard page serialises the signed-in person's email, age, XP, level or streak.

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
