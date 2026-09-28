# Meals, recipes and groceries: canonical models and migration

Supporting detail for [ADR-0007](adr/0007-canonical-meal-recipe-grocery-models.md) (**Accepted 2026-09-27**, issue #149). If this file and the ADR disagree, the ADR wins. `prisma/schema.prisma` and the route source remain authoritative for what exists today.

## 1. Evidence base

- Inspected on `master` @ `2fd6cc5` on 2026-09-27. Static source inspection only. No production data was read, and no row counts in this document come from a live database.
- #148 (route/domain inventory, deliverable `docs/refactor/ROUTE_AND_DOMAIN_INVENTORY.md`) is **still open and its output does not exist**. `EXECUTION_ORDER.md` puts #149 after #148. To avoid blocking on it, this document includes its own inventory of the meal/list slice (§2). #148 must reconcile with it and trigger the ADR's revisit clause if it finds another live path.
- The idempotency primitive (`src/lib/idempotency.ts`, `IdempotencyRecord`, `Idempotency-Key`) is on `master` (merged in #247 for #162). Child D builds on it.

## 2. Source inventory

### 2.1 Prisma delegate usage (non-test source)

Command: `grep -rnoE "(prisma!?|\(prisma as any\)|tx|db|client)\.(<model>)\b" src scripts`, with test files excluded from the "live" column.

| Model | Non-test call sites | Files | Classification |
| --- | --- | --- | --- |
| `familyMeal` | 7 | `api/meals/route.ts` (2), `api/meals/[id]/route.ts` (4), `dashboard/today/today-board-data.ts` (1) | Live: UI + fridge board |
| `list` | 13 | `api/lists/{route,create,items,items/create}`, `dashboard/lists/{page,[listId]/page,type/[type]/page}`, `api/users/export`, `lib/fixtures/seed.ts` | Live |
| `listItem` | 12 | `api/lists/items/{route,create,update,delete}`, `dashboard/lists/[listId]/page`, `lib/shopping-snapshot.ts`, `lib/fixtures/seed.ts` | Live: UI + fridge Shopping card + fixtures |
| `recipe` | 2 | `imports/persist-meal-planner.ts`, `api/users/export` | Import + export only |
| `ingredient` | 1 | `imports/persist-meal-planner.ts` | Import only |
| `recipeIngredient` | 1 | `imports/persist-meal-planner.ts` | Import only |
| `mealPlan` | 2 | `imports/persist-meal-planner.ts`, `api/users/export` | Import + export only |
| `mealPlanEntry` | 1 | `imports/persist-meal-planner.ts` | Import only (exported nested under `mealPlan`) |
| `shoppingList` | 2 | `imports/persist-meal-planner.ts`, `api/users/export` | Import + export only |
| `shoppingItem` | 1 | `imports/persist-meal-planner.ts` | Import only (exported nested) |
| `importJob` / `importedRecord` | 11 / 6 | the three `persist-*.ts` importers, `api/admin/imports`, export | Import provenance (keep) |

`fetch('/api/…')` callers outside `src/app/api`:
- `/api/meals` is called only by `src/app/dashboard/meals/page.tsx`.
- `/api/lists*` is called by `dashboard/lists/[listId]/ListDetailClient.tsx`, `dashboard/lists/create/page.tsx`, `[listId]/DeleteListButton.tsx` and `components/capture/CaptureBox.tsx`.
- Nothing calls a recipe, meal-plan or shopping-list endpoint, because none exists.

### 2.2 Live paths

| Journey | UI | API | Tables |
| --- | --- | --- | --- |
| Plan a meal for a day and slot | `/dashboard/meals` (client, 7-day grid) | `GET/POST /api/meals`, `PATCH/DELETE /api/meals/[id]` (`featureGate('meals')`, `cook_id` family check) | `FamilyMeal` |
| Tonight's dinner on the fridge | `/dashboard/today`, `/device/*` board | `today-board-data.ts` (dinners in window, `recipe_name`, cook name; no `notes`) | `FamilyMeal` |
| Grocery and generic lists | `/dashboard/lists`, `/lists/[listId]`, `/lists/type/[type]`, `/lists/create` | `/api/lists` GET/DELETE, `/api/lists/create`, `/api/lists/items{,/create,/update,/delete}` | `List`, `ListItem` |
| Quick capture "something to buy" | `CaptureBox` | first `grocery` list (or `lists[0]`, or creates `Shopping`/`grocery`) → `/api/lists/items/create` | `List`, `ListItem` |
| Groceries on the fridge | Today board Shopping card | `shopping-snapshot.ts` (unchecked items on `grocery`/`shopping` lists) | `ListItem` via `List` |
| Offline grocery tick (PR #247, open) | list page | `POST /api/lists/items/update` + `Idempotency-Key`; queue op `list-item.set-checked {itemId}` | `ListItem`, `IdempotencyRecord` |
| Import from the Meal Planner app | `/dashboard/settings/imports` | `POST /api/admin/imports/meal-planner` (parent, dry-run default) | `Recipe`, `Ingredient`, `RecipeIngredient`, `MealPlan`, `MealPlanEntry`, `ShoppingList`, `ShoppingItem`, `ImportJob`, `ImportedRecord` |
| Data export | settings | `GET /api/users/export` | `List`+items, `Recipe`+ingredients, `MealPlan`+entries, `ShoppingList`+items. **`FamilyMeal` is missing.** |

### 2.3 Dead or unused code found

- `src/components/lists/{ShoppingListView,ListItemRow,ListItems,DeleteListButton,ListsFilterTabs}.tsx` are imported by nothing in `src/app`. They are the only code that reads `ListItem.price`/`purchased` and `List.is_repeatable`/`last_purchased_at`, and no live API writes those columns (`updateListItemSchema` does not accept them).
- The `meal_plan` list type (`createListSchema`, `lists/create` picker) is a third, free-text meal representation with no link to meals.

### 2.4 Gaps found (fixed by child issues, not here)

1. `/dashboard/meals` `buildDayPlans` keeps only the first meal per (day, type) (`dayMeals.find(...)`). The API allows several, so any extra rows are invisible and cannot be edited → child C.
2. The user export omits `FamilyMeal` → child B.
3. `/api/lists/**` has no server `featureGate('lists')`. Every other domain route uses `featureGate` (40 route files) → child B (O-11).
4. `ShoppingItem.recipe_id` is a bare column with no FK or relation, so it can reference a missing or foreign recipe → handled in the backfill (§6).
5. `MealPlanEntry`, `ShoppingItem` and `RecipeIngredient` have no `family_id`. Ownership is nested (plan, list, recipe).

## 3. Canonical path per user journey

| Journey | Canonical write path | Canonical read path |
| --- | --- | --- |
| Plan/edit/delete a meal slot | `POST /api/meals`, `PATCH/DELETE /api/meals/[id]` → `FamilyMeal` | `GET /api/meals` |
| Link a meal to a recipe | the same routes with optional `recipe_id` (validated to be in the household) | `GET /api/meals` includes `recipe {id,title,prep_time,cook_time,servings}` when linked |
| Tonight card | none (read-only board) | `today-board-data.ts` → `FamilyMeal` (+ recipe title/prep when linked) |
| Create/edit a recipe with ingredients | new `POST/PATCH/DELETE /api/recipes[/id]` → `Recipe`, `RecipeIngredient`, `Ingredient` (upsert by family + name) | `GET /api/recipes[/id]` |
| Grocery list add/tick/edit/delete | `/api/lists/items/{create,update,delete}` → `ListItem` on a `grocery`/`shopping` `List` | `/api/lists/items`, `shopping-snapshot.ts` |
| Add a recipe's (missing) ingredients to groceries | new `POST /api/lists/items/from-recipe` (Idempotency-Key) → `ListItem` with `source='recipe'` | as above |
| Inventory (#121/#158) → missing ingredients | new inventory models reference `Ingredient.id`. The client passes the missing `ingredientIds` to `from-recipe`. | inventory API (future) |
| Generic to-do, wishlist and other lists | `/api/lists/**` → `List`/`ListItem` (unchanged) | unchanged |
| Import from Meal Planner | `POST /api/admin/imports/meal-planner`, retargeted to write `Recipe*`, `FamilyMeal`, `List`/`ListItem`, with provenance in `ImportedRecord` | admin imports list |
| Legacy `MealPlan*`/`Shopping*` rows | none (frozen) | export only, until contract |

## 4. Legacy → canonical field mapping

### `MealPlanEntry` (+ parent `MealPlan`) → `FamilyMeal`

| Canonical | Source | Rule |
| --- | --- | --- |
| `family_id` | `MealPlan.family_id` | always the plan's family |
| `date` | `MealPlanEntry.date` (DATE) | UTC midnight timestamp, the same convention as `parseDateOnly` |
| `meal_type` | `MealPlanEntry.meal_type` | `lower(trim())`. Values outside `breakfast\|lunch\|dinner\|snack` are **skipped and reported**, never coerced. |
| `recipe_id` | `MealPlanEntry.recipe_id` | only if the recipe's `family_id` matches. Otherwise the entry is **skipped, archived and reported** (`foreign_recipe`): its only content is the recipe reference, so a copy would be an empty slot or would carry another household's title (implemented in #250). |
| `recipe_name` | `Recipe.title` | snapshot for old clients and the board |
| `servings` (new) | `MealPlanEntry.servings` | |
| `notes`, `cook_id` | none | null |
| `created_by` | `MealPlan.created_by` | kept only if that user is a member of the plan's family. Otherwise (a user in another household, or missing) it becomes the **in-family fallback actor** (`--started-by` if given, else the family's oldest parent), reported as a creator remap; with no such actor the entry is skipped and archived (`no_in_family_actor`). The foreign id is never copied (#256 review). |
| provenance | `ImportedRecord(source_app='fp-canonical-149', source_model='MealPlanEntry', source_id, target_model='FamilyMeal', target_id)` | also stores `MealPlan.name` and range in the `ImportJob.summary` |

**`MealPlan` itself has no canonical row** (O-2: archive only). Its canonical target is the backfill `ImportJob` that archives its name and range: the backfill records `ImportedRecord(source_model='MealPlan', source_id, target_model='ImportJob', target_id=<that job>)`. Existing importer mappings `ImportedRecord(target_model='MealPlan')` are rewritten to the same `ImportJob` target in child E step 1, never deleted, so re-importing the same meal-planner export still recognizes the plan and creates 0 rows. The retargeted importer (child B) treats any existing mapping for a source `MealPlan` id as "already imported", whatever its `target_model`.

**Collision** (a `FamilyMeal` already exists for the same family, date and type):
- Same name (case-insensitive, trimmed) → **link**: set `recipe_id` only if it is null, record the mapping, and create no row.
- Different name → **insert as an additional meal** (O-1 = allow). If Cameron chooses O-1 = one meal per slot, the rule becomes **skip and report** instead.

### `ShoppingList` → `List`; `ShoppingItem` → `ListItem`

| Canonical | Source | Rule |
| --- | --- | --- |
| `List.family_id/name/created_by/created_at` | same fields | `type='grocery'`, `description='Imported from Meal Planner'`. One `List` per `ShoppingList`; not merged into an existing list. `created_by` follows the same membership rule as `FamilyMeal.created_by` (remap to the in-family fallback actor, or skip + archive the list and its items as `no_in_family_actor`). |
| `ListItem.content` | `ingredient_name` | trimmed; empty → skip and report |
| `ListItem.amount`, `unit`, `category` (new/existing) | same | |
| `ListItem.quantity` | none | 1 |
| `ListItem.checked` | `checked` | `checked_by`/`checked_at` null (unknown) |
| `ListItem.added_by` | `ShoppingList.created_by` | same membership rule (remap or `no_in_family_actor`). `checked_by`/`checked_at` and `FamilyMeal.cook_id` stay null, so no other user id is copied. The inserts re-check membership in SQL. Archived rows in `ImportJob.summary` (`mealPlans[]`, `skipped[]`) have a foreign or missing `created_by` replaced by `null` with `created_by_redacted`, so no other household's user id lands in this family's exportable data; `summary.remapped[]` lists each remapped source row and column. |
| `ListItem.recipe_id` | `recipe_id` | kept only if the recipe exists **and** is in the same family, otherwise null + reported |
| `ListItem.ingredient_id` | none | set when an `Ingredient` in the same family has the normalized name, otherwise null |
| `ListItem.source` / `source_key` | none | `'import'` / null (import rows never take part in the recipe dedupe index) |
| `ListItem.position` | none | source order within the list |
| provenance | `ImportedRecord(source_app='fp-canonical-149', source_model='ShoppingList'\|'ShoppingItem', …, target_model='List'\|'ListItem')` | |

`Recipe`, `Ingredient` and `RecipeIngredient` need no copying. They are already canonical.

## 5. Schema expand sketch (child A)

This is additive only. Prisma cannot express the partial unique index, so `scripts/migrate.js` `POST_FEATURE_SQL` owns it, and a schema comment points to it.

```sql
-- FamilyMeal: recipe link (ADR-0007)
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "servings" INTEGER;
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DO $$ BEGIN ALTER TABLE "FamilyMeal" ADD CONSTRAINT "FamilyMeal_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "FamilyMeal_recipe_id_idx" ON "FamilyMeal"("recipe_id");

-- ListItem: grocery provenance (ADR-0007)
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "ingredient_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "meal_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source_key" TEXT; -- immutable 'meal:<id>' | 'recipe:<id>'
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source_request_id" TEXT; -- IdempotencyRecord.id of the from-recipe request that created the row (undo + replay provenance)
CREATE INDEX IF NOT EXISTS "ListItem_source_request_id_idx" ON "ListItem"("source_request_id");
-- FKs: ingredient_id -> Ingredient, recipe_id -> Recipe, meal_id -> FamilyMeal, all ON DELETE SET NULL
CREATE INDEX IF NOT EXISTS "ListItem_ingredient_id_idx" ON "ListItem"("ingredient_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ListItem_open_recipe_source_key"
  ON "ListItem"("list_id", "ingredient_id", "source_key")
  WHERE "checked" = false AND "source_key" IS NOT NULL AND "ingredient_id" IS NOT NULL;
```

Why `source_key` is a text column and not `COALESCE(meal_id, recipe_id)`: the FKs are `SET NULL`. With an expression index, deleting a meal would null `meal_id` and could turn two distinct open rows into a unique-index collision, which would make the meal `DELETE` fail. A text key that is never rewritten avoids that.

Edge case: unticking a recipe item whose (list, ingredient, source) now has another open row violates the index. `PATCH /api/lists/items/update` must map that `P2002` to 409 `DUPLICATE_OPEN_ITEM`. The #247 queue already surfaces 409 as `conflict`, with Retry/Discard.

## 6. Backfill (child A tool, production run gated)

Script: `scripts/backfill-meals-groceries.mjs` (name indicative). It uses the same target guard style as `fixtures.mjs` for rehearsal databases, and needs `BACKFILL_ALLOW_PRODUCTION=1` plus Cameron's approval for production.

- **Default dry-run.** It prints, for each family, the counts of source rows, rows that would be created, linked, skipped (with reasons) and foreign references nulled. It writes nothing.
- **Apply mode.** It processes one family per transaction. It creates one `ImportJob(source_app='fp-canonical-149', dry_run=false, started_by=<--started-by or the family's oldest parent>)` and records every mapping in `ImportedRecord`. Before creating anything it checks `ImportedRecord`, so a re-run or a resume after a crash creates 0 duplicates. This is the same pattern as `persist-meal-planner.ts`.
- **Skipped rows are archived, never dropped.** Every skipped source row (unrecognized `meal_type`, empty `ingredient_name`, or any other skip reason) is written verbatim (all columns, as JSON) with its reason into `ImportJob.summary.skipped[]` of that family's backfill job. The user export includes backfill `ImportJob` summaries, so the last exportable copy of a skipped row survives the contract step. Each run prints the skipped count per family.
- **Never** updates or deletes legacy rows. The only change to a live canonical row is the collision "link", which sets `FamilyMeal.recipe_id` only where it is null.
- **Reverse mode** (rehearsal and emergency): deletes canonical rows created by a given job only while they are unmodified (`FamilyMeal.updated_at = created_at`; `ListItem.updated_at = created_at`). It reports anything it had to keep.

### Read-only rehearsal/audit queries

Run these on a rehearsal copy, or on production only by Cameron or with his approval. They output counts only, no content.

```sql
-- Legacy volume per family
SELECT f.id,
  (SELECT count(*) FROM "MealPlan" p WHERE p.family_id = f.id)                        AS meal_plans,
  (SELECT count(*) FROM "MealPlanEntry" e JOIN "MealPlan" p ON p.id = e.meal_plan_id WHERE p.family_id = f.id) AS entries,
  (SELECT count(*) FROM "ShoppingList" s WHERE s.family_id = f.id)                    AS shopping_lists,
  (SELECT count(*) FROM "ShoppingItem" i JOIN "ShoppingList" s ON s.id = i.shopping_list_id WHERE s.family_id = f.id) AS shopping_items
FROM "Family" f;

-- Unmappable meal types
SELECT lower(trim(meal_type)) AS t, count(*) FROM "MealPlanEntry"
WHERE lower(trim(meal_type)) NOT IN ('breakfast','lunch','dinner','snack') GROUP BY 1;

-- Slot collisions with live meals
SELECT count(*) FROM "MealPlanEntry" e JOIN "MealPlan" p ON p.id = e.meal_plan_id
JOIN "FamilyMeal" m ON m.family_id = p.family_id AND m.date = e.date::timestamp AND m.meal_type = lower(trim(e.meal_type));

-- ShoppingItem.recipe_id pointing at a missing or foreign recipe
SELECT count(*) FROM "ShoppingItem" i JOIN "ShoppingList" s ON s.id = i.shopping_list_id
LEFT JOIN "Recipe" r ON r.id = i.recipe_id
WHERE i.recipe_id IS NOT NULL AND (r.id IS NULL OR r.family_id <> s.family_id);

-- Live meals hidden today by the one-per-slot UI (gap 2.4.1)
SELECT count(*) FROM (SELECT family_id, date, meal_type FROM "FamilyMeal" GROUP BY 1,2,3 HAVING count(*) > 1) d;
```

### Synthetic rehearsal (fixtures)

Extend `src/lib/fixtures/dataset.ts` (#154) with legacy rows in both fixture households:
- Family A: a `MealPlan` with 3 entries (dinner that collides by name with an `fx_` `FamilyMeal`, dinner that collides with a different name, lunch with no collision), one `MealPlanEntry` with `meal_type='Brunch'`, and a `ShoppingList` with 2 items (one checked, one linked to an A recipe).
- Family B: a `ShoppingItem.recipe_id` pointing at a Family A recipe (foreign injection), plus a `ShoppingItem` with an empty name.
- Canonical `fx_` `Recipe`/`Ingredient`/`RecipeIngredient` rows so the fixtures' meal and recipe data follow the canonical model (TEST_DATA.md).

Expected results:
- A: 2 `FamilyMeal` created, 1 linked, 1 skipped (`Brunch`); 1 `List` + 2 `ListItem` created.
- B: the foreign `recipe_id` is nulled and reported; 1 item skipped.
- A second apply creates 0 rows.
- Reverse removes exactly the created rows.

## 7. Recipe → grocery contract (child D)

`POST /api/lists/items/from-recipe`
- Auth: `authenticateWithFamily`; `featureGate('meals')` and `featureGate('lists')`; roles parent, teen and child; device sessions refused (403) until #157 device writes exist.
- Header `Idempotency-Key` is **required** (400 `IDEMPOTENCY_KEY_REQUIRED` if missing). Wrapped in `withIdempotency` (PR #247) with action `grocery.add-from-recipe` and scope `user:<id>`.
- Body (Zod): `{ recipeId: string; mealId?: string; listId?: string; servings?: int 1..50; ingredientIds?: string[] (max 100, subset of the recipe's) }`.
- Validation: the recipe is in the household. The meal, if given, is in the household and has `recipe_id === recipeId` (otherwise 400). The list, if given, is in the household and has type `grocery` or `shopping` (otherwise 400/404 without revealing foreign existence). Without `listId`, the server resolves the default list per O-4 using `resolveDefaultGroceryList(familyId)`, under `pg_advisory_xact_lock(hashtext(family_id))`, so concurrent first adds create a single "Groceries" list. `CaptureBox` moves to the same helper.
- Scaling: `amount = RecipeIngredient.amount × (servings ?? meal.servings ?? recipe.servings) / recipe.servings`, rounded to 2 decimal places. `unit = RecipeIngredient.unit ?? Ingredient.unit`.
- Write: one `createMany({ skipDuplicates: true })` of rows with `source='recipe'`, `source_key = mealId ? 'meal:'+mealId : 'recipe:'+recipeId`, `source_request_id` = the request's `IdempotencyRecord.id`, `ingredient_id`, `recipe_id`, `meal_id`, `content = Ingredient.name`, `quantity=1`, `amount`, `unit`, `added_by`. The partial unique index turns a race into a skip.
- Response 201 is **compact and bounded** so it always fits the #247 replay cap (`IDEMPOTENCY_MAX_BODY_CHARS`, 8 KiB) even at the 100-ingredient maximum: `{ listId, requestId, createdCount, alreadyOnListCount, possibleDuplicates: [{ ingredientId, matchedItemId }] (at most 20, plus possibleDuplicatesTruncated) }`. No per-row id arrays; the client refetches the list to render. A test asserts the serialized body stays under the cap for 100 ingredients with maximal-length ids. The same body is replayed with `Idempotency-Replayed: true`.
- Undo (O-5): `POST /api/lists/items/undo-add { requestId }` deletes only still-unchecked rows with `source_request_id = requestId` created by the same user within 10 minutes. It relies on row provenance, not on the stored replay body; everything else returns 403 or 409.
- Not offline-queueable in v1 (O-10). The `OFFLINE_SYNC.md` allowlist is unchanged.

## 8. Compatibility and rollback summary

| Step | Old WebView bundle / queued #247 ops | App rollback | Data rollback |
| --- | --- | --- | --- |
| A expand | unaffected (new columns nullable/defaulted) | safe; columns unused | not needed; columns may stay |
| B API | additive response fields; old request bodies still valid | safe | none |
| C UI | old bundle keeps working against the same routes | safe | none |
| D from-recipe | new route only | route disappears; created rows stay as normal items | undo endpoint / manual |
| Production backfill | no ID changes to existing rows | safe | reverse mode while rows are unmodified; partial after edits; legacy rows untouched |
| E contract | none (legacy never read by clients) | **unsafe after drop** | backup restore only |

## 9. Child issues (ready to file)

### A. [Data] Expand meal/grocery canonical schema and add a dry-run backfill (ADR-0007)

**Outcome:** The canonical tables can hold recipe links and grocery provenance, and there is a rehearsed, resumable tool that copies legacy `MealPlanEntry`/`ShoppingList`/`ShoppingItem` rows into `FamilyMeal`/`List`/`ListItem` without losing any.

**Scope**
- `prisma/schema.prisma` and `scripts/migrate.js` `POST_FEATURE_SQL`: the additive columns, FKs (`SET NULL`), indexes and partial unique index in §5. Idempotent DDL.
- `scripts/backfill-meals-groceries.mjs`: dry-run default, per-family apply, reverse mode, and target guard (§6). Skipped rows archived verbatim in `ImportJob.summary.skipped[]`; `MealPlan` → `ImportJob` mappings recorded (§4).
- Fixture extensions in `src/lib/fixtures/dataset.ts`/`seed.ts` (§6 synthetic rehearsal).
- A `docs/runbooks/` entry for the gated production run.

**Acceptance criteria**
- [ ] `node scripts/migrate.js` runs twice on a fresh database and twice on a copy of the pre-change schema without error.
- [ ] Dry-run on the fixtures prints the expected §6 counts and writes nothing.
- [ ] Apply matches the expected counts; a second apply creates 0 rows; reverse removes exactly the created rows.
- [ ] A foreign `recipe_id` is nulled and reported, and no cross-household row is created.
- [ ] Legacy tables are byte-identical before and after apply.
- [ ] No production run in this issue.

**Tests:** a DB integration test (the same CI Postgres pattern as `fixtures.integration.test.ts`) covering dry-run, apply, re-apply, reverse and two-household isolation; unit tests for the mapping and normalization functions.

**Boundary:** additive schema and tooling only. Running against production requires Cameron's explicit approval for that run. No drops, no updates to legacy rows.

### B. [API] Unify meal, recipe and grocery APIs on the canonical models (ADR-0007)

**Outcome:** Recipes have a live family-scoped API, meals can link to recipes, list items carry provenance, and the importer writes canonical rows.

**Scope**
- `GET/POST /api/recipes`, `GET/PATCH/DELETE /api/recipes/[id]` with nested ingredients (upsert `Ingredient` by family + normalized name). `featureGate('meals')`. Roles per O-7.
- `/api/meals` POST/PATCH accept optional `recipe_id` and `servings`; GET includes `recipe` summary. If `recipe_name` is omitted and `recipe_id` is set, `recipe_name` is filled from the recipe title.
- `/api/lists/items/create|update` accept optional `amount`, `unit` and `ingredient_id` (household-validated); responses include the new fields; `featureGate('lists')` on all `/api/lists/**` (O-11); 409 `DUPLICATE_OPEN_ITEM` mapping (§5).
- `GET /api/users/export` adds `FamilyMeal` and keeps the legacy tables.
- `persist-meal-planner.ts`: `MealPlanEntry` → `FamilyMeal`, `ShoppingList`/`Item` → `List`/`ListItem` (`source='import'`), existing mappings still honoured.
- Shared-device board DTO: optional recipe title and prep time for tonight; no notes.

**Acceptance criteria**
- [ ] Two-household negative tests: foreign `recipe_id` on a meal, foreign `ingredient_id` on a list item, foreign recipe/ingredient ids in recipe bodies, and cross-family recipe reads all return 404/400 without revealing existence.
- [ ] Old-shape request fixtures for `/api/meals` and `/api/lists/items/*` still pass unchanged.
- [ ] Re-importing the same meal-planner export after the retarget creates 0 rows; a new export writes only canonical tables.
- [ ] A code search shows no product writer of `MealPlan*` or `Shopping*`.
- [ ] `ROLE_AND_ISOLATION_MATRIX.md`, `API_CONTRACTS.md` and `docs/security/API_ISOLATION_AUDIT.md` are updated.

**Tests:** route tests (happy path, validation, role, feature-gate, isolation); importer integration test; export test that includes `FamilyMeal`.

**Boundary:** no UI rework beyond what the API needs, no destructive migration, no device writes.

### C. [UI] Move meals and grocery UI onto the canonical models (ADR-0007)

**Outcome:** People can see every planned meal, pick or create a recipe for a meal, and see amounts and provenance on grocery items. The informal `meal_plan` list type stops growing.

**Scope**
- `/dashboard/meals`: render every meal per slot (fixes gap 2.4.1); recipe picker and create in the meal modal; recipe detail view (ingredients, prep/cook time).
- Grocery list rows: show `amount unit` when present, and "from <recipe>" provenance; group open rows by `ingredient_id`.
- Remove `meal_plan` from the create-list picker (O-8); existing ones still open.
- Delete the unused `src/components/lists/*` components after confirming no imports (§2.3).
- Figma/spec reference per #150–#153 for the meal and recipe views.

**Acceptance criteria**
- [ ] Two meals in one slot are both visible, editable and deletable.
- [ ] Meals without a recipe (free text) behave exactly as today.
- [ ] Responsive QA at 390×844, 800×1280 and 1280×800; empty, loading, error and long-text states; ≥44px targets; no colour-only meaning.
- [ ] Kid/teen role views match the matrix.

**Tests:** component tests; Playwright journeys for meals (add free text, add with recipe, two meals per slot) and grocery provenance display; visual baselines updated deliberately.

**Boundary:** no tablet write flows (device writes stay off), no inventory UI.

### D. [Meals→Groceries] Add recipe ingredients to groceries idempotently (ADR-0007, #122)

**Outcome:** From a meal or recipe, a family member can add all or selected ingredients to the grocery list once, even with retries, double taps or two devices, and can undo it.

**Scope:** `POST /api/lists/items/from-recipe` and `POST /api/lists/items/undo-add` per §7; the `resolveDefaultGroceryList` helper, adopted by `CaptureBox`; UI actions on the meal modal and recipe detail with a result toast (added / already on list / possible duplicates) and Undo.

**Depends on:** PR #247 (`withIdempotency`, `IdempotencyRecord`) merged; A and B.

**Acceptance criteria**
- [ ] Same key replays with no new rows; the same key with a different body returns 422.
- [ ] 8 concurrent requests with one key produce one set of rows; two different keys for the same meal produce one open row per ingredient.
- [ ] Checked items don't block; a different meal adds its own rows; a free-text lookalike is flagged, not merged.
- [ ] Two-household negative tests for the recipe, meal and list ids.
- [ ] Device session gets 403; child role allowed.
- [ ] Undo removes only that request's unchecked rows, only for the same user, within 10 minutes.

**Tests:** route unit tests, a real-Postgres concurrency test (as in #247), and an E2E add → replay → undo.

**Boundary:** no inventory matching (the client passes `ingredientIds`), no offline queueing, no purchasing or provider integrations.

### E. [Data] Contract legacy meal/shopping tables (ADR-0007) — gated

**Outcome:** The legacy `MealPlan`, `MealPlanEntry`, `ShoppingList` and `ShoppingItem` tables are retired only after evidence shows nothing depends on them.

**Preconditions (all required):** ADR-0007 accepted; A–D merged and deployed; the production backfill run approved and completed with a reconciled report; at least one release cycle with zero legacy reads or writes; a verified backup/restore (`docs/runbooks/`) taken immediately before; every skipped legacy row archived in a backfill `ImportJob.summary.skipped[]` (the reconciliation report shows source count = created + linked + archived-skipped per family, and any unarchived skip blocks the drop); the user export includes backfill `ImportJob` summaries; **Cameron's explicit approval for the drop.**

**Scope**
1. Rewrite `ImportedRecord` rows whose `target_model` is a legacy table to their canonical target, using the backfill mappings. `MealPlan` mappings are rewritten to the backfill `ImportJob` that archives the plan (§4); no mapping is deleted.
2. Remove the legacy tables from the export (their content is now exported via canonical tables).
3. Remove the models from `schema.prisma` and drop the tables in `migrate.js`, guarded.
4. Remove `database/migration-meal-planner-domains.sql` statements for the dropped tables, or make them no-ops.

**Acceptance criteria**
- [ ] Rehearsed on a restored production-shaped copy; canonical counts are unchanged by the drop.
- [ ] Re-importing an old meal-planner export creates 0 rows after step 1.
- [ ] Rollback documented as backup restore only.

**Tests:** migration rehearsal twice; importer re-run test against the post-contract schema.

**Boundary:** destructive. Nothing in this issue runs in production without that exact approval.
