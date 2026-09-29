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
lost-response case replays), the other inventory writes (#158/#121: `PATCH`/`DELETE /api/inventory/[id]`,
`POST /api/inventory/[id]/consume`, `/discard` and `POST /api/inventory/adjustments/[id]/undo`; consume and discard
stamp the record id on their `InventoryAdjustment.request_id` (unique), so even the crash case converges on the row
already written; undo of an undone change returns it; PATCH sets explicit values; DELETE completes its idempotency record in the same transaction as the delete, so a lost response or a failed
response store replays the 200 and a takeover only happens when nothing was deleted) and `POST /api/calendar/import-suggestions/commit` (#270, key required, one per batch;
the crash case converges: the takeover finds the batch's activity row by its record id and returns the same events).
Queue policy and client behaviour: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

- **Header:** `Idempotency-Key: <key>`, optional. 16–128 characters of `[A-Za-z0-9_-]`; clients send a random
  UUID generated once per logical change and reused for every retry of it. Without the header the route
  behaves exactly as before (older clients need no change).
- **Order of checks:** authentication (401) → key format (400) → body validation (400) → idempotency → the
  route's own household/role checks. A signed-out or revoked session therefore never reaches a stored response.
- **Scope:** records are unique per `(scope, key)`, where `scope` is `user:<userId>` for a person session
  and `device:<deviceId>` for a paired tablet's §9.2 writes (#274, where the header is **required**). The same key from another user is a
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
| No key on a route that requires one (`POST /api/lists/items/from-recipe`, `POST /api/calendar/import-suggestions/commit`) | `400` `IDEMPOTENCY_KEY_REQUIRED`. |
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

## Food inventory (#263, #158/#121)
New routes only; nothing existing changes shape except additive keys: `inventory` and (#158) `inventoryAdjustments`
in `GET /api/users/export`, new optional item fields, `dateKind` on use-soon entries and the board DTO.
Rules and data model: [`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md) §10. Roles and isolation:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Food inventory".

- **Gate:** every handler calls `featureGate('inventory')` after authentication (403 `{ error: string }` when off;
  the feature is off by default). `GET /api/inventory/cook` also needs `meals`.
- **Errors:** route-owned errors use the target envelope `{ error: { code, message, retryable } }` with
  `Cache-Control: private, no-store`: 400 `VALIDATION_ERROR` / `INVALID_JSON` / `INGREDIENT_NOT_FOUND`, 403
  `INVENTORY_WRITE_FORBIDDEN` (child), 404 `INVENTORY_ITEM_NOT_FOUND` (foreign and missing alike), 500
  `INTERNAL_ERROR` (`retryable: true`). #158/#121 adds 409 `INVENTORY_ITEM_FINISHED` (the item was already used up or
  thrown away; `retryable: false`), 409 `INVENTORY_CONFLICT` (the item changed while saving; `retryable: true`), 404
  `INVENTORY_ADJUSTMENT_NOT_FOUND` (foreign and missing alike) and 409 `INVENTORY_UNDO_CONFLICT` (the item changed
  after that change; `retryable: false`). Authentication (401) and the feature gate keep their shared shapes. A paired
  shared device gets 403 `DEVICE_WRITE_NOT_ALLOWED` on every write, before person auth.
- **Dates:** `expires_on` is date-only (`YYYY-MM-DD`, Postgres `DATE`). Every handler takes an optional
  `today=YYYY-MM-DD` (the viewer's calendar day) that must be within one day of the server's UTC date (every real
  zone is), else 400; without it the server's UTC day is used. `date_kind` (#158) says what `expires_on` means:
  `best_before` (default; every older row) or `use_by`. `expiry.status` is `expired` (a best-before day has passed),
  `past_use_by` (a use-by day has passed: do not eat; never "use soon"), `today`, `soon` (within 3 days), `later` or
  `none`, with `daysLeft`. Clients that do not know `past_use_by` should show it like `expired`; the words come from
  `expiryLabel` ("Best before was yesterday" / "Past use-by — don't eat").
- **Item DTO:** `{ id, name, ingredient_id, amount, unit, location: 'fridge'|'freezer'|'pantry', expires_on,
  date_kind: 'best_before'|'use_by', category: string | null, purchased_on, opened_on, status:
  'active'|'consumed'|'discarded', finished_at, added_by, created_at, updated_at, expiry: { status, daysLeft } }`.
  Never `family_id`. `category` is one of `produce`, `dairy_eggs`, `meat_fish`, `bakery`, `leftovers`, `dry_goods`,
  `snacks_drinks`, `condiments`, `other` (`INVENTORY_CATEGORIES`). `purchased_on` / `opened_on` are `YYYY-MM-DD` or null.
- **Adjustment DTO (#158):** `{ id, item_id, kind: 'consume'|'discard', amount_delta: number | null (negative),
  amount_before, amount_after, status_before, status_after, actor_id, created_at, undone_at }`. Never `family_id` or
  `request_id`.
- **Idempotency / offline:** `POST /api/inventory` accepts an optional `Idempotency-Key` (#265, see "Idempotency"
  above): same key and body replays the stored 201 with `Idempotency-Replayed: true`, a different body is 422
  `IDEMPOTENCY_KEY_REUSED`, a malformed key is 400 `IDEMPOTENCY_KEY_INVALID`; only 2xx outcomes are stored. Keys are
  scoped per user. Since #158 PATCH, DELETE, consume, discard and undo take the same optional key (actions
  `inventory-item.update`, `.delete`, `.consume`, `.discard`, `inventory-adjustment.undo`; the item or adjustment id is
  part of the hashed request, so one key on another item is 422). Inventory writes are not offline-queued; the #162
  queue allowlist is unchanged, and the page refuses writes while offline with a message.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/inventory?location=&category=&q=&expiringWithinDays=&today=&limit=&offset=` | `{ items: [Item], nextOffset }`, by name, **active items only** (#158: consumed and discarded items are left out). `q` (≤ 100 characters) matches the name case-insensitively; `category` is one of the categories above. `expiringWithinDays=N` (0–365) keeps items whose date is on or before today + N, passed dates included. `limit` 1–500 (default 200). All roles. | 400 bad filter/paging/today; 403 off |
| `POST /api/inventory?today=` | Strict body `{ name (1–200), ingredient_id?: string \| null, amount?: number \| null (0–100000), unit?: string \| null (≤ 32), location? (default fridge), expires_on?: 'YYYY-MM-DD' \| null, date_kind?: 'best_before' \| 'use_by' (default best_before), category?: string \| null, purchased_on?: 'YYYY-MM-DD' \| null, opened_on?: 'YYYY-MM-DD' \| null }`. `status` and `finished_at` are not accepted. Without `ingredient_id` the item links to a same-household ingredient with the same normalized name, if one exists (no ingredient is created); `null` keeps it free text. 201 `{ item }`. Optional header `Idempotency-Key` (#265): replays the stored 201. Parent and teen. | 400 validation / `INGREDIENT_NOT_FOUND` / `IDEMPOTENCY_KEY_INVALID`; 403 child, device or off; 409 `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED` |
| `GET /api/inventory/[id]?today=` | `{ item }`, whatever its status (so a client can show a finished item before Undo). All roles. | 404 |
| `PATCH /api/inventory/[id]?today=` | Same fields as POST, all optional (at least one). `null` clears `amount`, `unit`, `expires_on`, `ingredient_id`, `category`, `purchased_on`, `opened_on`. A new `name` without `ingredient_id` re-links by name. Moving is `location`. Compare-and-set on the version read. 200 `{ item }`. Optional `Idempotency-Key`. Parent and teen. | as POST; 404; 409 `INVENTORY_ITEM_FINISHED` / `INVENTORY_CONFLICT` |
| `DELETE /api/inventory/[id]` | 200 `{ success: true }`. Removes the item and its history (for an item added by mistake; "Used it" / "Throw away" keep history). Optional `Idempotency-Key`: a retry replays the 200 instead of a 404. Parent and teen. | 400 key; 403; 404 |
| `POST /api/inventory/[id]/consume?today=` (#158) | "Used it". Strict body `{ amount?: number \| null }` (> 0, ≤ 100000). Omitted/null, or at least the item's amount, uses all of it (`status: 'consumed'`, amount kept for the record); less leaves the rest active. A partial amount on an item without an amount is 400. 200 `{ item, adjustment }`. Optional `Idempotency-Key`. Parent and teen. | 400; 403; 404; 409 `INVENTORY_ITEM_FINISHED` / `INVENTORY_CONFLICT` |
| `POST /api/inventory/[id]/discard?today=` (#158) | "Throw away" the whole item (`status: 'discarded'`). Empty or `{}` body. 200 `{ item, adjustment }`. Optional `Idempotency-Key`. Parent and teen. | as consume |
| `POST /api/inventory/adjustments/[id]/undo?today=` (#158) | Puts the item back as it was before that change (status and amount) and marks the adjustment undone (kept as history). Only the latest change to the item can be undone. Undoing an undone change is 200 with `alreadyUndone: true`. 200 `{ item, adjustment, alreadyUndone }`. Optional `Idempotency-Key`. Parent and teen. | 403; 404 `INVENTORY_ADJUSTMENT_NOT_FOUND`; 409 `INVENTORY_UNDO_CONFLICT` |
| `GET /api/inventory/adjustments?itemId=&limit=&offset=` (#158) | `{ adjustments: [Adjustment & { item_name, item_status, undoable }], nextOffset }`, newest first. `undoable` is true only for the change Undo would accept now: not undone, and the item still has that change's status and version (so it is the item's latest change). `limit` 1–100 (default 20). All roles. | 400; 403 off |
| `GET /api/inventory/use-soon?days=3&today=&limit=` | `{ days, items: [{ id, name, location, expiresOn, dateKind, daysLeft, status: 'expired'\|'today'\|'soon', label }] }`: active items whose best-before day has passed or whose date is within `days` (0–365, default 3); a passed use-by day is never included; no-date items never are. Order: date, then use-by before best-before on the same day, then name, then id. `limit` 1–100 (default 50). Board-safe fields only; the same data comes from `getUseSoonItems` in `src/lib/inventory.ts`. All roles. | 400; 403 off |
| `GET /api/inventory/cook?today=&limit=` | `{ suggestions: [{ recipeId, title, prep_time, cook_time, servings, totalCount, haveCount, missingCount, coverage, useSoonCount, have: [{ ingredientId, name }], missing: [{ ingredientId, name }] }], recipesConsidered, truncated, inputsTruncated }`, ranked by coverage, then in-stock count, use-soon count, fewer missing, title. Recipes with nothing in stock are left out. Expired items are excluded in the query. Inputs are read up to 1000 recipes and 5000 non-expired items; `inputsTruncated: true` means a cap was hit and suggestions may be missing (the page says so). `truncated` means more suggestions than `limit`. `limit` 1–50 (default 20). All roles. The UI passes `missing[].ingredientId` to `POST /api/lists/items/from-recipe` as `ingredientIds`. | 400; 403 inventory or meals off |
| `GET /api/users/export` | Adds `inventory`: the household's items, any status (no `family_id`), and (#158) `inventoryAdjustments`: the household's history (no `family_id`, no `request_id`). | unchanged |

Compatibility: additive tables, columns and routes; old WebView bundles never call the new routes and ignore the new
fields. Old rows read as active best-before items. Rolling back the app code is safe: the older code ignores the new
columns, so a consumed or discarded item would show again in its lists (expand-only; nothing is deleted).

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
| Today board DTO (`/dashboard/today` props, `GET /api/device/today`) | `members[].color` (palette key: `indigo`, `sky`, `green`, `orange`, `purple`, `pink`, `yellow`, `red`; the parent's choice or the deterministic fallback, `src/lib/member-colors.ts`); `events[].addedById` (the household member who added a local event, `null` for imported events (subscribed calendars and provider-synced calendars, #264) or a creator no longer in the household); `weather: { label, unit: 'C' \| 'F', current: { temperature, summary, icon, isDay }, days: [{ day, high, low, summary, icon, precipitationChance }] (≤ 4, place-local dates), utcOffsetSeconds, fetchedAt } \| null`. No coordinates are ever in the DTO. The client picks "today" among `days` by the place's current date (now + `utcOffsetSeconds`; Open-Meteo `timezone=auto`), not the viewer's zone; cache rows from before the offset was stored are refetched. `weather` is `null` when the household has not opted in, the kill switch is off, or the forecast is unavailable. | unchanged |
| Today board DTO: `useSoon` (#263 data) | `useSoon: [{ id, name, location: 'fridge' \| 'freezer' \| 'pantry', expiresOn: 'YYYY-MM-DD', dateKind?: 'best_before' \| 'use_by' }] \| null` (soonest first; at most 50 rows plus at most 50 use-by rows from the zone-skew days; `dateKind` added by #158, optional so a cached older DTO reads as best before) and `links.inventory` (`/dashboard/inventory` for roles that may open it with the feature on, else `null`; always `null` for a device). `null` when the household's `inventory` feature is off. The server reads active items with `getUseSoonItems` anchored one UTC day ahead so the window covers the viewer's local day in every zone, and reads use-by days from one UTC day behind up to that anchor as a separate, separately capped set (so stale ones never crowd valid rows out of the cap); the client computes the status and label ("Best before was yesterday", "Use by today", "Best before in 2 days") against the viewer's local day and drops items not yet due and passed use-by days. | unchanged |
| `GET /api/family/board-settings` (new) | Parent only. `{ weather: { available, enabled, place: { label, latitude, longitude } \| null, unit: 'celsius' \| 'fahrenheit' }, members: [{ id, name, color, custom }] }`. `available` is the `WEATHER_ENABLED` kill switch (false unless it is explicitly `1`/`true`). | 401; 400 no household; 403 teen/child |
| `PATCH /api/family/board-settings` (new) | Parent only. Strict body `{ weather?: { enabled?, place?: { label (1–80), latitude (−90..90), longitude (−180..180) } \| null, unit? }, memberColors?: { [memberId]: key \| null } }`. Coordinates are stored rounded to 2 decimals. A new place, removing the place (which also turns weather off) or turning weather off deletes the household's `WeatherCache` row. Returns the GET shape. | 400 validation / unknown key / `Choose a place before turning on weather` / `Unknown household member` (another household's id and a missing id alike); 403 teen/child; 409 enabling while `WEATHER_ENABLED` is off |
| `GET /api/family/board-settings/places?q=` (new) | Parent only. Place search through the fixed Open-Meteo geocoding host; nothing is stored. `{ places: [{ label, latitude, longitude }] }` (≤ 6, coordinates rounded to 2 decimals). 30 searches per parent per 10 minutes. | 400 `q` not 2–80 chars; 403; 409 kill switch off; 429 with `Retry-After`; 502 provider error or timeout |

Weather is fetched server-side only (`src/lib/weather/open-meteo.ts`): fixed hosts `api.open-meteo.com` and
`geocoding-api.open-meteo.com`, no user-supplied URL, `redirect: 'error'`, 3 s timeout, 128 KB cap, no retries.
`getBoardWeather` (`src/lib/weather/board-weather.ts`) caches one row per household for 30 minutes and records a
failure for 10 minutes so an outage hides the tile without retrying on every board refresh. It never throws; the
board renders without the tile.

## Today board: visible sync and calm display (#271)
Additive: two read routes, optional DTO fields and optional settings keys. Roles and isolation:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Today board page"; device read surface: `SHARED_DEVICE.md` §9.1.

**Change detection.** `version` is an opaque string (`v1-` + 24 hex) that hashes exactly what the caller's board
shows (the DTO without `generatedAt` and without the forecast itself) plus the display settings and the weather
settings (on/off, place label, unit, coarse place). It is computed by `loadTodayBoard`
(`src/app/dashboard/today/board-snapshot.ts`) for both the full board and the version routes, so they cannot
disagree. Hashing the board's own bounded, `select`-only reads keeps the check exact without a schema change:
chores have no `updated_at` and deleted rows leave no timestamp. A client treats the value as opaque and compares
it for equality only. The board (`src/lib/board-sync.ts`) polls about every 25 s while the page is visible and
online, pauses while hidden, checks at once on return to visible or on reconnect, re-fetches only when the value
differs, and still does a full refresh every 15 minutes for what the version does not cover (a forecast ageing
out, the view-driven subscribed-calendar refresh). No cron and no server job.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/family/board-version` (new) | Person session, any role (parent, teen, child) of a household. `200 { version }` and nothing else, `Cache-Control: private, no-store`. Computed with the caller's role and household only (the same board `/dashboard/today` renders). 1200 checks per member per hour (key `board-version:<userId>`). A paired tablet's cookie is not a session. | 401 (also a device cookie alone); 400 no household; 429 `{ error }` with `Retry-After`; 500 |
| `GET /api/device/today/version` (new) | Device cookie only (`/api/device/*` rules, SHARED_DEVICE.md §12.3). `200 { version }` of the device-audience board, device's household only. 1200 checks per tablet per hour (key `device-board-version:<deviceId>`). | 401 `DEVICE_ACCESS_EXPIRED` / `DEVICE_REVOKED` / `DEVICE_SESSION_INVALID`; 404 kill switch (device cookies expired); 429 `RATE_LIMITED` with `Retry-After`; 500 `INTERNAL_ERROR` |
| Today board DTO (`/dashboard/today` props, `GET /api/device/today`) | Adds `version` (above) and `display: { idleMinutes: 0 \| 1 \| 2 \| 5 \| 10 \| 15 \| 30, night: { start: 'HH:MM', end: 'HH:MM' } \| null, photos?: [{ id, url }] }`. `photos` is present for person boards only (the household's chosen `Upload` rows, in the parent's order, JPEG/PNG/WebP only, `url` = the household-scoped `/api/files/chores/<filename>`) and is never sent to a paired tablet. | unchanged |
| `GET /api/family/board-settings` | Adds `display: { idleMinutes, idleChoices, night, photoIds, uploads: [{ id, url, createdAt }] }`. `uploads` lists the household's own displayable uploads, newest first, at most 60. | unchanged |
| `PATCH /api/family/board-settings` | Adds optional `display: { idleMinutes?, night?: { start, end } \| null, photoIds? }` (strict). `idleMinutes` must be one of the choices; `night` times are 24-hour `HH:MM` and must differ (`null` turns night hours off); `photoIds` at most 20, duplicates dropped, every id a displayable upload of this household. Returns the GET shape. | 400 validation / `Unknown photo` (another household's upload, a missing id and a HEIC upload alike); 403 teen/child |

Client wording: "Updated just now / 3 min ago" (`src/lib/relative-time.ts`), offline and "can't reach" notices in
words; the relative time is not a live region, and a separate polite live region announces only real changes.
Night hours are on the tablet's own clock and only draw a dark layer: a web page cannot change the hardware
backlight. Compatibility: `Family.ambient_idle_minutes` (default 5), `night_start`/`night_end` (NULL = off) and
`ambient_photo_ids` (default empty) are additive; clients built before #271 ignore `display`/`version`, and the
#271 board falls back to the defaults (and a full refresh) without them. The tablet treats a bare 404 from the
version route (a server rolled back to a build without it) as a plain failure, not the kill switch, so a rollback
never makes a tablet purge itself; the kill-switch 404 still does (`optionalRoute` in `src/lib/device-client.ts`).

## Grocery store sections (#273)
Additive fields on existing list routes plus two new routes. Rules and data model:
[`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md) §11. Roles and isolation: `docs/ROLE_AND_ISOLATION_MATRIX.md`
"Lists, notes, dates, pickups".

- **Section ids** (stable, stored and returned; labels are display-only): `produce`, `bakery`, `dairy_eggs`,
  `meat_fish`, `frozen`, `pantry`, `snacks_drinks`, `household`, `personal_care`, `other`
  (`GROCERY_SECTIONS` in `src/lib/grocery-sections.ts`). A client must treat an unknown id as `other`.
- **Resolution** (server and client use the same pure function): the household's override for the row's normalized
  `content` (NFC, trimmed, whitespace collapsed, lower-case), else the linked `Ingredient.section`, else the built-in
  English keyword map (row text, then the ingredient name), else `other`. Every row of a `grocery`/`shopping` list
  gets a section, ticked rows included, so ticking never moves a row.
- **Errors (new routes):** target envelope `{ error: { code, message, retryable } }` with
  `Cache-Control: private, no-store`: 400 `VALIDATION_ERROR` / `INVALID_JSON` / `LIST_NOT_GROCERY`, 403
  `SECTION_SORT_FORBIDDEN` (child, sort switch only), 404 `ITEM_NOT_FOUND` / `LIST_NOT_FOUND` (foreign and missing
  alike), 500 `INTERNAL_ERROR` (`retryable: true`). Authentication (401), the `lists` feature gate (403) and the
  paired-device refusal (403 `DEVICE_WRITE_NOT_ALLOWED`, before person auth) keep their shared shapes.
- **Not idempotency-keyed / not offline-queued:** both writes set an explicit value, so a repeat is harmless. The #162
  queue allowlist is unchanged; the page refuses "Move to…" while offline and says so.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/lists/items?listId=` | Unchanged for other list types. For `grocery`/`shopping` lists each item adds `section` (resolved id), and the body adds `sectionSort: { enabled, order: [id × 10], learned }` (`enabled` = `List.sort_by_section`; `order` is the household's learned walking order when `learned`, else the fixed order; `other` is always last). | unchanged |
| `POST /api/lists/items/create` | On a `grocery`/`shopping` list the returned `item` adds `section`. | unchanged |
| `PATCH /api/lists/items/update` | Response unchanged (the replay body stays as stored). A request that ticks a grocery row (open → ticked by the caller now) also appends the row's section to the list's current shopping trip (walking order, best effort: a failure never fails the tick; a replay records nothing). | unchanged |
| `PATCH /api/lists/items/section` (new) | "Move to…". Strict body `{ itemId, section: id \| null }`; `null` clears the household's choice (back to automatic). Upserts the household's `GrocerySectionPreference` for the item's normalized `content`; when the item is linked to an ingredient, sets (or clears) that `Ingredient.section` too. 200 `{ nameKey, override: id \| null, sections: { [itemId]: id } }` for every row on the same list sharing the name or the ingredient. Parent, teen, child. | 400 validation / `LIST_NOT_GROCERY`; 403 device or lists off; 404 `ITEM_NOT_FOUND` |
| `PATCH /api/lists/section-sort` (new) | Strict body `{ listId, sortBySection: boolean }`. Sets `List.sort_by_section` (default `true`) for a `grocery`/`shopping` list of the household. 200 `{ listId, sortBySection }`. Parent and teen. | 400 validation / `LIST_NOT_GROCERY`; 403 `SECTION_SORT_FORBIDDEN`, device or lists off; 404 `LIST_NOT_FOUND` |
| `GET /api/users/export` | Adds `grocerySectionPreferences` (`name_key`, `section`, `updated_by`, timestamps) and `groceryShoppingSessions` (`id`, `list_id`, `sections`, `started_at`, `last_tick_at`), both for the household, without `family_id`. | unchanged |

Compatibility: additive columns (`Ingredient.section`, `List.sort_by_section` default `true`), two new tables and two
new routes; no existing field changes meaning. Old WebView bundles ignore `section`/`sectionSort` and keep the
category grouping they shipped with. Rolling back the app code is safe: the columns and tables stay unused.

## Chores
Every change here is additive: old request bodies stay valid and old response fields keep their meaning. Roles:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Chores".

| Route | Contract | Errors |
| --- | --- | --- |
| `POST /api/chores/verify` | Parent only. Body `{ choreId, decision?: 'approve' \| 'reject' (default 'approve'), verificationNotes? (≤ 500, trimmed) }`. `approve`: `completed` → `verified` (a completion photo is marked checked), awards XP; re-verifying is `{ success, alreadyVerified: true }`. `reject`: `completed` → `pending` with `completed_at` null, `photo_verified` false and the note in `verified_notes`; the child is notified and can tick it again; no XP moves; an open chore is `{ success, alreadyOpen: true }`. Every 200 carries `chore: { id, status, photo_verified, verified_at, verified_notes, completed_at }`. Status never changes through `PATCH /api/chores` (its schema drops `status`/`photo_verified`/`verified_*`). | 400 not completed (approve) or bad body; 403 teen/child or another household; 404; 409 `CHORE_ALREADY_VERIFIED` (reject of a verified chore, including one verified while the reject was in flight); 409 `CHORE_NOT_COMPLETED` with the current `chore` (an approve that lost to a concurrent reject or Undo; never reported as verified) |
| `POST /api/chores/uncomplete` | Undo for a tick (#268): parent or the assignee, `completed` → `pending`. | 403; 404; 409 `CHORE_ALREADY_VERIFIED` |
| `POST /api/chores/create`, `PATCH /api/chores` (#272) | Optional `icon` (a key from `src/lib/routine-icons.ts`), `routine` (≤ 40 chars after trimming and collapsing spaces; empty becomes `null`) and `routine_order` (integer 1–99); `null` clears on PATCH. Create stores `null` when absent. Assignee may PATCH them like the title. | 400 `Choose a picture from the list` / routine or step messages |
| `GET /api/chores`, create/PATCH responses, `GET /api/users/export` (#272) | Chore rows add `icon`, `routine`, `routine_order` (nullable). Recurring generation copies them. | unchanged |
| `GET /api/device/today`, the Today board DTO (#272) | Each `chores[]` item adds `icon`: a catalogue key or `null` (a stored key the build does not know is sent as `null`). Not the routine name or step. | unchanged |

## Account and household deletion (D-3)
Behaviour and retention: `docs/product/ACCOUNT_DELETION.md`. Every route here refuses a paired shared device with
403 `DEVICE_WRITE_NOT_ALLOWED` before person auth. Deletion errors are `{ error, code }` with
`Cache-Control: private, no-store`.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/users/deletion` | Session. `{ role, household: { id, name, memberCount, parentCount } \| null, isOnlyParent, canDeleteAccount, canDeleteHousehold }` for the caller's own household only. Read-only. | 401 |
| `DELETE /api/users` | Session, any role. Body `{ password, confirmation }`; `confirmation` is `DELETE` (case, surrounding and repeated spaces ignored). Optional `Idempotency-Key` (action `account.delete`; the password is never part of the request hash). Deletes the caller's account (`deleteMemberAccount`). 200 `{ success, mode: 'account', filesRemoved, filesNotRemoved }` and a cleared `session_token` cookie. **Changed in D-3:** the body used to be ignored; the only parent used to get 400. | 400 `PASSWORD_REQUIRED` / `CONFIRMATION_MISMATCH` / `INVALID_PASSWORD` / `IDEMPOTENCY_KEY_INVALID`; 401; 403 device; 409 `LAST_PARENT` (use `DELETE /api/family`), `NO_SUCCESSOR`, `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED`; 429 `RATE_LIMITED` (5 attempts per 15 minutes per member, shared with the household route) |
| `DELETE /api/family` | Session, parent, the household's only parent. Body `{ familyId, password, confirmation }`; `familyId` must be the caller's household, `confirmation` is the household name. Optional `Idempotency-Key` (action `household.delete`). Deletes the household and every member (`deleteHousehold`). 200 `{ success, mode: 'household', membersRemoved, filesRemoved, filesNotRemoved }` and a cleared cookie. **Changed in D-3:** it used to need only `{ familyId }`, allowed any parent, and deleted the family row by cascade, leaving member accounts behind without a household. | 400 as above; 401; 403 teen/child, another household, device; 404; 409 `OTHER_PARENTS_EXIST`, `IDEMPOTENCY_IN_PROGRESS`; 422; 429 |

Retries: the in-progress idempotency record makes a concurrent duplicate 409. The deletion removes the caller's
records (and, for a household, all of them) with everything else, so a retry after success is answered by
authentication with 401: the account no longer exists. The Settings dialog retries once with the same key after a
network error and treats that 401 as "already deleted".

## Rate limits
Apply based on abuse/cost/risk rather than one global number. Authentication, invite/recovery, AI, uploads and expensive search/integration routes need stronger controls.

## Shared-device routes (#157 contract, #240)
Implemented (behind `SHARED_DEVICE_ENABLED`, default off; every route is `404` while it is off), with the web UI (#241).

**Tablet writes and setup (#274).** Additive routes, all `Cache-Control: private, no-store`, target error envelope:

| Route | Contract | Errors |
| --- | --- | --- |
| `PATCH /api/device/lists/items/:id` | Device cookie. Header `Idempotency-Key` **required** (scope `device:<deviceId>`). Strict body `{ checked: boolean, actingMemberId }`. Ticks/unticks an item of a household grocery/shopping list as the picked member. 200 `{ item: { id, checked } }`; replays carry `Idempotency-Replayed: true`. | 400 `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID` / `ACTING_MEMBER_INVALID` / `VALIDATION_ERROR`; 401 device codes; 403 `DEVICE_WRITES_OFF` (household opt-in off, the default) / `FEATURE_DISABLED`; 404 (kill switch, or a foreign/missing/non-grocery item); 409 `DUPLICATE_OPEN_ITEM` / `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED`; 429 |
| `POST /api/device/lists/:id/items` | Same gate. `{ content (1–200), actingMemberId }`. 201 `{ item: { id, content, quantity: 1, listId } }`. | as above |
| `POST /api/device/chores/:id/complete` | Same gate. `{ actingMemberId }`. A household chore due today; status `completed`. 200 `{ chore: { id, status }, alreadyCompleted }` (never points or XP). | as above; 409 `CHORE_NOT_DUE_TODAY` |
| `POST /api/device/chores/:id/uncomplete` | Same gate. `{ actingMemberId }`. Only this tablet's own completion of the chore from the last 2 minutes. 200 `{ chore: { id, status }, alreadyOpen }`. | as above; 403 `UNDO_NOT_ALLOWED`; 409 `CHORE_ALREADY_VERIFIED` |
| `GET` / `PATCH /api/device/elevated/board-settings` | Device cookie + `X-Device-Elevation`. The `/api/family/board-settings` body without photos (`display.photoIds` is 400) and with the place label only. | 403 `ELEVATION_REQUIRED` / `ELEVATION_EXPIRED`; 400 `VALIDATION_ERROR`; 409 |
| `GET /api/device/elevated/board-settings/places?q=` | Device cookie + elevation. Same as the parent place search. | 400, 403, 409, 429, 502 |
| `GET /api/device/me` | Adds `deviceWrites: boolean` (the household opt-in). | unchanged |
| `GET` / `PATCH /api/family/board-settings` | GET adds `deviceWrites: { available, enabled }`; PATCH accepts `deviceWrites: { enabled: boolean }` (parent only). | unchanged |

Existing clients are unaffected: every change is additive, and the household opt-in defaults off. The endpoint table, error codes (`DEVICE_ACCESS_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`, `ELEVATION_REQUIRED`, `ELEVATION_EXPIRED`, `PAIRING_CODE_INVALID`, …) and compatibility plan are in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §12–§13. New device routes use the target error envelope above and `Cache-Control: private, no-store`; they live under `/api/device/*` and `/api/family/devices/*` so existing routes keep their current responses and remain person-only. Installed Android builds need no update because the device UI is served by the web layer.

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

## Review-first event import (#270)
Three new routes; `POST /api/events` is unchanged (the commit route applies its field rules to each event). The suggestion
route is off (`404 EVENT_IMPORT_DISABLED`) until the deployment sets `EVENT_IMPORT_ANTHROPIC_API_KEY`
([`docs/runbooks/EVENT_IMPORT.md`](../runbooks/EVENT_IMPORT.md)). Rules, time zones and privacy:
[`CALENDAR_IMPORT.md`](CALENDAR_IMPORT.md) "Review-first import from text, photo or PDF". Route-owned errors use the
target envelope `{ error: { code, message, retryable } }` and every response carries `Cache-Control: private,
no-store`; authentication (401) and the feature gate (403 `{ error: string }`) keep their shared shapes.

| Route | Contract | Errors |
| --- | --- | --- |
| `POST /api/calendar/import-suggestions` | Either `application/json` strict `{ text (1–20,000 chars), today?: 'YYYY-MM-DD', timeZone?: IANA }` or `multipart/form-data` with `file` (JPEG/PNG/WebP ≤ 8 MB or PDF ≤ 10 MB and ≤ 20 visible pages, by magic bytes) and optional `today`, `timeZone` fields; `Content-Length` required. 200 `{ suggestions: [{ title, start, end: string \| null, allDay, location: string \| null, notes: string \| null, confidence: 0–1 }], unreadable: boolean, dropped, timeZone }`, at most 30, sorted by start. `start`/`end` are `YYYY-MM-DD` when `allDay` (end = last day, inclusive), else ISO 8601 with the zone offset. `unreadable: true` (no suggestions) covers a refusal, an "unreadable" answer or no usable date. Parent and teen. Writes nothing. | 401; 403 device (`DEVICE_WRITE_NOT_ALLOWED`), calendar off, child (`EVENT_IMPORT_FORBIDDEN`); 404 `EVENT_IMPORT_DISABLED`; 400 `INVALID_BODY` / `INVALID_TODAY`; 411 `LENGTH_REQUIRED`; 413 `TEXT_TOO_LONG` / `FILE_TOO_LARGE` / `PDF_TOO_MANY_PAGES`; 415 `UNSUPPORTED_FILE_TYPE`; 429 `RATE_LIMITED` / `IMPORT_DAILY_LIMIT` with `Retry-After`; 502 `IMPORT_PROVIDER_UNAVAILABLE` / `IMPORT_UNREADABLE` (`retryable: true`) |
| `POST /api/calendar/import-suggestions/commit` | Header `Idempotency-Key` **required** (one per batch). Strict `{ events: [{ title (1–200), description?: string \| null (≤ 1000), start_time, end_time?, location?: string \| null (≤ 200) }] (1–30) }`, the `POST /api/events` field and range rules (end not before start; default end = start). Creates them in one transaction for the caller's household (`event_type` other, `created_by` the caller) plus one `events_imported` activity row. 201 `{ eventIds, count, undoToken, undoExpiresAt }`. Same key and body: the stored 201 is replayed with `Idempotency-Replayed: true` and nothing is created; same key, other body: 422. Parent and teen; not behind the provider kill switch. | 401; 403 device (`DEVICE_WRITE_NOT_ALLOWED`), calendar off, child (`EVENT_IMPORT_FORBIDDEN`); 400 `INVALID_BODY`, `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`; 409 `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED` |
| `POST /api/calendar/import-suggestions/undo` | Strict `{ token }`: the `undoToken` from the commit, `v1.<payload>.<mac>` (HMAC-SHA256 over user, household, event ids and commit time; key derived from `JWT_SECRET` with a purpose label). Deletes those events that are still in the caller's household, created by the caller and not subscription/provider imports. 200 `{ removedCount }`; a repeat answers `{ removedCount: 0 }`. Event ids are never accepted directly. Parent and teen; not behind the provider kill switch. | 401; 403 device, calendar off, child, `UNDO_TOKEN_INVALID` (tampered, malformed, another person's or another household's token); 409 `UNDO_WINDOW_EXPIRED` (over 10 minutes); 400 `INVALID_BODY` |

Rate limits: 10 per person and 20 per household per hour, plus `EVENT_IMPORT_DAILY_LIMIT` (default 30) per household
per UTC day (suggestions only). Suggestions are read-only; the commit is idempotent per batch key (action
`calendar.import-commit`, records scoped to `user:<id>`), and none of these routes is offline-queued. Compatibility: additive routes; nothing existing changes. With the key removed the route is
404 and the button disappears on the next page load, so rollback is an environment change, not a deploy.

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.