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
code: it is never stored, so a retry with the same key re-runs the check). Queue policy and client behaviour: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

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
| First request ended non-2xx or threw | Nothing is stored; the same key may be retried. |
| First request died mid-flight (row in progress for more than 30 s) | The next request with the key takes over and runs the route again (allowlisted actions converge). |
| Record older than 7 days | Treated as absent; the key starts over. |

- **Error shape:** the three codes above use the target envelope `{ "error": { "code", "message", "retryable" } }`
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
| `POST /api/lists/create` | Type `meal_plan` is no longer accepted for a new list (O-8). Existing `meal_plan` lists are untouched and stay readable and editable. | 400 |
| every `/api/lists/**` handler | `featureGate('lists')` after authentication (O-11). | 403 lists off |
| `GET /api/users/export` | Adds `meals` (the household's `FamilyMeal` rows) and `mealBackfillJobs` (ADR-0007 backfill `ImportJob` summaries that archive skipped legacy rows). `mealPlans` and `shoppingLists` stay while the legacy tables exist. | unchanged |

Old Android WebViews and queued #247 operations keep working: no route, request field or `ListItem.id` changed, and
every new field is optional. Rollback of the app code is safe; the new columns stay unused.

## Rate limits
Apply based on abuse/cost/risk rather than one global number. Authentication, invite/recovery, AI, uploads and expensive search/integration routes need stronger controls.

## Shared-device routes (#157 contract, #240)
Implemented (behind `SHARED_DEVICE_ENABLED`, default off; every route is `404` while it is off); UI and device writes are not. The endpoint table, error codes (`DEVICE_ACCESS_EXPIRED`, `DEVICE_REVOKED`, `DEVICE_SESSION_INVALID`, `ELEVATION_REQUIRED`, `ELEVATION_EXPIRED`, `PAIRING_CODE_INVALID`, …) and compatibility plan are in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §12–§13. New device routes use the target error envelope above and `Cache-Control: private, no-store`; they live under `/api/device/*` and `/api/family/devices/*` so existing routes keep their current responses and remain person-only. Installed Android builds need no update because the device UI is served by the web layer.

## Provider adapters
Calendar, weather, AI, notification and food/recipe providers must sit behind application interfaces. Provider-specific errors map into stable product states.

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.