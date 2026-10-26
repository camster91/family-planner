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

### Error envelope in use (#161)
`src/lib/api-error.ts` `apiError(status, code, message, { requestId, shape })` has two shapes so adoption never breaks an installed client:

| Shape | Body | Used by |
|---|---|---|
| `flat` (default) | `{ "error": "<human message>", "code": "QUERY_TOO_SHORT", "requestId": "<id>" }` | Routes whose clients read `error` as a string. `error` is unchanged; `code` and `requestId` are additive. `GET /api/search`, `GET /api/audit` |
| `nested` | `{ "error": { "code": "VALIDATION_ERROR", "message": "…", "requestId": "<id>", "retryable"?: bool } }` (the target above) | Routes already on the nested shape. `GET`/`PATCH /api/users/preferences` (`requestId` added inside `error`) |

`code` is stable UPPER_SNAKE_CASE; clients branch on `code`, never on `message`. Success bodies and status codes of adopted routes did not change. Routes not yet adopted still return `{ error }` (and the shared-device routes their own nested envelope without `requestId`); the adoption order is in `OBSERVABILITY.md` "Incremental adoption plan". Moving an existing route from `flat` to `nested` is a breaking change and needs the compatibility plan above.

### Envelope rule for every route (#134)
Every API error response is JSON with an `error` key and a 4xx/5xx status: `{ "error": "<human message>" }` (plus the
additive flat fields above where adopted) or the nested `{ "error": { "code", "message", ... } }`. Extra keys a client
already reads stay (for example `GET /api/auth/me` keeps `user: null` next to `error`). Never `{ "message" }`,
`{ "errors" }`, plain text, or a 200 that carries `error`. The one exception is `GET /api/health`, whose 503 body is
`{ "status": "degraded" }` for the orchestrator and the release check.

`src/app/api/__tests__/error-envelope.test.ts` parses every `src/app/api/**/route.ts` and fails on an inline error
body without `error`, an `error` body with a success status, or a plain-text error. It does not see bodies built in
shared helpers or responses with a computed status; those helpers (`api-auth`, `csrf`, `feature-gate-server`,
`idempotency`, `device-http`, `inventory-http`) already return `{ error }`.

Aligned in #134 (additive or invisible to clients): `GET /api/files/[filename]` and `GET /api/files/chores/[filename]`
answer 403/404 with `{ "error": "Forbidden" | "Not found" }` instead of plain text (they are loaded by `<img>`, which
ignores the body; the 401 was already JSON); `GET /api/auth/me` adds `error` to its 401/500 `{ user: null }` bodies.
Reliability targets and how to check them: [`docs/engineering/SLO_AND_PERFORMANCE.md`](../engineering/SLO_AND_PERFORMANCE.md).

## Request identity and build version (#161)
- **`X-Request-Id`** is on every response that passes through `src/middleware.ts` (all API routes and pages; not `/_next/static`, `/_next/image`, `favicon.ico`), including CSRF 403s and redirects. A client or proxy may send its own `X-Request-Id` (`[A-Za-z0-9_-]{8,64}`); a well-formed value is echoed back, anything else is replaced by a random UUID. Adopted error bodies repeat it as `requestId`. Quote it in bug and support reports.
- **`GET /api/version`** (public, `Cache-Control: no-store`): `200 { "version": "0.1.0", "commit": "<40-hex RELEASE_SHA or \"unknown\">", "builtAt": "<ISO time of next build or \"unknown\">" }` and nothing else. Clients may show it in an About/diagnostics view. Installed clients never depend on it; a server rolled back to a build without it answers 404.
- `GET /api/health` is unchanged: `{ status }` plus the `X-Release-Commit` header.

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
the crash case converges: the takeover finds the batch's activity row by its record id and returns the same events),
and `PATCH /api/users/preferences` (#286; sets explicit values, so a re-run converges; a member without a household
has no record scope, so their key is ignored and the same update runs again).
Queue policy and client behaviour: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

`POST /api/lists/items/create` also accepts an optional key (`list-item.add`, #135).
Authentication, the lists feature gate, validation and current list ownership are checked before replay.
Without a key, the existing 200 `{ success: true, item }` response and generic list fields are unchanged;
each request remains a distinct add. Keyed creates use the same canonical `createListItem` writer as the
shared tablet. The item and completed replay response commit in one transaction, under the idempotency
record and list row locks (`person-list-item-create.ts`). A section lookup or completion-store failure
rolls back the item. A slow original effect and a lock takeover cannot both create; a retry after item
deletion returns the original response without recreating it. The caller should refresh canonical list
state after replay. The seven-day server record retention still applies. The explicit minimal personal grocery queue below uses the same server guarantee; generic list
fields remain outside the offline allowlist.
Real PostgreSQL concurrency, rollback, takeover and deletion-replay proof is in
`src/app/api/lists/__tests__/create-idempotency.integration.test.ts` and runs in protected Build & Test.

Personal submitted grocery quick add (#135): `POST /api/lists/items/grocery-add` is additive and
person-session only (parent/teen/child, existing Lists permission). Header `Idempotency-Key` is
**required**, action `list-item.grocery-add`, scope `user:<id>`. Strict body `{ listId, content }`:
canonical id `[A-Za-z0-9_-]{1,64}`, trimmed text 1–500 characters, no extra fields. The lists feature,
current household ownership and grocery/shopping type are checked before replay; type is rechecked
under the list row lock in the canonical writer. Quantity is 1, added_by is the authenticated
person. 200 `{ success: true, item }`, replay header `Idempotency-Replayed: true`; 400 invalid
JSON/body or missing/invalid key, 401 unauthenticated, 403 feature/foreign household, 404 missing or
non-grocery list (including a concurrent type change), 409 `IDEMPOTENCY_IN_PROGRESS`, 422
`IDEMPOTENCY_KEY_REUSED`. The same atomic item/completed-response transaction prevents duplicates
and resurrection after deletion. The browser refreshes canonical state after confirmation and
keeps missing-list recovery visible. No old route/schema or native request contract changes.
Queue bounds, persistence and client rollback caveat: [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md).

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
| `GET /api/meals` | Each meal adds `recipe_id`, `servings`, `updated_at` and `recipe: { id, title, prep_time, cook_time, servings } \| null`. Ordered by date, creation and ID. Several meals may share a (date, meal_type) slot (O-1). Without `limit`, legacy `{ meals }` remains complete. Opt-in `limit=1..200` reads at most limit+1 rows and returns `{ meals, nextCursor }`; pass the opaque cursor with the same household/date range. Web week starts with 100 and explicitly loads more. Responses are private/no-store. | 400 invalid/duplicate paging parameter, cursor without limit or cursor for another range/household; existing auth/feature/date errors unchanged |
| `POST /api/meals`, `PATCH /api/meals/[id]` | Optional `recipe_id` (same household; `null` unlinks on PATCH) and `servings` (1–100 or `null`). Linking without `recipe_name` sets the snapshot to the recipe title; unlinking keeps the snapshot. | 400 `Recipe not found` (foreign and missing alike), 400 bad `servings` |
| `POST /api/lists/items/create` | Optional `amount` (0–100000), `unit` (1–32 chars), `ingredient_id` (same household). Responses include every `ListItem` column, including `amount`, `unit`, `ingredient_id`, `recipe_id`, `meal_id`, `source` (default `manual`). `source` is not client-writable. | 400 `Ingredient not found` (foreign and missing alike) |
| `PATCH /api/lists/items/update` | Optional `amount`, `unit`, `ingredient_id`; `null` clears. The #162 idempotent, row-locked write is unchanged. | 400 `Ingredient not found`; 409 `{ error: { code: 'DUPLICATE_OPEN_ITEM', message, retryable: false } }` when unticking a recipe-added row whose (list, ingredient, source) already has an open row (partial unique index `ListItem_open_recipe_source_key`). Not stored for replay; the #247 queue shows it as a conflict. |
| `POST /api/lists/create` | Type `meal_plan` is no longer offered by the UI for a new list (O-8), but the server still accepts it for installed Android bundles until a version gate exists. Existing `meal_plan` lists are untouched. | 201 |
| `POST /api/lists/items/from-recipe` (new, #253) | Header `Idempotency-Key` **required**. Strict body `{ recipeId, mealId?, listId?, servings? (1–50), ingredientIds? (1–100, subset of the recipe's) }`. Adds one row per selected ingredient (`source: 'recipe'`, `source_key` `meal:<id>` or `recipe:<id>`, `source_request_id`, `amount` scaled by `servings ?? meal.servings ?? recipe.servings`, `unit`), skipping ingredients already open on the list from the same source. Without `listId` the default grocery list is used or created (O-4). 201 `{ listId, listName, requestId, createdCount, alreadyOnListCount, possibleDuplicates: [{ ingredientId, matchedItemId }] (≤ 20), possibleDuplicatesTruncated, undoExpiresAt }` (`undoExpiresAt` is absolute: request creation + 10 minutes, so a late replay does not extend Undo). The add, its read-back and the lookalike scan run in one transaction, so a failure leaves no rows; replays carry `Idempotency-Replayed: true`. Parent, teen, child. Not offline-queueable (O-10). Rules: `MEALS_AND_GROCERIES.md` §7. | 400 `IDEMPOTENCY_KEY_REQUIRED` / `IDEMPOTENCY_KEY_INVALID`, validation, `MEAL_RECIPE_MISMATCH`, `LIST_NOT_GROCERY`, `INGREDIENT_NOT_IN_RECIPE`, `RECIPE_HAS_NO_INGREDIENTS`; 403 shared device (`DEVICE_WRITE_NOT_ALLOWED`) or meals/lists off; 404 `RECIPE_NOT_FOUND` / `MEAL_NOT_FOUND` / `LIST_NOT_FOUND` (foreign and missing alike); 409 `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED` |
| `POST /api/lists/items/undo-add` (new, #253) | `{ requestId }` (the `requestId` from `from-recipe`). Deletes that request's still-unticked rows added by the caller within 10 minutes (O-5). 200 `{ requestId, removedCount, keptCheckedCount }`; repeating it removes 0. | 403 another member's request or shared device; 404 unknown or another household's request; 409 `UNDO_WINDOW_EXPIRED`, `UNDO_IN_PROGRESS` |
| `POST /api/lists/default-grocery` (new, #253) | Finds or creates the household's default grocery list (newest `grocery`, else newest `shopping`, else "Groceries"; per-household advisory lock). 200 `{ list: { id, name, type }, created }`. Parent and teen. Used by legacy/other clients; current capture commits through `/api/capture/grocery` so list resolution and item creation share one receipt. | 403 child or lists off |
| every `/api/lists/**` handler | `featureGate('lists')` after authentication (O-11). | 403 lists off |
| `GET /api/users/export` | Adds `meals` (the household's `FamilyMeal` rows) and `mealBackfillJobs` (ADR-0007 backfill `ImportJob` summaries that archive skipped legacy rows). `mealPlans` and `shoppingLists` stay while the legacy tables exist. | unchanged |

Old Android WebViews and queued #247 operations keep working: no route, request field or `ListItem.id` changed, and
every new field is optional. Rollback of the app code is safe; the new columns stay unused.

## Food inventory (#263, #158/#121)

**Cooking stock review source (2026-10-20):** GET
`/api/inventory/cooking-review?kind=recipe|batch&id=&servings=` is read-only,
private/no-store, 60/user/minute. Current personal parent/teen inventory + meals
authority and household-owned source joins apply; prepared batches require
captured recipe history. Optional original read scope is validated/echoed;
modern readers require it before parsing. Up to 100 ingredient lines, no stock
allocation. Recipe/prep links open explicit lot selection into existing versioned
amount-used/consume/recovery/Undo. Each lot is separate. Source and authored tests
are unverified; `COOKING_STOCK_REVIEW.md` defines limits and acceptance.


**Replacement restock source (2026-10-20, gated UI/add-journal integrated):**
GET `/api/inventory/restock?itemId=&listId=&content=` returns current source
name/version, eligible lists (cap 100), exact open replacement pointer and up to
ten possible duplicate summaries with incomplete-comparison disclosure (2000-row
scan cap). Optional original read-scope header is validated/echoed.
POST accepts strict `herewoven.inventory-restock.v1` with expected actor/family,
issued-at, reviewed source version, list/content/amount/unit and explicit
allow_similar; key required, 8 KiB body, GET/POST 90/user/minute. Canonical
ListItem/receipt are atomic; no stock mutation. Current parent/teen inventory and
lists authority applies before effect/replay. Removed list rows are not recreated
by confirmation. POST `/api/inventory/restock/undo` is original actor/household/
requestId-bound, 4 KiB/60 per minute, with the existing ten-minute own-open-rows
Undo rule; checked rows stay. Every outcome private/no-store. Details and
pending acceptance: `INVENTORY_RESTOCK.md`.

Modern review uses POST `/api/inventory/restock/review` with strict
`{itemId,listId?,content?}` in a 4 KiB body, sharing the 90/user/minute budget and
read-scope echo. This avoids private draft text in URL queries. The legacy GET
remains compatible. Restock adds now join the private owned inventory journal
and canonical recovered review with original target-list binding and compact
receipt. Explicit UI/result/Undo controls are authored, not exercised. Unknown
Undo remains open-sheet retry/manual acknowledgement, not a durable queue.

**Inventory recovery foundation (2026-10-20, off/gated UI integrated):** personal

`POST /api/inventory/recovery/review` accepts strict
`{contract:'herewoven.inventory-recovery-review.v1',entry:{kind,key,body}}` and
requires the original inventory owner proof. Limit 32 KiB; 60/user/minute;
parent/teen current inventory authority; private/no-store. It reads matching
receipts and current owned targets without mutation. Reply echoes owner/entry
and returns ready/pending/committed/removed/expired/conflict/unavailable,
canRetry, current canonical summary and validated completed receipt if present.
Ready is only a snapshot; writes retain all version/authority checks. Unknown
and foreign targets reveal no names. Browser readers bound time/bytes and exact
response ownership. Gated UI source is integrated; acceptance remains open.

Personal negotiation:
`GET /api/inventory/recovery` renews parent/teen inventory authority and returns
`{contract:'herewoven.inventory-recovery.v1',enabled,owner,userId,familyId}`.
Owner is a separate inventory continuity fingerprint of the actual session and
canonical current role/household, or null for a legacy session without nonce.
Every outcome is private/no-store; rate cap 240/user/minute. Negotiating enabled
support requires both inventory recovery gates and both existing queue-owner
gates. It neither grants stock authority nor changes the public manifest.
Intake/change accept optional `X-Herewoven-Inventory-Owner`; a supplied mismatch
is 409 `INVENTORY_RECOVERY_OWNER_CHANGED` before body processing/replay, even with
new recovery writing paused. No-header old clients retain existing behavior.
Post helpers may pass that original scope with unchanged body/key. See
`INVENTORY_RECOVERY.md` for gated browser/review source and required
rollback acceptance. Durable behavior is authored, not yet verified.

**Additive personal read binding (#125, source candidate 2026-10-19):** the list,
`use-soon`, `cook` and `adjustments` GET routes accept optional
`X-Herewoven-Inventory-Scope: v1.<URI-encoded JSON>` containing strict
`{userId,familyId}`. Missing header preserves older callers. Invalid binding is
400 `INVALID_READ_CONTEXT`; a binding different from the authenticated actor is
403 `AUTH_CONTEXT_CHANGED`. It supplies no authority. Successful replies echo
the canonical binding; all outcomes are private/no-store. New bound clients
reject missing/mismatched echoes before parsing private JSON, so deploy backend
support first. This does not continuously reauthorize an in-flight database query
or make parallel reads a consistent transaction snapshot.

The personal reader gives the whole batch 15 seconds, limits each streamed body
to 2 MiB, validates DTOs, follows at most 20 pages of 500, and rejects repeated
IDs or unexpected/nonadvancing cursors. Older JSON-only fetch bridges receive a
post-parse size check, not pre-allocation streaming protection. Latest generation
alone publishes. Required read failure retains same-owner data with stale copy;
history failure retains prior history without Undo and discloses the failure.
Authorization/scope loss hides cached data and suspends edit/capture UI until
the original scope is confirmed or the page is explicitly reopened. Source tests
are authored; acceptance is deferred with the integrated candidate.

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
| `PATCH /api/chores` `frequency` (O-33) | Parent only, as before. On a chore with no series, a repeating value makes it the template of a new series and generates its window, like create. On a series template, `once` stops the series (it is no longer `is_template`; its still-`pending` copies due after today are removed) and another repeating value re-times it. On a generated copy (always stored as `once`) `frequency` is ignored unless the new optional `apply_to_series: true` is sent; then the change is made to the series' template (the edited copy is kept). The edit and the series change commit in one transaction. | unchanged |
| `DELETE /api/chores` (560, #536) | The legacy body `{ choreId }` deletes one ordinary or generated occurrence only. An active self-anchored repeating template returns 409 `RECURRING_SERIES_REQUIRES_STOP`; a stopped self-anchored row with sibling history returns 409 `RECURRING_ANCHOR_RETAINS_HISTORY`. Both responses perform no write and direct the caller to the existing parent-only stop/history journey. DELETE acquires the actor user lock before the household lock and re-checks actor membership/role and target ownership under the transaction. | unchanged body; 403 household/assignee policy; 404 missing; 409 protected series anchor |
| `POST /api/chores/create` (repeating) | A `daily`/`weekly`/`monthly` chore is created, made the template of its own series (`recurrence_id` = its id, `is_template` true, both now in the response) and given its first window of copies in one transaction. Before, the link and the copies were written after the response's chore and a failure was only logged. | 500 when any part fails; nothing is written, so the client can retry |
| `GET /api/chores?limit=&cursor=&order=` (O-19) | Opt-in paging. Without `limit` the response shape is unchanged (installed Android builds): chores of the household ordered by `due_date`, no `nextCursor`, but now **capped at the latest 500 by due date** (`CHORE_UNPAGED_MAX` in `src/lib/chore-paging.ts`; the oldest are left out, the list is still oldest first). A client that needs older chores pages with `limit`. With `limit` (1–200) at most that many chores ordered by `due_date` then `id`, plus `nextCursor`: an opaque string to pass back as `cursor`, or `null` on the last page. `status` and `assigned_to` filters still apply. New, optional `order`: `asc` (default, unchanged for existing callers) or `desc` (newest first; the next page is older). Send the same `order` with every page. The web chores page pages verified history with `order=desc`: its server-rendered first page is the newest history and "Load more" continues from that cursor. | 400 `INVALID_QUERY` for a bad `limit`, a bad `cursor`, a `cursor` without `limit`, an `order` other than `asc`/`desc`, or an `order` without `limit` |
| `GET /api/chores?from=&to=` | New, optional. `YYYY-MM-DD` days, both inclusive, filter on the date-only `due_date`; either may be sent alone and both combine with paging, `status` and `assigned_to`. The travel page asks only for the trip's window. | 400 `INVALID_QUERY` for a bad date or `from` after `to` |
| `GET /api/chores?id=` | New. One chore of the caller's household: `{ chore, template, rotation }` (`rotation`: O-39, below), where `template` is `{ id, frequency }` of the series' template when the chore is a generated copy (stored as `once`), else `null`. Points are left out when Points & streaks is off, like the list. The edit page uses it instead of downloading the list. Other query parameters are ignored. | 404 (a missing id and another household's chore alike) |
| `POST /api/chores/create`, `PATCH /api/chores` `rotation` (take turns, O-39) | New, optional. `rotation`: 2–8 distinct member ids of the caller's household, in the order they take turns; repeating chores only. Create: the first person takes the first occurrence (`assigned_to` may be left out and is ignored when `rotation` is sent). PATCH (parent only; on the template or any copy, it applies to the whole series, and after a `frequency` change in the same request): a new order re-plans the series' rows due after today that are still `pending` and still with the person their place names, starting from the first person (a copy reassigned by hand keeps its person); `null` stops taking turns and leaves every row's person as it is; an unchanged list is a no-op. Older clients that never send it are unaffected. | 400 bad list, another household's member or unknown id, or a chore that does not repeat; 403 non-parent |
| `GET /api/chores?id=`, chore rows (O-39) | `GET ?id=` adds `rotation`: the series' order (`string[]`) or `null`, and `template` adds `rotation_member_ids`. Chore rows (list, create/PATCH responses) add `rotation_member_ids` (`string[]`, empty unless the row is a rotating template) and `rotation_index` (place in the order, nullable). A one-person list (left after a member was removed) means every new copy goes to that person; clients show it as not taking turns. | unchanged |
| `GET /api/device/today`, the Today board DTO (#272) | Each `chores[]` item adds `icon`: a catalogue key or `null` (a stored key the build does not know is sent as `null`). Not the routine name or step. | unchanged |

## Account and household deletion (D-3)
Behaviour and retention: `docs/product/ACCOUNT_DELETION.md`. Every route here refuses a paired shared device with
403 `DEVICE_WRITE_NOT_ALLOWED` before person auth. Deletion errors are `{ error, code }` with
`Cache-Control: private, no-store`.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/users/deletion` | Session. `{ role, household: { id, name, memberCount, parentCount } \| null, isOnlyParent, canDeleteAccount, canDeleteHousehold }` for the caller's own household only. Read-only. | 401 |
| `DELETE /api/users` | Session, any role. Body `{ password, confirmation }`; `confirmation` is `DELETE` (case, surrounding and repeated spaces ignored). Optional `Idempotency-Key` (action `account.delete`; the password is never part of the request hash). Deletes the caller's account (`deleteMemberAccount`). 200 `{ success, mode: 'account', filesRemoved, filesNotRemoved }` and a cleared `session_token` cookie. **Changed in D-3:** the body used to be ignored; the only parent used to get 400. | 400 `PASSWORD_REQUIRED` / `CONFIRMATION_MISMATCH` / `INVALID_PASSWORD` / `IDEMPOTENCY_KEY_INVALID`; 401; 403 device; 409 `LAST_PARENT` (use `DELETE /api/family`), `NO_SUCCESSOR`, `IDENTITY_CONFLICT` (dormant profile association needs review; no mutation), `IDEMPOTENCY_IN_PROGRESS`; 422 `IDEMPOTENCY_KEY_REUSED`; 429 `RATE_LIMITED` (5 attempts per 15 minutes per member, shared with the household route) |
| `DELETE /api/family` | Session, parent, the household's only parent. Body `{ familyId, password, confirmation }`; `familyId` must be the caller's household, `confirmation` is the household name. Optional `Idempotency-Key` (action `household.delete`). Deletes the household and every member (`deleteHousehold`). 200 `{ success, mode: 'household', membersRemoved, filesRemoved, filesNotRemoved }` and a cleared cookie. **Changed in D-3:** it used to need only `{ familyId }`, allowed any parent, and deleted the family row by cascade, leaving member accounts behind without a household. | 400 as above; 401; 403 teen/child, another household, device; 404; 409 `OTHER_PARENTS_EXIST`, `IDEMPOTENCY_IN_PROGRESS`; 422; 429 |

Retries: the in-progress idempotency record makes a concurrent duplicate 409. The deletion removes the caller's
records (and, for a household, all of them) with everything else, so a retry after success is answered by
authentication with 401: the account no longer exists. The Settings dialog retries once with the same key after a
network error and treats that 401 as "already deleted".

## Household member controls (O-34)
Additive: two new routes; no existing request or response changes, except that households created from now on get
a 24-character code (lowercase letters and digits) instead of a cuid; both formats keep working with
`POST /api/family/join` and `GET /api/family/lookup`. Decision: `docs/decisions/PROVISIONAL_OWNER_DECISIONS.md`
O-34; roles: `docs/ROLE_AND_ISOLATION_MATRIX.md`. Both routes refuse a paired shared device with 403
`DEVICE_WRITE_NOT_ALLOWED` before person auth; CSRF is checked by the middleware.

| Route | Contract | Errors |
| --- | --- | --- |
| `POST /api/family/invite-code` | Parent only. No body. Replaces the household's family code with a new random one (`createFamilyInviteCode`, the generator used at household creation); the old code is refused at once. Emailed invites and current members are not affected. Writes an `invite_code.rotated` audit row (never the code). 200 `{ inviteCode }`, `Cache-Control: private, no-store`. | 400 no household; 401; 403 teen/child, device; 404; 429 (10 an hour per parent) |
| `DELETE /api/family/members/[id]` | Parent only, on another member of their own household. The member keeps their account; `family_id` is cleared and `token_version` bumped (every session ends). Their tablet elevation, PIN, unfinished pairings, tablets they paired or confirmed (revoked), unaccepted invites, calendar connections, idempotency records, push subscriptions, notifications and activity rows go. Household content they created is handed to the removing parent; their open chores are reassigned to the removing parent; done chores (`completed`/`verified`/`approved`) and messages stay. Verifying a `completed` chore of a removed member pays no XP and notifies nobody; sending it back hands it to the parent who sent it back. Verifying a chore whose assignee has left the household awards no XP and sends no notification. Writes `member.removed` (and `device.removed` per revoked tablet). 200 `{ success: true, removedId, tabletsRevoked }`. Errors are `{ error, code, requestId }`. | 400 `CANNOT_REMOVE_SELF`, no household; 401; 403 teen/child, device; 404 `MEMBER_NOT_FOUND` (missing id and another household's member alike); 409 `LAST_PARENT`, `IDENTITY_CONFLICT` (dormant profile association needs review; no mutation); 429 `RATE_LIMITED` (30 an hour per parent) |

## Notification preferences (#286, PR101 D-5)

Each member switches three categories of notifications on or off for themselves. Stored on `User` as
`notify_chores`, `notify_events` and `notify_messages` (Boolean, `NOT NULL DEFAULT true`), added by
`scripts/migrate.js` with `ADD COLUMN IF NOT EXISTS`. Additive: a row from before #286 reads as all on, which is
today's behaviour, and an old client that never calls the routes keeps receiving everything.

| Route | Change | Old clients |
| --- | --- | --- |
| `GET /api/users/preferences` | New. `{ "preferences": { "chores", "events", "messages" } }` (booleans) for the caller only. Any role. | n/a |
| `PATCH /api/users/preferences` | New. Body `{ chores?, events?, messages? }`, booleans, at least one. **Strict**: any other key (including `userId`) is `400 VALIDATION_ERROR`; there is no way to name another member. Returns the full `preferences` after the change. Optional `Idempotency-Key` (see Idempotency). | n/a |
| `POST /api/notifications` | `type` must be a type from the policy table (`chore`, `reward`, `event`, `message`, `system`); anything else is `400`. The recipient's preferences apply: a muted category creates nothing and answers `{ success: true, delivered: false, notification: null }`. The success body adds `delivered`. | No browser code calls it today; server-side sends go through `src/lib/notifications-server.ts` and use table types only. |
| `GET /api/users/export` | Adds `notificationPreferences` (same shape as the GET) and the three `notify_*` columns on `user`. | unchanged |

Both preference routes: a paired shared device is refused with `403 DEVICE_WRITE_NOT_ALLOWED` before person auth,
then the person session is required (401). Errors use `{ "error": { "code", "message" } }`; every response is
`Cache-Control: private, no-store`.

**Categories and the policy table** (`src/lib/notification-policy.ts`). Every notification type is mapped
explicitly:

| Type | Category (switch) |
| --- | --- |
| `chore` (assigned, sent back) | `chores` |
| `reward` (chore checked, reward added/claimed/approved, level-up) | `chores` |
| `event` | `events` |
| `message` | `messages` |
| `system` (a parent's notice through `POST /api/notifications`) | **always sent** |
| `summary` (the morning summary, O-40; in-app and opt-in email) | **opt-in**: its own switch, default off (see "Morning summary") |
| Account email: `password_reset`, `email_verification`, `family_invite` | **always sent** |

Always-sent types ignore every switch. They are account and safety messages: muting them could lock a person out of
their account or household, and a parent must be able to reach every member. The level-up notification used to be
`system`; it is `reward` now, so "Chores and rewards" mutes it.

**Enforcement.** One server helper, `src/lib/notification-delivery.ts`, creates every `Notification` row
(`deliverNotification`, which reads the recipient's own switch for the type's category) and sends every account
email (`sendAccountMail`). `src/lib/notifications-server.ts` (used by the chore and reward routes) and
`POST /api/notifications` go through it. `src/lib/__tests__/notification-policy.test.ts` fails if any other file
creates a `Notification` row or calls `sendMail`, or if a source file sends a type that is not in the table. There
is no push channel today; a future one must go through the same helper.

**Membership concurrency (#469).** Household-originated in-app sends pass their
original `familyId` to the helper. It locks recipient/sender users in sorted order,
then the household, and rechecks membership before reading preferences and inserting.
Manual parent sends also recheck the sender's parent role. A removed recipient or
sender creates nothing (`delivered: false`); this authorization refusal takes
precedence over the always-send category policy. Removal uses the same locks, so
a completed send is cleaned up by a later removal and a later send cannot recreate
the removed member's notification. Legacy account-notice inputs remain compatible.
Chore creation similarly locks/rechecks the parent, assignee and rotation members
inside the creation/expansion transaction; a removed assignee/participant is `400`,
and a removed/demoted actor is `403`. No schema or browser payload changes.

The opt-in morning-summary **email** path (#470) still lacks original-household binding
across send/removal. Do not enable its scheduler until that separate privacy gap
is resolved and verified. In-app locking does not establish email safety.

### Quiet hours (#141, decision O-32)

Each member can set quiet hours for themselves. Stored on `User` as `quiet_hours_enabled` (Boolean,
`NOT NULL DEFAULT false`), `quiet_hours_start` / `quiet_hours_end` (Text `"HH:MM"`, `NOT NULL DEFAULT '22:00'` /
`'07:00'`) and `quiet_hours_time_zone` (Text, nullable: an IANA zone, NULL = UTC), added by `scripts/migrate.js`
with `ADD COLUMN IF NOT EXISTS`. Additive and off by default, so existing rows and old clients behave as before.

Quiet hours never drop or delay storing a notification: the row is created exactly as before, so nothing is lost.
`deliverNotification` adds `quiet: true` when the recipient is inside their window (start inclusive, end exclusive,
may wrap past midnight, read in the saved zone with its daylight-saving offset; `src/lib/quiet-hours.ts`). Every
interruptive channel (push, sound, toast, reminder email) must hold its interruption when `quiet` is true. **The app
has no such channel today** (the bell is a plain link with no badge, nothing polls for toasts, and the only email is
always-sent account mail), so quiet hours are a stored preference that the first interruptive sender must honour.
`quiet` applies to every in-app type, including `system` notices; account email is not in-app and is not held.

| Route | Change | Old clients |
| --- | --- | --- |
| `GET /api/users/preferences` | Adds `quietHours: { enabled, start, end, timeZone }` beside `preferences`. | Extra key, ignored |
| `PATCH /api/users/preferences` | Body may add `quietHours: { enabled, start, end, timeZone? }` (the whole setting; strict). `start`/`end` are 24-hour `"HH:MM"` and must differ; `timeZone` must be an IANA zone the server knows (max 64 characters) or null/missing (UTC). Any other shape is `400 VALIDATION_ERROR`. The response adds `quietHours`. | Unchanged bodies still valid |
| `POST /api/notifications` | A delivered notification's body adds `quiet` (boolean). A muted one is unchanged. | Extra key, ignored |
| `GET /api/users/export` | Adds `quietHours` (same shape as the GET) and the four `quiet_hours_*` columns on `user`. | unchanged |

"Local" time: the Settings form saves the browser's own time zone with the times (O-31: dates use the browser's
local time; there is no per-household zone yet). Moving to another zone needs a save from a browser there.

### Morning summary (decision O-40)

One short daily message per member who opts in: in-app (`Notification.type = 'summary'`) and, to a verified address,
email. Stored on `User` as `morning_summary_enabled` (Boolean, `NOT NULL DEFAULT false`: opt-in),
`morning_summary_time_zone` (Text, nullable: the browser's IANA zone saved with the switch) and
`morning_summary_sent_on` (Text, nullable: the local `YYYY-MM-DD` of the last send, the once-a-day dedupe key), added
by `scripts/migrate.js` with `ADD COLUMN IF NOT EXISTS`. Additive and off by default: existing rows and old clients
get nothing new.

Policy: `summary` maps to the opt-in kind `morning_summary` (not a muteable category, not ALWAYS). `deliverNotification`
stores it only when the recipient's own switch is on; `sendOptInMail` emails it only when the switch is on, the address
is verified, the recipient is outside quiet hours and mail is configured.

| Route | Change | Old clients |
| --- | --- | --- |
| `GET /api/users/preferences` | Adds `morningSummary: { enabled, timeZone }`. | Extra key, ignored |
| `PATCH /api/users/preferences` | Body may add `morningSummary: { enabled, timeZone? }` (strict). `timeZone`: an IANA zone the server knows (max 64), or null; missing keeps the saved zone. The last-sent day cannot be set. The response adds `morningSummary`. | Unchanged bodies still valid |
| `POST /api/notifications` | `type: 'summary'` is `400` (only the summary sender creates it). | No browser code sends it |
| `GET /api/users/export` | Adds `morningSummary` (same shape as the GET) and the two preference columns on `user`. | unchanged |
| `POST /api/cron/morning-summary[?tz=<IANA zone>]` | New. Machine-only: `x-cron-secret` must equal `CRON_SECRET` (constant-time); unset `500 { error: 'Cron not configured' }`, missing/wrong `401`; unknown `tz` `400`. CSRF-exempt like the recurring-chores cron (no cookie auth). Answers counts only: `{ success, households: { processed, failed }, sent: { inApp, email }, skipped: { alreadySent, quietHours, nothingToday, noEmail }, failedRecipients, truncated }`. | n/a |

Run rules (`src/lib/morning-summary-server.ts`): opted-in members only, read in pages by id (at most 5000 per run);
each household's rows read once; a household that fails is logged (content-free) and the others carry on. A person's
day is their saved zone, else `tz`, else UTC. Before sending, the day is claimed with a conditional update
(`morning_summary_enabled = true AND (sent_on IS NULL OR sent_on <> day)`), so a retried, overlapping or doubled run
sends nothing more; a send that fails after the claim is not retried that day. Inside quiet hours nothing is sent and
the day is not claimed (a later run that day sends it). No summary when there is nothing to say (not claimed either).
At most 1000 summaries per run; then `truncated: true` and the next run continues. Content rules: `src/lib/morning-summary.ts`
and `ROLE_AND_ISOLATION_MATRIX.md` "Morning summary".

## Household audit history (#285, PR101 D-4)
Additive: one new route and one new export key; no existing request or response changes. Roles:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Household audit history"; decision: ADR-0008.

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/audit?limit=&cursor=` | Parent only; person session only. `{ entries: [{ id, action, actorKind: 'person' \| 'device', actor: { id, name } \| null, targetType, targetId, summary, createdAt }], nextCursor: string \| null }`, newest first (`created_at` desc, `id` desc). `limit` 1–50, default 20; `cursor` is the previous page's opaque `nextCursor`. `action` is one of `feature.turned_on`, `feature.turned_off`, `member.joined`, `member.left`, `board_settings.changed`, `device.paired`, `device.renamed`, `device.removed`, `invite.created`, `invite.revoked`, `beta_metrics.turned_on`, `beta_metrics.turned_off` (#287), `member.removed`, `invite_code.rotated` (O-34); clients must show `summary` and treat an unknown `action` as plain text. `actor` is null for a former member. Rows older than 12 months are pruned before the read. `Cache-Control: private, no-store`. | 400 bad `limit` / `cursor`; 401; 403 teen/child; 403 `DEVICE_WRITE_NOT_ALLOWED` on a paired tablet |
| `GET /api/users/export` (#285) | Adds `auditLog: [{ id, action, actor_kind, actor_user_id, target_type, target_id, summary, created_at }]`, last 12 months: every household row for a parent, only rows the caller acted in for a teen or child. | unchanged |

## Deprecated, duplicate and operator routes (#289, route inventory F-5/F-6)
Nothing was removed. A deprecated route keeps its status codes and bodies; every response adds
`Deprecation: @1790640000` (RFC 9745, 2026-09-29 UTC, `src/lib/deprecation.ts`) and, where a replacement exists,
`Link: <…>; rel="successor-version"`. No `Sunset` header is sent: a removal date is set only after the ADR-0004
review of installed Android clients (which builds still call the route, per request logs and the supported
`versionCode` window) and is written here first. Removal is a separate, reviewed change.

| Route | Status | Contract |
| --- | --- | --- |
| `DELETE /api/lists/items/[id]` | New (REST form) | Parent only; `lists` feature on; the item's list must be in the caller's household. 200 `{ success: true }`; 401; 403 teen/child (`Only parents can perform this action`), lists off, or a paired shared device (`DEVICE_WRITE_NOT_ALLOWED`, before person auth); 404 `{ error: 'Item not found' }` for a missing item and for another household's item alike. Not idempotent-keyed: a repeat is 404. The web list page calls it. |
| `DELETE /api/lists/items/delete?itemId=` | Deprecated, kept | Installed Android builds call it. Same personal transactional helper (`deletePersonListItem`, delegating to `deleteHouseholdListItem`) and the same answers as the REST route, plus 400 `Missing itemId`; `Link` names `/api/lists/items/<itemId>`. Change in #289: another household's item is now the same 404 as a missing one (was 403). A paired device with only its device cookie still gets 401, as before. |
| `GET /api/lists/items?listId=` | Deprecated, kept | No in-app caller (the list page reads on the server); only `e2e/`. Body unchanged (see "Grocery store sections"). |
| `GET /api/admin/imports` | Kept (operator) | Parent only. `{ jobs: [{ id, source_app, source_version, status, dry_run, started_at, completed_at, summary, error }] }`, the caller's household's last 50 `ImportJob` rows, newest first. For operators checking an import (`POST /api/admin/imports/[source]`); no page calls it. |
| `GET`/`POST /api/projects/[id]/tasks` | Wired | "Add task" on an active project's page posts `{ title (1–200), due_date?: 'YYYY-MM-DD', assigned_to?: user id }`; 201 `{ task }` (with `assignee`). Any household member. Since #289 the project and the assignee are looked up with the caller's household: another household's project, or a member of another household as assignee, is the same 404 as a missing one (was 403). 400 on a completed or archived project. |
| `/api/files/[filename]` | Legacy, kept | Serves pre-D3 chore photos next to `/api/files/chores/[filename]`; stays until there is evidence no stored chore or assignment still references a legacy path (D3 contract step, `docs/security/API_ISOLATION_AUDIT.md`). |
| `POST /api/chores/complete`, `PATCH /api/chores` | Unchanged | Status changes on one path: `completeChore` (`src/lib/chore-complete.ts`, also the tablet's complete) and `reopenCompletedChoreInTx` (`src/lib/chore-reopen.ts`, Undo and the verify reject). `PATCH /api/chores` edits details only; its schema drops `status`, `photo_verified` and `verified_*`, so it never changed status. Responses pinned by `src/app/api/chores/__tests__/status-single-path.test.ts`. |

Page: `/dashboard/lists/type/[type]` redirects to `/dashboard/lists?type=<type>` (an unknown type to
`/dashboard/lists`); the web page is served by the server, so installed Android builds follow the redirect.

## Beta usage counts (#287, PR101 D-6)
Additive: one new route, one new `Family` column (`beta_metrics_enabled`, default false) and one new export key; no
existing request or response changes. Existing routes gain a best-effort count after their write commits
(`src/lib/beta-metrics.ts`); it never changes their status or body and never fails them. Roles:
`docs/ROLE_AND_ISOLATION_MATRIX.md` "Beta usage counts"; measurement: `docs/PRODUCT_PROGRAM.md` "How the beta
criteria are measured".

| Route | Contract | Errors |
| --- | --- | --- |
| `PATCH /api/family/beta-metrics` | Parent only; person session only. Body `{ "enabled": boolean }`, **strict** (any other key, e.g. a household id or a metric name, is 400). Sets the caller's own household's switch; `false` also deletes every stored count of that household in the same transaction. A real change adds a household audit line (`beta_metrics.turned_on` / `beta_metrics.turned_off`); repeating the current value adds none. `200 { "betaMetrics": { "enabled" } }`. `Cache-Control: private, no-store`. No `Idempotency-Key` needed: it sets an explicit value, so a retry converges. | 400 invalid JSON or body; 400 no household; 401; 403 teen/child; 403 `DEVICE_WRITE_NOT_ALLOWED` for a paired tablet (before person auth); 404 household gone; 500 |
| `GET /api/users/export` (#287) | `family` adds `beta_metrics_enabled`; adds `betaMetrics: [{ day, metric, count }]` (the household's counts, no `family_id`), for every role. | unchanged |

The Settings page reads the switch on the server for parents; there is no GET route.

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

## Export completeness, analytics days and the event list (server review)
Additive for every client: new export keys, a new optional query parameter, and a narrower default event list
that no in-app or Android caller depends on (the web calendar pages read single events by `?id=`; the e2e
isolation check only asserts that no foreign row appears).

| Route | Contract | Errors |
| --- | --- | --- |
| `GET /api/users/export` | Adds the caller's own rows in per-person domains, current household only, never a `family_id`: `allowances` (paid to them; a parent also gets those they gave), `wishlistItems` (they asked for), `sickDays` and `medications` (about them, any status), `emergencyContacts` (their own card), `anniversaries` (about them or added by them), `pickups` (assigned to or added by them), `pinnedNotes` (they wrote), `choreAssignments` (assigned to, completed or approved by them; no `idempotency_key`), `uploads` (`id, filename, content_type, size_bytes, created_at` of photos they uploaded; no file bytes), `handoffs` (they created; never `share_token`, then shaped like `GET /api/handoff` for the role), `pushSubscriptions` (`id` and dates only: no endpoint, no keys). Parent only (empty array otherwise): `familyLocations` (their own saved places), `budgetCategories` (they created; no `import_metadata`), `calendarConnections` (their own; no tokens, no sync cursor). Parent or teen: `calendarSubscriptions` (they added; no feed URL, `etag` or `last_modified`). A member with no household gets empty arrays. | unchanged |
| `GET /api/analytics?tz=<IANA>` or `?tzOffset=<minutes>` | Days (`weeklyTrend[].date/day`, `summary.mostActiveDay`, `summary.currentStreak`) are the viewer's local days (O-31). `tz` is an IANA zone (validated with `Intl`), preferred; `tzOffset` is `Date#getTimezoneOffset()` (minutes, positive west of UTC). Without either: UTC days, as before. Rates (`summary.totalChores/completedChores/completionRate`, `memberParticipation`, `topPerformers`, `difficultyDistribution`) cover chores due in the last 90 days up to now, plus chores completed in that window; a chore that is not due yet (e.g. a generated future occurrence) is no longer in the denominator. The streak looks back up to 90 days (was 30). The web Analytics page sends `tz`. | new: 400 `{ error: 'Invalid time zone' }` for an unknown zone or an offset that is not an integer within ±16 h |
| `GET /api/events` (no `id`, no `upcoming`) | Was the household's 100 **oldest** events ever. Now events whose `end_time` is no earlier than 30 days ago (ongoing and recently finished ones included), oldest start first, at most 100. `upcoming=true` (events starting from now) and `?id=` are unchanged. | unchanged |

Tests: `src/app/api/users/export/__tests__/personal.test.ts`, `src/app/api/analytics/__tests__/local-days.test.ts`,
`src/app/api/events/__tests__/list-window.test.ts`.

## Bounded calendar planning reads

`GET /api/events?start=<instant>&end=<instant>[&limit=<integer>][&cursor=<opaque>]`
is an opt-in person-session read for future Day/Week/Agenda clients. Existing
nonempty `id` takes precedence and ignores all other query parameters, including
malformed range/paging parameters. Without any `start`, `end`, `limit` or `cursor`,
legacy default/upcoming behavior and the `{ events }` envelope are unchanged.

- Authentication and current household membership are unchanged; parent, teen
  and child person sessions retain existing GET access. This is not a paired-device API.
- Both bounds are required: `YYYY-MM-DDTHH:mm:ss[.S|.SS|.SSS]Z` or the same with
  `±HH:mm`. Use URL encoding for `+`. Calendar-invalid dates, date-only strings,
  missing offsets, leap seconds and silent rollover repairs are rejected.
- `start < end`; at most 45 elapsed days. The start is inclusive and end exclusive.
  Clients compute viewer-local day/week boundaries with calendar arithmetic and
  send explicit instants; DST days need not be 24 hours. No timezone is inferred.
- Include starts inside `[start,end)` (including zero-duration events), plus
  events starting before `start` whose end is strictly after `start`. An event
  ending exactly at `start` is excluded unless its own start is inside the range.
- `limit` is a decimal integer 1–200, default 200. The database reads at most
  `limit + 1`; responses contain at most `limit` events. Duplicate range/paging
  parameters and any `upcoming` parameter combined with range mode are 400.
  `limit` or `cursor` without both bounds is also 400.
- Range-mode response: `{ events, nextCursor: string | null, hasMore: boolean }`.
  `hasMore` explicitly signals page truncation; fetch `nextCursor` until null
  before treating the range as complete. Event fields, creator provenance and
  household-scoped ICS `source` attachment are unchanged. No private provider
  metadata is queried or attached.
- Order is `(start_time ASC, id ASC)` with keyset continuation after the last
  returned tuple, not an offset or cursor-row lookup. Pass the same interval
  with every page; equivalent offset spellings of the same instants are valid.
  Page size may change. Cursor context is versioned and validated against the
  current household and canonical interval; malformed/mismatched cursors return
  400 `{ error: string }` before an event query.
- Cursors are opaque client bookmarks, not signed authorization tokens. A
  caller-crafted well-formed tuple can skip its own rows but cannot widen the
  household/range predicates or resolve foreign records. Deleting the boundary
  row does not break continuation. Reads are not a frozen snapshot: edits or
  inserts between pages can move events; refresh from page one after changes.
- Only stored concrete events are returned. No local RRULE expansion, attendees,
  all-day classification, source filters or schema changes are introduced.

Tests: `src/app/api/events/__tests__/range.test.ts` and
`src/lib/calendar-planning/__tests__/range.test.ts`, alongside existing event
legacy/isolation/import tests.

## Testing
Contract tests should cover validation, happy path, unauthorized/forbidden, foreign-family IDs, not-found semantics, duplicate retry, concurrency conflict, pagination and old-client fixtures when relevant.

## Versioned personal list field edits (#135)

`PATCH /api/lists/items/edit` is additive, person-session only and lists-feature gated. It requires
an `Idempotency-Key` (action `list-item.edit`, scope `user:<id>`) and a strict body:
`{ itemId, expectedUpdatedAt, content, quantity }`. The item ID uses the existing canonical shape;
`expectedUpdatedAt` is the ISO server `updated_at` read with the item, content is trimmed to
1–500 characters, and quantity is an integer from 1–9999. No unchecked toggle, notes, price or
caller-assigned new timestamp is accepted. The browser exposes it for grocery/shopping rows;
the route preserves the existing owned-list edit permission for all member roles/list types.

Current authentication, feature state and item ownership/existence are checked before replay.
The canonical writer repeats ownership and checks the precondition under its item row lock.
A changed version returns 409 `LIST_ITEM_CHANGED` with no current household values; deleted items
return 404 and are never recreated. Successful retries replay the stored response, not another
write. A replay may describe an older row, so clients refresh canonical data on confirmation.
409 is not retained as success; adopting a newly read version starts a new key/intent.

The existing `/api/lists/items/update` accepts the version precondition optionally, keeping old
installed tick clients compatible. All canonical item writes advance a server-owned monotonic
millisecond `updated_at`; unchanged ticks retain it. The editor persists no draft and registers
no offline edit action. An uncertain save retains its exact body/key in memory for explicit retry;
closing it refreshes the list. No new schema, provider or native cold-start guarantee is introduced.

## Open personal list version (#135)

`GET /api/lists/:id/version` accepts a person session in the list's household, all existing member
roles, and the lists feature. A missing/foreign/invalid list is the same 404. The result contains
only `{ version }`, an opaque SHA-256 digest of canonical list identity/version and sorted item
identity/server-version membership. It returns no names, content, counts, credentials or private
DTO. The full projection detects older-row updates and equal-count replacements that a maximum
updated-at timestamp would miss. It is a read; no new domain/schema or item write is introduced.

The response is private/no-store. The per-member rate limit is 1,200 checks/hour across lists;
429 includes Retry-After. The personal detail uses the existing bounded 25-second visible/online
poller, coalesces refreshes, checks on reconnect/visibility, and keeps its 15-minute full refresh.
401/403/404 stop checks and request a canonical page refresh. Temporary failures retain the
snapshot and use the existing stale/offline notice. An in-flight result after unmount cannot refresh
another view. Server page and endpoint use the same digest function; old clients need not call it.

Canonical deletion removes a normal row. If it has a queued tick, an explicitly labelled, disabled
recovery row remains until retry/conflict/discard resolves that operation; it is excluded from the
canonical progress count and cannot be edited, moved or recreated. Current checkbox intent overlays
refreshed server data. Related recipe/member/section labels use the slow refresh; no fleet, native
restart, provider or production acceptance is inferred from this bounded browser propagation.

The recovery row above uses a previously rendered item. Generic recovery for a deleted queued item
whose list/content is unknown after a full browser restart remains a separate #135 follow-up; no
new title/list context was added to the persisted checked-action payload in this slice.


### Event creation replay and capture (#472)

Terminal receipt reconciliation retires the matching mounted text/photo proposal as well as its recovery envelope. A deleted, opaque, absent, expired or conflicting result cannot leave that original Add control actionable; a new preview receives a new operation identity. Unrelated newer previews and remaining photo rows retain their identities. The existing atomic event and grocery Postgres suites run in the protected database gate against a fixture-guarded disposable database.

`POST /api/events` accepts an optional `Idempotency-Key` (`event.create`). Authentication and event validation precede replay. Older clients without a key keep distinct deliberate creates and the existing `{ event }` response. Event, activity and completed response commit in one transaction under the receipt row lock; overlapping lock takeovers recheck completion before writing. Failed completion rolls back the event. Replay after an event is deleted returns the historical receipt without resurrecting it; refresh the Calendar for current state.

Capture retains one key and frozen payload per confirmed preview/photo row, including partial batch and unknown-response retries. Event capture uses the existing atomic event writer. Grocery capture uses the additive `POST /api/capture/grocery` writer, which resolves the household default list and creates the item in the same keyed transaction; the ordinary default-grocery and list-item routes remain unchanged for existing clients. The browser keeps only a six-day, per-user/per-family envelope containing the normalized write body, key/hash and display title; prompts, source photos, provider output and credentials are never stored.

After a reload, `GET /api/capture/receipt` accepts `Idempotency-Key`, `X-Capture-Action` (`event.create` or `capture.grocery.add`) and `X-Capture-Request-Hash` headers; fingerprints are not placed in the URL. It returns only `absent`, `pending`, `expired` or `committed` plus a family-scoped `present|removed|unknown` state. It never returns the stored receipt body and is private/no-store. Recovery is explicit: the browser does not auto-submit; Check status reads this endpoint and Retry replays the same keyed body through its original writer. A committed row that was deleted stays deleted, while a missing/expired/conflicting receipt is removed from the local envelope and asks for a new preview. Confirmed operations older than six days refuse retry before the seven-day server retention expires.

Changed payload keeps the established `422 IDEMPOTENCY_KEY_REUSED` contract (rather than adding a route-specific 409); in-progress work retains `409 IDEMPOTENCY_IN_PROGRESS`. The #472 acceptance wording is reconciled with this pre-existing canonical contract. No global idempotency codes, schema, role rules or scheduler change.

Recovery storage is a safety precondition for a confirmed capture write. If
identity activation, recovery read, or envelope persistence cannot be confirmed
(for example quota/private-mode failure), the client keeps the draft/photo row
and its generated key/body, shows localized retry-storage guidance, and sends no
event or grocery POST. A later explicit storage revalidation may persist the
same envelope and let the person confirm again. An authenticated refusal or
`allowed: false` response is a recovery boundary: in-memory rows and identity
are cleared and the active/identified private namespace is purged when
possible. If that purge cannot be confirmed, the client keeps a logical
refusal and does not expose Check status/Retry; it does not claim physical
erasure. These boundaries do not change server authorization, receipts,
request validation, or automatic submission behavior. The same synchronous
boundary applies when preview, event/grocery mutation, receipt status, or a
recovery Retry returns `401`/`403`; Check status and Retry require fresh
authenticated availability plus a verified recovery store before making a
request. A partial photo batch reports confirmed successes separately from
remaining rows that were blocked, so storage/access failures never claim that
nothing was sent after an earlier success.

## Personal display preferences (#560 / #561)

The additive account/default APIs and revision-conflict contract are defined in
[DISPLAY_PREFERENCES.md](DISPLAY_PREFERENCES.md). Personal preferences are not
household feature flags or paired-fridge settings. Existing notification
`/api/users/preferences` bodies and behavior remain unchanged. New direct APIs
refuse paired devices and derive actor/household scope from the current session.
Implementation is local; consolidated migration/API/rendered QA is deferred.

## Durable routine schedule foundation — 2026-10-20 (#450)

`../plans/routine-schedule-v1.md` / `routine-schedule.ts` define a strict future
command/storage vocabulary, canonical root identities, shared date-only schedule,
explicit removal and future-after-today controls. This is source preparation,
not an HTTP/offline/public capability. Nullable RoutineStack.schedule_config and
Chore root definition/cue/duration fields are authored, ungenerated/unapplied.
Before runtime writing, dedicated parent state/replay authorization, ordinary
read metadata stripping, atomic receipt/config/copy changes, canonical expander
and legacy-write guards, exact owned recovery and rollback-ready support must
be implemented and later accepted. Current-occurrence endpoints stay unchanged.
Parent export includes definitions; non-parent export strips root control JSON.

Routine continuation (2026-10-20): canonical parent coordinator/read functions
are authored but unrouted. Original viewer zone/day, fifteen-minute first-effect
age, current parent/session/household/profile/feature authority, stack version
and original keyed compact receipt bind future operations. Definition support /
fresh-write flags remain off. Ordinary chore JSON/page projections strip private
metadata and legacy root writes hold under lock. Recurrence holds rather than
ignores non-null metadata. Adapter/anchor actions/recovery/routes/UI and QA remain
open; no public or offline capability is added. See routine-schedule-v1 plan.


### Captured chore create recovery (2026-10-22, source; unverified)

`POST /api/chores/create` additionally accepts an optional `Idempotency-Key` for
account assignment (`chore.create`). Existing unkeyed requests remain distinct
creates; ordinary keyed/unkeyed clients receive a fresh authorized `{ chore }`
projection. The canonical chore/series and minimal `{ choreId }` receipt commit
in one transaction under actor/assignee/household then receipt locks. Takeovers
re-read completion, so a committed effect is never repeated. Bound owned-review
requests receive only the pointer and preserve their original wire body/key.
Profile requests retain their existing required-key `chore.profile.create`
protocol-2/gated path; bound requests opt into compact pointers. No schema change.

`GET /api/chores/create/receipt` requires a current parent person session plus
`Idempotency-Key`, `X-Chore-Create-Action` (`chore.create` or
`chore.profile.create`) and a 64-character lower-case hex `X-Chore-Request-Hash`
computed from canonical parsed input. The endpoint renews token generation,
parent role and household under membership locks before reading the same user
scope/family/action/hash. It is private/no-store and read-only. Responses contain
only `{ state: absent|pending|expired }` or
`{ state: committed, current: present|removed|unknown }`; erased subjects count as
removed, unrecognized/non-success receipts as unknown. Conflicting action/hash
returns409, invalid headers400, unauthorized/revoked401, wrong role/household403;
profile capability withdrawal holds profile receipt access409. No title, assignee,
points, routine, body or original receipt is returned. No background retry/pruning.
Runtime/API/isolation acceptance remains pending consolidated QA.


### Parent change timeline (2026-10-22 source; acceptance pending)

`GET /api/review/timeline?source=all|coordination|settings&cursor=<opaque>` is
person-parent only. Paired sessions are refused by canonical authentication;
child/teen receive403. The reader locks the current user/household and renews
family, parent role and session generation before any history query. Unknown or
duplicate parameters, invalid/oversized/filter-mismatched cursors return400;
retired session401, changed role/family403, unavailable read500. Every response
is private/no-store. Family/actor authority is never accepted from query values.

200 returns `{ owner: { userId, familyId, generation }, source, entries,
nextCursor }`. Entries contain a bounded local stream/row ID, fixed `action`,
ISO `at`, current actor name/kind or explicit unknown/tablet attribution, fixed
`origin`, optional registry-validated `featureKey`, current canonical `title`
and `target`, and `current: available|unavailable|unknown`. The target is a typed
Event/Chore/Recipe/Pickup/Handoff/settings reference, never a saved/provider URL.
Clients construct canonical links; each destination renews permission and owns
its supported reversal controls. This endpoint never offers a generic Undo.
Missing/erased/foreign record references expose no historical name, private note,
raw metadata, cached snapshot or link. Historical Activity titles/descriptions and
AuditLog summaries are excluded. Handoff private content is not selected.

Activity and AuditLog each read at most21 candidates within a one-year horizon;
the merged20-candidate page uses stable per-stream ordering and timestamp/ID
continuation. Filtering can leave an empty page with a continuation cursor. This
is not proof that no changes exist. There is no prune, cache, replay, provider or
new persistence model. Current-source projection and client owner/epoch checks
remain separate from the API's authenticated authority.

New private coordination facts commit inside existing chore/recipe/preparation/
schedule/responsibility effects and their receipts; completed replay creates no
second fact. Their types stay excluded from older member Activity and Analytics
feeds, and new completion actor/target markers are masked in the older Activity
DTO. Existing own-Activity export and erasure still apply. Source/helper/API/
privacy/pagination/component and replay cases are authored, all unrun. Consolidated
Postgres/isolation/role/device/browser/localization/release gates remain pending.

## Optional shared preparation labels (source, 2026-10-22)

The canonical Today board DTO may include `sharedPreparationContext`, keyed only
by task IDs already resolved into its `chores` window, with values `{ eventTitle }`
(max512 characters). The existing preparation readiness/schema/domain gates
apply. Protocol1 permits current account subjects; email-free profiles require
protocol2 and the existing profile readiness gate. No parent relationship maps,
plan/event/routine IDs, cues, notes, tokens, private proof or new write capability
are exposed. This field joins only same-household canonical records and is part
of the ordinary board version hash. Older clients may ignore it. The current
offline cache allowlist deliberately strips it and cached UI omits its labels.
No cache schema, API route, migration, polling or activation is added. Source
cases are authored/unrun; integrated QA and release gates remain open.

## Personal chore preparation context (source, 2026-10-22)

`POST /api/chores/preparation-context` is a private/no-store read, not a mutation
or queue action. Strict body `{ ids: string[] }` accepts1–150 unique canonical task
IDs; no supplied household/profile/owner authority. Current parent/child/teen
person auth, family and token generation renew under canonical membership locks.
Response contains `owner { userId,familyId,generation }`, `state` available/paused,
`backlinks`, `origins` and `ownContext`. Only parents invoke backlink/origin
readers. Child/teen responses contain empty parent maps and own-account shared
event titles only; no event/plan/routine IDs, cues, source tokens or private
content. Missing ownContext defaults to empty for additive compatibility. Current
source checks do not grant canonical write authority. Repeated150-ID client
batches remain in memory, clear on lifecycle/identity changes, and retire on
owner/session replacement. Paused/schema-unavailable projections are empty.
Source cases are authored/unrun; integrated QA and release remain outstanding.

## Optional assistant references (source, 2026-10-22)

Explicit person Include Today requests may advertise header
`X-Assistant-References: herewoven.assistant-references.v1`. Only with the private
`FAMILY_ASSISTANT_REFERENCES_READY=1` gate does the provider receive the separate
opaque-reference block and use the reference-aware typed reply. Existing Today
readiness/provider/role gates remain. No body field or client-selected record
authority is added. Nonadvertising clients retain the exact v1 reply; rollback
servers may ignore the header. New clients accept the v1 reply.

After current source renewal, the server may append optional `evidence` (max8)
with `{ref,kind,label,observedAt,href}`. All labels/routes resolve server-side from
issued current references; providers cannot supply them. Unknown refs fail502,
changed/expired sources fail409 without old reply/evidence. Citations are
presentation, never mutation tokens; canonical actions retain their own target
authorization/confirmation. Active Today lease is required for source links in
the chat; citation objects are excluded from subsequent chat request messages.
Source/schema/catalog/transport/UI cases are authored/unrun. Gate stays off;
confirmed-plan grounding, eval/cost gates and consolidated release QA remain open.

## Parent AI usage controls (source, 2026-10-22)

`GET /api/family/ai-usage`: current authenticated parent-person only, private/
no-store, membership/session renewal, explicit paired-device refusal. Adoption is
required; missing storage is503. Returns strict owner, readiness/pause, policy and
revision, reviewed provider fingerprint/live sanitized label, current month/day
and at most31 UTC daily aggregates. No per-user calls, prompts, replies, source
records, credentials or full URLs are exposed. Unknown tokens/costs are explicit.

`POST`:8KiB strict `{owner,expectedRevision,configVersion,policy}` with bounded
enabled/daily limits, nullable integer micro-USD month estimate limit and both
input/output rates per million tokens. Current identity/provider and revision
conflicts require refresh. No provider/key/model/subscription change or provider
call occurs. Source cases are unrun. See `AI_USAGE_CONTROLS.md`.

Assistant/capture request/reply bodies stay compatible; their server-owned
controllers meter the shared provider transport only after opt-in. Both usage
gates are required; rollback adoption persists while calls pause. Partial opt-in
never falls back to legacy unmetered calls. Quota/readiness/source holds use429/
503/409 safe errors. Normal deterministic app work remains independent. The new
independent provider kill switch does not erase settings. No activation occurred.

## Request-body bounds and response tightening (security review, PR #591)

| Route | Contract | Errors |
|---|---|---|
| `POST /api/upload` | Multipart body is read through `readBoundedFormData` (`src/lib/bounded-body.ts`) and abandoned once it passes 6 MB (one 5 MB photo plus framing), whether or not `Content-Length` is sent. A declared length over the bound is refused before reading. | 413 `File too large`; 400 not form data |
| `POST /api/capture` | JSON body bounded the same way at the base64 image limit plus 64 KB. | 413 image too large; 400 `Invalid JSON` |
| `POST /api/capture/grocery` | JSON body bounded at 16 KB. | 413 `Request is too large`; 400 `Invalid JSON` |
| `POST /api/admin/imports/[source]` | JSON body bounded at 10 MB while reading. | 413 `Import payload exceeds 10 MB`; 400 `Invalid JSON` |
| `POST /api/budget/transactions`, `PATCH /api/budget/transactions/[id]` | `amount` is positive (direction comes from `type`), 0.01 to 100,000,000, at most 2 decimals. | 400 |
| `POST /api/allowance` | `amount` is positive, at most 1,000,000, at most 2 decimals. | 400 |
| `PATCH /api/family` | Only `name` is writable; a sent `subscription_tier` is ignored. Returns `{ family: { id, name, subscription_tier, created_at, features } }` — never the feed token, invite code or AI settings. | unchanged |
| `GET /api/calendar/feed` | `Cache-Control: private, max-age=300` (was `public`): the feed is guarded only by its URL token, so shared caches must not keep it. | unchanged |

## Login wrong-password lockout (security review follow-up)

`POST /api/auth/login` counts wrong passwords in two windows of 15 minutes (`src/lib/login-lockout.ts`): 10 per account and client address (`login-fail-ip:<ip>:<email>`), and 50 per account across all addresses (`login-fail:<email>`). Either one at its limit answers 429 with `Retry-After` before the password is checked. Previously a single 10-failure account counter let anyone who knew an email lock its owner out from everywhere; now one address only locks itself out. A successful sign-in clears both counters for that address and account. Tablet password elevation still shares the account counter at the same limit of 50, on top of its own per-tablet limits.


## Additive list-summary pagination (#134, source authored 2026-10-22)

`GET /api/lists?limit=1..200&cursor=...&type=...` opts into bounded list
summaries: `{lists, nextCursor}`. Summary fields and canonical item counts/creator
projection remain unchanged. It reads at most limit+1 summaries; `nextCursor` is
null only when no extra row was observed. Follow the cursor deliberately to read
more. Do not treat a partial page as all household lists.

Paged order is immutable creation time descending then ID ascending. Checking
items or renaming a list therefore does not move it across a page boundary.
Without `limit`, the legacy complete `{lists}` response and updated-first order
remain; no existing installed caller is silently capped. Both successful response
forms are private/no-store. Existing auth/household/feature checks still apply.

The versioned canonical base64url cursor binds the current family and normalized
type filter (absent/empty means all) plus the last creation time/ID. It is a read
position, not an authorization proof or snapshot. Each request applies current
auth and family filters independently; deleting the anchor does not prevent
continuation. New lists created ahead of the cursor require refreshing from the
first page. Filter/household changes must start a fresh first page.

Malformed, noncanonical, overlong, wrong-version/family/filter cursors, cursor
without limit, duplicate paging/type parameters and limits outside1..200 return
400. Legacy arbitrary type filtering remains compatible; opted-in type scope is
bounded to128 characters. This source is not yet connected to the server-rendered
Lists overview or list-item detail. Legacy reads remain unbounded. No schema,
index, mutation, capability or infrastructure change. All QA remains deferred.


### Connected web overview (2026-10-22 source follow-through)

`/dashboard/lists?type=&cursor=` now uses the same position contract internally
with100-row pages and explicit Next/first navigation. Its server reader retains
current actor generation/role/family checks and derives counts within one
repeatable-read snapshot. Type counts group only the six fixed known types;
item progress groups only the at-most100 displayed IDs. Type filters are applied
to the household query before paging. Continued empty pages never mean an empty
household. The existing canonical API remains optional for installed callers;
this server view does not fetch the unbounded no-limit API.

Detail links carry `overviewCursor` separately from any item pagination. The
server validates its family/type before Back/deletion return links use it; it is
only a read position, never an arbitrary return URL. Invalid context falls back
to the first page for the filter. Creation returns to the first page. List-detail
item reads remain unbounded at this checkpoint. Source only; QA deferred.


### Item pages and matching version positions (#134/#135, 2026-10-22 source)

The deprecated `GET /api/lists/items?listId=&limit=1..200&cursor=` now optionally
returns `{items,nextCursor,sectionSort?}`. Legacy no-limit callers retain complete
items and checked/position/creation ordering, no nextCursor key, the existing
household/feature checks and deprecation headers. Paged order is position, creation
time and ID ascending; checking a row does not move it. Cursors bind family/list
and the exact last position/time/ID. Malformed/noncanonical/overlong/wrong-version/
list/family/duplicate paging params, duplicate paged listId or cursor without a
valid limit produce400. Successful responses are private/no-store. A cursor is a
read position only; concurrent position changes require a fresh traversal.

The web detail uses the same contract internally with100 rows+lookahead and an
explicit `itemCursor` route parameter, separate from `overviewCursor` return
context. New server snapshot renews actor generation/role/family and resolves
only page section metadata. Partial page progress/grouping and continued-empty
copy are explicit. A missing partial row is unknown, never proof of deletion;
existing owner-scoped pending tick recovery remains independently reachable.

`GET /api/lists/[id]/version?limit=&cursor=` optionally hashes that same bounded
page+lookahead. Legacy unpaged hash contracts remain. Initial web hashes and page
polls use the exact same rows; changing page invalidates outstanding poll replies.
No new cached private DTO, automatic replay, schema/index or mutation authority.
Legacy no-limit reads/version hashes stay unbounded, not silently truncated.
Source authored only; compatibility/permission/sync/DB/rendered acceptance awaits
consolidated QA, as detailed in WEB_IMPLEMENTATION_HANDOFF.md.


## Project summary read paging — #134, source 2026-10-24

`GET /api/projects?limit=24[&cursor=...][&status=active|completed|archived]`
opts into additive summary paging. Limit is1–100; repeated limit/cursor/status
parameters, malformed/noncanonical cursors, a cursor without limit, an unknown
paged status or a cursor from a different current household/status scope returns
400. Cursor contents are bounded protocol metadata and a read position, never
authority: every request authenticates, derives its household and checks Projects.
A cursor preserves creation timestamp/id position even if that row was deleted;
it does not grant access to a supplied household or require a lookup by cursor ID.

Paged response is `{ projects, nextCursor: string | null }`. Unpaged callers
retain `{ projects }`, original invalid-status fallback and no truncation; that
legacy read remains unbounded until explicitly migrated/retired. Responses are
private/no-store. Stable paged order is created_at DESC, id ASC. A concurrent
rename/status update is not a creation-order change; this is keyset continuation,
not a transactionally frozen whole-household snapshot. Refresh newest for a fresh
view after relevant changes.

The web overview opts in at24 rows and offers older/newest navigation. Empty
later pages and invalid positions have distinct copy rather than a false global
empty state. Only the returned project IDs participate in one family-scoped task
aggregate grouped by project_id/completed, yielding at most two counts per
project. Total/completed counts share that aggregate statement; task IDs/bodies
are not materialized for progress cards. Project detail/task writing is unchanged.

Existing family/status/project-task indexes remain; no claim is made that limit
alone bounds DB scan/sort work. Evaluate a family/created_at/id index and a
status-prefixed variant against representative query plans before a separate
additive migration. Current/previous client, concurrent paging/deletion,
permission/feature changes, malformed cursor, large-household query plan and
rendered keyboard/phone/tablet acceptance remain unexecuted. No runtime or scale
result is claimed for this authored source.


## Personal notification read paging — #134/#141, source 2026-10-24

`GET /api/notifications?limit=50[&cursor=...][&unread=true|false][&includeSnoozed=true|false]`
opts into stable created_at DESC/id ASC continuation. Limit is1–100. The bounded
cursor carries its protocol, current authenticated user, both filter choices and
position. Repeated paging/filter values, malformed/noncanonical/cross-user or
changed-filter cursors are refused; a cursor without limit is invalid. A cursor
is a read position, never authentication/household authority. The personal user
predicate stays separate from the combined snooze-window and position predicates.

Paged response is `{ notifications, nextCursor: string | null }`; no-limit
callers keep their previous50-row `{ notifications }` response and snooze/unread
behavior, without new required fields. Successful reads are private/no-store.
No write, notification/provider policy, schema or offline allowlist changes.
The original named personal/API authorization and paired-context boundaries
remain the authority; paging metadata cannot grant account access.

The web inbox requests50 at a time and explicitly loads older pages. It keeps
loaded rows on an older-read failure, retains the exact continuation for retry,
deduplicates IDs while retaining newer local read/snooze/Undo state, and filters
pending deletes. Current-cycle guards discard late results after refresh/unmount.
Reads settle after15 seconds even when abort is ignored; a late result has no
state callback. Cycling/nonadvancing cursors and empty continuing pages are
refused. Keyboard-initiated continuation preserves control/status focus without
stealing focus from someone who moved elsewhere.

Until all supported pages are loaded, unread/empty text and the scope hint refer
to loaded notifications, not a complete caught-up inbox. A rolled-back server
without nextCursor can still show its latest rows, but gets explicit unsupported
paging/refresh copy rather than a false complete state. An unsupported older
response never replaces loaded rows or silently discards the continuation.
Counts remain a view of loaded rows, not fleet/delivery telemetry. A concurrent
new notification is discovered on refresh, not by claiming a frozen snapshot.

Original mark-read, snooze/expiry/Show now, deferred Delete/Undo and notification
preference paths stay canonical. Fresh authorization, duplicate/overlapping
pages, load/write races, timeout/unmount, old-server recovery and EN/ES
keyboard/phone/tablet journeys remain unexecuted. Evaluate a user/created_at/id
index against representative query plans before a separate migration; the row
limit alone is not a bounded-DB-work or scale proof.

## Wishlist continuation and row recovery — source 2026-10-24 (#134)

`GET /api/wishlist` still returns the full `{items}` contract and original
created-descending ordering when no paging arguments are present. This legacy
exception remains explicitly unbounded. New opt-in `limit=1..100` returns at most
limit rows plus `nextCursor: string | null`, reading limit+1 internally. Paged
order is created_at DESC, id ASC. Cursor positions bind version, authenticated
household and requester filter; lexical canonical base64url and strict tuple
validation reject malformed/duplicate/cross-scope positions. They confer no
access and do not choose household ownership.

Optional `mine=true|false` requires limit. True filters requested_by to the
current authenticated user **before** paging; false/absent retains household
read scope. Duplicate/invalid mine, limit and cursor parameters refuse with400;
cursor requires limit. The existing family authentication/shared-device and
Wishlist feature guards precede data reads. No writer permission changed.

`GET /api/wishlist/[id]` adds one canonical household-scoped row read with the
same guards and existing requester/status-changer projection and Decimal string
serialization. Missing/foreign IDs return404, not foreign data. It is used only
to inspect a mutation target absent from loaded pages; a present canonical
collection row is reused without a redundant row query. Page absence cannot
prove deletion or a failed save. Successful collection/row and missing-row
responses are private/no-store. Existing writes/receipts are unchanged.

The web requests24 per page, server-filtered own wishes for child/teen and
household wishes for parents. It loads more only on explicit action, keeps the
same cursor on error, rejects repeated cursors, deduplicates concurrent-page IDs
and re-reads only viewer-loaded depth after a write. Per-read body/transport
has a15s timeout, generations suppress obsolete/unmounted read application, and
background page refresh blocks concurrent continuation. These are authored
controls, not measured latency or rendered behavior.

Loaded-only summaries/empty copy, EN/ES continuation and guarded focus recovery
avoid claiming unloaded data is absent. An older server that ignores paging
retains its legacy response; missing continuation metadata is treated as unknown
coverage. The new row inspection may fail against that older server, keeping
recovery unresolved rather than inventing proof. No offline/backend copy,
migration, index, background work or household write was introduced.

No QA executed. Route/paging source cases and original Wishlist UI mock URL
adoption are authored. New UI source cases cover explicit continuation, retrying
the same failed cursor, child mine requests and target-read contradiction of
page absence during delete recovery. None ran. Real query plans,
concurrent changes, role/session/feature transitions, old/current server/client
matrix, all write/recovery cases and rendered behavior remain unverified.

## Legacy import authority renewal — source 2026-10-24 (#104)

The existing parent-only POST /api/admin/imports/[source] success/body contract
is unchanged. Dispatch now carries auth.payload.tv (legacy missing claim ->0)
as an internal sessionVersion option to persisted importers; no client field
controls it. All three writers renew original household/current-parent/mapped
user authority under ordered User advisory locks, household lock and ordered
User row locks before creating a job and again before canonical effects. A stale
session returns401 with code SESSION_CHANGED; existing identity conflicts retain
409 IDENTITY_CONFLICT. Core parent/shared-device guards still run before import.
Internal non-HTTP callers can omit sessionVersion but not current parent/household
and mapping validation. Pure dry-run plans remain non-writing, not review receipts.

Operational failure updates are exact family/source/job + status running under
household lock. They cannot recreate deleted jobs or overwrite completed status;
fixed diagnostics avoid raw exception data and accounting failure does not hide
the original refusal. No schema/client payload change, automatic retry, background
work or provider. See plans/import-review-ui.md for exact source and remaining
review-snapshot, real PG/concurrency/deletion/replay/reconciliation/rollback and
compatibility acceptance. Source cases authored/unrun; no QA/import executed.

## Import reviewed-scope precondition — source 2026-10-24 (#104)

Opt-in request `reviewProtocol: 1` adds `review: {protocol: 1, actorId, familyId}`
to the existing import result, derived from the authenticated caller. A persisted
request using that protocol must include strict `expectedScope: {actorId,
familyId}`. Missing scope ->400 IMPORT_REVIEW_REQUIRED; either ID different from
current authentication ->409 IMPORT_SCOPE_CHANGED before dispatcher/mapping
reads. Scope never chooses a target or grants access. The writer still uses the
authenticated original family and renews parent/mappings/session under locks.

Legacy callers without reviewProtocol keep their original success response shape
and existing write path; this is an explicit compatibility exception. Supplied
expectedScope is always checked, including for legacy requests. Invalid protocol,
scope shape/IDs refuse400. Opt-in success is private/no-store. This is an intent
precondition, not a signed proof that source bytes or target state were reviewed.

The new web requests protocol1, freezes returned actor/household in its exact
reviewed persistence body and consumes local approval on a refusal as on other
write outcomes. Scope IDs are excluded from its reconciliation JSON display.
New web against an old server lacking metadata cannot enable persistence and
shows a localized refresh/review message; it does not silently downgrade. Current
API can serve legacy clients unchanged. No schema/store/secret/provider action
or automatic retry added. Source cases authored/unrun; exact current/previous
server/client, account/household switch, lifecycle/PG and original import
reconciliation/rollback acceptance remain open.

## Note mutation lifecycle follow-through — 2026-10-24 (#134/#136, source only)

Existing `PATCH/DELETE /api/notes/[id]` request bodies and successful response
shapes remain. Both now delegate to `person-note-mutation.ts`: User then household
locks, exact current role/session/membership, stored Notes feature permission
protected by a Family share lock, then owned PinnedNote row lock and creator
re-read before a scoped write. Parents edit any owned-household note; teen/child
edit only their own; deletion stays parent-only. Device refusal and outer route
checks remain. A missing/foreign locked target returns the same404 rather than
serializing another household's record. Results from the effect are private/no-store.

`person-content-authority.ts` extracts the existing list-container/note base
check without changing create/replay policy. Creation and note edit/delete reuse
it; per-record/action policy remains in the domain mutation. Body trimming and
unknown-color-to-yellow behavior are preserved. No new client authority field,
schema, queue action, assistant command, provider or activation was added.

This closes an unprotected read-then-write source gap, not all multi-device edit
semantics: absolute-field writes remain last-writer behavior, without a new
optimistic version, delete receipt or Undo. Lost responses still need canonical
reinspection. Current authority/feature/creator/range decisions, two-household
isolation and paired-device tests are authored/adapted but unrun. No API/database,
test/check/build/browser/native/provider or release was executed; mock transactions
do not prove actual PostgreSQL isolation, rollback or deadlock behavior. Full
#134/#136 acceptance remains open.

### Personal list-item deletion authority — 2026-10-24 (#134/#135, local source)

Both REST and deprecated installed-client delete routes now renew current personal
session generation, role, household and list-feature permission under User then
household locks in the canonical delete transaction. Parent-only authorization
precedes a scoped item row lock and the shared delete primitive; its final delete
predicate repeats list household ownership. Missing/foreign/repeated deletion is
still404. Existing outer refusals and legacy deprecation headers remain; successful
transactional responses use private/no-store. No offline queue, keyed receipt,
tombstone/Undo/schema or new device permission. Generation/role/household-change
race cases for both routes authored/unrun. PostgreSQL contention/rollback/isolation,
installed-device and original full acceptance remain unverified; no execution or
release occurred.

### Legacy member Activity opt-in continuation — 2026-10-25 (#134/#135, local source)

`GET /api/activity?paging=keyset-v1[&limit=1..100][&cursor=...]` adds explicit stable
continuation for compatible clients. Default opt-in limit30; response includes
`activities` and `nextCursor` (null at the observed end). Reads use limit+1 and
`created_at DESC, id ASC`; opaque base64url cursors carry a fixed version, the
original household, canonical UTC timestamp and ID. They are positions, not
credentials; ordinary current member authentication/household filtering still runs.
No query fetches the pivot row, so deletion does not invalidate its position.
Duplicate/invalid mode/limit/cursor, noncanonical encoding/date, or different-
household cursors get400 before read-side housekeeping/database feed queries.

No `paging` keeps installed legacy behavior: limit defaults30/clamps1..100, the
old timestamp-only cursor and activities-only response. Its same-timestamp skip
limitation is retained for compatibility; clients must opt in to the new contract.
Existing all-member projection, legacy analytics/private-timeline type exclusions,
parent timeline-marker masking and private/no-store successful responses remain.
No new role/device permission, metadata field, web surface or changed parent inbox.
No current web caller was found in this source inspection; UI/client adoption is
not claimed. New inserts/history mutation can change later pages: this is not a
snapshot or complete-history/retention guarantee. No schema/index migration.

Pure/route source covers round-trip/refusal, ties, deleted pivot, household scope
and legacy shape; all unrun. Actual PostgreSQL collation/query plans/isolation,
installed clients, network/lifecycle and #134/#135 original acceptance remain open.

### Pinned-note edit precondition — 2026-10-25 (#134/#135/#499, local source)

`PATCH /api/notes/[id]` accepts optional `expected_updated_at` (ISO datetime with
offset). The existing body id and permission policy remain; no new URL/body
binding or delete policy. After current personal authority and owned-record lock,
author/parent edit permission is checked before comparing the server timestamp.
Mismatch returns private/no-store409 `error.code: NOTE_CHANGED`, retryable:false,
plus `current` containing only id/title/body/color/created_at/updated_at. No creator
or lifecycle markers. No content change is applied. Known content fields cause a
server timestamp advance to max(current clock, previous+1ms), including clock
retreat/same-millisecond updates. Empty patches retain existing behavior. Legacy
unversioned callers still work and retain their existing overwrite limitation.

The web sheet sends the loaded version when present. A recognized conflict keeps
the draft/form mounted, displays saved content and disables Save until the person
chooses Keep my draft or Use saved version. The first retains draft fields, the
second explicitly replaces them with saved content; both adopt only that reviewed
version and neither writes. A later Save still rechecks permission/version, so a
second intervening edit conflicts again. EN/ES text and44px review controls are
authored. Older servers without versions retain existing compatibility; complete
conflict protection on those servers is not claimed. Cancel still follows existing
draft-close policy; no automatic merge, idempotent receipt or destructive Undo.

Server/schema/mounted comparison-choice cases authored/unrun. No PG/concurrency,
unknown-outcome, browser/long-text/locale/device or release acceptance is inferred;
notes create recovery and broader async/membership boundaries remain separate.

### Mounted note-create request binding — 2026-10-25 (#134/#135/#499, local source)

Notes GET now adds `writeContext: {userId,familyId}` for the authenticated personal
session. It grants no permission; existing household/feature/device read policy
remains. POST accepts paired optional expected_user_id/expected_family_id, both
1..128 characters. Supplying only one gets400. A mismatched pair gets private/
no-store409 NOTE_OWNER_CHANGED before key claiming or create/replay effect. Current
transaction authority still renews session/role/family/feature normally. Legacy
unbound bodies remain accepted; no new server key namespace or table.

The sheet's new client freezes normalized title/body/color and expected owner in
one exact body with a secure Idempotency-Key. It reuses canonical POST, whose note
and exact keyed response already commit together. The shared owned HTTP helper
bounds fetch/body wait15 seconds and response256KiB (JSON-only bridges are bounded
after allocation). Only a successful note ID with the expected family/creator is
confirmed. Network/deadline/5xx/in-progress or malformed success remains uncertain.
An uncertain intent remains read-only and retains key/body across sheet Cancel/
reopen on the same mounted page. A deliberate Save retries those exact bytes; no
automatic retry. The immediate request latch prevents overlapping note mutations.
After an uncertain result, later refusals retain the held intent. A fresh definitive
client refusal before uncertainty releases it for ordinary editing. A24-hour wall-
clock window (also refusing backwards time) prevents sending stale mounted intents
near the server's seven-day retention. Expired requests hold for manual review.

This is mounted recovery only: no storage/journal, reload/navigation/process-death
persistence or canonical item-removed receipt inspection. Leaving the page loses
the in-memory intent. The UI tells the person to keep the page open; it does not
claim all #135 exactly-once acceptance. Older servers missing writeContext hold
new creates until refreshed/updated; browsing/edit legacy bodies remain compatible.
No offline queue/device capability/provider/schema change. Pure/route/mounted source
cases authored/unrun; real fault/PG/native/owner/storage acceptance remains open.

### Original note-create receipt inspection — 2026-10-25 (#134/#135/#499, local source)

`POST /api/notes/create/receipt` is read-only. It takes the original owner-bound
create JSON and Idempotency-Key in the header, keeping private draft text/key out
of URL logs. Paired devices are refused, personal auth is required, and both owner
fields/key are mandatory. Current User/household/role/session/notes-feature renewal
precedes receipt lookup under existing lifecycle locks. The scoped receipt is read
under FOR SHARE; action note.create, canonical parsed request hash, stored expiry
and compatible successful response pointer are checked. No receipt claiming,
pruning/replay/effect or content recreation is called.

Successful replies expose only state: unissued (no matching scoped receipt),
pending, expired, unavailable (malformed/unsupported completed receipt), or
present/removed with noteId. Current presence is read by exact id+household with
id-only projection; cached note title/body/creator markers are never returned.
Owner mismatch is409 NOTE_OWNER_CHANGED; action/hash mismatch422
IDEMPOTENCY_KEY_REUSED; ordinary auth/feature refusals retain their codes. Responses
are private/no-store, including failures.

Mounted uncertain Save now inspects first using shared15s/32KiB bounds. Present
confirms without another write; removed ends recovery with EN/ES explanation and
never recreates. Only unissued can continue through the same original keyed POST,
subject to the existing24h client window and canonical atomic-receipt assumption.
Pending/expired/unavailable/malformed/non-success inspection holds the original
intent. A missing receipt is not a disaster-restore proof; post-restore key/history
continuity remains a separate acceptance requirement. No background retry/new key,
queue/storage schema, device permission or persistent journal is added.

Server/client/mounted/device-inventory source authored/adapted only. No real API/DB/
locking/fault/restart/native/privacy/browser/test/build/release execution occurred.
Persistent adoption/reload/process-death and full #135 acceptance remain open.

### Note-create owned recovery foundation — 2026-10-25 (#135/#499, local source)

GET /api/notes/recovery is personal-only, rate-limited240/minute by account,
private/no-store and uses current User/session/role/household/notes-feature renewal.
It returns herewoven.note-create-recovery.v1, enabled, userId/familyId and a nullable
person owner. The note owner preserves the existing generation/household retirement
fields but hashes a note-specific namespace from the actual current session owner;
it is continuity metadata, never a credential. No token/PIN/draft is returned.

Readiness requires existing QUEUE_OWNER_RECOVERY_ENABLED and
QUEUE_OWNER_RECOVERY_ROLLBACK_READY plus NOTE_CREATE_RECOVERY_ENABLED and
NOTE_CREATE_RECOVERY_ROLLBACK_READY, all exactly1. No values were activated.
POST notes and receipt inspection accept optional X-Herewoven-Note-Owner. When
supplied, the exact current note scope must match or409 NOTE_RECOVERY_OWNER_CHANGED
before claiming/reading a receipt; journal-origin creates additionally refuse with
NOTE_RECOVERY_PAUSED while gates are off. Matching receipt inspection remains
possible during a write pause. Legacy no-header requests retain existing policy.

The strict note contract holds one note-create entry with original key/body/issuedAt,
not an editable/offline-action queue. Body is at most64KiB and journal96KiB, with
owner-bound title/body/color only; unknown fields/legacy-unbound entries refuse.
The store wraps createOwnedRequestJournal, reusing CAS/leases, replica verification,
uncertain-storage recovery, explicit review, owner/retirement and keep-until-dismiss
semantics. Browser adoption uses only ownedQueueLocation in the note namespace;
there is no unowned storage fallback or import-time work. Context is renewed by
canonical GET. Before every send it inspects the original receipt; only unissued
inside the client window is eligible. Present/removed must be resolved separately
through inspection and confirmed dismissal. No background send or automatic erasure.

This is an uninitialized foundation. The current sheet has not adopted the adapter;
persist-before-first-send, recovered-request discovery/inspection/dismissal and
explicit storage-repair UI are next source work. Injected source cases cover exact
reload, required review, post-write fault hold/repair, owner switch, immutable body,
strict contract, namespace and readiness/proof pause. All unrun. No storage/DB/API/
browser/native/permission/provider activation or acceptance is inferred.

### Note journal sheet adoption — 2026-10-25 (#135/#499, local source)

Notes GET adds recoveryAdopted from NOTE_CREATE_RECOVERY_ROLLBACK_READY. Once
adopted, retain that rollback-readiness advertisement through a write pause so
pending requests remain discoverable; clearing it before owned work is reconciled
is not a supported rollback. No environment values changed. Current no-adoption/
older servers keep mounted-only behavior without probing browser storage.

The adopted sheet lazily initializes the note adapter after validated owner context.
Restored entries appear as a generic Review saved request action, with no automatic
open/send/dismiss. Opening restores exact original read-only fields. New requests
are staged/verified before canonical create; every deliberate Save inspects the
receipt under renewed journal ownership. Present/removed settle without another
create, unissued may send exact saved bytes through the existing journal's renewed
review/proof path, and pending/expired/unknown holds. Save/new-create is blocked
during initialization/storage recovery. Context changes and known owner-loss
refusals clear the old personal UI, retaining owned storage for retirement policy.

Confirmed terminal results precede local dismissal. Failed dismissal/staging keeps
recovery blocked and offers Retry recovery inside the sheet and on the page. The
same controller repairs only its exact uncertain CAS transition; repair alone never
sends a create. If repaired cleanup is empty and same-owner terminal proof remains,
the sheet finishes rather than sending again. Legacy mounted intent handling stays
separate when adoption is absent. No new queue/storage engine or automatic fallback
from an adopted storage failure. Paused owner-matching reads/terminal cleanup use
the shared journal's existing allow-paused semantics.

Read-only receipt inspection may now recognize committed/unremoved requests after
the shorter client send window; only sends require age0..24h. Server expiry still
holds invalidated receipts. Internal reconstruction projects durable entry fields
before strict validation because shared snapshots add reviewRequired display metadata;
the durable contract still rejects unknown fields. EN/ES44px review/repair actions
and focused recovery from disabled Save are authored. No rendered/a11y proof.

Injected sheet cases cover restored-present/no-create, stage-before-write, post-write
storage fault/explicit repair, terminal cleanup fault/no second send and owner-loss
UI clearing without journal erasure. Client cases cover older read-only proof with
no create. All source unrun. Real storage/replicas/reload/process-death, logout/
retirement/multitab/paused flags, wire/lifecycle/long-text/accessibility/locale/native
and disaster-restore acceptance remain open. Flags off; no initialization or run.

### Note edit/delete foreground bounds — 2026-10-25 (#135)

Notes web source moves note edits/deletes onto the shared
15-second foreground deadline and bounded JSON decoder (#135). PATCH replies cap
at256KiB and DELETE replies at32KiB. An absent/malformed/oversized reply retains
the draft or delete confirmation and releases the sheet's pending latch; it does
not imply rollback or trigger a retry. Edit version/conflict review remains, and
404 deletion remains an error. JSON-only older bridges retain post-parse limits.
Source coverage for oversized replies authored only. No QA/test/check/build/
browser/CI/API/DB/native/provider/push/merge/deploy ran. Rendered timeout/conflict/
permission and complete recovery acceptance remain open.

### Notes page decode and revoked-authority bounds — 2026-10-25 (#134/#135)

Notes web source caps Notes page JSON at2MiB within its
existing 15-second deadline (#134/#135). The shared decoder bounds streamed bytes;
older JSON-only bridges retain post-parse limits. A401/403 response clears prior
personal notes/drafts without waiting for an error body. Existing page/cursor/
generation validation, exact retry and create recovery remain. Oversize/revoked-
authority source cases authored only. No QA/test/check/build/browser/CI/API/DB/
native/provider/push/merge/deploy ran. Runtime timeout, rendered privacy recovery,
old-server compatibility and full acceptance remain open.

### Wishlist bounded read decoding — 2026-10-25 (#134)

Wishlist web source caps Wishlist list/target reads at2MiB
and account-role lookup at32KiB within the existing15-second deadline (#134).
The shared decoder bounds streaming bytes; JSON-only bridges retain post-parse
limits.401/403 can enter existing refusal handling without waiting for error
JSON. Exact-cursor retry, target inspection and mutation behavior remain. Source
cases for oversize/account refusal authored only. No QA/test/check/build/browser/
CI/API/DB/native/provider/push/merge/deploy ran. Rendered recovery, fault/timeout,
role/privacy, old-server compatibility and full acceptance remain open.

### Notification foreground reply bounds — 2026-10-25 (#141)

Notification web source bounds foreground notification mark,
snooze and delayed-delete requests through the shared15-second deadline/32KiB
JSON decoder (#141). Success requires an explicit success:true acknowledgment;
snooze also validates its date. Missing/malformed/oversized replies keep read/
snooze state or restore the locally hidden delete row without claiming server
rollback. EN/ES copy calls the outcome unconfirmed. Existing Undo delay and page-
exit keepalive dispatch remain separate/unchanged; no write replay/delivery or
scheduler added. Source oversize cases authored only. No QA/test/check/build/
browser/CI/API/DB/native/provider/push/merge/deploy ran. Actual lifecycle, races,
role/privacy, timeout/Undo and full acceptance remain open.

### Notification explicit refresh recovery — 2026-10-25 (#141)

Notification web source adds a visible44px EN/ES Refresh
notifications control (#141), completing the explicit action named by uncertain-
write copy. It reloads canonical first-page state without replaying a write.
Manual refresh pauses through reads, mark/snooze, queued Undo deletes and actual
foreground delete waits; immediate refs also guard pre-render clicks. Undo or
foreground settlement releases delete busy tracking; page-exit dispatch keeps
its existing best-effort semantics. Source refresh/Undo cases authored only. No
QA/test/check/build/browser/CI/API/DB/native/provider/push/merge/deploy ran. Rendered
focus/reflow, read-write races, lifecycle and original acceptance remain open.

### Notification stale read/action fencing — 2026-10-25 (#141)

Notification web source fences notification page replies
against intervening local actions (#141). First/older reads capture a write
epoch; mark/snooze begin+settlement, delete/Undo/settlement and exit dispatch
advance it. Changed or still-pending actions reject stale page application and
retain explicit EN/ES refresh/exact-cursor retry. Older reads pause while actions
are pending; in-flight delete rows cannot be submitted twice. Existing overlapping
page merge and original Undo/send behavior remain. Concurrent-page source case
authored only. No QA/test/check/build/browser/CI/API/DB/native/provider/push/merge/
deploy ran. Runtime race, focus, native lifecycle and full acceptance remain open.

### Assistant chat and report transport bounds — 2026-10-25 (#464/#144)

Assistant panel source bounds assistant chat/report transport
(#464/#144). Chat uses the shared foreground deadline at45 seconds, above the
existing30-second provider timeout, and256KiB JSON cap. Network/unreadable/deadline
failures keep existing localized retry/draft paths; no automatic provider retry
or app write occurs. Feedback reads use15seconds/512KiB and validate/project at
most25 report rows; saves use15seconds/64KiB and retain exact original request IDs/
bodies on uncertainty. JSON-only bridges retain post-parse bounds. Oversize chat/
report source cases authored only. No QA/test/check/build/browser/CI/API/DB/native/
provider/push/merge/deploy ran. Actual timeout, grounding, private identity, action/
report concurrency and rendered/lifecycle acceptance remain open.

### Opt-in private feedback summary — 2026-10-25 (#464/#136)

Feedback API/panel source adds opt-in feedback summary responses
(#464/#136). The personal panel requests X-Herewoven-Feedback-View:summary-v1.
GET selects/projects only id/kind/title/status/created_at for the existing25-row
own-user/household list; POST projects the same receipt only after unchanged
ownership/session and exact-request checks. Details, pathname and owner/request
IDs stay out of opted-in responses. No-header callers retain the original shape;
older servers may ignore the header and the panel still projects display fields.
No schema/permission changes or external forwarding. Source projection/legacy
cases authored only. No QA/test/check/build/browser/CI/API/DB/native/provider/push/
merge/deploy ran. Runtime privacy/compatibility/replay and full acceptance open.

### Historical-content erasure hold response — 2026-10-25 (#136/#142)

Account deletion source completes translated recovery for
historical shared-content ownership holds (#136/#142). The server returns409
HISTORICAL_SUCCESSOR_REQUIRED only for a missing former-household successor;
current-household NO_SUCCESSOR remains unchanged. The dialog renders owned EN/ES
guidance, retains password/confirmation and does not claim deletion or replay it
when locale changes. No former household name/ID is exposed. Existing older
clients retain the generic server-text fallback. Locale/draft/no-replay source
case authored only. No QA/test/check/build/browser/CI/API/DB/native/provider/push/
merge/deploy ran. Runtime rollback/compatibility/rendered and full acceptance open.

### Reward collection continuation and exact status inspection — 2026-10-25 (#134/#499)

Rewards API/SSR/web source adds reward collection continuation
(#134/#499). A shared API/SSR timestamp/ID reader returns24 web rows or up to100
opt-in API rows with one lookahead, household/status-bound cursor and no pivot
lookup. No-limit legacy responses remain complete. EN/ES Older/Newest/invalid/
page-only copy is wired; current identity/family and analytics role are renewed
before SSR serialization. Recovery inspects one exact owned reward through an
optional target filter and bounded transport; absent targets never prove an
outcome. Closed/off-page uncertain claims retain original keys and accessible
review, still-available reads keep recovery, and page links hold during actions/
review. Source parser/API/UI cases authored only. No QA/test/check/build/browser/
CI/API/DB/native/provider/push/merge/deploy ran. Query/index/compatibility/race/
rendered/navigation and full reward acceptance remain open; no new DDL applied.

Protocol: GET /api/rewards?limit=24[&status=available|claimed|approved|redeemed][&cursor=...] returns rewards plus nullable nextCursor. Duplicate/invalid paging and foreign household/status positions refuse400 REWARDS_INVALID_PAGE. GET ?rewardId=<id> is an exclusive exact-target filter returning the same rewards array shape with zero/one own-household row; it cannot combine with paging/status. Older servers may ignore the filter; clients still match the target and hold on absent/unreadable replies. This is not a write receipt or deletion tombstone. Legacy no-limit/no-target calls retain prior representation and ordering.

Index follow-up is measured planning only: compare existing Reward family/status indexes with proposed family+created_at+id and family+status+created_at+id paths. No index/migration or latency result is implied. Reward history follows canonical erasure/retention; no time-based pruning is introduced.

### Opt-in message history keysets — 2026-10-25 (#134)

Message API source adds opt-in tie-safe message API
continuation (#134). paging=keyset-v1 uses default50/max100 plus one lookahead,
household-bound canonical timestamp/ID positions and no pivot lookup. The cursor
is built before chronological DTO reversal; sender/pickup projection and complete
current roster remain. Legacy no-mode timestamp reads/shape/order stay unchanged.
Parser/foreign/tied/deleted-pivot/legacy source cases authored only. The current
chat has not adopted the new mode: merge/refresh/scroll/exact retry and old-server
handling remain the next source slice. No QA/test/check/build/browser/CI/API/DB/
native/provider/push/merge/deploy ran. Relation/index/client/runtime acceptance
remain open; no complete roster-size or whole-response bound is claimed.

GET /api/messages?paging=keyset-v1[&limit=1..100][&cursor=...] returns the existing messages/members/userId plus nullable nextCursor. Invalid/duplicate mode/limit/cursor or another household position refuses400 MESSAGES_INVALID_PAGE. Page selection is created_at DESC/id ASC; the response reverses only that selected page for chronological display. Complete current-member roster and canonical sender/pickup masking remain. No mode retains the legacy timestamp-only API, including its tie limitation; no client adoption or read-snapshot guarantee is implied.

Next source integration: latest/earlier client reads must validate explicit continuation, retain the exact failed cursor, preserve all loaded same-time messages during a latest merge, keep unsent text/attachments/unknown send keys, and retain scroll position/focus. Specify unknown/older-server recovery rather than inventing a cursor from timestamps. Later QA owns actual refresh/send/read/history races and query plans. Compare a proposed Message(family_id,created_at DESC,id ASC) index only after plan measurement; no DDL/retention change here.

### Chat history keyset adoption — 2026-10-25 (#134/#135)

Message web source connects chat to message history
keysets (#134/#135). Latest/earlier reads use15-second/2MiB bounded decoding,
validated50-row unique pages and explicit opaque continuation. Failed older reads
retain the exact cursor; loop/unread/unknown pages do not advance it. Latest
merges preserve loaded timestamp ties and just-sent boundary rows; scroll/focus
and unsent text/attachments/send intents remain. Modern API readContext binds
user/household; changed/revoked read context masks the thread/composer and stops
new reads until explicit reload. Older servers show recent-only EN/ES notice,
without invented continuation. Source fixtures/cases authored/adapted only. No
QA/test/check/build/browser/CI/API/DB/native/provider/push/merge/deploy ran. Actual
tie collation, same-window edits, send/read/history races, large refresh gaps,
old-client/server, async owner/lifecycle and rendered acceptance remain open.

Modern message responses now also include readContext:{userId,familyId}; it is observed read scope, never a write permission or cached authority. The client validates it before merging latest/history. Unknown old-server responses remain recent-only with no fabricated history cursor. Legacy no-mode API shape remains unchanged. Existing5-second polling/sending/upload/read-ack paths are not new delivery or offline queues; their wider lifecycle/owner mutation requirements remain separate. Read scopes do not prove an in-flight send's outcome or revoke an already dispatched action. Streaming bytes are bounded; JSON-only bridges retain post-parse limits.

### Original-owner chat composition and uploads — 2026-10-25 (#135/#136)

Chat/API source binds chat composition to original
account/household/session (#135/#136). Modern GET advertises a strict writeContext;
the client freezes it before uploads and includes it in exact send bytes. New
/send and /attachments/owned routes require those preconditions while sharing
canonical legacy handlers/effects. Unsupported old servers cannot silently strip
fields via a legacy fallback. Unknown support keeps drafts local. Fresh user ->
household locks renew session/feature before message effect/replay, upload row
creation and post-file publication check. Lost upload authority uses existing
exact unclaimed-file compensation. Read acknowledgments now renew the same
locks before appending non-FK read_by IDs. Upload/send/read waits are bounded;
unknown sends keep original keys and late retired uploads do not trigger sends.
Legacy endpoints/body formats remain supported. Source contract/API/UI/paired/
upload-fault cases authored/adapted only. No QA/test/check/build/browser/CI/API/DB/
native/provider/push/merge/deploy ran. Actual PG/filesystem/race/rollback/native/
aging/lifecycle acceptance remains open; no persistent message queue is claimed.

Modern read writeContext is `{protocol:"herewoven.message-owner.v1",userId,familyId,generation}`. This is private context, not a token or authority. Optional legacy message fields expected_user_id/expected_family_id/expected_generation must be all absent or all present and match the authenticated actor. POST `/api/messages/send` requires them and an Idempotency-Key, stream-bounds JSON at64KiB and delegates to the same message.create receipt/effect. POST `/api/messages/attachments/owned` requires X-Herewoven-Message-Owner with exact strict context and delegates to the same bounded multipart/storage/compensation handler. Existing message/attachment endpoints remain legacy-compatible; supplied owner constraints still enforce. Neither strict endpoint falls back to a legacy write URL.

The client captures context before asynchronous photo work and masks the thread on generation/context change. Missing marker keeps composing local with EN/ES explanation. Request deadlines are15seconds, upload/read-ack JSON caps32KiB and send cap256KiB. Network/parse/timeout and408/409/425/429/5xx send uncertainty retains original key/body. This is mounted recovery only: no new persistent queue, receipt-retention extension, original-send age guarantee or automatic retry. Existing unbound-media pruning/file compensation and wider erase/claim/rollback/lifecycle races still require real acceptance.

### Original chat send time — 2026-10-25 (source only, no QA)

The unreleased strict `/api/messages/send` contract now requires canonical UTC
`issued_at` alongside the original owner triple and idempotency key. The client
captures it once per logical draft, keeps it in exact serialized request bytes,
and restores the whole intent/key/time when editing away and back after an
unknown reply. Modern retries stop before24h; the pure shared window is capped
at one quarter of canonical receipt retention (currently7days, unchanged), with
at most5minutes future skew. Device-clock problems hold rather than renew the
intent. Server time checks run before receipt acquisition, after actor/household
locks, and after receipt/media reads before message creation. A supplied legacy
time enforces the same bound; absent legacy fields retain existing behavior.

EN/ES hold copy retains the draft and directs the person to the conversation and
device clock. An explicit review acknowledgment retires only that held mounted
intent; it neither sends nor proves the original message absent. A later Send is
a deliberate new intent. Ordinary uncertain retries never silently renew age or
key. This extends the local, unreleased owner-v1 candidate together with its web
consumer; legacy endpoints are unchanged and the strict URLs have no fallback.
Timestamp validation adds no stored column/migration or queue. Browser relaunch,
receipt inspection, durable recovery and upload-retry identity are still outside
this mounted-send slice. Source time-boundary/API/UI fixtures are authored/adapted
but unrun. QA, real lock/retention/clock/lifecycle behavior, compatibility and all
release acceptance remain open. No runtime, database or external activation ran.

Latest bounded source work (2026-10-25) binds the Imports form to original
parent/account/household/session context (#104/#136). A strict owned endpoint
requires the bounded marker before source-body parsing, reuses canonical legacy
handlers/effects and renews original authority before private success echo. The
client freezes context, requires matching owner/review replies, masks retired
file/report controls and never falls back to a legacy write URL. Old-server
missing support holds backend actions with EN/ES recovery; legacy contracts stay
supported. API/UI/paired source cases are authored/adapted UNRUN. No QA/test/check/
build/scanner/browser/CI/API/DB/import/native/provider/push/merge/deploy ran.
39 issues remain open; full source/export/client/race/rollback acceptance and the
pending unlink product-choice question remain unresolved.

Full owned-import/legacy compatibility contract: docs/plans/import-review-ui.md.

## Paired recipe curation read owner and write intent — 2026-10-25

#460/#136 source: collection catalog and recipe curation GETs now echo a bounded
X-Herewoven-Recipe-Owner header with protocol, original server actor/family/role/
session generation after existing authority renewal. Response JSON shapes stay
unchanged. Supplied expected-owner headers are validated before feature/body/
mutation work; mismatch/malformed markers refuse409 RECIPE_OWNER_CHANGED. Legacy
callers without the optional request header retain existing API compatibility.
Mutation responses renew original access before echoing the context; later refusal
does not prove a prior write rolled back.

RecipeCuration requires matching owner echoes from both parallel reads before
showing the catalog/current choices or enabling edits. The first accepted pair
freezes the mounted sheet's owner; refresh and writes carry that exact header.
Refresh cannot rebind an uncertain draft to another account/household/role/session.
Mismatched/missing/old-server echoes or explicit access refusal latch a masked
EN/ES reload hold. The previous draft stays mounted but hidden; no new write or
legacy fallback is sent. Reload is explicit and44px, and receives focus only if
removal left focus on body. Close/reopen does not clear the hold; a new route ID
or page reload creates a new mount context.401/403 are recognized before body
reading even for empty native responses. Existing bounded deadlines/CAS recovery
and user-authored recipe/collection text remain otherwise unchanged.

This is intent binding and paired-response admission, not a credential, signed
snapshot, proof of absent effects or complete SSR-origin owner boundary. The first
pair begins with current server authority; an original server-rendered owner,
full app masking/native/process-death/restore acceptance remain separate. Other
recipe consumers retain their existing contracts. No schema/provider activation.
Pure marker, mixed/missing pair, frozen uncertain refresh/write-header and server
pre-decode refusal cases are authored/adapted UNRUN. No QA/tests/checks/build/
browser/CI/API/DB/provider/push/merge/deploy ran. #460/#136 remain open.

## Household name authority and conflict recovery — 2026-10-25

#499/#136 source: legacy PATCH /api/family and strict PATCH /api/family/name now
share family-name-http.ts. Both bound bodies to8KiB, keep existing parent/person/
family checks and use a5second transaction/max-wait. User then household advisory
locks precede actual User FOR SHARE and Family FOR UPDATE; fresh parent/family/
original session-generation checks run before family lookup/write. Ordinary role,
password/session or membership updates are fenced by the row lock. Responses keep
only the existing display selection, private/no-store; billing/invite/feed/AI
secrets remain outside the writable/display contract.

The dedicated name route requires name_protocol1, exact observed baseName and
requested name. It refuses409 FAMILY_NAME_CHANGED when the locked current value
matches neither base nor request. A matching requested value confirms current
state without updating again. Legacy callers retain their old stripped-input/
last-value semantics, now with fresh authority; unknown billing fields cannot
change plan state. The new web never falls back to that legacy write when an old
server lacks the strict route. No new schema, epoch, receipt or migration exists.
This is compare-value conflict protection, not immutable revisions/ABA detection
or proof of which request originally set an already-matching value.

Household Settings adopts bounded15second reads/writes (256KiB account-read and
64KiB save replies), abort/retirement on reload/unmount and synchronous read/save
exclusion. Unknown replies retain the entry and never claim saved. A known name
conflict requires explicit Check current name; that read preserves the draft,
shows the actual saved name and enables a deliberate reviewed save. It never
silently substitutes a different household. Existing typed EN/ES copy gains short
review/check feedback; profile/account/board subflows remain canonical/separate.
Full original client actor/session binding, auth-me read semantics, server body-
read deadlines, SQL/lock/restore and rendered/native acceptance remain separate.

Legacy behavior, strict conflict/no-write convergence, role/family/generation
change during decoding, required protocol/body bound, retained draft/review and
stalled reply/late success source cases are authored/adapted UNRUN. No QA/tests/
checks/build/browser/CI/API/DB/provider/push/merge/deploy ran. #499/#136 remain open.

## Board Settings personal transport bounds and audience retirement — 2026-10-25

#499/#135 source: personBoardSettingsTransport now bounds fetch and response JSON:
15second reads/search,45second settings writes,90second deliberate photo uploads,
and2MiB reply limit. Same-origin/no-store is explicit. Body/network/size/deadline
uncertainty produces typed EN/ES unconfirmed-change feedback for writes; it never
automatically sends a second setting or photo. Known HTTP diagnostics and custom
transport message semantics are preserved. JSON-only bridges retain post-decode
allocation limits; timers do not preempt synchronous serialization/FormData work.

BoardSettings exposes an explicit44px retry after load failure. Each transport/
retry generation clears the old audience view and retires previous results.
Load cancellation and generation-guarded save/search/upload outcomes prevent an
old transport from repainting names/settings or clearing a newer busy state.
Synchronous lanes reject duplicate operations before React state updates; an old
upload cannot continue into load/selection after audience retirement. Custom
paired-tablet transports keep their original interface and error semantics; this
patch does not add transport-level cancellation/deadlines to arbitrary custom
promises or change elevation/provider/permission behavior.

Stalled body/late result, single exact unconfirmed write, oversize-before-decode,
explicit custom-load retry and old-save/new-audience cases are authored UNRUN.
This is bounded personal transport and local audience retirement, not full server
owner echo, compare-and-set setting updates, unknown upload reconciliation,
native physical cancellation or rendered/role acceptance. No QA/tests/checks/
build/browser/CI/API/DB/provider/push/merge/deploy ran. #499/#135 remain open.


### Owned reward action source candidate (#135/#136/#141, 2026-10-25)

Default-off `REWARD_ACTION_COMMANDS_ENABLED` exposes strict POST claim/approve
`/owned` wrappers sharing canonical handlers. `herewoven.reward-action.v1` binds
original owner/session, reward birth, reviewed claim cost or approval claimant,
issue time and required existing idempotency key; unknown fields/missing context
hold, with no legacy fallback. Exact packet participates in the existing receipt
hash. Source/authority/time checks precede replay/effects; late expiry after
writes throws for rollback. Protocol acknowledgement and every result are private/
no-store. Original endpoints retain optional-key/representation compatibility.
Schema expansion/Prisma generation are prerequisites, not performed. Browser
capability/adoption/owned reads and real acceptance remain unfinished; do not
activate from authored mocks. Detailed source/rollout limits are in
`docs/plans/notification-delivery-v1.md`. No new provider or scheduler.


The owned reward source candidate now includes default-off SSR browser selection
and GET `/api/rewards/owned` current-state recovery with strict original-owner
header, protocol acknowledgement/echo and minimal same-household target. Client
packets keep reviewed birth/cost/claimant/issue time/key across retries; no automatic
fallback or current-read renewal. Source replacement cannot resolve the original
request. All source and cases remain unrun; flags, schema/client-generation and
old-client/restore/runtime/device rollout acceptance remain separate and open.


The private notification source envelope candidate additionally recognizes
`reward.created` for a fresh canonical Reward birth. The default-off create cohort
captures the creator-excluded bounded account roster, then atomically stores
Reward/event/terminal inbox-or-suppression decisions/receipt through the existing
sender. Old envelope readers hold the new kind; this is no activation or universal
keyless-create dedupe claim. Exact active-available focus uses existing personal
claim confirmation. All source/rollback/client/runtime acceptance remains open;
see the dated notification-delivery plan. No new schema or provider.


### Reward JSON request byte bounds — 2026-10-25 (#135/#136)

Ordinary POST/PATCH `/api/rewards` use the existing streamed JSON reader with a 16-KiB input limit. Legacy and owned POST claim/approve handlers share an 8-KiB limit. `Content-Length` can reject early; missing/inaccurate declarations do not bypass streamed byte accounting. Oversize input returns 413 with the existing `{ error: 'Invalid JSON' }` body; malformed JSON remains 400. Refusal occurs before idempotency receipt allocation or reward/XP/notification effects. Existing schema field validation, ordinary optional keys and owned packet/key requirements remain unchanged; no protocol rollout is enabled. Current bounded name/description/icon fields fit within the byte budget, including escaped/unicode text. Previously unbounded legacy reward ID strings, additional unknown fields and whitespace also consume that budget; this introduces no separate ID-format rule.

Legacy bridges without a body stream have only the existing post-decoder byte limit, not bounded allocation. This change supplies no slow-stream time limit. Four ordinary handler streamed-oversize fixtures are authored in the existing idempotency suite, UNRUN. Actual transport, old/installed clients, timeout/rate/lifecycle and broader API/QA acceptance remain open. No QA/tests/checks/build/browser/DB/migrations/push/merge/deploy/activation ran.


### Recipe collection mounted-owner admission — 2026-10-25 (#460/#135/#136)

`RecipeCollections` now uses the existing `X-Herewoven-Recipe-Owner` protocol already emitted/admitted by the canonical collections HTTP route. It captures the first validated catalog owner and sends that exact account/household/role/session context on refresh/create/rename/delete. Successful replies require the same marker; missing/changed markers, 401/403 or `RECIPE_OWNER_CHANGED` mask the collection UI/draft and require a page reload. No replacement owner is adopted by refreshing a draft. Write permission still requires the existing parent/teen boundary and `canEdit`; the canonical server writer remains unchanged. The original synchronous action latch and revision/name conflict handling remain.

Collection requests now carry the mounted abort signal through the existing foreground deadline/body limits; unmount retires callbacks and aborts transport without claiming mutation cancellation. Favorites and collection management share the same extracted curation transport, with no second queue/write engine. Two focused mounted-owner fixtures are authored, UNRUN. This does not pair the wider Explore library/session, establish durable command recovery or settle uncertain writes by identity alone. Server concurrency, exact-command durability, old-server behavior, accessibility/rendered/locale/native and all runtime acceptance remain open. No QA/checks/build/browser/CI/DB/migration/release/activation ran.


### Explore recipe library page admission — 2026-10-25 (#460/#134/#135)

The Explore recipe-box read now uses the shared 15-second/1-MiB recipe foreground reader instead of raw unbounded fetch/JSON waits. Its existing 100-row explicit page size remains. The library adapter admits allowed unique search filters, safe offset arithmetic, at most 100 projected summaries, unique path-safe IDs and a nullable exact `offset + 100` continuation only after a full page. Malformed, repeated or backward continuation refuses into the existing localized retry state; it never converts failure into an empty library or automatically fetches another page. Replacement/unmount still aborts/retire reads; a bridge that ignores abort cannot hold the caller indefinitely. Repeated IDs across separately valid pages update one card rather than adding duplicate React keys.

Source fixtures describe projection/search and malformed/duplicate/filter boundaries, UNRUN. No collection API, canonical writer, permission or provider changes. The adapter strips unused fields without accepting payload identity as household authority. Account/household pairing across library/auth/collections, whole-library duplicate absence, offset stability during concurrent title edits and actual transport/rendered/locale/native acceptance remain open. No QA/tests/checks/build/browser/CI/DB/migration/release/activation ran.


### Explore discovery and preview foreground bounds — 2026-10-25 (#460/#125/#135)

Explore online discovery and import-preview requests now use the shared foreground race with a 15-second deadline and 512-KiB response cap. Unlike only scheduling AbortController.abort(), the race settles the UI even if headers or the JSON bridge ignore abort. Response schemas still admit bounded discovery cards/extracted review fields before display; no partial or truncated recipe is silently accepted. Timeout/transport/oversize failure restores the existing localized network/retry state, keeps manual/external source paths, and never saves canonical recipe state. Existing request generations and unmount/replacement signals suppress late preview/search completions. Provider fetching, SSRF/input/role/rate contracts and manual review/save remain unchanged.

Two mounted ignored-abort stall fixtures (preview body and search headers) are authored, UNRUN. Bridge bodies without streams retain the shared post-decode limit, not bounded allocation. Original account/session pairing across discovery/preview/library/editor, real mounted/locale/old-client behavior and provider/role/negative acceptance remain open. No QA/tests/checks/build/browser/CI/DB/migration/release/provider activation ran.


### Saved-library owner continuity — 2026-10-25 (#460/#135/#136)

GET `/api/recipes` additively emits the existing recipe-owner header after original HTTP authority renewal, and checks an optional expected header before household queries. Legacy callers without a header keep the response JSON shape. Explore requires a valid successful marker, pins the first admitted library owner across filters/refresh/continuation, and sends it on later reads. Changed/missing owner markers and access-loss responses hold/mask the mounted page; it never adopts another account/household to keep loading. Header admission happens before body decoding. Its favorites and collection controls receive that same original owner before their own first read, retaining existing canonical writer validation.

A bounded, advisory `/api/auth/me` role read preserves public/manual import affordances during a library-only failure; it cannot replace an admitted owner or authorize a write. Discovery/preview/editor owner pairing is still unfinished, as is propagating an individual child control's hold to the full parent page. Existing recipe save review/authority remains mandatory. Old servers without the marker hold this new library UI rather than silently weakening owner admission; this is a server/web candidate compatibility requirement, not store rollout evidence. Fixture sources are adapted and a pre-decode owner-mismatch case added, UNRUN. No actual old-client, concurrency, mounted/rendered/locale/native or runtime acceptance claimed. No QA/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Recipe control holds mask the containing library — 2026-10-25 (#460/#135/#136)

Collections and per-recipe favorite/collection controls notify their optional containing owner boundary when an original-owner marker is missing/changed or access is lost. Explore routes that signal to the existing library hold: original library cards and preview/editor controls are masked, pending discovery/preview callbacks are retired and the existing EN/ES reload guidance is focused. This closes the prior child-only masking gap in this host; standalone controls keep their own masking without a required parent. No replacement owner is adopted, no write is retried, and abort/unmount does not prove an in-flight mutation was cancelled.

The mounted parent-mask and child notification fixtures are authored/extended, UNRUN. Preview/editor original-context admission, exact-command/durable recovery and actual mounted/focus/locale/concurrency/native/old-client acceptance remain open. No API, schema, permission or provider activation change; no QA/tests/checks/build/browser/CI/DB/migrations/push/merge/deploy ran.


### Recipe discovery/preview original owner and editor identity — 2026-10-25 (#460/#135/#136)

Discovery and preview APIs now use the existing recipe-owner protocol: an optional expected marker is compared only with server-captured authenticated authority before publisher work; successful output emits that authority after existing renewal. Headerless legacy callers retain request/JSON shape and role/rate/provider rules. Explore sends its pinned context and requires the same successful marker; known access loss, missing/changed markers and owner refusals invoke the existing page hold. Search and preview can establish the initial page owner during a library-only failure. A library request dispatched before that adoption must still match the newly pinned owner before installing rows, closing the parallel-bootstrap race. The existing bounded curation transport skips 401/403 bodies before returning those known access statuses; all public preview content still requires schema admission.

An imported editor receives the existing recoveryIdentity user/household boundary so it cannot bootstrap a different person's/household's review document. This is not full preview-to-editor role/session-generation admission; review/recovery context and canonical submit renewal remain separate work, including propagation of editor holds. No private household data is added to publisher requests, no writer/store is forked and no provider is activated. Two API foreign-owner and one changed-session mounted fixture are authored; existing fixtures aligned with their explicit review-document identity. All UNRUN. Actual concurrency, missing/old-server compatibility, rendered/locale/native and runtime acceptance remain open. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Imported editor review-context continuity — 2026-10-25 (#460/#135/#136)

Imported RecipeEditor receives the page's full recipe-owner context in addition to its existing user/household recovery identity. RecipeDraftBoundary freezes that context on mount; changing/removing it cannot rebind a later current-context check. Recipe review-context reads and the existing browser document store's resolveContext pass that frozen optional owner header. GET `/api/review-documents/context?domain=recipe` checks it against server-captured account/household/role/session before the family lookup and additively returns the marker after its existing final renewal. Recipe clients supplying the marker require the matching echo plus matching user/household/role body fields. Other review domains and headerless clients keep the existing JSON contract; new imported readers hold on old servers lacking the echo.

Editor owner loss retires private draft display and notifies the existing Explore mask. Ordinary role changes also hold the existing mounted context instead of adopting them. No recovery location, queue owner schema, mutation receipt or canonical writer is replaced. Focused original-session context refusal and editor forwarding/hold propagation fixtures are authored, UNRUN. This is read-time review/context renewal, not proof of atomic original-session admission at a later legacy write or transaction; that gap, exact durable/restore/old-reader behavior and actual mounted/concurrent/rendered/locale/native acceptance remain open. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/provider activation ran.


### Imported recipe create request authority — 2026-10-25 (#460/#135/#136)

Imported ordinary create and adopted review-submit dispatch now carry the existing original recipe-owner marker. POST `/api/recipes` admits an optional expected marker before body/idempotency work, freezes actor ID/household/role/session from initial authentication and passes those fields to the canonical effect/replay/detail helpers. The canonical recipe authority helper, when given originalRole, takes actual User/Family share locks after existing advisory locks and checks exact original role plus token generation, household and enabled feature. Headerless HTTP creates also capture their initial exact role; other internal helper callers retain optional-role compatibility. Authority is renewed after detail projection and success echoes the captured marker. Client ordinary and adopted paths require a matching successful marker when originating from a bound import; known owner loss masks private work through the existing host hold without retiring uncertain requests as successful.

No second canonical writer, receipt engine, body/key regeneration or schema is introduced. Receipt request hashes remain based on existing canonical input, not a newly durable original-owner record. Thus this closes request-time/transactional captured-authority gaps only; original-owner provenance across restored commands, recipe source-birth replay identity and old-reader/restore/actual row-lock/concurrency/runtime/native acceptance remain open. Two API source cases describe changed original generation and a parent-to-teen change during a pre-write wait; UNRUN. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Recipe create receipts retain insertion identity — 2026-10-25 (#460/#135/#136)

The compact canonical create receipt now stores `{ recipeId, recipeGeneration }`, using the existing Recipe.food_generation assigned by `database/migration-zzzzzzzzz-food-source-versions.sql`. The existing storage capability probe must confirm that migration's columns/triggers before any fresh ingredient/recipe effect; missing readiness returns `RECIPE_IDENTITY_UNAVAILABLE` rather than manufacturing identity. After insertion, a scoped generation read supplies the compact pointer; invalid proof throws for rollback. No new migration or schema field is introduced or applied. **This existing unapplied migration/trigger is now a prerequisite for ordinary new recipe creation in this candidate**, including while AI features are off. Do not release until its original migration/rollback/old-reader and actual DB acceptance is established.

POST success/replay hydration requires the stored pointer and locks the exact original birth, household and creator before projecting current fields. ID-only legacy receipts hold confirmation instead of adopting a current same-ID row; ordinary detail/PATCH hydration keeps its existing separate authorized path. State-only recipe receipt inspection likewise distinguishes an exact original insertion from replacement/moved/other-creator rows. It captures original HTTP role/session, locks the owned receipt and uses a bounded five-second scope plus final authority renewal; no private recipe fields or generations are returned. Missing legacy birth is committed/current unknown, never inferred from current row/time or permission to create again.

Parser, legacy/receipt-state fixtures and an opt-in DB wrong-generation case are authored/adapted, UNRUN. A generation match remains source identity, not actor credentials or material-version proof; edits within the original birth retain current authorized projection. Restore/trigger continuity, full original-browser receipt binding, command provenance and all actual DB/locking/concurrency/old-reader/rendered/native acceptance remain open. No QA/tests/checks/build/browser/CI/DB/migration/generation/push/merge/deploy/activation ran.


### Imported recipe receipt-inspection continuity — 2026-10-25 (#460/#135/#136)

Every receipt callback in the imported recipe boundary now retains its frozen recipe owner. The existing read-only adapter checks context user/household/role/generation before hashing and sends that marker with the original key/hash. Recipe receipt HTTP checks the optional expected owner against original captured authentication before reading a record and echoes that owner only after final renewal on successful state-only replies. Bound readers require matching success acknowledgement; known owner/access loss throws an owner hold rather than being reclassified as a normal terminal receipt refusal. Headerless callers and non-recipe receipt domains retain their existing representation.

No receipt is written/refreshed/pruned, no request is resent and no old body/key is replaced. API original-session refusal and inspector forwarding fixture sources are authored, UNRUN. This is mounted original-owner continuity at inspection, not new durable ownership provenance in historical receipt hashes or proof about restore/trigger history. Legacy create journal durability, exact-command ownership across future mounts, old-reader/concurrency/rendered/native and actual runtime acceptance remain open. Existing unapplied recipe generation migration prerequisite remains. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### New imported recipe command owner provenance — 2026-10-25 (#460/#135/#136)

New bound imported-create bodies add optional `creation_owner` using the existing strict recipe-owner schema, only with `herewoven.recipe-create.v1`. Both ordinary and adopted builders freeze that field with the original body/key. Existing canonical parsing retains it, so it participates in the existing request hash without a second receipt store. POST validates it against initial authenticated authority before idempotency allocation/replay; the canonical helper independently matches account/household/generation and exact role against current locked authority. Changing the owner changes the canonical hash and cannot reuse a stored key as the same request. Headerless commands carrying old owner metadata cannot silently adopt current authentication.

New compact successful receipts and retained source-refusal receipts preserve this bounded `creationOwner` metadata. State-only inspection compares stored provenance with captured current authority even without a browser marker, before source lookup or terminal-state disclosure. The browser inspector also refuses disagreement between saved command owner and mounted owner before hashing. No names, tokens or provider content are added to provenance; it is an expected identity assertion, never an actor credential. It binds user/household/role/token-version generation under the existing protocol, not a new per-cookie/session-ID credential.

Older bodies remain accepted by their existing contract, and older receipts are not rewritten or assigned inferred ownership. Older strict servers reject the extra field; no new-client fallback drops it or replaces the key. Source fixtures cover canonical retention/protocol requirement, restored old-body refusal, hash distinction/canonical generation refusal and stored receipt provenance. All UNRUN. Legacy ordinary-create journal durability, older-record provenance, actual rollback/restore/multi-store/old-reader/concurrency/native/runtime acceptance remain open. Existing food-source migration prerequisite remains unapplied; no new migration/store/activation introduced. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy ran.


### Bound recipe command original issue window — 2026-10-25 (#460/#135/#136)

New `creation_owner` bodies also require their first `creation_issued_at` with the existing create protocol. The timestamp is frozen in the original ordinary attempt or adopted exact body and participates in existing canonical hashing; retries, receipt reads and owner refresh cannot renew that packet. Returning after a confirmed noncommit to review a deliberate new command may create a new key/time, while the old exact packet stays unchanged. New bound commands use the editor/review flow's existing one-day command window, shorter than seven-day receipt retention. Missing/unsupported/future timing holds as `RECIPE_COMMAND_TIME_UNCONFIRMED`; age >= one day refuses `RECIPE_COMMAND_EXPIRED`. The original local clock/future hold is retained, with no invented timestamp or server claim that client time is trusted clock proof.

POST checks before idempotency allocation, completed replay checks again after authorization waits, and canonical effects check after receipt/source/storage waits before effects. Expiry after ingredient/recipe/receipt effects throws to roll back the transaction; postcommit response holds never imply rollback or authorize recreation. Ordinary clients retain unknown state/key on time refusals; adopted submitted documents remain held. No timestamp is added to old records. Old unbound bodies retain their prior contract; partial owner-without-time bodies from earlier source candidates are unsupported/held rather than upgraded. This is a compatibility requirement, not old-reader acceptance.

Pure exact-boundary/missing/future cases and API expired-before-allocation source cases are authored; earlier owner-bound fixtures aligned. All UNRUN. Actual clock/concurrency/rollback/restore/multi-store/old-reader/native behavior remains open, as does broader legacy-create durability. Existing identity migration prerequisite remains unapplied. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Ordinary uncertain recipe create: read-only inspection — 2026-10-25 (#460/#135/#499/#142)

The ordinary editor's primary uncertain-save action is now **Check original save**, using the existing state-only receipt endpoint with the original key and hash of canonical parsed saved body. Optional original-owner context follows the same header/acknowledgement path as adopted recovery. Dynamic module load, hashing and read are bounded together by the existing 15-second foreground race; response remains 8 KiB, unmount aborts/retire callbacks, and a synchronous action latch prevents overlapping retry/read/submit work. No POST is made by inspection, no body/key/time is replaced and no receipt is mutated.

EN/ES pending/absent/expired/committed-present/removed/unknown/refused/unavailable messages distinguish state-only proof from a usable recipe DTO. Fields stay locked; neither absence nor expiry grants a new create. Committed results offer recipe-box navigation without auto-calling onCreated or guessing a recipe ID. The unchanged exact POST retry is explicitly named **Retry original save** under a compact native disclosure and disabled after committed/expired inspection, while server/local original age rules still apply. Inspection is available after the command's send window; reading does not renew that window.

Source fixtures adapt explicit retry semantics and describe GET-only present/absent inspection with unchanged key/hash, locked fields and no selection callback. UNRUN. Ordinary attempt storage remains mounted memory, not durable all-store recovery. Actual focus/Back/unmount/callback/locale/responsive/native/old-reader/restore acceptance remains open, and existing identity migration remains unapplied. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Ordinary recipe foreground lifetime — 2026-10-25 (#460/#135/#136)

The ordinary RecipeEditor form now shares one mounted lifetime/epoch/controller across receipt inspection and foreground create/edit transport. Unmount aborts the active transport and retires late response/state/selection/saving callbacks, including bridges that ignore abort. Write completion checks mounted lifetime plus current original-owner continuity before applying any response; latest parent callbacks are used within the admitted lifetime. Retry/submit catch/finally paths likewise avoid touching a retired parent. Existing synchronous mutation latches, immutable create packet/body/key/issue time, explicit retry and adopted boundary remain.

One ignored-abort ordinary-create/unmount callback fixture is authored, UNRUN. An abort/retired callback never proves that the server did not commit; no original request is recreated or automatically discarded. Ordinary attempt durability is still mounted memory. Parent callback failures, same-component target replacement, native process death, restore/old-reader and actual mounted/rendered/locale/runtime acceptance remain open. Existing identity migration prerequisite is unapplied. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Confirmed recipe result survives parent handoff — 2026-10-26 (#460/#135/#499/#142)

Ordinary recipe save records a synchronous confirmed guard and visible read-only result before invoking optional parent selection/save callbacks. Confirmed fields and submit/retry are locked; no second body/key is generated if the host stays mounted or a synchronous callback throws. Known success is not reclassified as network uncertainty. Existing owner/lifetime admission still precedes confirmation. EN/ES guidance offers the known canonical recipe link and Close; raw callback errors are not rendered. Unchanged existing-recipe completion uses the same handoff behavior without issuing a new write.

Adopted create enters its existing completed view immediately after confirmed receipt retirement, before navigation release or onCreated. A failed/blocked handoff cannot leave a submitted/retry UI with its saved entry already retired. The known-present confirmation and recipe-box path remain available; no new journal/receipt/writer is introduced. Completion retains the callback captured at dispatch, preserving the parent route-generation guard if props refresh while waiting. Two ordinary/adopted callback-failure cases and one dispatch-generation case are authored, UNRUN. This is UI result ownership, not acceptance of arbitrary asynchronous host behavior, process death, restore/old-reader or actual mounted/rendered/locale/native behavior. Existing migration prerequisite remains unapplied. No QA/tests/checks/build/browser/CI/DB/migration/push/merge/deploy/activation ran.


### Notification write admission — 2026-10-26 source candidate

`POST /api/notifications` reads at most16KiB of JSON; `PATCH`/`DELETE` on that
route and `PATCH /api/notifications/snooze` read at most8KiB using the existing
stream-bounded reader. Oversized bodies return413; malformed JSON remains400.
Authentication and existing POST parent admission precede decoding. No accepted
request field or success body changes. Legacy decoder-only bridges have the
shared reader's post-decode bound, not a preallocation guarantee.

Single-row mark-read/delete now include both ID and authenticated user ID in
the database mutation predicate. Missing or foreign targets retain neutral404.
Bulk actions keep their existing user scope. Relative snooze minutes recompute
the target time on another deliberate request and are not an exact retry after
uncertainty; refresh the canonical inbox first. No schema/migration or provider
change. Fixture source is UNRUN; session-renewal, concurrent same-owner row
replacement, native/old-reader and all runtime acceptance remain separate.


### Canonical recipe detail browser read — 2026-10-26 source candidate

The existing detail page uses `recipe-detail-client.ts` and the shared bounded
recipe transport:15-second foreground deadline and1MiB JSON response. Replacing
a read or leaving the route aborts the page-owned controller; existing route/
request-generation guards still reject retired completions. Canonical404 maps
to the existing missing/foreign state without error-body decoding. Other read
failures keep the localized Retry state. No write or provider request is added.

The display projection checks the requested canonical ID, complete nested
ingredient/display fields, finite nonnegative amounts/times, positive servings
(or null), optional valid revision/time metadata and no more than100 unique
line IDs. Unrecognized fields are stripped. Unsupported legacy/malformed data
holds with Retry; it is never silently truncated, normalized or presented as
an empty recipe. These are read-shape bounds, not reapplication of write-time
text/portion limits. Advisory role loading uses the shared foreground helper
and64KiB body bound; failure grants no extra controls or server permission.

Seven fixture cases are authored, UNRUN. The existing server remains household
scoped and renews authority before responding, but this browser slice does not
pin detail, later edits or curation to one original owner generation. Same-ID
birth replacement, owner handoff, notification exact-link admission and current/
previous native acceptance remain separate work. No schema/migration/QA/release
or provider activation ran.


### Recipe detail owner continuity — 2026-10-26 source candidate

Detail GET and PATCH now admit the optional existing recipe-owner header against
the server-captured principal before reading recipe data or edit JSON. Successful
responses echo that marker. Legacy headerless response bodies remain unchanged.
PATCH passes the original role into the existing locked writer and detail reader.
The marker is comparison metadata, never a credential or source-read grant.

The browser detail helper now returns the validated recipe and owner together.
It refuses absent/malformed/mismatched successful metadata before decoding the
private body;401/403/409 hold the owner context. A canonical404 still maps to
the existing neutral missing state. The page retains its first admitted owner
across refreshes/route IDs in the same mounted lifetime and derives advisory
role controls from that owner, removing the separate auth read. Edit and
curation controls receive this original context and report owner holds to the
containing page, which retires reads and replaces all recipe/action content
with localized reload guidance. No owner is silently adopted on Retry.

The new detail reader holds against older servers without marker support. An
already-open edit followed by server rollback is a distinct unresolved case:
older PATCH readers may ignore this header and still accept the edit payload.
There is no strict edit-version/owner body refusal barrier in this slice, so
forward/rollback release acceptance is not established. No new safe-retry
promise, immutable recipe birth, full session-ID binding, durable edit journal
or grocery-action owner contract is added. Other actions still authorize in
their own canonical handlers; this page does not convert notifications or links
into capabilities. Five added owner-admission/response cases and existing
response fixtures are authored/adapted, UNRUN. No QA/checks/build/browser/DB/
migration/CI/push/merge/deploy or activation ran. #460/#135/#473 remain open.


### Recipe edit strict predecessor refusal — 2026-10-26 source candidate

This supersedes the preceding note that owner-bound edits had no body barrier.
New owner-bound editors send `edit_protocol: herewoven.recipe-edit.v1` and the
original `edit_owner` alongside the existing PATCH fields. The canonical strict
input accepts both together or neither; missing pairs, unknown versions and
malformed owners refuse. The route compares the body owner with its captured
principal before starting recipe effects, independently of the optional header.
Protocol/owner fields are stripped before building Recipe update data. Existing
legacy callers without either field retain the established edit path.

The inspected predecessor is base `3b4e1046fee45e5924ac24b3498f0e2ef26b5669`,
`src/lib/recipe-input-contract.ts` blob
`ef8b807f059b13c10f9fde0d014f6c18fa7c653f`: its update object is strict and has
neither edit field. The new command therefore cannot be admitted by that
source schema. The client does not remove metadata or retry an unbound body
after a refusal. This is source provenance, not an executed old-server test or
a compatibility claim about unknown older implementations.

Three new fixture cases cover pair/version validation, mismatched body-only
ownership refusal and matching ownership without metadata persistence; existing
editor payload assertions are adapted. All are UNRUN. No exact-edit receipt/
idempotency contract, original issue-time admission, immutable birth identity,
full session-ID binding or durable pending journal is supplied. Migration,
forward/rollback binaries, real DB concurrency and complete household/UI/native
acceptance remain separate. No QA/checks/build/browser/DB/CI/push/merge/deploy or
activation ran. #460/#135/#473 remain open.


### Reviewed revision required for bound recipe edits — 2026-10-26 source

The recipe detail projection now requires nonnegative safe-integer revision
metadata before rendering recipe actions. Owner-bound edit input additionally
requires `base_revision`; legacy unbound callers retain their prior shape. A
directly reused bound editor without a loaded revision refuses dispatch and
shows localized reload guidance. The existing PATCH row lock and revision
comparison reject an older form with `REVISION_CONFLICT` before changing recipe
or ingredient rows. No version is guessed, refreshed or silently rebased.

Three new fixture cases describe unversioned-detail refusal, stale bound-edit
refusal and whole-page access-loss masking. Existing owner/payload fixtures now
carry the reviewed revision; the dismissal/retry fixture uses validation400,
while permission403 has separate containing-page retirement coverage. All are
UNRUN. This is revision-based stale-write source behavior, not exact original
request receipt inspection or proof of no effect after an unknown response. A
same-ID replacement could share revision and still needs immutable birth
continuity. Durable pending edits, rebase/recovery UX, real row-lock/concurrency
and current/previous installed-client acceptance remain separate. No tests/
checks/build/browser/DB/migration/CI/push/merge/deploy or activation ran.


### Recipe edit response projection — 2026-10-26 source candidate

The browser edit response now uses the same `parseRecipeDetail` projection as
the canonical detail reader before passing data to `onSaved`. It validates
exact target ID, complete nested display/ingredient shape, finite numeric
fields, capped unique line identities and (for bound edits) revision metadata,
and strips unrelated response properties. Existing role/owner/lifetime guards
remain before this handoff. Ordinary create still hands off its existing
summary; this change concerns the full edit-detail result.

Malformed successful edit JSON becomes an unconfirmed outcome: no parent
recipe replacement or callback, no second request, and Save remains disabled
under the existing uncertainty behavior. This does not assert rollback or
provide receipt inspection. Legacy unbound editors may accept absent revision
metadata; newly bound edits and detail reads require it. No input/response is
silently truncated or reinterpreted as an empty recipe.

Two source fixture cases describe malformed-success containment and removal
of unrelated fields from a validated callback. Two existing page payload
assertions missed in the prior owner/revision changes are also adapted. All
are UNRUN. Durable recovery, source birth continuity, exact edit retries and
real client/DB/concurrency/rendered acceptance remain separate. No QA/checks/
build/browser/DB/CI/push/merge/deploy or activation ran.


### Ordinary bound recipe response admission before decoding — 2026-10-26

The ordinary editor create/edit transport now checks401/403 and successful
original-owner metadata immediately after receiving headers, before decoding
the body. Missing/changed successful metadata or access refusal retires the
owner view without waiting on proxy HTML or oversized/stalled JSON. Matching
replies retain the shared body/deadline bounds and detail projection. A
structured409 still uses the bounded decoder to distinguish revision conflict
from explicit owner refusal. The adopted draft transport remains separate.

Three source cases use a never-settling decoder to describe missing-owner,
changed-owner and denied-access responses; the decoder must remain uncalled.
They are UNRUN. No conclusion about server commit/rollback, body transport
cancellation, exact receipt recovery or durable pending state follows from
this response hold. No QA/checks/build/browser/DB/CI/push/merge/deploy ran.


### Recipe editor local owner containment — 2026-10-26 source candidate

The form now owns a sticky original-owner hold in addition to notifying its
containing page. A changed/missing owner prop masks private fields during the
render; the effect retires the request epoch, aborts local foreground work and
releases busy state. Response/receipt owner refusals use the same local hold.
Optional missing/throwing parent callbacks cannot restore fields or prevent
containment. Reload guidance is typed EN/ES and receives focus when appropriate.

Retained submit/retry/inspection/confirmation handlers refuse held work, and
write preflight compares the current owner ref rather than a dispatch closure's
old prop. The draft-change effect does not forward old private content to a
changed-owner callback. The original pending request body/key remain untouched;
no journal is purged, ownership reassigned, retry inferred or server rollback
asserted. Same-owner draft editing outside these signals is unchanged.

Three fixture cases describe absent/throwing callbacks and a prop-only owner
change without writes or forwarding the old draft. They are UNRUN. Durable
restore/cross-tab ownership, actual effect outcomes, full session identity and
role/native/rendered acceptance remain separate. No QA/checks/build/browser/
DB/CI/push/merge/deploy or activation ran.


### Exact event GET household predicate — 2026-10-26 source candidate

`GET /api/events?id=<id>` now scopes its lookup by both event ID and the
authenticated household before fetching event/creator data. Missing and foreign
IDs return the same404; the former foreign403 distinction is removed. An
explicit empty `id` or multiple `id` values returns400 rather than widening to
a family list or selecting an ambiguous value. Existing successful shape and
source attribution, established allowed family roles and collection reads stay
unchanged. This does not grant target access from a notification URL.

Three fixture cases are authored, UNRUN. Related-person projection, late-session
renewal across all legacy event reads, local recurring occurrence semantics and
actual DB/role/installed-client acceptance remain separate. No QA/checks/build/
browser/DB/CI/push/merge/deploy or provider activation ran.


### Event GET creator projection and final viewer renewal — 2026-10-26 source

Exact, paged-range and legacy `GET /api/events` now load scalar event rows and
project creator display objects from current same-household User queries, in
batches of100 events/at most100 distinct creator IDs. Missing/moved creators
become null; `created_by` stays scalar household history. Names are not fetched
through the unscoped event creator relation. Source attribution, event ordering,
paging/lookahead and established family-role policy remain.

The route freezes original actor/family/role/token-generation context and renews
it after event/person/source waits, before serializing successful private
no-store JSON. Changed context returns409 `EVENT_SCOPE_CHANGED`; current auth
refusal retains its response with private no-store. No loaded household body is
returned on refusal. Malformed/missing target errors remain separate.

Five source fixture cases cover moved creators in exact/range/legacy reads,
a viewer move during projection and bounded/minimal person projection. All are
UNRUN. This is point-in-time checking, not recall or serialization of related
people after lookup, original browser-session-ID binding, or coverage of event
mutation/SSR replies. No actual DB, role/native/rollback/recurrence acceptance,
QA/checks/build/browser/CI/push/merge/deploy or provider activation ran.


### Browser calendar range transport/projection — 2026-10-26 source candidate

`fetchPlanningRange` uses the existing foreground helper for one30-second
range-job deadline (all pages/headers/body waits) and an8MiB streamed response
limit per page. JSON-only older bridges retain the helper's post-decode bound,
not a preallocation guarantee. Non-success response bodies are not decoded.
The existing ten-page/2000-event budget remains, with explicit truncation only
when that deliberate budget is reached. Internal page budgets outside1–10 and
invalid/nonpositive/over45-day ranges refuse before dispatch.

Each page projects complete typed planning/source display fields, strict
calendar instants and nonnegative intervals (including existing zero-duration
points), range overlap, at most200 unique event IDs and bounded cursor metadata.
Empty continuation pages, within-page duplicate IDs, malformed metadata or
repeated cursors refuse. Unrelated properties are stripped; a failed/malformed
later page never returns an apparently complete partial calendar. Existing
cross-page ID reconciliation is retained, not a snapshot-convergence claim.

Seven new fixture cases describe a stalled later page, size refusal before
decoding, malformed display/time/duplicate rows, minimal projection and invalid
page budget. Existing pagination and one source-attribution fixture are adapted
to real response shape and the shared owned signal. All are UNRUN. No original
browser-owner pinning across pages, stable DB snapshot, local recurrence engine,
CPU/latency/memory benchmark or native/rendered/rollback acceptance is supplied.
No QA/tests/checks/build/browser/DB/CI/push/merge/deploy or activation ran.
