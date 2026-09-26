# Data Model Policy

`prisma/schema.prisma` is authoritative for models that exist today. Issue #149 is the canonical decision issue for the overlapping meal, recipe, grocery and list generations. Issues #134 and #143 are broader architecture/refactor parents; they do not replace #149.

## Ownership rule

Every private household-domain record must be traceable to exactly one household. Prefer an explicit `family_id` on high-value domain tables when it improves authorization/query safety; nested ownership must still be proven server-side.

## Existing foundation that remains

- `User` and `Family` remain the identity/household foundation.
- Existing auth/family systems must be extended, not duplicated for the fridge tablet.
- `Event` remains the existing calendar foundation until an accepted versioned migration changes it.
- Existing chore/task/reward models remain during vertical migration.

## Unresolved overlapping generations

The schema currently contains both:

| Domain | Existing/legacy path | Newer/foundation path | Current decision |
| --- | --- | --- | --- |
| Meals | `FamilyMeal` | `MealPlan` + `MealPlanEntry` linked to `Recipe` | Open in #149 |
| Recipes | meal name/description fields in `FamilyMeal` | `Recipe`, `Ingredient`, `RecipeIngredient` | Open in #149 |
| General lists | `List` + `ListItem` | No replacement for every generic-list use case | Preserve pending #149 |
| Groceries | grocery-like generic `List` + `ListItem` usage | `ShoppingList` + `ShoppingItem` | Open in #149 |

These are factual existence statements, not declarations that either generation is canonical for all future writes.

## #149 required outcome

Before inventory → meal → missing ingredient → grocery writes are implemented, #149 must record:

- the canonical read/write model for each domain;
- which models are legacy, compatibility-only or migration targets;
- current UI/API consumers;
- import and data-preservation requirements;
- transition strategy, including any temporary dual read/write;
- old-client/server compatibility;
- household-ownership and authorization rules;
- migration, rollback and test evidence;
- follow-up issues for implementation.

Do not create a third parallel model generation. Do not mark canonicalization complete until an ADR/decision and its accepted evidence exist.

## Planned new domains

Subject to ADR/schema review:

- shared devices/sessions — implemented in #240 (tables unused while `SHARED_DEVICE_ENABLED` is off) as `HouseholdDevice`, `DevicePairing`, `DeviceSession`, `ParentElevationPin` and `DeviceAuditEvent` (additive only; sketches and `scripts/migrate.js` DDL notes in [`SHARED_DEVICE.md`](SHARED_DEVICE.md) §3, ADR-0006); dashboard preferences are not part of #157;
- food inventory/locations/adjustments/expiry observations;
- bounded sync mutations/conflict metadata;
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
