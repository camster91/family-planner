# API Contracts

The Android app and deployed server can be on different versions. API changes must be compatible, typed and observable.

## Contract rules
- Validate request payloads at the boundary with Zod or equivalent.
- Return stable DTOs rather than leaking incidental Prisma shape when a mobile/shared contract is involved.
- Use a consistent error envelope with machine-readable code, human-safe message and request ID where available.
- Paginate all potentially unbounded collections.
- Use server-authoritative timestamps.
- Define timezone/date-only semantics explicitly.
- Retryable mutations use idempotency keys.
- Collaborative edits use version/ETag/updated-at conflict checks where necessary.
- Destructive or sensitive actions should require a live server decision.

## Compatibility
Prefer additive API changes. Do not remove/rename required fields or change semantics until supported installed clients no longer depend on them.

For breaking changes, define:
1. old-client behaviour;
2. compatibility window;
3. server rollout order;
4. client rollout order;
5. feature flag/kill switch;
6. rollback behaviour.

## Error shape target
A future normalized form may look like:
```json
{
  "error": {
    "code": "HOUSEHOLD_FORBIDDEN",
    "message": "You do not have access to this item.",
    "requestId": "...",
    "retryable": false
  }
}
```
Do not expose stack traces, database details, foreign record existence or secrets to clients.

## Idempotency
Client-generated keys should be scoped to authenticated actor/device + operation. Replays should return the prior logical result or a deterministic conflict, never duplicate visible state.

Implemented in #162 (`src/lib/idempotency.ts`, record `IdempotencyRecord`). Routes that accept it today:
`PATCH /api/lists/items/update` (its 409 `DUPLICATE_OPEN_ITEM`, #251, is a route outcome, not an idempotency
code: it is never stored, so a retry with the same key re-runs the check) and `POST /api/inventory` (#265, used by
the fridge scan dialog; a create is not convergent, so a request that crashes after committing and before storing its
response can, after the 30 s lock timeout, be re-run by a retry with the same key and add a second row; every other
lost-response case replays). Queue policy and client behaviour: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

- **Header:** `Idempotency-Key: <key>`, optional. 16–128 characters of `[A-Za-z0-9_-]`; clients send a random
  UUID generated once per logical change and reused for every retry of it. Without the header the route
  behaves exactly as before (older clients need no change).
- **Order of checks:** authentication (401) → key format (400) → body validation (400) → idempotency → the
  route's own household/role checks. A signed-out or revoked session therefore never reaches a stored response.
- **Scope:** records are unique per `(scope, key)`, where `scope` is `user:<userId>` for a person session
  (`device:<deviceId>` is reserved; device writes are not enabled). The same key from another user is a
  different record. A record is only replayed to the household it was written in.
- **Request identity:** a SHA-256 of the action name and the validated body in canonical (key-sorted) JSON.
  The body itself is not stored.
- **Outcomes:**

| Situation | Response |
| --- | --- |
| First request with a new key | The route runs; a 2xx result is stored (status + body up to 8 KB, else `{ "success": true }`). |
| Same key, same request, first one finished | The stored status and body, with `Idempotency-Replayed: true`. The effect does not run again. |
| Same key, same request, first one still running | `409` `IDEMPOTENCY_IN_PROGRESS`, `retryable: true`, `Retry-After: 1`. |
| Same key, different body, action or household | `422` `IDEMPOTENCY_KEY_REUSED`, `retryable: false`. |
| Malformed key | `400` `IDEMPOTENCY_KEY_INVALID`. |
| No key on a route that requires one (`POST /api/lists/items/from-recipe`) | `400` `IDEMPOTENCY_KEY_REQUIRED`. |
| First request ended non-2xx or threw | Nothing is stored; the same key may be retried. |
| First request died mid-flight (row in progress for more than 30 s) | The next request with the key takes over and runs the route again (allowlisted actions converge). |
| Record older than 7 days | Treated as absent; the key starts over. |

- **Error shape:** the codes above use the target envelope `{ "error": { "code", "message", "retryable" } }`
  with `Cache-Control: private, no-store`. The route's existing errors keep their current shape.
- **Retention:** `expires_at = created_at + 7 days`. A small random share (5%) of keyed requests deletes expired
  rows; there is no scheduled job. Rows cascade away with their household or user.
- **Concurrency:** the in-progress row is inserted before the effect runs, so the unique index serialises
  concurrent duplicates (proved against Postgres in `src/lib/__tests__/idempotency.integration.test.ts`).

## Meals, recipes and groceries (ADR-0007, #251)
Canonical models and rules: [ADR-0007](adr/0007-canonical-meal-recipe-grocery-models.md) and
[`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md). Every change below is additive for existing routes: old request
bodies are still valid and old response fields keep their meaning (`src/app/api/{meals,lists}/__tests__` carry
old-shape fixtures). Roles and isolation: `docs/ROLE_AND_ISOLATION_MATRIX.md` "Meals and recipes".

| Route | Change | Errors |
| --- | --- | --- |
| `GET /api/recipes?limit=&offset=` (new) | `{ recipes: [{ id, title, description, prep_time, cook_time, servings, image_url, created_by, created_at, updated_at, _count: { ingredients } }], nextOffset }`, ordered by title; `limit` 1–200 (default 100). All roles. | 400 bad paging; 403 meals off |
| `POST /api/recipes` (new) | Strict body `{ title, description?, instructions?, prep_time?, cook_time?, servings? (1–100, default 2), ingredients?: [{ ingredient_id \| name, amount, unit?, note? }] (≤ 100) }`. Named ingredients are upserted by (household, normalized name: NFC, trimmed, inner whitespace collapsed, case-insensitive). 201 `{ recipe }` with `ingredients: [{ id, amount, unit, note, ingredient: { id, name, unit } }]`. Parent and teen. `image_url` is not writable yet. | 400 validation / unknown key / `Ingredient not found` / duplicate ingredient; 403 child or meals off; 409 concurrent ingredient create (retry) |
| `GET /api/recipes/[id]` (new) | `{ recipe }` (detail shape above plus `instructions`). All roles. | 404 missing or another household's (identical) |
| `PATCH /api/recipes/[id]` (new) | Same fields as POST, all optional; `ingredients`, when present, replaces the whole set. Parent and teen. | as POST; 404 |
| `DELETE /api/recipes/[id]` (new) | Parent only. Linked meals and list items keep their rows (`recipe_id` becomes null; the meal keeps `recipe_name`). | 404; 409 `{ error: { code: 'RECIPE_IN_ARCHIVED_PLAN', message, retryable: false } }` while a frozen legacy `MealPlanEntry` references it |
| `GET /api/meals` | Each meal adds `recipe_id`, `servings`, `updated_at` and `recipe: { id, title, prep_time, cook_time, servings } \| null`. Ordered by date, then creation. Several meals may share a (date, meal_type) slot (O-1). | unchanged |
| `POST /api/meals`, `PATCH /api/meals/[id]` | Optional `recipe_id` (same household; `null` unlinks on PATCH) and `servings` (1–100 or `null`). Linking without `recipe_name` sets the snapshot to the recipe title; unlinking keeps the snapshot. | 400 `Recipe not found` (foreign and missing alike), 400 bad `servings` |
| `POST /api/lists/items/create` | Optional `amount` (0–100000), `unit` (1–32 chars), `ingredient_id` (same household). Responses include every `ListItem` column, including `amount`, `unit`, `ingredient_id`, `recipe_id`, `meal_id`, `source` (default `manual`). `source` is not client-writable. | 400 `Ingredient not found` (foreign and missing alike) |
| `PATCH /api/lists/items/update` | Optional `amount`, `unit`, `ingredient_id`; `null` clears. The #162 idempotent, row-locked write is unchanged. | 400 `Ingredient not found`; 409 `{ error: { code: 'DUPLICATE_OPEN_ITEM', message, retryable: false } }` when unticking a recipe-added row whose (list, ingredient, source) already has an open row (partial unique index `ListItem_open_recipe_source_key`). Not stored for replay; the #247 queue shows it as a conflict. |
| `POST /api/lists/create` | Type `meal_plan` is no longer offered by the UI for a new list (O-8), but the server still accepts it for installed Android bundles until a version gate exists. Existing `meal_plan` lists are untouched. | 201 |
| `POST /api/lists/items/from-recipe` (new, #253) | Header `Idempotency-Key` **required**. Strict body `{ recipeId, mealId?, listId?, servings? (1–50), ingredientIds? (1–100, subset of the recipe's) }`. Adds one row per selected ingredient (`source: 'recipe'`, `source_key` `meal:<id>` or `recipe:<id>`, `source_request_id`, `amount` scaled by `servings ?? meal.servings ?? recipe.servings`, `unit`), skipping ingredients already open on the list from the same source. Without `listId` the default grocery list is used or created (O-4). 201 `{ listId, listName, requestId, createdCount, alreadyOnListCount, possibleDuplicates: [{ ingredientId, matchedItemId }] (≤ 20), possibleDuplicatesTruncated, undoExpiresAt }` (`undoExpiresAt` is absolute: request creation + 10 minutes, so a late replay does not extend Undo). The add, its read-back and the lookalike scan run in one transaction, so a failure leaves no rows; replays carry `Idempotency-Replayed: true`. Parent, teen, child. Not offline-queueable (O-10). Rules: `MEALS_AND_GROCERIES.md` §7. | 400 `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`, validation, `MEAL_RECIPE_MISMATCH`, `LIST_NOT_GROCERY`, `INGREDIENT_NOT_IN_RECIPE`, `RECIPE_HAS_NO_INGREDIENTS`; 403 shared device (`DEVICE_WRITE_NOT_ALLOWED`) or meals/lists off; 404 `RECIPE_NOT_FOUND` / `MEAL_NOT_FOUND` / `LIST_NOT_FOUND` (foreign and missing alike); 409 `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED` |
| `POST /api/lists/items/undo-add` (new, #253) | `{ requestId }` (the `requestId` from `from-recipe`). Deletes that request's still-unticked rows added by the caller within 10 minutes (O-5). 200 `{ requestId, removedCount, keptCheckedCount }`; repeating it removes 0. | 403 another member's request or shared device; 404 unknown or another household's request; 409 `UNDO_WINDOW_EXPIRED`, `UNDO_IN_PROGRESS` |
| `POST /api/lists/default-grocery` (new, #253) | Finds or creates the household's default grocery list (newest `grocery`, else newest `shopping`, else "Groceries"; per-household advisory lock). 200 `{ list: { id, name, type }, created }`. Parent and teen. Used by capture. | 403 child or lists off |
| every `/api/lists/**` handler | `featureGate('lists')` after authentication (O-11). | 403 lists off |
| `GET /api/users/export` | Adds `meals` (the household's `FamilyMeal` rows) and `mealBackfillJobs` (ADR-0007 backfill `ImportJob` summaries that archive skipped legacy rows). `mealPlans` and `shoppingLists` stay while the legacy tables exist. | unchanged |

Old Android WebViews and queued #247 operations keep working: no route, request field or `ListItem.id` changed, and
every new field is optional. Rollback of the app code is safe; the new columns stay unused.

## Food inventory (#263)
New routes only; nothing existing changes shape except the additive `inventory` key in `GET /api/users/export`.
Rules and data model: [`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md) §10. Roles and isolation:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Food inventory".

- **Gate:** every handler calls `featureGate('inventory')` after authentication (403 `{ error: string }` when off;
  the feature is off by default). `GET /api/inventory/cook` also needs `meals`.
- **Errors:** route-owned errors use the target envelope `{ error: { code, message, retryable } }` with
  `Cache-Control: private, no-store`: 400 `VALIDATION_ERROR` / `INVALID_JSON` / `INGREDIENT_NOT_FOUND`, 403
  `INVENTORY_WRITE_FORBIDDEN` (child), 404 `INVENTORY_ITEM_NOT_FOUND` (foreign and missing alike), 500
  `INTERNAL_ERROR` (`retryable: true`). Authentication (401) and the feature gate keep their shared shapes. A paired
  shared device gets 403 `DEVICE_WRITE_NOT_ALLOWED` on every write, before person auth.
- **Dates:** `expires_on` is date-only (`YYYY-MM-DD`, Postgres `DATE`). Every handler takes an optional
  `today=YYYY-MM-DD` (the viewer's calendar day) that must be within one day of the server's UTC date (every real
  zone is), else 400; without it the server's UTC day is used. `expiry.status` is `expired` (before today), `today`,
  `soon` (within 3 days), `later` or `none`, with `daysLeft`.
- **Item DTO:** `{ id, name, ingredient_id, amount, unit, location: 'fridge'|'freezer'|'pantry', expires_on, added_by,
  created_at, updated_at, expiry: { status, daysLeft } }`. Never `family_id`.
- **Idempotency / offline:** `POST /api/inventory` accepts an optional `Idempotency-Key` (#265, see "Idempotency"
  above): same key and body replays the stored 201 with `Idempotency-Replayed: true`, a different body is 422
  `IDEMPOTENCY_KEY_REUSED`, a malformed key is 400 `IDEMPOTENCY_KEY_INVALID`; only 2xx outcomes are stored. Keys are
  scoped per user. PATCH and DELETE take no key. Inventory writes are not offline-queued; the #162 queue allowlist is
  unchanged.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/inventory?location=&expiringWithinDays=&today=&limit=&offset=` | `{ items: [Item], nextOffset }`, by name. `expiringWithinDays=N` (0–365) keeps items whose expiry day is on or before today + N, expired included. `limit` 1–500 (default 200). All roles. | 400 bad filter/paging/today; 403 off |
| `POST /api/inventory?today=` | Strict body `{ name (1–200), ingredient_id?: string \| null, amount?: number \| null (0–100000), unit?: string \| null (≤ 32), location? (default fridge), expires_on?: 'YYYY-MM-DD' \| null }`. Without `ingredient_id` the item links to a same-household ingredient with the same normalized name, if one exists (no ingredient is created); `null` keeps it free text. 201 `{ item }`. Optional header `Idempotency-Key` (#265): replays the stored 201. Parent and teen. | 400 validation / `INGREDIENT_NOT_FOUND` / `IDEMPOTENCY_KEY_INVALID`; 403 child, device or off; 409 `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED` |
| `GET /api/inventory/[id]?today=` | `{ item }`. All roles. | 404 |
| `PATCH /api/inventory/[id]?today=` | Same fields as POST, all optional (at least one). `null` clears `amount`, `unit`, `expires_on`, `ingredient_id`. A new `name` without `ingredient_id` re-links by name. 200 `{ item }`. Parent and teen. | as POST; 404 |
| `DELETE /api/inventory/[id]` | 200 `{ success: true }`. Parent and teen. | 403; 404 |
| `GET /api/inventory/use-soon?days=3&today=&limit=` | `{ days, items: [{ id, name, location, expiresOn, daysLeft, status: 'expired'\|'today'\|'soon', label }] }`: expired items and those expiring within `days` (0–365, default 3), soonest first. `limit` 1–100 (default 50). Board-safe fields only; the same data comes from `getUseSoonItems` in `src/lib/inventory.ts`. All roles. | 400; 403 off |
| `GET /api/inventory/cook?today=&limit=` | `{ suggestions: [{ recipeId, title, prep_time, cook_time, servings, totalCount, haveCount, missingCount, coverage, useSoonCount, have: [{ ingredientId, name }], missing: [{ ingredientId, name }] }], recipesConsidered, truncated, inputsTruncated }`, ranked by coverage, then in-stock count, use-soon count, fewer missing, title. Recipes with nothing in stock are left out. Expired items are excluded in the query. Inputs are read up to 1000 recipes and 5000 non-expired items; `inputsTruncated: true` means a cap was hit and suggestions may be missing (the page says so). `truncated` means more suggestions than `limit`. `limit` 1–50 (default 20). All roles. The UI passes `missing[].ingredientId` to `POST /api/lists/items/from-recipe` as `ingredientIds`. | 400; 403 inventory or meals off |
| `GET /api/users/export` | Adds `inventory`: the household's items (no `family_id`). | unchanged |

Compatibility: additive table and routes; old WebView bundles never call them. Rolling back the app code is safe;
the table stays unused.

### Fridge photo scan (#265)
One new route, off until the deployment sets `INVENTORY_SCAN_ANTHROPIC_API_KEY`. Rules, privacy and limits:
[`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md) §10 "Fridge photo scan". It returns suggestions only; the page adds
the reviewed items with `POST /api/inventory` (unchanged).

| Route | Contract | Errors |
| --- | --- | --- |
| `POST /api/inventory/scan` | `multipart/form-data` with one `image` file (JPEG, PNG or WebP by magic bytes, ≤ 8 MB; `Content-Length` required). 200 `{ items: [{ name, amount: number \| null, unit: string \| null, location: 'fridge'\|'freezer'\|'pantry' \| null, confidence: 0–1 }], dropped }`, at most 50 items, `Cache-Control: private, no-store`. Parent only. Writes nothing. | 401; 403 device (`DEVICE_WRITE_NOT_ALLOWED`), feature off, teen/child (`INVENTORY_SCAN_FORBIDDEN`); 404 `INVENTORY_SCAN_DISABLED` (no key); 400 `INVALID_FORM`; 411 `LENGTH_REQUIRED`; 413 `IMAGE_TOO_LARGE`; 415 `UNSUPPORTED_IMAGE_TYPE`; 429 `RATE_LIMITED` / `SCAN_DAILY_LIMIT` with `Retry-After`; 502 `SCAN_PROVIDER_UNAVAILABLE` / `SCAN_UNREADABLE` (`retryable: true`) |

Rate limits: 5 per user and 10 per household per hour, plus `INVENTORY_SCAN_DAILY_LIMIT` (default 20) per household per
UTC day. Compatibility: additive route; nothing existing changes. With the key removed the route is 404 and the button
disappears on the next page load, so rollback is an environment change, not a deploy.
## Today board: member colours and weather (#262)
Additive. Old Android WebViews render the board from the web layer, and every new DTO field is optional (a board
built before #262 ignores it; the #262 client falls back when it is missing). Roles and isolation:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Today board page"; device read surface: `SHARED_DEVICE.md` §9.1.

| Route | Change | Errors |
| --- | --- | --- |
| Today board DTO (`/dashboard/today` props, `GET /api/device/today`) | `members[].color` (palette key: `indigo`, `sky`, `green`, `orange`, `purple`, `pink`, `yellow`, `red`; the parent's choice or the deterministic fallback, `src/lib/member-colors.ts`); `events[].addedById` (the household member who added a local event, `null` for imported events or a creator no longer in the household); `weather: { label, unit: 'C' \| 'F', current: { temperature, summary, icon, isDay }, days: [{ day, high, low, summary, icon, precipitationChance }] (≤ 4), fetchedAt } \| null`. No coordinates are ever in the DTO. `weather` is `null` when the household has not opted in, the kill switch is off, or the forecast is unavailable. | unchanged |
| Today board DTO: `useSoon` (#263 data) | `useSoon: [{ id, name, location: 'fridge' \| 'freezer' \| 'pantry', expiresOn: 'YYYY-MM-DD' }] \| null` (≤ 50, soonest first) and `links.inventory` (`/dashboard/inventory` for roles that may open it with the feature on, else `null`; always `null` for a device). `null` when the household's `inventory` feature is off. The server reads `getUseSoonItems` anchored one UTC day ahead so the window covers the viewer's local day in every zone; the client computes the status and label ("Expired yesterday", "Use today", "Use in 2 days") against the viewer's local day and drops items not yet due. | unchanged |
| `GET /api/family/board-settings` (new) | Parent only. `{ weather: { available, enabled, place: { label, latitude, longitude } \| null, unit: 'celsius' \| 'fahrenheit' }, members: [{ id, name, color, custom }] }`. `available` is the `WEATHER_ENABLED` kill switch (false unless it is explicitly `1`/`true`). | 401; 400 no household; 403 teen/child |
| `PATCH /api/family/board-settings` (new) | Parent only. Strict body `{ weather?: { enabled?, place?: { label (1–80), latitude (−90..90), longitude (−180..180) } \| null, unit? }, memberColors?: { [memberId]: key \| null } }`. Coordinates are stored rounded to 2 decimals. A new place, removing the place (which also turns weather off) or turning weather off deletes the household's `WeatherCache` row. Returns the GET shape. | 400 validation / unknown key / `Choose a place before turning on weather` / `Unknown household member` (another household's id and a missing id alike); 403 teen/child; 409 enabling while `WEATHER_ENABLED` is off |
| `GET /api/family/board-settings/places?q=` (new) | Parent only. Place search through the fixed Open-Meteo geocoding host; nothing is stored. `{ places: [{ label, latitude, longitude }] }` (≤ 6, coordinates rounded to 2 decimals). 30 searches per parent per 10 minutes. | 400 `q` not 2–80 chars; 403; 409 kill switch off; 429 with `Retry-After`; 502 provider error or timeout |

Weather is fetched server-side only (`src/lib/weather/open-meteo.ts`): fixed hosts `api.open-meteo.com` and
`geocoding-api.open-meteo.com`, no user-supplied URL, `redirect: 'error'`, 3 s timeout, 128 KB cap, no retries.
`getBoardWeather` (`src/lib/weather/board-weather.ts`) caches one row per household for 30 minutes and records a
failure for 10 minutes so an outage hides the tile without retrying on every board refresh. It never throws; the
board renders without the tile.

## Rate limits
Apply based on abuse/cost/risk rather than one global number. Authentication, invite/recovery, AI, uploads and expensive search/integration routes need stronger controls.

## Shared-device routes (#157 contract, #240)
Implemented (behind `SHARED_DEVICE_ENABLED`, default off; every route is `404` while it is off); UI and device writes are not. The endpoint table, error codes (`DEVICE_ACCESS_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`, `ELEVATION_REQUIRED`, `ELEVATION_EXPIRED`, `PAIRING_CODE_INVALID`, …) and compatibility plan are in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §12–§13. New device routes use the target error envelope above and `Cache-Control: private, no-store`; they live under `/api/device/*` and `/api/family/devices/*` so existing routes keep their current responses and remain person-only. Installed Android builds need no update because the device UI is served by the web layer.

## Provider adapters
Calendar, weather, AI, notification and food/recipe providers must sit behind application interfaces. Provider-specific errors map into stable product states. Weather (#262) follows this: Open-Meteo errors become a fixed code (`timeout`, `network`, `http_error`, `too_large`, `bad_response`) and the board state "no weather tile".

## Calendar sync routes (#264)
Two-way Google / Outlook sync, **dormant**: every route below is `404` (whoever calls) until the environment in
`docs/runbooks/CALENDAR_SYNC.md` is set. All JSON responses carry `Cache-Control: private, no-store` and never
include tokens, sync cursors or provider error bodies. Parents only (teen/child `403 PARENT_REQUIRED`; no session or
a device cookie `401`). Design: [`CALENDAR_SYNC.md`](CALENDAR_SYNC.md).

| Method + path | Who | Request | Response |
| --- | --- | --- | --- |
| `GET /api/calendar/connections` | parent | — | `{ providers: [{ id, label }], connections: ConnectionDto[] }` for the caller's household (all rows, not truncated) |
| `POST /api/calendar/connections/[provider]/start` | parent | — (CSRF header) | `{ authorize_url }`; `404` unknown/unconfigured provider; `409` household limit (6); `429` over 10 starts / 10 min |
| `GET /api/calendar/connections/[provider]/callback` | the parent who started | `?code&state` (or `?error`) from the provider | `303` to `/dashboard/settings?calendar_sync=<outcome>#calendar-sync`, outcome one of `connected`, `denied`, `state`, `exchange`, `forbidden`, `limit`, `error`; the household limit is enforced atomically here |
| `PATCH /api/calendar/sync-connections/[id]` | connecting parent | `{ calendar_id?, push_mode?: "linked" or "all" }` | `{ connection }`; `403` another parent; `400` not a writable calendar; `409` reconnect needed; `404` foreign/missing |
| `DELETE /api/calendar/sync-connections/[id]` | any parent | — | `{ success, removed_events }`; revokes (best effort), deletes tokens, links and imported events |
| `GET /api/calendar/sync-connections/[id]/calendars` | connecting parent | — | `{ calendars: [{ id, name, primary }] }` (writable only); `403` another parent |
| `POST /api/calendar/sync-connections/[id]/sync` | any parent | — | `{ result: { status, pulled, pushed, conflicts, resynced, error? }, connection }`, status one of `ok`, `error`, `reauth_required`, `not_ready`, `superseded`; `429` over 6 / 10 min |

`ConnectionDto`: `id, provider, provider_label, calendar_id, calendar_name, push_mode, status
('pending'|'ok'|'error'|'reauth_required'), last_synced_at, last_error (fixed vocabulary), conflicts_count,
last_conflict_at, owner { id, name }, is_mine`.

Compatibility: additive only. `Event` gains `source_connection_id` and `updated_at` (both optional for clients);
`/api/events` responses carry them as extra fields. Events imported from a connection are editable (unlike ICS
imports, which stay `409 EVENT_READ_ONLY`). Installed Android builds need no update (web-served UI).

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.