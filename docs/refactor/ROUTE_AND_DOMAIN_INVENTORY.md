# Route and domain inventory (#148)

**Inspected:** `master` at `cbef026` (#280), 2026-09-29. Static source inspection only: no route was run for this document, no production data was read, and nothing here claims runtime behaviour.

**Scope:** every page (`src/app/**/page.tsx`, 57 files) and every API route (`src/app/api/**/route.ts`, 131 files, 197 exported handlers; reconciled with #281 at `32f10d0`). The lists were produced by a throwaway Node script (not committed; the repository has no tooling-scripts location for doc generators) that walks `src/app`, reads each file's exported HTTP methods, `featureGate(...)` / `FeatureGate` / `useFeatureEnabled(...)` calls, device helpers (`authenticateDevice`, `requireElevation`, `refusePairedDevice`), env kill-switch helpers, Prisma delegates used in the route file and its direct `@/lib/*` imports, and joins each handler to the "Role gate" column of [`security/API_ISOLATION_AUDIT.md`](../security/API_ISOLATION_AUDIT.md). Hand-checked rows are marked.

**Related documents.** Roles: [`ROLE_AND_ISOLATION_MATRIX.md`](../ROLE_AND_ISOLATION_MATRIX.md). Navigation: [`product/NAVIGATION.md`](../product/NAVIGATION.md). Meal/list model decision: [ADR-0007](../architecture/adr/0007-canonical-meal-recipe-grocery-models.md) and [`architecture/MEALS_AND_GROCERIES.md`](../architecture/MEALS_AND_GROCERIES.md) §2. Shared device: [`architecture/SHARED_DEVICE.md`](../architecture/SHARED_DEVICE.md). Feature flags: `src/lib/features.ts`.

**Boundary.** This audit deletes no route and runs no migration. Findings that need work are proposed as issues below; none were filed from this change.

## Legend

- **Roles.** P = parent, T = teen, C = child. "all" = every member of the household. "n/a" = no person session (public, token or device). Page roles come from `src/middleware.ts` and `src/lib/kid-access.ts`: teens and children may open only `/dashboard` (kid home) and the prefixes in `KID_ALLOWED_PREFIXES`; everything else under `/dashboard` redirects them to `/dashboard`.
- **Device cookie.** "device only" / "device + elevation" = accepts only the `fp_device` cookie (`src/lib/device-route.ts`). "refused" = `refusePairedDevice` rejects a paired tablet before person auth. "no" = person session only (`authenticateRequest`/`authenticateWithFamily`/`getServerUser` never read device cookies; the route-allowlist test guards this).
- **Env gate.** Server kill switch or provider key; see [`CURRENT_STATE.md`](../CURRENT_STATE.md) "What is on and what is off by default". `SHARED_DEVICE_ENABLED` routes return 404 while off; calendar sync routes 404 until `isCalendarSyncEnabled()`; the scan and import routes 404 while their Anthropic key is unset.
- **Meal/list model.** Delegates used by the route file and the `@/lib` modules it imports directly. Canonical and legacy follow ADR-0007. "—" means no meal/recipe/list table is touched at that depth (the board loader and importer are covered by hand in "Meal and list overlap").
- **IA home** follows `product/NAVIGATION.md` and `src/lib/nav-items.ts`: *Tab* (phone tab bar and top bar), *More* (`/dashboard/family/more`, parents), *Settings* (settings, Features, family settings), *Sub-page* (reached from a parent page), *Utility* (top bar or user menu), *Hidden* (no in-app link; reached by URL, email link, redirect or device flow).

## Summary

| | Count |
|---|---|
| Page routes | 59 (48 under `/dashboard`, including `/dashboard/settings/activity` from #285; 4 under `/device`, 4 auth, `/`, `/join`, `/privacy`, `/terms`, `/handoff/[token]`, and the development-only `/dev/design-system` from #156) |
| API route files | 150 (the 131 above; 10 added by #283 and #284, which have no row in the generated API table yet: `/api/device/chores/[id]/complete`, `/api/device/chores/[id]/uncomplete`, `/api/device/elevated/board-settings`, `/api/device/elevated/board-settings/places`, `/api/device/lists/[id]/items`, `/api/device/lists/items/[id]`, `/api/inventory/[id]/consume`, `/api/inventory/[id]/discard`, `/api/inventory/adjustments`, `/api/inventory/adjustments/[id]/undo`; `/api/search`, F-3; `/api/users/deletion`, D-3; `/api/users/preferences`, #286; `/api/audit`, #285; `/api/lists/items/[id]`, F-6; `/api/family/beta-metrics`, #287; `/api/version`, #161 / #299; `/api/family/invite-code` and `/api/family/members/[id]`, O-34 / #322) |
| API handlers (file × method) | 219 (197 + 11 from #283/#284 + `GET /api/search` + `GET /api/users/deletion` + `GET`/`PATCH /api/users/preferences` + `GET /api/audit` + `DELETE /api/lists/items/[id]` + `PATCH /api/family/beta-metrics` + `GET /api/version` + `POST /api/family/invite-code` + `DELETE /api/family/members/[id]` + `GET /api/auth/verify-email` (#316)) |
| API handlers missing from the isolation audit | 0 (the 5 `/api/calendar/subscriptions/**` handlers were added for finding F-4) |
| Routes that read a legacy ADR-0007 table | 2: `GET /api/users/export`, `DELETE /api/recipes/[id]` (finding F-7) |
| Route-level `loading.tsx` / `error.tsx` files | `error.tsx` for `/dashboard` and `/device`; `loading.tsx` for the today, chores, lists, calendar and rewards tabs (finding F-9, fixed) |

API route files by domain (first path segment, all 150): family 24, device 15, calendar 13, lists 12, auth 9, inventory 9, budget 5, chores 5, projects 5, users 5, handoff 4, rewards 3, wishlist 3, and 1–2 each for activity, admin, allowance, analytics, anniversaries, audit, capture, cron, emergency-contacts, events, files, health, locations, meals, medications, messages, notes, notifications, pickups, recipes, search, sick-days, upload, version.

## Page routes

Disposition uses the #148 classes: **1** keep with visual refactor; **2** keep but move in IA; **3** merge into another journey; **4** parent/admin only; **5** child/teen simplified; **6** deprecate after migration evidence; **7** later/feature-gated.

| Route | Roles | Device | Feature gate (page) | IA home | Canonical data / API | Disposition |
|---|---|---|---|---|---|---|
| `/` | public | no | — | Hidden (landing; middleware sends signed-in users to `/dashboard`) | — | 1 |
| `/login`, `/register`, `/forgot-password`, `/reset-password` | public | login/register return 409 on a paired device (#240) | — | Hidden (auth) | `/api/auth/*` | 1 |
| `/join` | public / signed-in | no | — | Hidden (invite link) | `/api/family/invites/preview`, `/api/family/join`, `/api/family/lookup` | 1 |
| `/privacy`, `/terms` | public | no | — | Hidden (linked from register) | static | 1 |
| `/handoff/[token]` | public (share token) | no | — (API checks `handoff`) | Hidden (shared link) | `GET /api/handoff/share/[token]` | 7 |
| `/dashboard` | P → redirect `/dashboard/today`; T/C kid home | no | — | Tab (kid Today) | server: own chores, routines (#272) | 5 |
| `/dashboard/today` | all | no (the device board is `/device/today`) | per tile (weather, meals, inventory) | Tab (parent Today); user menu for T/C | board loader `src/app/dashboard/today/today-board-data.ts`: `Event`, `Chore`, `FamilyMeal`, `ListItem`; home summary `/api/chores/complete`, `/api/chores/uncomplete` | 1 |
| `/dashboard/calendar` | P | no | core (always on) | Tab | `/api/events`, `/api/calendar/import-suggestions*` | 1 |
| `/dashboard/calendar/create`, `/dashboard/calendar/edit` | P | no | core | Sub-page | `/api/events` | 1 |
| `/dashboard/chores` | P | no | core; `gamification` hides points | Sub-page (Today summary "All chores", More) | `/api/chores`, `/api/chores/complete`, `/api/chores/verify` | 1 |
| `/dashboard/chores/create`, `/dashboard/chores/edit` | P | no | core; `gamification` | Sub-page | `/api/chores/create`, `/api/chores`, `/api/upload` | 1 |
| `/dashboard/meals` | P | no | `meals` (FeatureGate); `inventory` for tiles | Tab | `/api/meals`, `/api/meals/[id]` → `FamilyMeal` | 1 |
| `/dashboard/meals/recipes/[id]` | P | no | `meals` | Sub-page | `/api/recipes/[id]` → `Recipe`, `RecipeIngredient` | 1 |
| `/dashboard/lists` | all | no | core | Tab (P and T/C) | server → `List`; shows `meal_plan` card only while such lists exist; `?type=` filters by list type (F-6) | 1 |
| `/dashboard/lists/[listId]` | all (delete P) | no | core | Sub-page | `/api/lists/items/*` (item delete: `DELETE /api/lists/items/[id]`, F-6), `/api/lists/section-sort` → `List`, `ListItem`, `Ingredient` | 1 |
| `/dashboard/lists/type/[type]` | all | no | core | Hidden (redirect only, F-6 fixed) | none: redirects to `/dashboard/lists?type=<type>` (unknown type: `/dashboard/lists`); the type cards filter `/dashboard/lists` in place | 3 (kept for old links and bookmarks) |
| `/dashboard/lists/create` | all (API: P+T) | no | core | Sub-page | `/api/lists/create` | 1 |
| `/dashboard/family` | P | no | core | Tab | `/api/family/members`, `/api/family/members/[id]` (remove, O-34), `/api/auth/me` | 4 |
| `/dashboard/family/more` | P | no | — (lists enabled features) | Tab (Family → More) | `src/lib/nav-items.ts` | 4 |
| `/dashboard/family/settings` | P | no | — | Settings | `/api/family`; the D-3 deletion dialog (`/api/users/deletion`, `DELETE /api/users`, `DELETE /api/family`); board settings component → `/api/family/board-settings` | 4 |
| `/dashboard/family/invite` | P | no | — | Settings (Family) | `/api/family/invites*`, `/api/family/invite-code` (new code, O-34) | 4 |
| `/dashboard/family/create` | P (no family yet) | no | — | Settings / onboarding | `POST /api/family` | 4 |
| `/dashboard/features` | P | no | — | Settings (More, Settings) | `/api/family/features` (via provider) | 4 |
| `/dashboard/settings` | P | no | sections by env: calendar sync, shared device | Utility (user menu) | `/api/users` (incl. `DELETE`, D-3), `/api/users/deletion`, `/api/users/export`, `/api/family` (`DELETE`, only parent), `/api/auth/change-password`, `/api/family/ai-settings`, `/api/family/feed-token`, `/api/calendar/*`, `/api/users/elevation-pin`, `/api/users/preferences` (#286; teens and children reach it from the user menu) | 4 |
| `/dashboard/settings/devices` | P | manages devices | `SHARED_DEVICE_ENABLED` (`notFound()` while off) | Settings | `/api/family/devices*` | 4, 7 |
| `/dashboard/settings/imports` | P | no | — | Settings | `POST /api/admin/imports/[source]` | 4 |
| `/dashboard/settings/activity` | P | no | — | Settings → Family "Recent changes" (parents) | `GET /api/audit` (#285) | 1 |
| `/dashboard/search` | P | no | — (per type in the API) | Utility (top bar link; command palette "Search the household") | `GET /api/search` (F-3 search part fixed) | 1 |
| `/dashboard/notifications` | P | no | — | Utility (bell) | `/api/notifications` | 1 |
| `/dashboard/emergency` | all (edit P) | no | `emergency` | Tab (T/C); Family → Emergency (P) | `/api/emergency-contacts*` | 5 |
| `/dashboard/inventory` | all (edit P+T) | no | `inventory`; `meals` for "what can I cook" | More; user menu (all roles) | `/api/inventory*` | 7 |
| `/dashboard/notes` | P | no | `notes` | More | `/api/notes`, `/api/notes/[id]` (F-1 fixed) | 1 |
| `/dashboard/anniversaries` | P | no | `anniversaries` | More | `/api/anniversaries*` | 1 |
| `/dashboard/messages` | P | no | `messages` (FeatureGate; F-2 fixed) | More | `/api/messages` | 1 |
| `/dashboard/projects` | P | no | `projects` (checked in page before any read; F-2 fixed) | More | server Prisma; `/api/projects` | 1 |
| `/dashboard/projects/[id]`, `/dashboard/projects/create` | P | no | `projects` (`[id]` checked in page before the project read; `create` FeatureGate; F-2 fixed) | Sub-page | `/api/projects/*`; "Add task" on an active project → `POST /api/projects/[id]/tasks` (F-5) | 1 |
| `/dashboard/budget` | P | no | `budget` (checked in page before any read; F-2 fixed) | More | server Prisma; budget components → `/api/budget/*` | 4 |
| `/dashboard/rewards` | P | no | `rewards` (checked in page; requires `gamification`) | More | server; `/api/rewards*` | 7 |
| `/dashboard/rewards/create` | P | no | `rewards` | Sub-page | `/api/rewards` | 7 |
| `/dashboard/analytics` | P | no | `analytics` (requires `gamification`) | More | `/api/analytics` | 7 |
| `/dashboard/wishlist` | all | no | `wishlist` (off by default) | More | `/api/wishlist*` | 5, 7 |
| `/dashboard/pickups` | P | no | `pickups` (off by default) | More | `/api/pickups*` | 7 |
| `/dashboard/allowance` | all (T/C read own) | no | `allowance` (off by default) | More | `/api/allowance*` | 5, 7 |
| `/dashboard/handoff` | all (T/C reduced) | no | `handoff` (off by default) | More | `/api/handoff*` | 5, 7 |
| `/dashboard/sick-days` | all (T/C own) | no | `sick-days` (off by default) | More | `/api/sick-days*`, `/api/medications*` | 5, 7 |
| `/dashboard/locations` | P | no | `locations` (off by default) | More | `/api/locations*` | 4, 7 |
| `/dashboard/travel` | P | no | `travel` (off by default) | More | `/api/family/travel`, `/api/chores` | 7 |
| `/device` | device | device cookie | `SHARED_DEVICE_ENABLED` | Hidden (redirects to `/device/today`) | — | 7 |
| `/device/pair` | none (pairing) | pairing | `SHARED_DEVICE_ENABLED` | Hidden (device flow) | `/api/device/pair/*` | 7 |
| `/device/today` | device (+ parent elevation) | device only | `SHARED_DEVICE_ENABLED` | Hidden (device home) | `GET /api/device/today` (same board loader as `/dashboard/today`) | 7 |
| `/device/removed` | none | after revoke | `SHARED_DEVICE_ENABLED` | Hidden | — | 7 |
| `/dev/design-system` | none (not a product page) | no | 404 in a production build unless `DESIGN_GALLERY_ENABLED=1` (E2E server only) | Hidden (development and QA tool, `noindex`) | none: fixture props only (`src/app/dev/design-system/fixtures.ts`), no session, Prisma or API (#156, `design/DESIGN_GALLERY.md`) | 7 |

## Feature flags (`src/lib/features.ts`)

| Feature | Default (new household) | Page | API gate | Disposition |
|---|---|---|---|---|
| `chores`, `calendar`, `lists`, `family` | core, always on | yes | `lists` gated (O-11); others core | 1 |
| `meals` | on | `/dashboard/meals` | `featureGate('meals')` on meals, recipes, from-recipe, cook | 1 |
| `inventory` | off (also for existing households) | `/dashboard/inventory` | `featureGate('inventory')`; scan also needs its key | 7 |
| `notes` | on | `/dashboard/notes` | yes | 1 (F-1 fixed) |
| `anniversaries` | on | yes | yes | 1 |
| `gamification` | off; on for pre-#248 households | setting, not a page | hides fields (`isGamificationOn`) | 7 |
| `rewards` | on, requires `gamification` | yes | yes | 7 |
| `analytics` | on, requires `gamification` | yes | yes | 7 |
| `budget` | on | yes (F-2 fixed) | yes | 4 |
| `projects` | on | yes (F-2 fixed) | yes | 1 |
| `messages` | on | yes (F-2 fixed) | yes | 1 |
| `emergency` | on | yes | yes | 5 (kid-readable by design) |
| `wishlist` | off | yes | yes | 5, 7 |
| `locations` | off | yes | yes | 4, 7 |
| `pickups` | off | yes | yes | 7 |
| `allowance` | off | yes | yes | 5, 7 |
| `travel` | off | yes | yes | 7 |
| `handoff` | off | yes | yes | 5, 7 |
| `sick-days` | off | yes | yes | 5, 7 |

## Shared-device and role exposure

- Only `/api/device/*` accepts the device cookie (9 route files, including #281's `GET /api/device/today/version`). `/api/device/label` and `/api/device/revoke-self` also need parent elevation. `/api/family/devices/*` and `/api/users/elevation-pin` are parent person routes behind `SHARED_DEVICE_ENABLED`.
- 10 routes refuse a paired tablet before person auth: `/api/inventory` and `/api/inventory/[id]` (all methods), `/api/inventory/scan`, `/api/calendar/import-suggestions*`, `/api/lists/items/from-recipe`, `/api/lists/items/section`, `/api/lists/items/undo-add`, `/api/lists/section-sort`. Since then: the #284 inventory consume/discard/undo routes, `GET /api/search` (F-3) `GET`/`PATCH /api/users/preferences` (#286) `GET /api/audit` (#285) and `PATCH /api/family/beta-metrics` (#287) also refuse it (the route-allowlist test's `DEVICE_REFUSED_ROUTES` is the current list).
- The tablet surface is `/device/today`, fed by the same board loader as `/dashboard/today`; its DTO allowlist is in `SHARED_DEVICE.md` §9.1. Device writes are off (#274 proposes extending them deliberately, ADR-0006).
- Teens and children: page access is the kid allowlist (`/dashboard`, `today`, `lists`, `emergency`, `inventory`, `wishlist`, `allowance`, `handoff`, `sick-days`); every API row below carries its per-method role from the isolation audit.

## Meal and list overlap (for ADR-0007 and #254)

| Path | Model today | Notes |
|---|---|---|
| `/dashboard/meals`, `/api/meals*` | canonical `FamilyMeal` (+ `Recipe` link) | #251/#252 |
| `/dashboard/meals/recipes/[id]`, `/api/recipes*` | canonical `Recipe`, `RecipeIngredient`, `Ingredient` | `DELETE /api/recipes/[id]` also counts `MealPlanEntry` rows that still reference the recipe (`src/app/api/recipes/[id]/route.ts:133`): a legacy **read** that must go with #254 |
| `/dashboard/lists*`, `/api/lists/**` | canonical `List`, `ListItem`, `Ingredient` | every handler has `featureGate('lists')` (O-11). The `meal_plan` list type still opens (`src/app/dashboard/lists/ListsClient.tsx:71`) but is no longer offered for new lists (`src/app/dashboard/lists/create/page.tsx:14`) |
| `/api/lists/items/from-recipe`, `/undo-add`, `/api/lists/default-grocery` | canonical, via `src/lib/grocery-from-recipe.ts` | #253 |
| `/api/inventory/cook`, `/use-soon` | canonical `Ingredient`, `Recipe` | #263 |
| Today board and `/api/device/today` | canonical `FamilyMeal`, `ListItem` via `today-board-data.ts` and `src/lib/shopping-snapshot.ts` | `shopping-snapshot.ts` reads `ListItem` on `grocery`/`shopping` lists; the name is not the legacy table |
| `POST /api/admin/imports/[source]` (meal-planner) | writes canonical `FamilyMeal`/`List`/`ListItem`/`Recipe*` (`src/lib/imports/persist-meal-planner.ts`, audit row) | existing `ImportedRecord` rows may still name a legacy `target_model`; #254 step 1 rewrites them |
| `GET /api/users/export` | reads canonical **and legacy** `MealPlan`, `ShoppingList` (`src/app/api/users/export/route.ts:129`, `:133`) | #254 step 2 removes the legacy sections |
| `scripts/backfill-meals-groceries.mjs` / `src/lib/backfill/meals-groceries.ts` | reads legacy, writes canonical | production run owner-gated (`runbooks/MEALS_GROCERIES_BACKFILL.md`) |
| `src/lib/fixtures/*` | seeds legacy rows for rehearsal | test-only |

No page or API route **writes** a legacy table. The two live legacy reads above are the complete list found by `grep -rnE "\.(mealPlan|mealPlanEntry|shoppingList|shoppingItem)\b" src scripts` outside tests and fixtures. This matches ADR-0007; no new live path triggers its revisit clause.

## Findings

Each is from source inspection at `cbef026`. "Proposed issue" means an issue should be filed; none was filed here. F-2, F-4, F-8 and F-9 were fixed in a follow-up change on top of `c379c5e`; their rows say what changed.

| ID | Finding | Evidence | Proposed action |
|---|---|---|---|
| F-1 | **Notes edit and delete cannot work.** The page sends `PATCH` and `DELETE` to `/api/notes`, which exports only `GET` and `POST`; the handlers live in `/api/notes/[id]`, which nothing calls. | `src/app/dashboard/notes/page.tsx:132-133`, `:158-159`; `src/app/api/notes/route.ts` (GET, POST); `src/app/api/notes/[id]/route.ts` | **Fixed** in this change: the page calls `/api/notes/${id}`; `src/app/dashboard/notes/__tests__/edit-delete.test.tsx` covers both |
| F-2 | **Three pages do not check their feature flag.** `/dashboard/budget` and `/dashboard/projects` read Prisma on the server and render with `budget`/`projects` off; `/dashboard/messages` renders and gets 403 from its API. Their APIs are gated, and the nav hides them, so this is a direct-URL inconsistency, not a cross-household leak. | `src/app/dashboard/budget/page.tsx:55-90`, `src/app/dashboard/projects/page.tsx:17`, `src/app/dashboard/messages/page.tsx` (no `FeatureGate`) | **Fixed** (route inventory follow-up): budget, projects and projects/[id] check the effective flag on the server before any Prisma read and render `FeatureOffState` (as rewards does); messages and projects/create use `FeatureGate`. Tests: `src/app/dashboard/{budget,projects,messages}/__tests__/feature-gate.test.tsx` |
| F-3 | **Placeholder UI in production paths.** `/dashboard/search` had no data source and showed "No results" for every query; Settings has "Two-Factor Authentication", "Data Export" and "Delete Account" buttons with no handler (the export and delete APIs exist). | `src/app/dashboard/search/page.tsx` (whole file); `src/app/dashboard/settings/SettingsClient.tsx:731-739` | **Search fixed** (#101 D-2): `GET /api/search` searches the household's canonical members, events, chores, lists, list items, recipes, notes and active inventory, per feature and role (`ROLE_AND_ISOLATION_MATRIX.md` "Household search"); the page and the command palette use it. Settings part **fixed (D-3)**: Data Export downloads `GET /api/users/export`, the Two-Factor Authentication entry is removed (no 2FA exists), Delete Account opens the in-page deletion dialog (`product/ACCOUNT_DELETION.md`). Settings → Notifications **fixed** (#286, PR101 D-5): its four switches only wrote `localStorage` and nothing read them; they are replaced by three per-member switches stored on `User` and enforced by `src/lib/notification-delivery.ts` |
| F-4 | **ICS subscription routes are missing from the isolation audit and the role matrix.** 5 handlers. From source: list P+T (URL hint parent only), create/update/delete P, refresh P+T; every lookup uses `authenticateWithFamily`. | `src/app/api/calendar/subscriptions/**`; no row in `security/API_ISOLATION_AUDIT.md` | **Fixed** (route inventory follow-up): 5 rows and an update note in `security/API_ISOLATION_AUDIT.md`, a row in `ROLE_AND_ISOLATION_MATRIX.md`; the existing two-household suite `src/app/api/calendar/subscriptions/__tests__/isolation.test.ts` now also pins the exact 404/403/400 statuses |
| F-5 | **API routes with no in-app caller.** `GET /api/admin/imports`, `GET/POST /api/projects/[id]/tasks` (no UI adds a task to an existing project), `GET /api/lists/items` (only `e2e/`). Expected callers outside the app: `/api/calendar/connections/[provider]/callback` (OAuth redirect), `/api/calendar/feed` (ICS URL), `/api/health*` (release smoke). `/api/users/export` is no longer on this list: Settings → Data Export and the delete dialog call it (D-3). | generated reference scan of `src/` and `e2e/` | **Resolved** (#289), nothing deleted. `GET /api/admin/imports`: kept for operators (parent-only list of the household's last 50 import jobs; documented in `architecture/API_CONTRACTS.md` "Deprecated, duplicate and operator routes"). `GET/POST /api/projects/[id]/tasks`: **wired**, "Add task" on an active project's page (`src/components/projects/AddProjectTaskForm.tsx`); lookups are now household-scoped (foreign project or assignee = the same 404 as a missing one). `GET /api/lists/items`: **deprecated**, unchanged body plus a `Deprecation` header (`src/lib/deprecation.ts`); removal only after the ADR-0004 review of installed Android clients. Tests: `src/app/api/projects/__tests__/isolation.test.ts`, `src/components/projects/__tests__/add-project-task-form.test.tsx`, `src/app/dashboard/projects/__tests__/add-task-wiring.test.tsx`, `src/app/api/lists/__tests__/item-delete.test.ts` |
| F-6 | **Duplicate or overlapping routes.** `/dashboard/lists/type/[type]` duplicates a filter of `/dashboard/lists`; `/api/lists/items/delete` (body id) sits beside REST-style `[id]` routes elsewhere; `/api/files/[filename]` and `/api/files/chores/[filename]` serve two upload generations (D3 legacy path in the audit); `/api/chores/complete` and `PATCH /api/chores` both change chore status. | route list above | **Resolved** (#289), nothing deleted. `/dashboard/lists/type/[type]`: redirects to `/dashboard/lists?type=<type>`, and the type cards filter in place. List item delete: new REST `DELETE /api/lists/items/[id]` (parent, lists on, household-scoped 404, paired device refused), which the web app now calls; `DELETE /api/lists/items/delete?itemId=` (the id is a query parameter, not a body field) stays for installed Android builds with a `Deprecation` header; both go through `deleteHouseholdListItem` (`src/lib/list-item-delete.ts`). `/api/files/[filename]`: unchanged; stays until there is migration evidence (D3 legacy path, `security/API_ISOLATION_AUDIT.md`). Chore status: one path already — `completeChore` for complete, `reopenCompletedChoreInTx` for Undo and the verify reject; `PATCH /api/chores` never changed status (its schema drops `status`), so no endpoint changed; pinned by `src/app/api/chores/__tests__/status-single-path.test.ts`. Tests: `src/app/dashboard/lists/__tests__/type-filter.test.tsx`, `src/app/api/lists/__tests__/item-delete.test.ts`, `src/lib/__tests__/list-item-delete.integration.test.ts`, route allowlist |
| F-7 | **Legacy table reads** that block #254: `GET /api/users/export`, `DELETE /api/recipes/[id]`. | see "Meal and list overlap" | Part of #254 (gated) |
| F-8 | **Dead helper.** `generateFamilyCode` (uses `Math.random`) is exported and has no caller. | `src/lib/utils.ts:106` | **Fixed** (route inventory follow-up): deleted; no caller in `src`, `e2e`, `scripts` or tests |
| F-9 | **No route-level `loading.tsx` or `error.tsx` anywhere in `src/app`.** Loading, error and empty states are per component, so a server-page exception falls through to the framework error page. | `find src/app -name loading.tsx -o -name error.tsx` returns nothing | **Fixed** (route inventory follow-up): `src/app/dashboard/error.tsx` and `src/app/device/error.tsx` (plain-words message, Try again calls `reset()`, no error text, stack or digest; the tablet one shows no household data and does not unpair), `loading.tsx` in the today, chores, lists, calendar and rewards segments (one shared polite `role="status"` skeleton, `src/components/ui/route-loading.tsx`). Not at `/dashboard` itself or above pages that `redirect()` or `notFound()`: a loading boundary streams the page, which turns the parent redirect from `/dashboard` into a client-side one (caught by `e2e/journeys.spec.ts`) and a 404 into a 200. Tests: `src/app/dashboard/__tests__/route-states.test.tsx`, `src/app/device/__tests__/error.test.tsx` |

Not assessed here, because static inspection cannot support a claim: responsive/tablet weaknesses beyond the tab model already in `NAVIGATION.md`, and bundle/performance hotspots (#137 owns route budgets).

## Proposed migration order

Highest-frequency daily flows first, each as one vertical slice (UI + canonical API + authorization + tests):

1. **Today / home** (`/dashboard/today`, kid `/dashboard`, `/device/today`): already canonical; next are #271 (PR #281) and #274.
2. **Chores** (`/dashboard/chores*`): canonical; #272 merged in #280.
3. **Lists and groceries** (`/dashboard/lists*`): canonical; `/lists/type/[type]` folded into the `?type=` filter (F-6 fixed).
4. **Calendar** (`/dashboard/calendar*`): canonical `Event`; the missing audit rows are added (F-4 fixed).
5. **Meals and recipes** (`/dashboard/meals*`): canonical; #252 design review against FridgeCal is open.
6. **Notes** (F-1 fixed), inventory, messages.
7. **Weekly/occasional:** projects, budget, anniversaries, rewards/analytics, then the off-by-default family features (wishlist, pickups, allowance, handoff, sick days, locations, travel).
8. **Settings and placeholders:** F-3, F-2 and F-9 fixed.
9. **Contract (gated):** #254 after the backfill run and a release with zero legacy reads.

## API routes

Generated table. Roles are the audit's "Role gate" column per method; the three `/api/calendar/subscriptions` rows were read from source before the audit had them (F-4, now fixed). "Device cookie: refused" is `refusePairedDevice`.

| Route | Methods | Roles (audit "Role gate", per method) | Device cookie | Feature gate | Env gate | Meal/list model |
|---|---|---|---|---|---|---|
| `/api/activity` | GET | GET: all | no | — | — | — |
| `/api/audit` | GET | GET: P (teen/child 403) — hand-checked (#285) | refused | — | — | `AuditLog` (household audit history, ADR-0008) |
| `/api/admin/imports/[source]` | POST | POST: P | no | — | — | — |
| `/api/admin/imports` | GET | GET: P | no | — | — | — |
| `/api/allowance/[id]` | PATCH | PATCH: P | no | allowance | — | — |
| `/api/allowance` | GET, POST | GET: P; teen/child own (`to_user_id = self`) ; POST: P | no | allowance | — | — |
| `/api/analytics/event` | POST | POST: all | no | — | — | — |
| `/api/analytics` | GET | GET: all | no | analytics | — | — |
| `/api/anniversaries/[id]` | PATCH, DELETE | PATCH: P; teen/child own (`created_by = self`; NULL = parent-only) ; DELETE: P | no | anniversaries | — | — |
| `/api/anniversaries` | GET, POST | GET: all ; POST: all | no | anniversaries | — | — |
| `/api/auth/change-password` | POST | POST: all | no | — | — | — |
| `/api/auth/forgot-password` | POST | POST: n/a | no | — | — | — |
| `/api/auth/login` | POST | POST: n/a | no | gamification (fields hidden) | — | — |
| `/api/auth/logout` | POST | POST: n/a | no | — | — | — |
| `/api/auth/me` | GET | GET: all | no | gamification (fields hidden) | — | — |
| `/api/auth/register` | POST | POST: n/a | no | — | — | — |
| `/api/auth/resend-verification` | POST | POST: n/a | no | — | — | — |
| `/api/auth/reset-password` | POST | POST: n/a | no | — | — | — |
| `/api/auth/verify-email` | GET, POST | GET: n/a; POST: n/a | no | — | — | — |
| `/api/budget/categories/[id]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | budget | — | — |
| `/api/budget/categories` | GET, POST | GET: P ; POST: P | no | budget | — | — |
| `/api/budget/stats` | GET | GET: P | no | budget | — | — |
| `/api/budget/transactions/[id]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | budget | — | — |
| `/api/budget/transactions` | GET, POST | GET: P ; POST: P | no | budget | — | — |
| `/api/calendar/connections/[provider]/callback` | GET | GET: P | no | — | calendar sync envs | — |
| `/api/calendar/connections/[provider]/start` | POST | POST: P | no | — | calendar sync envs | — |
| `/api/calendar/connections` | GET | GET: P | no | — | calendar sync envs | — |
| `/api/calendar/feed` | GET | GET: n/a | no | — | — | — |
| `/api/calendar/import-suggestions/commit` | POST | POST: P+T | refused | calendar | — | — |
| `/api/calendar/import-suggestions` | POST | POST: P+T | refused | calendar | EVENT_IMPORT_ANTHROPIC_API_KEY | — |
| `/api/calendar/import-suggestions/undo` | POST | POST: P+T (own import only) | refused | calendar | — | — |
| `/api/calendar/subscriptions/[id]/refresh` | POST | POST: P+T | no | — | — | — |
| `/api/calendar/subscriptions/[id]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | — | — | — |
| `/api/calendar/subscriptions` | GET, POST | GET: P+T (URL hint parent only) ; POST: P | no | — | — | — |
| `/api/calendar/sync-connections/[id]/calendars` | GET | GET: P, connecting member only (403) | no | — | calendar sync envs | — |
| `/api/calendar/sync-connections/[id]` | PATCH, DELETE | PATCH: P, connecting member only (403) ; DELETE: P | no | — | calendar sync envs | — |
| `/api/calendar/sync-connections/[id]/sync` | POST | POST: P | no | — | calendar sync envs | — |
| `/api/capture` | POST, GET | POST: P+T (child 403 "Ask a parent to add this.") ; GET: all; returns `allowed` (false for child) | no | — | — | — |
| `/api/chores/complete` | POST | POST: all (any family chore, by design) | no | — | — | — |
| `/api/chores/create` | POST | POST: P | no | gamification (fields hidden) | — | — |
| `/api/chores` | GET, PATCH, DELETE | GET: all ; PATCH: P or assignee; P-only fields ; DELETE: P or assignee | no | gamification (fields hidden) | — | — |
| `/api/chores/uncomplete` | POST | POST: P or assignee (403); only from `completed` (verified: 409 `CHORE_ALREADY_VERIFIED`) | no | — | — | — |
| `/api/chores/verify` | POST | POST: P (approve and reject) | no | gamification (fields hidden) | — | — |
| `/api/cron/recurring-chores` | POST | POST: n/a | no | — | CRON_SECRET | — |
| `/api/device/elevation` | POST, DELETE | POST: target must be a `parent` of the device's family (DB); PIN or password; every failure the same 401 ; DELETE: n/a | device only | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/label` | PATCH | PATCH: elevated parent (role, family, token_version re-read) | device + elevation | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/me` | GET | GET: n/a | device only | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/pair/claim` | POST | POST: n/a | device pairing/session (no person) | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/pair/status` | POST | POST: n/a | device pairing/session (no person) | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/revoke-self` | POST | POST: elevated parent | device + elevation | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/session/refresh` | POST | POST: n/a | device pairing/session (no person) | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/today` | GET | GET: n/a | device only | — | SHARED_DEVICE_ENABLED | — |
| `/api/device/today/version` | GET | GET: n/a (the device's own household; returns only `{ version }`, #281) | device only | — | SHARED_DEVICE_ENABLED | — |
| `/api/emergency-contacts/[id]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | emergency | — | — |
| `/api/emergency-contacts` | GET, POST | GET: all (kid-readable by design, kid-access.ts) ; POST: P | no | emergency | — | — |
| `/api/events` | GET, POST, PATCH, DELETE | GET: all ; POST: all ; PATCH: P ; DELETE: P | no | — | — | — |
| `/api/family/ai-settings` | GET, POST | GET: P ; POST: P | no | — | — | — |
| `/api/family/board-version` | GET | GET: all (the caller's own household and role; returns only `{ version }`, #281) | no (tablet cookie 401) | — | — | — |
| `/api/family/beta-metrics` | PATCH | PATCH: P (teen/child 403; strict body) — hand-checked (#287) | refused | — | — | `BetaMetricDaily` (beta usage counts) |
| `/api/family/board-settings/places` | GET | GET: P | no | — | WEATHER_ENABLED | — |
| `/api/family/board-settings` | GET, PATCH | GET: P ; PATCH: P | no | — | WEATHER_ENABLED (weather fields only) | — |
| `/api/family/devices/[id]/events` | GET | GET: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices/[id]/revoke` | POST | POST: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices/[id]` | PATCH | PATCH: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices/pairings/[id]/confirm` | POST | POST: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices/pairings/[id]` | GET, DELETE | GET: P ; DELETE: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices/pairings` | POST | POST: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/devices` | GET | GET: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/family/features` | GET, PATCH | GET: all ; PATCH: P | no | — | — | — |
| `/api/family/feed-token` | GET, POST | GET: P ; POST: P | no | — | — | — |
| `/api/family/invite-code` | POST | POST: P (teen/child 403; "Get a new family code", O-34) | refused | — | — | — |
| `/api/family/invites/[id]` | DELETE | DELETE: P | no | — | — | — |
| `/api/family/invites/preview` | GET | GET: n/a | no | — | — | — |
| `/api/family/invites` | GET, POST | GET: P ; POST: P | no | — | — | — |
| `/api/family/join` | POST | POST: n/a | no | — | — | — |
| `/api/family/lookup` | GET | GET: n/a | no | — | — | — |
| `/api/family/members/[id]` | DELETE | DELETE: P, own household only, not self, never the last parent ("Remove from household", O-34) | refused | — | — | — |
| `/api/family/members` | GET | GET: all | no | — | — | — |
| `/api/family` | POST, GET, PATCH, DELETE | POST: n/a (rejects if already in a family) ; GET: all ; PATCH: P ; DELETE: P, only parent, password + household name (D-3) | refused (DELETE) | — | — | — |
| `/api/family/travel` | GET, PATCH | GET: P (was all) ; PATCH: P | no | travel | — | — |
| `/api/files/[filename]` | GET | GET: all | no | — | — | — |
| `/api/files/chores/[filename]` | GET | GET: all | no | — | — | — |
| `/api/handoff/[id]/regenerate-token` | POST | POST: P | no | handoff | — | — |
| `/api/handoff/[id]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | handoff | — | — |
| `/api/handoff` | GET, POST | GET: all; teen: no share token; child: `id`, `sitter_name`, `arrival_time`, `departure_time` only ; POST: P | no | handoff | — | — |
| `/api/handoff/share/[token]` | GET | GET: n/a | no | — | — | — |
| `/api/health/live` | GET | GET: n/a | no | — | — | — |
| `/api/version` | GET | GET: n/a | no | — | — | — |
| `/api/health` | GET | GET: n/a | no | — | — | — |
| `/api/inventory/[id]` | GET, PATCH, DELETE | GET: all ; PATCH: P+T ; DELETE: P+T | refused | inventory | — | canonical: Ingredient, Recipe |
| `/api/inventory/cook` | GET | GET: all | no | inventory, meals | — | canonical: Ingredient, Recipe |
| `/api/inventory` | GET, POST | GET: all ; POST: P+T | refused | inventory | — | canonical: Ingredient, Recipe |
| `/api/inventory/scan` | POST | POST: P | refused | inventory | INVENTORY_SCAN_ANTHROPIC_API_KEY | — |
| `/api/inventory/use-soon` | GET | GET: all | no | inventory | — | canonical: Ingredient, Recipe |
| `/api/lists/create` | POST | POST: P+T | no | lists | — | canonical: List |
| `/api/lists/default-grocery` | POST | POST: P+T | no | lists | — | canonical: FamilyMeal, List, ListItem, Recipe |
| `/api/lists/items/create` | POST | POST: all | no | lists | — | canonical: Ingredient, List, ListItem |
| `/api/lists/items/delete` | DELETE | DELETE: P — deprecated (F-6): `Deprecation` header, kept for installed Android builds | no | lists | — | canonical: ListItem |
| `/api/lists/items/[id]` | DELETE | DELETE: P — hand-checked (F-6, #289) | refused | lists | — | canonical: ListItem |
| `/api/lists/items/from-recipe` | POST | POST: all | refused | meals, lists | — | canonical: FamilyMeal, List, ListItem, Recipe |
| `/api/lists/items` | GET | GET: all — deprecated (F-5): `Deprecation` header, no in-app caller | no | lists | — | canonical: Ingredient, List, ListItem |
| `/api/lists/items/section` | PATCH | PATCH: all | refused | lists | — | canonical: Ingredient, List, ListItem |
| `/api/lists/items/undo-add` | POST | POST: all (own request) | refused | lists | — | canonical: FamilyMeal, List, ListItem, Recipe |
| `/api/lists/items/update` | PATCH | PATCH: all | no | lists | — | canonical: Ingredient, List, ListItem |
| `/api/lists` | GET, DELETE | GET: all ; DELETE: P | no | lists | — | canonical: List |
| `/api/lists/section-sort` | PATCH | PATCH: P+T | refused | lists | — | canonical: Ingredient, List, ListItem |
| `/api/locations/[id]` | DELETE | DELETE: P | no | locations | — | — |
| `/api/locations` | GET, POST | GET: P (was all) ; POST: P | no | locations | — | — |
| `/api/meals/[id]` | PATCH, DELETE | PATCH: all ; DELETE: all | no | meals | — | canonical: FamilyMeal, Recipe |
| `/api/meals` | GET, POST | GET: all ; POST: all | no | meals | — | canonical: FamilyMeal, Recipe |
| `/api/medications/[id]` | PATCH, DELETE | PATCH: P; teen/child dose-log only, own medication (sibling's 404) ; DELETE: P | no | sick-days | — | — |
| `/api/medications` | GET, POST | GET: P; teen/child own (`person_id = self`) ; POST: P | no | sick-days | — | — |
| `/api/messages` | GET, POST, PATCH | GET: all ; POST: all ; PATCH: all | no | messages | — | — |
| `/api/notes/[id]` | PATCH, DELETE | PATCH: P; teen/child own (`created_by = self`) ; DELETE: P | no | notes | — | — |
| `/api/notes` | GET, POST | GET: all ; POST: all | no | notes | — | — |
| `/api/notifications` | GET, POST, PATCH, DELETE | GET: all ; POST: P ; PATCH: all ; DELETE: all | no | — | — | — |
| `/api/pickups/[id]` | PATCH, DELETE | PATCH: all ; DELETE: P | no | pickups | — | — |
| `/api/pickups` | GET, POST | GET: all ; POST: all | no | pickups | — | — |
| `/api/projects/[id]` | GET, PATCH, DELETE | GET: all ; PATCH: P ; DELETE: P | no | projects | — | — |
| `/api/projects/[id]/send-to-calendar` | POST | POST: all | no | projects | — | — |
| `/api/projects/[id]/tasks/[taskId]` | PATCH, DELETE | PATCH: P ; DELETE: P | no | projects | — | — |
| `/api/projects/[id]/tasks` | GET, POST | GET: all ; POST: all | no | projects | — | — |
| `/api/projects` | GET, POST | GET: all ; POST: all | no | projects | — | — |
| `/api/recipes/[id]` | GET, PATCH, DELETE | GET: all ; PATCH: P+T (O-7) ; DELETE: P (O-7) | no | meals | — | canonical: Ingredient, Recipe, RecipeIngredient; **legacy: MealPlanEntry** |
| `/api/recipes` | GET, POST | GET: all ; POST: P+T (O-7) | no | meals | — | canonical: Ingredient, Recipe, RecipeIngredient |
| `/api/rewards/approve` | POST | POST: P | no | rewards | — | — |
| `/api/rewards/claim` | POST | POST: all | no | rewards | — | — |
| `/api/rewards` | GET, POST, PATCH | GET: all ; POST: P ; PATCH: P | no | rewards | — | — |
| `/api/sick-days/[id]` | PATCH, DELETE | PATCH: P (kid: own 403, sibling 404) ; DELETE: P (kid: own 403, sibling 404) | no | sick-days | — | — |
| `/api/search` | GET | GET: all, by type (P every type; teen/child lists, list items and inventory only) — hand-checked (F-3) | refused | per type: family, calendar, chores, lists, meals, notes, inventory | — | canonical: List, ListItem, Recipe (and InventoryItem, PinnedNote, Event, Chore, User) |
| `/api/sick-days` | GET, POST | GET: P; teen/child own (`person_id = self`) ; POST: P; teen/child own (report self only) | no | sick-days | — | — |
| `/api/upload` | POST | POST: all | no | — | — | — |
| `/api/users/preferences` | GET, PATCH | GET: all (own) ; PATCH: all (own; strict body) — hand-checked (#286) | refused | — | — | — |
| `/api/users/elevation-pin` | PUT, DELETE | PUT: P (requires current password) ; DELETE: P | no | — | SHARED_DEVICE_ENABLED | — |
| `/api/users/deletion` | GET | GET: all | no | — | — | — |
| `/api/users/export` | GET | GET: all | no | — | — | canonical: FamilyMeal, List, Recipe; **legacy: MealPlan, ShoppingList** |
| `/api/users` | GET, PATCH, DELETE | GET: all ; PATCH: all ; DELETE: all, password + `DELETE`, not the only parent (D-3) | refused (DELETE) | gamification (fields hidden) | — | — |
| `/api/wishlist/[id]` | PATCH, DELETE | PATCH: requester or P ; DELETE: requester or P | no | wishlist | — | — |
| `/api/wishlist/[id]/status` | PATCH | PATCH: P | no | wishlist | — | — |
| `/api/wishlist` | GET, POST | GET: all ; POST: all | no | wishlist | — | — |
