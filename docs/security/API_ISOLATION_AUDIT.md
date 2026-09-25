# API household-isolation audit (issue #102)

Date: 2026-09-25
Scope: every `src/app/api/**/route.ts` (86 route files, 139 exported handlers) checked against
`docs/architecture/AUTHORIZATION.md`, `AGENTS.md` (parent-only finance, private messages, addresses,
medical notes, account controls, tokens and secrets), `docs/PRODUCT_PROGRAM.md` and the kid allowlist in
`src/lib/kid-access.ts`.

**The role/isolation matrix is missing.** `AUTHORIZATION.md` points at `docs/ROLE_AND_ISOLATION_MATRIX.md`,
which does not exist anywhere in the repository. This audit used the documents above, plus intent recorded in
route comments, as the de facto matrix. Where they do not settle a question, the row is marked
`gap-needs-decision` and the question is listed under [Decisions needed](#decisions-needed). It has not been
guessed.

## Legend

- **Auth**: `family` = `authenticateWithFamily` (session plus server-side user lookup, 400 without a family).
  `session` = `authenticateRequest` (session only, account-scoped). `jwt` = `getServerUser()` (session; role and
  family_id come from the JWT claims, see D6). `public` = no session. `token` = bearer token in the URL.
  `cron` = `x-cron-secret`. Every session path runs `verifySessionToken`, which enforces the `token_version`
  generation check.
- **Family scope**: how reads and writes are pinned to the caller's household. `where` = the query filters on
  the caller's `family_id`. `match` = the record is loaded, then compared with `requireFamilyMatch` or an
  equivalent check (403 or 404). `n/a` = account- or token-scoped.
- **Role gate**: `P` = parent only (403 for teen and child). `all` = any member of the family.
- **Foreign-id checks**: client-supplied IDs other than the target record, and whether they are verified to be
  inside the caller's family.
- **Test**: path under `src/app/api/` unless it starts with `src/`. `iso` = `__tests__/isolation.test.ts` in that
  route's domain folder. All tests use the shared harness in `src/__tests__/helpers/two-household.ts`. That
  harness is a fake Prisma client that evaluates `where` clauses against a family-A/family-B dataset, and the
  real `api-auth` and `getServerUser` code runs on top of it.
- **Status**: `ok` = no gap found. `fixed` = gap fixed in this change. `gap-needs-decision` = product or
  architecture decision needed (see D-number).

## Audit table

| Route | Method | Auth | Family scope | Role gate | Foreign-id checks | Test | Status |
|---|---|---|---|---|---|---|---|
| /api/activity | GET | family | where | all | none | activity/iso | ok |
| /api/admin/imports | GET | family | where | P | none | admin/imports/iso | ok |
| /api/admin/imports/[source] | POST | family | familyId from session | P | identityMap user ids verified in family | admin/imports/iso | ok |
| /api/allowance | GET | jwt | where | P (was all) | none | allowance/iso | fixed (D5) |
| /api/allowance | POST | jwt | session family | P | to_user_id verified in family | allowance/iso | ok |
| /api/allowance/[id] | PATCH | jwt | match (404) | P | none | allowance/[id]/route.test.ts | ok |
| /api/analytics | GET | family | where | all | none | analytics/iso | ok (see O2) |
| /api/analytics/event | POST | jwt (anonymous = no-op) | family from DB user | all | none | analytics/iso | ok |
| /api/anniversaries | GET | family | where | all | none | anniversaries/iso | ok |
| /api/anniversaries | POST | family | session family | all (D9) | person_id **now** verified | anniversaries/iso | fixed |
| /api/anniversaries/[id] | PATCH | family | match (403) | all (D9) | person_id **now** verified | anniversaries/iso | fixed |
| /api/anniversaries/[id] | DELETE | family | match (403) | all (D9) | none | anniversaries/iso | ok |
| /api/auth/change-password | POST | session | n/a (self) | all | none | — | ok |
| /api/auth/forgot-password | POST | public | n/a | n/a | none | — | ok |
| /api/auth/login | POST | public | n/a | n/a | none | — | ok |
| /api/auth/logout | POST | cookie clear | n/a | n/a | none | — | ok |
| /api/auth/me | GET | session | n/a (self) | all | none | — | ok |
| /api/auth/register | POST | public | invite binds family | n/a | invite token + email match | — | ok |
| /api/auth/resend-verification | POST | public | n/a | n/a | none | — | ok |
| /api/auth/reset-password | POST | token | n/a | n/a | none | src/__tests__/auth-tokens.test.ts | ok |
| /api/auth/verify-email | GET | token | n/a | n/a | none | src/__tests__/auth-tokens.test.ts | ok |
| /api/budget/categories | GET | family | where | P | none | budget/iso | ok |
| /api/budget/categories | POST | family | session family | P | none | budget/iso | ok |
| /api/budget/categories/[id] | PATCH | family | match (403) | P | none | budget/iso | ok |
| /api/budget/categories/[id] | DELETE | family | match (403) | P | none | budget/iso | ok |
| /api/budget/stats | GET | family | where | P | none | budget/iso | ok |
| /api/budget/transactions | GET | family | where (category filter cannot widen) | P | none | budget/iso | ok |
| /api/budget/transactions | POST | family | session family | P | category_id verified | budget/iso | ok |
| /api/budget/transactions/[id] | PATCH | family | match (403) | P | category_id verified | budget/iso | ok |
| /api/budget/transactions/[id] | DELETE | family | match (403) | P | none | budget/iso | ok |
| /api/calendar/feed | GET | token (feed_token) | where family = token's family | n/a | none | calendar/feed/__tests__/route.test.ts | ok |
| /api/capture | GET | family | caller family's config | all | none | capture/iso | ok |
| /api/capture | POST | family | caller family's config | all | none | capture/iso, capture/route.test.ts | gap-needs-decision (D4) |
| /api/chores | GET | family | where | all | assigned_to filter cannot widen | chores/iso | ok |
| /api/chores | PATCH | family | match (403) | P or assignee; P-only fields | assigned_to verified; photo_url unverified | chores/iso, chores/route.test.ts | gap-needs-decision (D3) |
| /api/chores | DELETE | family | match (403) | P or assignee | none | chores/iso | ok |
| /api/chores/complete | POST | family | match (403) | all (any family chore, by design) | photoUrl unverified | chores/iso | gap-needs-decision (D3) |
| /api/chores/create | POST | family | session family | P | assigned_to verified; photo_url unverified | chores/iso | gap-needs-decision (D3) |
| /api/chores/verify | POST | family | match (403) | P | none | chores/iso | ok |
| /api/cron/recurring-chores | POST | cron | per-family expansion | n/a | none | src/__tests__/recurring-chores.test.ts | ok |
| /api/emergency-contacts | GET | family | where | all (kid-readable by design, kid-access.ts) | none | emergency-contacts/iso | ok |
| /api/emergency-contacts | POST | family | session family | all (D1) | person_id **now** verified | emergency-contacts/iso | fixed / gap-needs-decision (D1) |
| /api/emergency-contacts/[id] | PATCH | family | match (403) | all (D1) | person_id **now** verified | emergency-contacts/iso | fixed / gap-needs-decision (D1) |
| /api/emergency-contacts/[id] | DELETE | family | match (403) | all (D1) | none | emergency-contacts/iso | gap-needs-decision (D1) |
| /api/events | GET | family | where; `?id=` match (403) | all | none | events/iso | ok |
| /api/events | POST | family | session family | all | none | events/iso | ok |
| /api/events | PATCH | family | match (403) | P | none | events/iso | ok |
| /api/events | DELETE | family | match (403) | P | none | events/iso | ok |
| /api/family | POST | session | creates own family | n/a (rejects if already in a family) | none | family/iso | ok |
| /api/family | GET | family | own family; invite_code parent-only | all | none | family/iso | ok |
| /api/family | PATCH | family | familyId must equal session family (403) | P | familyId verified | family/iso | ok |
| /api/family | DELETE | family | familyId must equal session family (403) | P | familyId verified | family/iso | ok |
| /api/family/ai-settings | GET | family | own family | P | none | family/iso | ok |
| /api/family/ai-settings | POST | family | own family | P | none | family/iso | ok |
| /api/family/features | GET | jwt | own family | all | none | family/iso | ok |
| /api/family/features | PATCH | jwt | own family | P | none | family/iso | ok |
| /api/family/feed-token | GET | family | own family | P | none | family/iso | ok |
| /api/family/feed-token | POST | family | own family | P | none | family/iso | ok |
| /api/family/invites | GET | family | where | P | none | family/iso | ok |
| /api/family/invites | POST | family | session family | P | none | family/iso | ok |
| /api/family/invites/[id] | DELETE | family | where id + family (404) | P | none | family/iso | ok |
| /api/family/invites/preview | GET | token | token's family only | n/a | none | family/membership.test.ts | ok |
| /api/family/join | POST | session | token/code's family; refuses if already in a family | n/a | invite email must match | family/membership.test.ts | ok |
| /api/family/lookup | GET | session | code lookup (name only) | n/a | none | family/lookup/__tests__/route.test.ts | ok |
| /api/family/members | GET | jwt | where | all | none | family/iso | ok |
| /api/family/travel | GET | jwt (**now** 401 when signed out; was 400) | own family | P (was all) | none | family/iso | fixed |
| /api/family/travel | PATCH | jwt | own family | P | none | family/iso | ok |
| /api/files/[filename] | GET | family (was session only) | **now** served only when a chore/assignment of the caller's family references the file (404 otherwise) | all | none | files/[filename]/__tests__/route.test.ts | fixed |
| /api/files/chores/[filename] | GET | family | owner via referencing chore/assignment (404) | all | n/a | src/__tests__/chore-photo-auth.test.ts | gap-needs-decision (D3) |
| /api/handoff | GET | family | where | all; share_token/share_expires_at **now** stripped for teen/child | none | handoff/iso | fixed / gap-needs-decision (D2) |
| /api/handoff | POST | family | session family | P | none | handoff/iso | ok |
| /api/handoff/[id] | PATCH | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/[id] | DELETE | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/[id]/regenerate-token | POST | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/share/[token] | GET | token (rate-limited, expiring) | token's handoff only; allowlisted fields | n/a | none | handoff/share/[token]/__tests__/route.test.ts | ok |
| /api/health | GET | public | n/a | n/a | none | src/__tests__/health.test.ts | ok |
| /api/health/live | GET | public | n/a | n/a | none | src/__tests__/health.test.ts | ok |
| /api/lists | GET | family | where | all | none | lists/iso | ok |
| /api/lists | DELETE | family | match (403) | P | none | lists/iso | ok |
| /api/lists/create | POST | family | session family | all | none | lists/iso | ok |
| /api/lists/items | GET | family | list match (403) | all | none | lists/iso | ok |
| /api/lists/items/create | POST | family | list match (403) | all | listId verified | lists/iso | ok |
| /api/lists/items/update | PATCH | family | item's list match (403) | all | none | lists/iso | ok |
| /api/lists/items/delete | DELETE | family | item's list match (403) | P | none | lists/iso | ok |
| /api/locations | GET | jwt | where | P (was all) | none | locations/iso | fixed |
| /api/locations | POST | jwt | session family | P | none | locations/iso | ok |
| /api/locations/[id] | DELETE | jwt | match (404) | P | none | locations/iso | ok |
| /api/meals | GET | family | where | all | none | meals/iso | ok |
| /api/meals | POST | family | session family | all | cook_id **now** verified | meals/iso | fixed |
| /api/meals/[id] | PATCH | family | match (403) | all | cook_id **now** verified | meals/iso | fixed |
| /api/meals/[id] | DELETE | family | match (403) | all | none | meals/iso | ok |
| /api/medications | GET | jwt | where | all (D1) | none | medications/iso | gap-needs-decision (D1) |
| /api/medications | POST | jwt | session family | P | person_id + sick_day_id verified | medications/route.test.ts | ok |
| /api/medications/[id] | PATCH | jwt | match (404) | all may log a dose; prescription edits P | none | medications/iso | ok |
| /api/medications/[id] | DELETE | jwt | match (404) | P | none | medications/iso | ok |
| /api/messages | GET | family | where | all | none | messages/iso | ok |
| /api/messages | POST | family | session family | all | none | messages/iso | ok |
| /api/messages | PATCH | family | where (ids ∩ family) | all | messageIds limited to family | messages/iso | ok |
| /api/notes | GET | family | where | all | none | notes/iso | ok |
| /api/notes | POST | family | session family | all | none | notes/iso | ok |
| /api/notes/[id] | PATCH | family | match (403) | all | none | notes/iso | ok |
| /api/notes/[id] | DELETE | family | match (403) | all | none | notes/iso | ok |
| /api/notifications | GET | session | own user | all | none | notifications/iso | ok |
| /api/notifications | POST | family | target user must share caller's family (403) | P | userId verified | notifications/iso | ok |
| /api/notifications | PATCH | session | own user (404) | all | none | notifications/iso | ok |
| /api/notifications | DELETE | session | own user (404) | all | none | notifications/iso | ok |
| /api/pickups | GET | jwt | where | all | none | pickups/iso | ok |
| /api/pickups | POST | jwt | session family | all | assigned_to verified | pickups/route.test.ts | ok |
| /api/pickups/[id] | PATCH | jwt | match (404) | all | none | pickups/iso | ok |
| /api/pickups/[id] | DELETE | jwt | match (404) | all (D9) | none | pickups/iso | ok |
| /api/projects | GET | family | where | all | none | projects/iso | ok |
| /api/projects | POST | family | session family | all | none | projects/iso | ok |
| /api/projects/[id] | GET | family | match (403) | all | none | projects/iso | ok |
| /api/projects/[id] | PATCH | family | match (403) | P | none | projects/iso | ok |
| /api/projects/[id] | DELETE | family | match (403) | P | none | projects/iso | ok |
| /api/projects/[id]/send-to-calendar | POST | family | match (403) | all | none | projects/iso | ok |
| /api/projects/[id]/tasks | GET | family | project match (403) | all | none | projects/iso | ok |
| /api/projects/[id]/tasks | POST | family | project match (403) | all | assigned_to verified | projects/iso | ok |
| /api/projects/[id]/tasks/[taskId] | PATCH | family | task∈project + match (403/404) | P | assigned_to verified | projects/iso | ok |
| /api/projects/[id]/tasks/[taskId] | DELETE | family | task∈project + match (403/404) | P | none | projects/iso | ok |
| /api/rewards | GET | family | where | all | none | rewards/iso | ok |
| /api/rewards | POST | family | session family | P | none | rewards/iso | ok |
| /api/rewards | PATCH | family | match (403) | P | none | rewards/iso | ok |
| /api/rewards/claim | POST | family | match (403) + conditional write on family | all | none | rewards/iso | ok |
| /api/rewards/approve | POST | family | match (403) | P | none | rewards/iso | ok |
| /api/sick-days | GET | jwt | where | all (D1) | none | sick-days/iso | gap-needs-decision (D1) |
| /api/sick-days | POST | jwt | session family | all | person_id verified | sick-days/route.test.ts | ok |
| /api/sick-days/[id] | PATCH | jwt | match (404); raw SQL also filters family_id | all (D1) | none | sick-days/iso | gap-needs-decision (D1) |
| /api/sick-days/[id] | DELETE | jwt | match (404) | all (D1) | none | sick-days/iso | gap-needs-decision (D1) |
| /api/upload | POST | family | n/a (writes an unowned file; see D3) | all | none | — | ok |
| /api/users | GET | session | self | all | none | users/__tests__/route.test.ts | ok |
| /api/users | PATCH | session | self (id/family_id/role not writable) | all | none | users/__tests__/route.test.ts | ok |
| /api/users | DELETE | session | self; last-parent guard | all | none | users/__tests__/route.test.ts | ok |
| /api/users/export | GET | session | self + own family; travel fields **now** parent-only | all | none | users/export/__tests__/route.test.ts | fixed |
| /api/wishlist | GET | family | where | all | none | wishlist/iso | ok |
| /api/wishlist | POST | family | session family | all | none | wishlist/iso | ok |
| /api/wishlist/[id] | PATCH | family | match (403) | requester or P | none | wishlist/iso | ok |
| /api/wishlist/[id] | DELETE | family | match (403) | requester or P | none | wishlist/iso | ok |
| /api/wishlist/[id]/status | PATCH | family | match (403) | P | none | wishlist/iso | ok |

Totals: 139 handlers. 117 `ok`, 12 `fixed` (including 3 that also carry an open decision), 10 marked only
`gap-needs-decision`. No confirmed cross-family read or write remains open.

## Gaps fixed in this change

| File | Fix |
|---|---|
| `src/app/api/anniversaries/route.ts` | `person_id` must belong to the caller's family (400). |
| `src/app/api/anniversaries/[id]/route.ts` | Same `person_id` check on update. |
| `src/app/api/emergency-contacts/route.ts` | `person_id` must belong to the caller's family (400). |
| `src/app/api/emergency-contacts/[id]/route.ts` | Same `person_id` check on update. |
| `src/app/api/meals/route.ts` | `cook_id` must belong to the caller's family (400). Before this, a foreign user's name was echoed back through `include: { cook }`, which was a cross-family read. |
| `src/app/api/meals/[id]/route.ts` | Same `cook_id` check on update. |
| `src/app/api/files/[filename]/route.ts` | Was session-only: any signed-in user of any family could read every file in the upload root. Now it needs a family, and serves a file only when a chore or chore assignment of the caller's family references it. Otherwise it returns the same 404 as a missing file. |
| `src/app/api/locations/route.ts` | GET is parent-only. Saved places hold precise addresses, which the docs make parent-only. |
| `src/app/api/family/travel/route.ts` | GET returns 401 when signed out (it returned 400) and is parent-only. Travel dates and destination say when the home is empty. No kid surface reads this. |
| `src/app/api/users/export/route.ts` | The travel fields of the family object are exported only for parents, consistent with the travel gate. |
| `src/app/api/allowance/route.ts` | GET is parent-only. Household money is parent-only, and the allowance page is not on the kid allowlist. |
| `src/app/api/handoff/route.ts` | GET strips `share_token` and `share_expires_at` for teen and child. The token is a bearer credential for the public sitter page. |

The role gates added (locations, travel, allowance) do not remove any existing kid UI.
`src/lib/kid-access.ts` sends teen and child sessions away from `/dashboard/locations`, `/dashboard/travel` and
`/dashboard/allowance`. `TravelModeBanner` (the only other caller of `/api/family/travel`) is not mounted anywhere.

## Decisions needed

- **D1: Medical data for child and teen.** `GET /api/medications` and `GET /api/sick-days` return medication
  and illness notes to every member. `PATCH`/`DELETE /api/sick-days/[id]` and the emergency-contact writes are
  open to child and teen. `AGENTS.md` lists medical notes as parent-only on the shared surface. However,
  `kid-access.ts` deliberately makes emergency and medical info kid-readable, `PATCH /api/medications/[id]`
  deliberately lets non-parents log a dose, and the existing `POST /api/sick-days` test expects a child to be
  able to report being sick. The rule for each role (read, report, edit, delete) must be written into the matrix
  before any gate is added.
- **D2: Handoff contents for kids.** Teen and child can read every handoff field: sitter phone, code words, house
  and emergency notes. The share token is now stripped, but whether kids should see the rest (a kid may need the
  code word) is a product call.
- **D3: Chore photo ownership.** `photo_url` / `photoUrl` on chore create, update and complete is any
  client-supplied string, and `/api/upload` stores content-addressed files with no owner record. Both file
  routes decide ownership from "which chore references this file". So a family-A member who learns a family-B
  filename can attach it to an A chore, and the legacy route will then serve it to A. The chores route resolves
  ownership with an unscoped `findFirst`, which can serve it to A or wrongly 404 the real owner. Two families who
  upload byte-identical images share one file. A real fix needs an upload-ownership record (family_id and
  uploader per stored file) and validation of `photo_url` against it. That is a schema and migration change, so
  it is out of scope here.
- **D4: Capture spend.** Any member, including children, can call `POST /api/capture`, which spends the family's
  own AI provider key (rate-limited to 30/hour per user). Decide whether capture is parent-only or kid-allowed.
- **D5: A kid's own allowance.** Allowance is now parent-only. If teens or children should see their own
  allowance, define a scoped read (for example `to_user_id = self`) in the matrix.
- **D6: `getServerUser()` trusts JWT claims.** 14 route files take `role` and `family_id` from the signed JWT, not
  from the database. `authenticateWithFamily` re-reads the user. `AUTHORIZATION.md` step 2 says to resolve
  current state from authoritative data. No exploitable path was found. No API changes a member's role or family
  without re-issuing the cookie, and deleting a family only leaves a dangling id, which has no rows. But an
  out-of-band role change (a DB edit, a future "change member role" feature) would not take effect until the
  cookie expires. Either re-read `role`/`family_id` in `getServerUser()` (one extra query), or bump
  `token_version` whenever either changes.
- **D7: Shared-device sessions.** The API has no device-session concept yet (ADR 0002). Every row above assumes
  a human parent, teen or child session. The shared-tablet column of the matrix cannot be audited until device
  auth exists.
- **D8: Write the matrix.** `docs/ROLE_AND_ISOLATION_MATRIX.md` is referenced but missing. It should record,
  per domain, the teen versus child capability. Today teen and child are treated identically everywhere.
- **D9: Open child/teen writes in low-sensitivity domains.** Anniversaries (create, update, delete), notes,
  meals, lists (create and tick), events (create), pickups (create, complete, delete), projects and tasks
  (create), messages, wishlist (create), sick-day reports, and completing any family chore are open to every
  member. None of this is a cross-family issue and none is documented as parent-only, so it was left as it is,
  but it should be confirmed in the matrix.

## Other observations (not isolation gaps)

- **O1.** `src/app/dashboard/anniversaries/page.tsx` sends PATCH and DELETE to `/api/anniversaries?id=`, but
  those handlers exist only on `/api/anniversaries/[id]`, so edit and delete from that page get 405. This is a
  functional bug, not a security gap, and it was not changed here.
- **O2.** `GET /api/analytics` `recentActivity` includes `event_*` analytics rows (page paths and metadata of
  other members). `GET /api/activity` filters those out. The data stays inside the family, but it is
  inconsistent and may be more than kids should see.

## Test harness

`src/__tests__/helpers/two-household.ts` is not collected by jest, because it does not match `*.test.ts`. It
provides:

- a fake Prisma client that evaluates `where` clauses (including `OR`/`AND`/`NOT`, `in`, ranges and relation
  filters) against a seeded family-A/family-B dataset, applies `select`/`include`/`_count` through a relation
  map, and records every write;
- session mocks for both auth styles;
- a `next/server` mock and a request builder;
- `expectDenied` and `expectNoForeignData` helpers. Every family-B row carries the marker `FOREIGN`, so these can
  assert that a response body carries no family-B data.

As a check that the tests guard the fixes, `meals/route.ts`, `files/[filename]/route.ts`, `locations/route.ts`
and `handoff/route.ts` were temporarily restored to their `HEAD` versions. 8 of the new tests failed, and they
passed again once the fixes were restored.
