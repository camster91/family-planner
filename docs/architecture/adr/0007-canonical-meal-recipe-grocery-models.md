# ADR-0007: Canonical meal, recipe, grocery and list models

**Status:** Proposed — pending Cameron's acceptance
**Date:** 2026-09-27
**Owners:** Cameron (decision); implementing agents (child issues)
**Supersedes (on acceptance):** the provisional "exact canonical models pending" clause of [ADR-0005](0005-canonical-data-before-new-writes.md). The ADR-0005 constraint itself (no broad cross-domain writes before canonicalization, no third model generation) stays in force.
**Related issues/PRs:** #149 (this decision), #122 (meal → grocery flow), #121 / #158 (inventory), #148 (route/domain audit, still open), #162 / PR #247 (idempotency + offline queue), #157 (shared device), #102 (isolation), #134 / #143 (architecture parents)
**Detail:** [`../MEALS_AND_GROCERIES.md`](../MEALS_AND_GROCERIES.md) has the source inventory, field mapping, backfill algorithm, rehearsal queries and the ready-to-file child issue bodies.

## Context

The schema has two generations for meals and groceries. Source inspection on `master` @ `2fd6cc5` (2026-09-27) shows which are live:

| Model | Live writers (non-test) | Live readers (non-test) | Role today |
| --- | --- | --- | --- |
| `FamilyMeal` | `/api/meals` POST, `/api/meals/[id]` PATCH/DELETE | `/api/meals` GET → `/dashboard/meals`; fridge Today board (`today-board-data.ts`, dinners) | **Live** meal planner |
| `List` / `ListItem` | `/api/lists/create`, `/api/lists/items/{create,update,delete}`, `DELETE /api/lists`; capture (`CaptureBox` → type `grocery`); fixtures | `/dashboard/lists/**`; fridge Shopping card (`shopping-snapshot.ts`, types `grocery`/`shopping`); user export | **Live** groceries and generic lists; PR #247 makes `ListItem` check/uncheck the first idempotent offline action |
| `Recipe`, `Ingredient`, `RecipeIngredient` | meal-planner importer only (`persist-meal-planner.ts`) | user export only | Import landing zone; no UI or API |
| `MealPlan`, `MealPlanEntry` | meal-planner importer only | user export only | Import landing zone; invisible in the product |
| `ShoppingList`, `ShoppingItem` | meal-planner importer only | user export (`shoppingList`) only | Import landing zone; invisible in the product |

So the overlap is real but asymmetric: every user-visible meal and grocery write already goes to `FamilyMeal` and `List`/`ListItem`. The newer tables only receive data from the parent-only `POST /api/admin/imports/meal-planner` import, and that data is never displayed. The only recipe structure in the codebase (`Recipe` + `RecipeIngredient` + `Ingredient`) exists only in the import generation. There is also a third, informal meal representation: generic lists of type `meal_plan`, which users can create in `/dashboard/lists/create`.

The fridge flow (#122: inventory → meal → missing ingredients → groceries) needs one write path for each step.

## Decision

1. **Meal slots:** `FamilyMeal` through `/api/meals` is the canonical meal-plan write path. It is expanded additively with a nullable `recipe_id` (FK to `Recipe`, `ON DELETE SET NULL`), a nullable `servings` and an `updated_at`. `recipe_name` stays as the display snapshot so old clients and the fridge board keep working.
2. **Recipes:** `Recipe`, `Ingredient` and `RecipeIngredient` are the canonical recipe models. This is the only recipe generation, so no new one is added. A new family-scoped `/api/recipes` becomes their live write path, gated by the `meals` feature.
3. **Groceries and generic lists:** `List` + `ListItem` through `/api/lists/**` is the canonical grocery and list write path. Lists of type `grocery` and `shopping` are grocery lists, as `SHOPPING_LIST_TYPES` already defines. `ListItem` is expanded additively with nullable `ingredient_id`, `recipe_id` and `meal_id` (all `ON DELETE SET NULL`), `amount` (float), `unit`, and `source` (`manual` | `capture` | `recipe` | `import`, default `manual`).
4. **Recipe → grocery:** one new endpoint, `POST /api/lists/items/from-recipe`, adds missing ingredients to a grocery list. It requires an `Idempotency-Key` and uses the `withIdempotency` primitive (`src/lib/idempotency.ts`, `IdempotencyRecord`) from PR #247 / #162. Duplicate rules are listed below.
5. **Legacy/import generation:** `MealPlan`, `MealPlanEntry`, `ShoppingList` and `ShoppingItem` become **frozen compatibility/archive tables**. They get no new product writers. The meal-planner importer is retargeted to write canonical rows (`MealPlanEntry` → `FamilyMeal`, `ShoppingItem` → `ListItem`). Existing rows are copied into canonical tables by an idempotent, resumable backfill that records provenance in `ImportedRecord`. The legacy tables stay intact and exported until a separately approved contract step.
6. **No third generation.** Nothing like `ShoppingListItem` or `MealSlot` is created. A named or templated weekly plan, if the product needs one later, would be a grouping over `FamilyMeal`, not new slot storage.
7. **`meal_plan` list type:** no longer offered when creating a new list. Existing `meal_plan` lists stay readable and editable as generic lists. They are not converted, because their contents are free text.

### Duplicate and provenance rules (recipe → grocery)

- **Same `Idempotency-Key` and same request:** the stored response is replayed and no rows are written (#247 semantics). The same key with a different body gets 422 `IDEMPOTENCY_KEY_REUSED`.
- **Same ingredient, same source, still open:** if an unchecked `ListItem` already has the same `list_id`, `ingredient_id` and source (`meal_id`, or `recipe_id` when there is no meal), the add is a no-op for that ingredient and is reported as `already_on_list`. A partial unique index enforces this in the database, so two different keys racing from two devices still produce one row.
- **Same ingredient, different source** (two dinners both need onions): a separate row per source. The UI groups rows by `ingredient_id`. No quantity arithmetic is done across units (owner decision O-3).
- **Free-text manual item that looks similar** (no `ingredient_id`, normalized `content` matches): the row is added and flagged `possible_duplicate` in the response. It is never merged silently (#122: uncertain matches are shown as uncertain).
- **Checked (bought) items** never block a new add.
- **Provenance:** `source`, `recipe_id`, `meal_id` and `ingredient_id` on `ListItem`. Import and backfill provenance lives in `ImportedRecord` (`source_app`, `source_model`, `source_id` → `target_model`, `target_id`), as the importers already do.

### Household ownership and authorization

- `FamilyMeal`, `Recipe`, `Ingredient` and `List` carry `family_id`. `RecipeIngredient` is owned through `Recipe`, and `ListItem` through `List`. This is nested ownership, proven server-side. `ListItem` gets no denormalized `family_id` for now (O-12).
- Every new cross-reference (`FamilyMeal.recipe_id`, `ListItem.{ingredient_id, recipe_id, meal_id}`, `RecipeIngredient.ingredient_id`) is checked server-side to belong to the caller's household before it is written. Each route gets two-household relationship-injection tests (#102 pattern).
- Roles: meals stay as the matrix allows today (all roles). Recipes: parent and teen create/edit, parent deletes, child reads (O-7). `from-recipe`: any role that may add list items (parent, teen, child). Shared device: read-only until elevated device writes exist (#157). The board DTO may add the recipe title and prep time, never `notes`.
- Feature gates: recipe and meal routes use `meals`. `from-recipe` needs both `meals` and `lists`. `/api/lists/**` gains the server-side `featureGate('lists')` it lacks today (O-11).

## Alternatives considered

- **Make `MealPlan`/`MealPlanEntry` canonical and migrate `FamilyMeal` into it.** Rejected. `MealPlanEntry` requires a `Recipe` for every slot, so a free-text "leftovers" slot would need a fake recipe row. It has no cook, notes or `family_id`, and needs a plan container per week. It would mean rewriting the live API, the page, the board and the offline assumptions, and moving every live row, when the target has no live users today.
- **Make `ShoppingList`/`ShoppingItem` canonical for groceries.** Rejected. It has no UI, no API, no author or checker attribution, no position and no timestamps on items. `List`/`ListItem` already backs the lists UI, capture, the fridge Shopping card, fixtures and the #247 offline queue, whose queued operations reference `ListItem.id`. Moving would change item IDs under queued offline operations.
- **Keep both generations and dual-write.** Rejected. It diverges by construction, and ADR-0005 forbids it.
- **Create a fresh unified model** (for example `ShoppingListItem` or `MealSlot`). Rejected. That would be a third generation, which ADR-0005 and the fridge programme §8 forbid.

## Consequences

### Positive
- Each #122 step has exactly one write path. The tables users already rely on are extended, not replaced, so live IDs, routes and the #247 offline queue keep working.
- No dual-write period: the legacy tables' only writer (the importer) is retargeted, and no live UI reads legacy rows.
- Imported recipes and plans become visible to users for the first time, with provenance.

### Costs/risks
- `ListItem` becomes a wider table that serves both generic lists and groceries. Grocery-only columns stay null on to-do lists.
- The backfill can collide with meals a family already entered by hand. The rules are in the detail doc and are report-first.
- `ListItem.quantity` (int) and `amount`/`unit` (float/text) coexist and need clear display rules (O-6).
- Two quiet gaps found during inspection are fixed in the child issues: `/dashboard/meals` shows only the first meal per (day, type), so extra rows are hidden, and the user export omits `FamilyMeal`.

## Compatibility / migration

Expand → backfill → switch → (gated) contract. There is no dual write and no dual read in the UI.

1. **Expand (child A):** nullable columns, FKs with `SET NULL`, indexes and the partial unique index, added in `prisma/schema.prisma` and in `scripts/migrate.js` `POST_FEATURE_SQL` (idempotent `ADD COLUMN IF NOT EXISTS`). A backfill script is added. It defaults to dry-run, is scoped per family, resumes via `ImportedRecord`, and is rehearsed on the synthetic fixtures.
2. **API (child B)** and **UI (child C):** additive response fields only. Existing request and response shapes of `/api/meals` and `/api/lists/**` are unchanged. The importer is retargeted.
3. **Recipe → grocery (child D):** a new endpoint, built on the idempotency primitive merged in #247.
4. **Production backfill run:** a non-destructive insert into live tables, which needs Cameron's explicit approval for the run.
5. **Contract (child E, gated):** first stop all legacy writes and reads. Dropping the legacy tables needs a separate explicit approval and a verified backup.

**Old Android clients:** every installed APK loads the live web app from `server.url` (see `ANDROID.md`). No APK update is needed. The risks are open WebViews running an older JS bundle and entries already in the #247 offline queue. Both keep working because routes, request shapes and `ListItem` IDs are unchanged, and new fields are optional.

**Rollback limits:** the expand columns are nullable and unused by older code, so rolling back app code is safe and the columns can stay. Backfilled rows are tagged (`ImportedRecord` job and `ListItem.source='import'`). A reversal script can delete them only while they are unmodified; once users edit or tick them, reversal is partial. The legacy source rows are never modified, so the backfill can be re-run. The contract step (dropping tables) cannot be undone except by restoring a backup, which is why it is gated. This ADR requires no immediate destructive production change.

## Security / privacy

Covered in "Household ownership and authorization" above. Additional points:
- Idempotency records store a request hash, never the body (#247).
- The backfill runs per family and never crosses households. A legacy `ShoppingItem.recipe_id` has no FK today; if it points at another family's recipe, it is nulled and reported.
- The shared-device surface keeps reading only allowlisted fields.
- The user export must add `FamilyMeal` (a portability gap today) and keep exporting legacy tables while they exist.

## Validation

- A synthetic rehearsal on the #154 fixtures, extended with legacy `MealPlan`/`ShoppingList` rows in two households, reconciles the counts: for each family, `MealPlanEntry` = created + linked + skipped (reported), and `ShoppingItem` = created + skipped. A second run creates 0 rows. Foreign-ID injection rows are refused or nulled.
- Two-household negative tests pass for `/api/recipes`, the `/api/meals` recipe link, the new `ListItem` references and `from-recipe`.
- The `from-recipe` race test (N concurrent requests with the same key, and two different keys for the same meal) yields one row per ingredient.
- Old-shape requests to `/api/meals` and `/api/lists/items/*` (fixtures without the new fields) still pass.
- After the switch, a code search finds no product writer of `MealPlan`, `MealPlanEntry`, `ShoppingList` or `ShoppingItem`.

## Owner decisions

Each is open until Cameron confirms. The recommended default applies if this ADR is accepted without comment.

| # | Decision | Recommended default |
| --- | --- | --- |
| O-1 | More than one meal per (date, meal type)? | **Allow** (no unique constraint). `/dashboard/meals` renders every meal in a slot instead of hiding extras. |
| O-2 | Keep `MealPlan` "named plan" as a product concept? | **No.** Archive only; its name and range go into backfill provenance. Revisit as a grouping over `FamilyMeal` if templates are requested. |
| O-3 | Same ingredient from two different recipes or meals | **Separate rows per source**, grouped in the UI. No cross-unit merging. |
| O-4 | Which list receives recipe ingredients | Explicit `listId`; otherwise the most recently updated `grocery` list; otherwise create "Groceries". This matches `CaptureBox` today and moves to one server helper. |
| O-5 | Undo of recipe-added items by teen/child (item delete is parent-only today) | Allow the original actor to remove **only the rows that request created**, within 10 minutes, through an undo endpoint. Every other delete stays parent-only. |
| O-6 | Quantity representation | Keep `quantity Int` for count semantics and old clients. Add nullable `amount Float` + `unit`, and display `amount unit` when present. |
| O-7 | Recipe roles | Parent and teen create/edit; parent deletes; child reads; device reads tonight's recipe only. |
| O-8 | `meal_plan` list type | Remove it from the create picker. Existing lists stay as generic lists and are not converted. |
| O-9 | When to run the production backfill and how long to keep legacy tables | Run after child C ships, with approval. Keep legacy tables read-only for at least one release cycle and until the export covers canonical data. Dropping them is a separate approval. |
| O-10 | Should `from-recipe` be offline-queueable? | **No** in v1, because it needs a live recipe and list resolution. Grocery tick/quick add stay the queueable actions. |
| O-11 | Add server `featureGate('lists')` to `/api/lists/**` | **Yes.** This matches the UI gate. It is a small behaviour change for households that turned lists off. |
| O-12 | Denormalize `family_id` onto `ListItem` | **Not now.** Nested ownership plus tests is enough. Revisit with inventory (#121) if query paths need it. |

## Child issues

Ready-to-file bodies are in [`../MEALS_AND_GROCERIES.md` §9](../MEALS_AND_GROCERIES.md#9-child-issues-ready-to-file):

- **A.** Schema expand + backfill tooling + fixture rehearsal
- **B.** API unification (`/api/recipes`, recipe link on meals, `ListItem` provenance fields, lists feature gate, export, importer retarget)
- **C.** UI migration (meals slot rendering + recipe picker, grocery item amount/provenance, `meal_plan` type retirement, dead list components)
- **D.** Recipe → grocery add with idempotency and duplicate rules (builds on #247, merged)
- **E.** Contract/cleanup of the legacy tables (gated on Cameron's approval)

## Revisit trigger

- #148's route/domain inventory (`docs/refactor/ROUTE_AND_DOMAIN_INVENTORY.md`, not yet written) finds another live writer or reader of the legacy tables.
- The production dry-run shows a large volume of legacy rows whose shape the rules above cannot map.
- The product needs multi-week plan templates, which would be designed as a grouping over `FamilyMeal`.
