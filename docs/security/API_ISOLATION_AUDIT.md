# API household-isolation audit (issue #102)

Date: 2026-09-25
Scope: every `src/app/api/**/route.ts` (86 route files, 139 exported handlers) checked against
`docs/architecture/AUTHORIZATION.md`, `AGENTS.md` (parent-only finance, private messages, addresses,
medical notes, account controls, tokens and secrets), `docs/PRODUCT_PROGRAM.md` and the kid allowlist in
`src/lib/kid-access.ts`.

**Update 2026-09-26: decisions D1–D9 are recorded and implemented.** Cameron approved the role rules on issue
#102. They are written up in [`docs/ROLE_AND_ISOLATION_MATRIX.md`](../ROLE_AND_ISOLATION_MATRIX.md) and
implemented in the routes below; the rows that were `gap-needs-decision` now say `implemented (Dn)`. D7
(shared-device sessions) is deferred to #157. See [Decisions](#decisions) for what was decided.

**Update 2026-09-26 (later): D3 is implemented and D9 anniversary ownership is complete.** Cameron approved the
expand/contract schema change. The additive `Upload` table records the owning family and uploader of every
file stored by `/api/upload`; chore create, update and complete accept a photo only when it names an upload of
the caller's family. `Anniversary.created_by` (nullable) lets teens and children edit anniversaries they
created. See [D3 legacy path and contract step](#d3-legacy-path-and-contract-step).

**Update 2026-09-26 (#240): shared-device routes.** 19 handlers in 16 new route files (`/api/device/*`,
`/api/family/devices/*`, `/api/users/elevation-pin`), all `implemented (behind SHARED_DEVICE_ENABLED)` and 404 while
the switch is off (the default). New auth values: `device` = the `fp_device` access cookie resolved by
`src/lib/device-session.ts` (never `session_token`); `device + elevation` = additionally `X-Device-Elevation`
bound to that device; `session (person only)` = `authenticateRequest`, which never reads device cookies. Every
device route's household is the device's own `family_id` from the database. The route-allowlist test is the
guard that no other route accepts a device cookie. Contract: `docs/architecture/SHARED_DEVICE.md` §12 and §18.

**Update 2026-09-26 (#162): idempotency.** `PATCH /api/lists/items/update` accepts an optional
`Idempotency-Key` header through `src/lib/idempotency.ts`. The new `IdempotencyRecord` table is keyed by
`(scope, key)` with `scope = user:<userId>` and carries `family_id` (FK, cascade) and `user_id` (FK, cascade).
Authentication and household checks run before any record is read; a record is replayed only to the same scope
and household, and only 2xx outcomes are stored, so a denied or foreign-item request leaves no record. Tests:
`src/app/api/lists/__tests__/idempotency.test.ts`, `src/lib/__tests__/idempotency.test.ts` and the opt-in
`src/lib/__tests__/idempotency.integration.test.ts`. Contract: `docs/architecture/OFFLINE_SYNC.md`.

**Update 2026-09-28 (#264): calendar sync routes.** 7 handlers in 6 new route files (`/api/calendar/connections`,
`/api/calendar/connections/[provider]/start|callback`, `/api/calendar/sync-connections/[id]`, `…/calendars`,
`…/sync`), **dormant**: all 404 until calendar sync is configured (`src/lib/calendar-sync/config.ts`). Person
session only (a device cookie gets 401; asserted with sync configured in the route-allowlist test), parent only.
Every connection lookup is `where { id, family_id }` (another household's id = 404, identical to missing); the
engine scopes every event and link statement by `family_id` and connection id. OAuth `state` is single use,
10-minute, and bound to member + household + provider. Tokens are AES-256-GCM encrypted with household-bound AAD
and never returned. Tests: `src/app/api/calendar/connections/__tests__/routes.test.ts`,
`src/lib/calendar-sync/__tests__/*.test.ts`, opt-in `sync.integration.test.ts`.

**Update 2026-09-28 (#251): canonical meal, recipe and grocery APIs (ADR-0007).** New family-scoped
`/api/recipes` and `/api/recipes/[id]` (every lookup `where { id, family_id }`, so another household's recipe is a
404 identical to a missing one); `recipe_id` on `/api/meals` and `ingredient_id` on `/api/lists/items/create|update`
are verified in the caller's household (400, the same answer for a foreign and a missing id, so existence is not
revealed); nested recipe ingredients are resolved in the household only (a name never matches another household's
ingredient). Every `/api/lists/**` handler now has `featureGate('lists')` (O-11). The meal-planner importer writes
`FamilyMeal`/`List`/`ListItem` and resolves every reference inside the importing household. Tests:
`recipes/__tests__/isolation.test.ts`, `meals/__tests__/recipe-link.test.ts`, `lists/__tests__/provenance.test.ts`,
`users/export/__tests__/canonical.test.ts`, and the opt-in `recipes/__tests__/recipes.integration.test.ts`,
`src/lib/__tests__/list-item-provenance.integration.test.ts` and
`src/lib/imports/__tests__/meal-planner-canonical.integration.test.ts`.

**Update 2026-09-28 (#253): recipe → grocery add (ADR-0007 child D).** `POST /api/lists/items/from-recipe`,
`POST /api/lists/items/undo-add` and `POST /api/lists/default-grocery`. The recipe, meal and list are each looked up
`where { id, family_id }`, so another household's id is a 404 identical to a missing one; ingredient rows come from the
household's recipe, never from the body. A paired shared device is refused with 403 `DEVICE_WRITE_NOT_ALLOWED`
before person auth (`refusePairedDevice`), and the route-allowlist test lists both routes. Undo is limited to the
original caller's own request (idempotency record `user_id`), their own unticked rows and a 10-minute window. Tests:
`src/app/api/lists/__tests__/from-recipe.test.ts` and the opt-in `from-recipe.integration.test.ts`.

**Update 2026-09-28 (#263): food inventory.** New family-owned `InventoryItem` with `/api/inventory`,
`/api/inventory/[id]`, `/api/inventory/use-soon` and `/api/inventory/cook`, all behind `featureGate('inventory')`
(cook also `meals`). Every lookup is `where { id, family_id }` (another household's item is a 404 identical to a
missing one); the optional `ingredient_id` is verified in the caller's household (400, same answer for a foreign and
a missing id), and the automatic link by name only considers the household's own ingredients. Writes are parent and
teen; a paired shared device is refused with 403 `DEVICE_WRITE_NOT_ALLOWED` before person auth and the three write
handlers are listed in the route-allowlist test. The export adds the household's items. Tests:
`src/app/api/inventory/__tests__/isolation.test.ts` (two-household harness, which now seeds an `inventoryItem` per
household) and the opt-in `inventory.integration.test.ts`.

**Update 2026-09-28 (#265): fridge photo scan.** `POST /api/inventory/scan` reads and writes no household rows: it
returns model suggestions for one uploaded photo, and the page adds reviewed items through `POST /api/inventory`
(above). A paired device is refused (403, listed in the route-allowlist test) before person auth; then a session, the
kill switch (404 without `INVENTORY_SCAN_ANTHROPIC_API_KEY`), `featureGate('inventory')` and parent role. Rate-limit
keys are `inventory-scan:user:<userId>`, `inventory-scan:family:<familyId>` and
`inventory-scan:day:<familyId>:<UTC day>`, all from the session, so one household's use never counts against another's.
The provider host is a constant and the key is server env only (no user-supplied URL, key or model). The image is
never stored; logs are metadata only. Tests: `src/app/api/inventory/__tests__/scan.test.ts` (mocked provider; parent,
teen, child, device, two households, limits, sizes, types, malformed output) and `src/lib/__tests__/inventory-scan.test.ts`.

When this audit was first written the matrix did not exist, so the audit used the documents above, plus intent
recorded in route comments, as the de facto matrix.

## Legend

- **Auth**: `family` = `authenticateWithFamily` (session plus server-side user lookup, 400 without a family).
  `session` = `authenticateRequest` (session only, account-scoped). `jwt` = `getServerUser()` (session; role and
  family_id are re-read from the database on every request since D6). `public` = no session. `token` = bearer token in the URL.
  `cron` = `x-cron-secret`. Every session path runs `verifySessionToken`, which enforces the `token_version`
  generation check.
- **Family scope**: how reads and writes are pinned to the caller's household. `where` = the query filters on
  the caller's `family_id`. `match` = the record is loaded, then compared with `requireFamilyMatch` or an
  equivalent check (403 or 404). `n/a` = account- or token-scoped.
- **Role gate**: `P` = parent only (403 for teen and child). `all` = any member of the family. `own` = a teen
  or child is limited to their own rows (the column is named). `P+T` = parent and teen, not child.
- **Foreign-id checks**: client-supplied IDs other than the target record, and whether they are verified to be
  inside the caller's family.
- **Test**: path under `src/app/api/` unless it starts with `src/`. `iso` = `__tests__/isolation.test.ts` in that
  route's domain folder. All tests use the shared harness in `src/__tests__/helpers/two-household.ts`. That
  harness is a fake Prisma client that evaluates `where` clauses against a family-A/family-B dataset, and the
  real `api-auth` and `getServerUser` code runs on top of it.
- **Status**: `ok` = no gap found. `fixed` = gap fixed in the first audit change. `implemented (Dn)` = role rule
  decided on #102 and implemented. `gap-needs-decision` / `deferred` = still open (see D-number).

## Audit table

| Route | Method | Auth | Family scope | Role gate | Foreign-id checks | Test | Status |
|---|---|---|---|---|---|---|---|
| /api/activity | GET | family | where | all | none | activity/iso | ok |
| /api/admin/imports | GET | family | where | P | none | admin/imports/iso | ok |
| /api/admin/imports/[source] | POST | family | familyId from session | P | identityMap user ids verified in family | admin/imports/iso, imports/meal-planner-canonical.integration | ok; meal-planner (#251) writes only canonical `FamilyMeal`/`List`/`ListItem` (+ `Recipe*`); recipe links and ingredient matches resolved in the importing family; existing mappings honoured whatever their `target_model` |
| /api/allowance | GET | jwt | where | P; teen/child own (`to_user_id = self`) | none | allowance/iso | implemented (D5) |
| /api/allowance | POST | jwt | session family | P | to_user_id verified in family | allowance/iso | ok |
| /api/allowance/[id] | PATCH | jwt | match (404) | P | none | allowance/[id]/route.test.ts | ok |
| /api/analytics | GET | family | where | all | none | analytics/iso | ok (see O2) |
| /api/analytics/event | POST | jwt (anonymous = no-op) | family from DB user | all | none | analytics/iso | ok |
| /api/anniversaries | GET | family | where | all | none | anniversaries/iso | ok |
| /api/anniversaries | POST | family | session family | all | person_id **now** verified | anniversaries/iso | fixed; implemented (D9) |
| /api/anniversaries/[id] | PATCH | family | match (403) | P; teen/child own (`created_by = self`; NULL = parent-only) | person_id **now** verified | anniversaries/iso | fixed; implemented (D9) |
| /api/anniversaries/[id] | DELETE | family | match (403) | P | none | anniversaries/iso | implemented (D9) |
| /api/auth/change-password | POST | session | n/a (self) | all | none | — | ok |
| /api/auth/forgot-password | POST | public | n/a | n/a | none | — | ok |
| /api/auth/login | POST | public | n/a | n/a | none | src/app/api/auth/login/__tests__/device-guard.test.ts | ok; 409 `DEVICE_MODE_LOGIN_BLOCKED` while a live device credential is present (#240, switch on only) |
| /api/auth/logout | POST | cookie clear | n/a | n/a | none | — | ok |
| /api/auth/me | GET | session | n/a (self) | all | none | — | ok |
| /api/auth/register | POST | public | invite binds family | n/a | invite token + email match; 409 `DEVICE_MODE_LOGIN_BLOCKED` on a paired device (#240) | — | ok |
| /api/auth/resend-verification | POST | public | n/a | n/a | none | — | ok |
| /api/auth/reset-password | POST | token | n/a | n/a | none | src/__tests__/auth-tokens.test.ts, device/__tests__/device-routes.test.ts | ok; also deletes the parent's `ParentElevationPin` (#240) |
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
| /api/calendar/connections | GET | family (404 while sync off) | where | P | none | calendar/connections/__tests__/routes.test.ts | implemented (dormant, #264) |
| /api/calendar/connections/[provider]/start | POST | family (404 while off / provider unconfigured) | session family + user bound into OAuth state | P | provider allowlisted | calendar/connections/__tests__/routes.test.ts | implemented (dormant, #264) |
| /api/calendar/connections/[provider]/callback | GET | family (404 while off) | state must match session user, family and provider (single use, 10 min) | P | state hash lookup only | calendar/connections/__tests__/routes.test.ts, calendar-sync/__tests__/oauth-state.test.ts | implemented (dormant, #264) |
| /api/calendar/sync-connections/[id] | PATCH | family (404 while off) | where (404) | P, connecting member only (403) | calendar_id must be one of the member's writable provider calendars | calendar/connections/__tests__/routes.test.ts | implemented (dormant, #264) |
| /api/calendar/sync-connections/[id] | DELETE | family (404 while off) | where (404) | P | none | calendar/connections/__tests__/routes.test.ts | implemented (dormant, #264) |
| /api/calendar/sync-connections/[id]/calendars | GET | family (404 while off) | where (404) | P, connecting member only (403) | none | calendar/connections/__tests__/routes.test.ts | implemented (dormant, #264) |
| /api/calendar/sync-connections/[id]/sync | POST | family (404 while off) | where (404); engine scopes by family + connection | P | none | calendar/connections/__tests__/routes.test.ts, calendar-sync/__tests__/sync.test.ts | implemented (dormant, #264) |
| /api/capture | GET | family | caller family's config | all; returns `allowed` (false for child) | none | capture/iso | implemented (D4) |
| /api/capture | POST | family | caller family's config | P+T (child 403 "Ask a parent to add this.") | none | capture/iso, capture/route.test.ts | implemented (D4) |
| /api/chores | GET | family | where | all | assigned_to filter cannot widen | chores/iso | ok |
| /api/chores | PATCH | family | match (403) | P or assignee; P-only fields | assigned_to verified; photo_url must be an `Upload` of the caller's family (400), or the chore's unchanged current value | chores/iso, chores/route.test.ts, src/__tests__/chore-photo-ownership.test.ts | implemented (D3) |
| /api/chores | DELETE | family | match (403) | P or assignee | none | chores/iso | ok |
| /api/chores/complete | POST | family | match (403) | all (any family chore, by design) | photoUrl must be an `Upload` of the caller's family (400), or the chore's unchanged current value | chores/iso, src/__tests__/chore-photo-ownership.test.ts | implemented (D3) |
| /api/chores/create | POST | family | session family | P | assigned_to verified; photo_url must be an `Upload` of the caller's family (400) | chores/iso, src/__tests__/chore-photo-ownership.test.ts | implemented (D3) |
| /api/chores/verify | POST | family | match (403) | P | none | chores/iso | ok |
| /api/cron/recurring-chores | POST | cron | per-family expansion | n/a | none | src/__tests__/recurring-chores.test.ts | ok |
| /api/device/elevation | POST | device | device's family | target must be a `parent` of the device's family (DB); PIN or password; every failure the same 401 | `userId` verified in device family; foreign/teen/child ids = uniform 401 and never touch that account's lockout | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/elevation | DELETE | device | this device only | n/a | elevation header must match this device | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/label | PATCH | device + elevation | this device only | elevated parent (role, family, token_version re-read) | elevation token bound to this device | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/me | GET | device | where (device's family) | n/a | none | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/pair/claim | POST | public (pairing code) | household from the code only; body family/member ids ignored | n/a | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/pair/status | POST | token (claim token, body) | the claimed pairing's family | n/a | none | family/devices/__tests__/devices.test.ts, src/lib/__tests__/device.integration.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/revoke-self | POST | device + elevation | this device only | elevated parent | elevation token bound to this device | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/session/refresh | POST | device (refresh cookie) | session's device/family | n/a | none | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts, src/lib/__tests__/device-session.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/device/today | GET | device | where (device's family); device-audience DTO; weather (#262) from the device household's own settings and `WeatherCache` row only | n/a | none | device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/emergency-contacts | GET | family | where | all (kid-readable by design, kid-access.ts) | none | emergency-contacts/iso | ok |
| /api/emergency-contacts | POST | family | session family | P | person_id **now** verified | emergency-contacts/iso | fixed; implemented (D1) |
| /api/emergency-contacts/[id] | PATCH | family | match (403) | P | person_id **now** verified | emergency-contacts/iso | fixed; implemented (D1) |
| /api/emergency-contacts/[id] | DELETE | family | match (403) | P | none | emergency-contacts/iso | implemented (D1) |
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
| /api/family/board-settings | GET | family | where (own family; members `family_id`) | P | none | family/board-settings/__tests__/board-settings.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (#262) |
| /api/family/board-settings | PATCH | family | own family; `WeatherCache` delete where `family_id` | P | `memberColors` ids verified in the household (400, same answer for foreign and missing); updates `where id + family_id` | family/board-settings/__tests__/board-settings.test.ts | implemented (#262) |
| /api/family/board-settings/places | GET | family | n/a (no household data read or stored; outbound to a fixed Open-Meteo host only) | P | none | family/board-settings/__tests__/board-settings.test.ts | implemented (#262) |
| /api/family/devices | GET | session (person only) | where | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/[id] | PATCH | session (person only) | where id + family (404) | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/[id]/events | GET | session (person only) | where id + family (404); actor names only for current members | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/[id]/revoke | POST | session (person only) | where id + family (404) | P | none | family/devices/__tests__/devices.test.ts, device/__tests__/device-routes.test.ts, src/app/api/__tests__/device-route-allowlist.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/pairings | POST | session (person only) | session family; `replacesDeviceId` where id + family (404) | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/pairings/[id] | GET | session (person only) | where id + family (404) | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/pairings/[id] | DELETE | session (person only) | where id + family (404) | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/family/devices/pairings/[id]/confirm | POST | session (person only) | where id + family (404) | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
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
| /api/files/chores/[filename] | GET | family | `Upload` row family (authoritative); legacy files with no row: a chore/assignment of the caller's family references it (404 otherwise) | all | n/a | src/__tests__/chore-photo-auth.test.ts, src/__tests__/chore-photo-ownership.test.ts | implemented (D3) |
| /api/handoff | GET | family | where | all; teen: no share token; child: `id`, `sitter_name`, `arrival_time`, `departure_time` only | none | handoff/iso | fixed; implemented (D2) |
| /api/handoff | POST | family | session family | P | none | handoff/iso | ok |
| /api/handoff/[id] | PATCH | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/[id] | DELETE | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/[id]/regenerate-token | POST | family | match (403) | P | none | handoff/iso | ok |
| /api/handoff/share/[token] | GET | token (rate-limited, expiring) | token's handoff only; allowlisted fields | n/a | none | handoff/share/[token]/__tests__/route.test.ts | ok |
| /api/health | GET | public | n/a | n/a | none | src/__tests__/health.test.ts | ok |
| /api/health/live | GET | public | n/a | n/a | none | src/__tests__/health.test.ts | ok |
| /api/inventory | GET | family + `featureGate('inventory')` | where family_id (+ location / expiry filters); paginated (limit ≤ 500) | all | none | inventory/iso, inventory.integration | implemented (#263) |
| /api/inventory | POST | device refused (403) + family + `featureGate('inventory')` | session family | P+T | `ingredient_id` verified in family (400, no existence leak); name link only to a same-family ingredient; strict body (no `family_id`/`added_by`); optional `Idempotency-Key` scoped `user:<id>`, record carries the family (#265) | inventory/iso, inventory/create-idempotency, inventory.integration, device-route-allowlist | implemented (#263) |
| /api/inventory/[id] | GET | family + `featureGate('inventory')` | where id + family (404, same as missing) | all | none | inventory/iso, inventory.integration | implemented (#263) |
| /api/inventory/[id] | PATCH | device refused (403) + family + `featureGate('inventory')` | where id + family (404); update also scoped by family | P+T | same as POST | inventory/iso, inventory.integration, device-route-allowlist | implemented (#263) |
| /api/inventory/[id] | DELETE | device refused (403) + family + `featureGate('inventory')` | `deleteMany where id + family` (404 when 0) | P+T | none | inventory/iso, inventory.integration, device-route-allowlist | implemented (#263) |
| /api/inventory/use-soon | GET | family + `featureGate('inventory')` | where family_id; board-safe fields only; limit ≤ 100 | all | none | inventory/iso, inventory.integration | implemented (#263) |
| /api/inventory/cook | GET | family + `featureGate('inventory')` + `featureGate('meals')` | recipes and items where family_id; ingredients owned through the recipe | all | none | inventory/iso, inventory.integration | implemented (#263) |
| /api/inventory/scan | POST | device refused (403) + family + kill switch (404) + `featureGate('inventory')` | none read or written; rate-limit keys from session user/family | P | multipart image: Content-Length bound, 8 MB, magic-byte type (JPEG/PNG/WebP); model output zod-validated and cleaned; fixed provider host, server-only key | inventory/scan, lib/inventory-scan, device-route-allowlist | implemented (#265) |
| /api/lists | GET | family + `featureGate('lists')` (#251) | where | all | none | lists/iso, lists/provenance | ok |
| /api/lists | DELETE | family + `featureGate('lists')` (#251) | match (403) | P | none | lists/iso, lists/provenance | ok |
| /api/lists/create | POST | family + `featureGate('lists')` (#251) | session family | P+T | none; type `meal_plan` hidden in the UI, still accepted for old clients (O-8) | lists/iso, lists/provenance | implemented (D9) |
| /api/lists/items | GET | family + `featureGate('lists')` (#251) | list match (403) | all | none | lists/iso, lists/provenance | ok |
| /api/lists/items/create | POST | family + `featureGate('lists')` (#251) | list match (403) | all | listId verified; `ingredient_id` **now** verified in family (400, no existence leak) | lists/iso, lists/provenance | ok |
| /api/lists/items/update | PATCH | family + `featureGate('lists')` (#251) | item's list match (403) | all | `ingredient_id` **now** verified in family (400, no existence leak) | lists/iso, lists/idempotency, lists/provenance, list-item-provenance.integration | ok; optional `Idempotency-Key` (#162): records scoped to `user:<id>` + `family_id`, never replayed across users or households, 401 before any lookup; `P2002` on `ListItem_open_recipe_source_key` → 409 `DUPLICATE_OPEN_ITEM` (not stored) |
| /api/lists/items/delete | DELETE | family + `featureGate('lists')` (#251) | item's list match (403) | P | none | lists/iso, lists/provenance | ok |
| /api/lists/items/from-recipe | POST | shared device refused first (403); family + `featureGate('meals')` + `featureGate('lists')` (#253) | recipe, meal, list each `where { id, family_id }` (404, no existence leak) | all | `ingredientIds` must belong to the recipe (400); ingredient rows come from the recipe, never from the body; `mealId` must use the recipe (400) | lists/from-recipe, lists/from-recipe.integration, device-route-allowlist | ok; `Idempotency-Key` required, records scoped to `user:<id>` + `family_id`; refusals not stored |
| /api/lists/items/undo-add | POST | shared device refused first (403); family + `featureGate('lists')` (#253) | `IdempotencyRecord` `where { id, family_id, action }` (404); same user (403); rows filtered by `source_request_id`, `added_by`, list `family_id` | all (own request) | none | lists/from-recipe, lists/from-recipe.integration, device-route-allowlist | ok; 10-minute window (409) |
| /api/lists/default-grocery | POST | family + `featureGate('lists')` (#253) | session family | P+T | none | lists/from-recipe, lists/from-recipe.integration | ok; advisory lock per household |
| /api/locations | GET | jwt | where | P (was all) | none | locations/iso | fixed |
| /api/locations | POST | jwt | session family | P | none | locations/iso | ok |
| /api/locations/[id] | DELETE | jwt | match (404) | P | none | locations/iso | ok |
| /api/meals | GET | family | where; `recipe` summary via the meal's own FK (id, title, prep/cook time, servings) | all | none | meals/iso, meals/recipe-link | ok |
| /api/meals | POST | family | session family | all | cook_id **now** verified; `recipe_id` verified in family (400, no existence leak, #251) | meals/iso, meals/recipe-link | fixed |
| /api/meals/[id] | PATCH | family | match (403) | all | cook_id **now** verified; `recipe_id` verified in family (400, no existence leak, #251) | meals/iso, meals/recipe-link | fixed |
| /api/meals/[id] | DELETE | family | match (403) | all | none | meals/iso | ok |
| /api/medications | GET | jwt | where | P; teen/child own (`person_id = self`) | none | medications/iso | implemented (D1) |
| /api/medications | POST | jwt | session family | P | person_id + sick_day_id verified | medications/route.test.ts | ok |
| /api/medications/[id] | PATCH | jwt | match (404) | P; teen/child dose-log only, own medication (sibling's 404) | none | medications/iso | implemented (D1) |
| /api/medications/[id] | DELETE | jwt | match (404) | P | none | medications/iso | ok |
| /api/messages | GET | family | where | all | none | messages/iso | ok |
| /api/messages | POST | family | session family | all | none | messages/iso | ok |
| /api/messages | PATCH | family | where (ids ∩ family) | all | messageIds limited to family | messages/iso | ok |
| /api/notes | GET | family | where | all | none | notes/iso | ok |
| /api/notes | POST | family | session family | all | none | notes/iso | ok |
| /api/notes/[id] | PATCH | family | match (403) | P; teen/child own (`created_by = self`) | none | notes/iso | implemented (D9) |
| /api/notes/[id] | DELETE | family | match (403) | P | none | notes/iso | implemented (D9) |
| /api/notifications | GET | session | own user | all | none | notifications/iso | ok |
| /api/notifications | POST | family | target user must share caller's family (403) | P | userId verified | notifications/iso | ok |
| /api/notifications | PATCH | session | own user (404) | all | none | notifications/iso | ok |
| /api/notifications | DELETE | session | own user (404) | all | none | notifications/iso | ok |
| /api/pickups | GET | jwt | where | all | none | pickups/iso | ok |
| /api/pickups | POST | jwt | session family | all | assigned_to verified | pickups/route.test.ts | ok |
| /api/pickups/[id] | PATCH | jwt | match (404) | all | none | pickups/iso | ok |
| /api/pickups/[id] | DELETE | jwt | match (404) | P | none | pickups/iso | implemented (D9) |
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
| /api/recipes | GET | family + `featureGate('meals')` | where family_id; paginated (limit ≤ 200) | all | none | recipes/iso, recipes.integration | implemented (#251) |
| /api/recipes | POST | family + `featureGate('meals')` | session family | P+T (O-7) | nested `ingredient_id`s verified in family (400, no existence leak); names upserted in family only; strict body (no `family_id`/`created_by`) | recipes/iso, recipes.integration | implemented (#251) |
| /api/recipes/[id] | GET | family + `featureGate('meals')` | where id + family (404, same as missing) | all | none | recipes/iso, recipes.integration | implemented (#251) |
| /api/recipes/[id] | PATCH | family + `featureGate('meals')` | where id + family (404) | P+T (O-7) | same as POST; `ingredients` replaces the set | recipes/iso, recipes.integration | implemented (#251) |
| /api/recipes/[id] | DELETE | family + `featureGate('meals')` | where id + family (404) | P (O-7) | 409 `RECIPE_IN_ARCHIVED_PLAN` while a legacy `MealPlanEntry` references it | recipes/iso, recipes.integration | implemented (#251) |
| /api/sick-days | GET | jwt | where | P; teen/child own (`person_id = self`) | none | sick-days/iso | implemented (D1) |
| /api/sick-days | POST | jwt | session family | P; teen/child own (report self only) | person_id verified | sick-days/route.test.ts, sick-days/iso | implemented (D1) |
| /api/sick-days/[id] | PATCH | jwt | match (404); raw SQL also filters family_id | P (kid: own 403, sibling 404) | none | sick-days/iso | implemented (D1) |
| /api/sick-days/[id] | DELETE | jwt | match (404) | P (kid: own 403, sibling 404) | none | sick-days/iso | implemented (D1) |
| /api/upload | POST | family | records an `Upload` row (caller's family, uploader); filename namespaced per family | all | none | src/__tests__/chore-photo-ownership.test.ts | implemented (D3) |
| /api/users | GET | session | self | all | none | users/__tests__/route.test.ts | ok |
| /api/users | PATCH | session | self (id/family_id/role not writable) | all | none | users/__tests__/route.test.ts | ok |
| /api/users | DELETE | session | self; last-parent guard | all | none | users/__tests__/route.test.ts | ok |
| /api/users/elevation-pin | PUT | session (person only) | self; PIN row carries the caller's family | P (requires current password) | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/users/elevation-pin | DELETE | session (person only) | self | P | none | family/devices/__tests__/devices.test.ts | implemented (behind SHARED_DEVICE_ENABLED) |
| /api/users/export | GET | session | self + own family; travel fields **now** parent-only; `meals` (FamilyMeal) and `mealBackfillJobs` (ADR-0007 backfill summaries) scoped by membership (#251); `inventory` (InventoryItem) scoped by membership (#263) | all | none | users/export/__tests__/route.test.ts, users/export/__tests__/canonical.test.ts | fixed |
| /api/wishlist | GET | family | where | all | none | wishlist/iso | ok |
| /api/wishlist | POST | family | session family | all | none | wishlist/iso | ok |
| /api/wishlist/[id] | PATCH | family | match (403) | requester or P | none | wishlist/iso | ok |
| /api/wishlist/[id] | DELETE | family | match (403) | requester or P | none | wishlist/iso | ok |
| /api/wishlist/[id]/status | PATCH | family | match (403) | P | none | wishlist/iso | ok |

Totals: 139 handlers before #240, plus the 19 shared-device handlers above (158). After the #102 decisions: 28 rows carry `implemented (Dn)` (some alongside `fixed`),
including the five D3 chore/upload/file rows; no row is `gap-needs-decision`, and every other row is `ok` or
`fixed`. D6 changed the auth
helper rather than individual rows: every `jwt` and `family` row now resolves role and family from the
database. No confirmed cross-family read or write remains open.

## Gaps fixed in the first audit change

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
| `src/app/api/allowance/route.ts` | GET was made parent-only. Superseded by D5: teens and children now read their own rows. |
| `src/app/api/handoff/route.ts` | GET strips `share_token` and `share_expires_at` for teen and child. The token is a bearer credential for the public sitter page. |

The role gates added (locations, travel) do not remove any existing kid UI.
`src/lib/kid-access.ts` sends teen and child sessions away from `/dashboard/locations` and `/dashboard/travel`.
Since the #102 decisions, `/dashboard/allowance`, `/dashboard/lists`, `/dashboard/handoff` and
`/dashboard/sick-days` are on the kid allowlist, read-only or own-only as the matrix describes. `TravelModeBanner` (the only other caller of `/api/family/travel`) is not mounted anywhere.

## Decisions

Cameron's decisions on issue #102, as implemented. The per-role result is in
[`docs/ROLE_AND_ISOLATION_MATRIX.md`](../ROLE_AND_ISOLATION_MATRIX.md).

| # | Topic | Status | Decision and implementation |
|---|---|---|---|
| D1 | Medical data for child and teen | decided, implemented | Teens and children see only their own medications and sick days (`person_id = self`), may report only themselves sick, and may log a dose of their own medication (`PATCH /api/medications/[id]` with `markDoseTaken`; any other kid PATCH is 403, a sibling's medication is 404). Sick-day edits and deletes are parent-only. Emergency contacts: every member reads, only parents create, edit or delete. Parents unchanged. |
| D2 | Handoff contents for kids | decided, implemented | Teens see the full handoff (still without the share token). Children see only `id`, `sitter_name`, `arrival_time`, `departure_time`. `/dashboard/handoff` is kid-reachable and read-only for kids. |
| D3 | Chore photo ownership | decided, implemented (expand phase) | Additive `Upload` table (`id`, `family_id` FK cascade, `uploaded_by` FK user set-null, unique `filename`, `content_type`, `size_bytes`, `created_at`). `POST /api/upload` records a row for the caller's family and names files `sha256(family_id, bytes)`, so identical images in two households no longer share a file. Chore create, update and complete accept only `/api/files/chores/<filename>` or the bare filename (stored in the canonical path form) of an upload owned by the caller's family; anything else, including another family's upload, is 400. `null`/`''` clears; re-sending the chore's current value is accepted unchanged. Serving: an `Upload` row decides ownership when it exists; legacy files with no row fall back to the referencing chore/assignment of the caller's family (now family-scoped). See [D3 legacy path and contract step](#d3-legacy-path-and-contract-step). |
| D4 | Capture spend | decided, implemented | Parents and teens may use `POST /api/capture`. Children get 403 `Ask a parent to add this.` before any provider call. `GET /api/capture` returns `allowed`, and the capture box shows the same message to a child. |
| D5 | A kid's own allowance | decided, implemented | Teens and children `GET` only rows paid to them (`to_user_id = self`), read-only. `POST`/`PATCH` stay parent-only. `/dashboard/allowance` is kid-reachable with the write controls hidden. |
| D6 | `getServerUser()` trusted JWT claims | decided, implemented | `resolveSession` (`src/lib/session.ts`) reads `token_version`, `role` and `family_id` in one query; `verifySessionToken` returns the database values. That covers `authenticateRequest`, `getServerUser()` and so all 14 `jwt` route files without per-file changes. The middleware kid gate uses the same lookup's role. |
| D7 | Shared-device sessions | implemented behind `SHARED_DEVICE_ENABLED` (#157 contract, #240) | Device identity, pairing, sessions, elevation and revocation ship as the `/api/device/*`, `/api/family/devices/*` and `/api/users/elevation-pin` rows above, default off. Existing routes stay person-only; `src/app/api/__tests__/device-route-allowlist.test.ts` calls every handler with only a device cookie and requires 401/404 outside the allowlist. UI (#241), device writes (phase 2) and Android integration are not implemented. |
| D8 | Write the matrix | done | `docs/ROLE_AND_ISOLATION_MATRIX.md`, linked from `AUTHORIZATION.md`. |
| D9 | Child/teen writes in low-sensitivity domains | decided, implemented | Lists: every member reads, adds and ticks items; parents and teens create lists; deleting a list or item is parent-only. `/dashboard/lists` is kid-reachable and in the kid nav. Notes: every member creates; teens and children edit only notes they created; delete is parent-only. Anniversaries: every member creates; delete is parent-only; teens and children edit only anniversaries they created (`Anniversary.created_by = self`, set on create, not writable by PATCH). Rows created before the column existed have `created_by` NULL and stay parent-edit-only. Pickups: delete is parent-only. The other D9 domains (meals, events create, projects and tasks create, messages, wishlist create, chore completion) stay open to every member, as confirmed in the matrix. |

### D3 legacy path and contract step

Expand phase (current):

- **Writes are contracted now.** A new chore photo (create, update, complete) needs an `Upload` row owned by
  the caller's family. The only exception is re-sending a chore's own current `photo_url` unchanged, so edit
  forms that post back what they loaded keep working for legacy chores. It grants no access the chore did not
  already have.
- **Reads keep a legacy fallback.** Files stored before D3 have no `Upload` row. `GET /api/files/chores/[filename]`
  still serves them when a chore or chore assignment of the caller's family references the file by
  `/api/files/chores/<filename>` or bare filename (`canFamilyReadChorePhoto` in `src/lib/chore-photos.ts`). The
  lookup is now scoped to the caller's family, which fixes the unscoped `findFirst` noted in the original D3
  question. When an `Upload` row exists it is authoritative: a chore reference from another family never
  overrides it.
- **Residual risk.** A cross-family attachment made *before* D3 shipped (a family-A chore pointing at a
  family-B legacy filename) is still served to A through the fallback. No new ones can be created.
- `/api/files/[filename]` (the older upload root) is unchanged: it already serves only files referenced by the
  caller's family, and nothing writes there any more.

Contract step (future, needs Cameron's approval because it touches production data):

1. Backfill `Upload` rows for legacy files: for each file under `UPLOAD_DIR/chores`, find the chores and chore
   assignments that reference it. If every reference is in one family, insert an `Upload` row for that family
   (`uploaded_by` NULL, `content_type` from the extension, `size_bytes` from the file). If references span
   families, do not guess: list them for a manual decision. Unreferenced files get no row. Run it as a one-off
   script, idempotent (`ON CONFLICT (filename) DO NOTHING`), dry-run first.
2. Verify on a copy of production that every chore/assignment `photo_url` under `/api/files/chores/` has an
   `Upload` row in the same family.
3. Remove the legacy reference fallback from `canFamilyReadChorePhoto`, and the "unchanged current value"
   exception from `resolveChorePhotoForWrite`, so ownership comes only from `Upload`.
4. Optionally retire `/api/files/[filename]` the same way once its files are migrated or confirmed unused.

### Original questions (for history)

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
