# Data Model Policy

`prisma/schema.prisma` is authoritative for models that exist today. Issue #149 is the canonical decision issue for the overlapping meal, recipe, grocery and list generations. Issues #134 and #143 are broader architecture/refactor parents; they do not replace #149.

## Ownership rule

Every private household-domain record must be traceable to exactly one household. Prefer an explicit `family_id` on high-value domain tables when it improves authorization/query safety; nested ownership must still be proven server-side.

## Existing foundation that remains

- `User` and `Family` remain the identity/household foundation.
- Existing auth/family systems must be extended, not duplicated for the fridge tablet.
- `Event` remains the existing calendar foundation until an accepted versioned migration changes it.
- Existing chore/task/reward models remain during vertical migration.

## Overlapping meal/list generations (#149)

The schema contains both generations. [ADR-0007](adr/0007-canonical-meal-recipe-grocery-models.md) (**Proposed — pending Cameron's acceptance**) records the proposed outcome. The detail (source inventory, mapping, backfill, recipe → grocery contract and child issues) is in [`MEALS_AND_GROCERIES.md`](MEALS_AND_GROCERIES.md).

| Domain | Live today (source-verified 2026-09-27) | Import-only today | Proposed role (ADR-0007) |
| --- | --- | --- | --- |
| Meal slots | `FamilyMeal` (`/api/meals`, `/dashboard/meals`, fridge Today board) | `MealPlan` + `MealPlanEntry` | **Canonical:** `FamilyMeal`, expanded with a nullable `recipe_id`/`servings`. `MealPlan*` is frozen: backfilled into `FamilyMeal`, then archived. |
| Recipes | none (`FamilyMeal.recipe_name` is free text) | `Recipe`, `Ingredient`, `RecipeIngredient` | **Canonical:** these three, with a new `/api/recipes`. |
| Groceries | `List` (type `grocery`/`shopping`) + `ListItem` (lists UI, capture, fridge Shopping card, PR #247 offline tick) | `ShoppingList` + `ShoppingItem` | **Canonical:** `List`/`ListItem`, expanded with `ingredient_id`/`recipe_id`/`meal_id`/`amount`/`unit`/`source`/`source_key`. `Shopping*` is frozen: backfilled, then archived. |
| General lists | `List` + `ListItem` | none | Unchanged. The `meal_plan` list type is no longer offered for new lists. |

Until ADR-0007 is accepted, ADR-0005's constraint applies: no broad cross-domain inventory → meal → grocery writes, and no third model generation. After acceptance, new writes go only to the canonical models above. Legacy tables receive no new product writers and are dropped only through the gated contract step (child issue E). Do not mark canonicalization complete until ADR-0007 is accepted and its rehearsal evidence (backfill counts reconciled on synthetic fixtures, two-household negative tests, old-shape request fixtures) exists.

## Planned new domains

Subject to ADR/schema review:

- shared devices/sessions — implemented in #240 (tables unused while `SHARED_DEVICE_ENABLED` is off) as `HouseholdDevice`, `DevicePairing`, `DeviceSession`, `ParentElevationPin` and `DeviceAuditEvent` (additive only; sketches and `scripts/migrate.js` DDL notes in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §3, ADR-0006); dashboard preferences are not part of #157;
- food inventory/locations/adjustments/expiry observations;
- bounded sync mutations/conflict metadata — server side implemented in #162 as `IdempotencyRecord` (additive: `(scope, key)` unique, `family_id` and nullable `user_id` FKs with cascade, 7-day `expires_at`, pruned opportunistically; DDL in `scripts/migrate.js`; contract in [`OFFLINE_SYNC.md`](OFFLINE_SYNC.md)). The queued operations themselves live only on the client;
- AI suggestions/action proposals;
- integration connections;
- leftovers only after product evidence.

## Schema requirements

For new/changed models consider household ownership/indexes, actor/audit fields, server timestamps, concurrency/version fields, idempotency, bounded collections, deletion/retention/export, correct household-scoped uniqueness and explicit relation deletion behaviour.

## Migration policy

Installed Android clients may be old. Prefer expand → backfill → compatible transition → switch → contract. Backfills must be resumable, idempotent and observable. Rolling back app code does not imply a database rollback is safe.

## Test fixtures

Development/test data must include at least two synthetic households and foreign-ID negative cases so isolation is easy to prove.

## ADR requirement

Replacing a canonical model, introducing dual writes, materially changing ownership or breaking older clients requires an accepted ADR plus migration, compatibility and rollback evidence.
