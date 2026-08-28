# Family Planner Consolidation Plan

## Objective

Make this repository the single household application. Retire `chore-champs`,
`meal-planner`, and `budget-app` only after their useful features and data are
migrated, reconciled, and verified in production.

Family Planner remains authoritative for authentication, family membership,
roles, feature flags, navigation, and deployment. The source apps are migration
inputs and UX references, not packages to embed wholesale.

## Source map

| Source       | Preserve                                                                                   | Do not duplicate                                            |
| ------------ | ------------------------------------------------------------------------------------------ | ----------------------------------------------------------- |
| ChoreChamps  | Assignments, habits, badges, redemptions, family goals, push subscriptions, child-first UX | NextAuth, Parent/Kid identities, Family                     |
| Meal Planner | Recipes, ingredients, servings, meal-plan entries, generated shopping lists                | SQLite, user-only ownership, JWT auth, shopping-list tables |
| Budget App   | Accounts, budgets, bills, goals, daily allowance, no-spend days, receipt OCR               | Household/User auth, transactions, categories, wishlist     |

## Architecture rules

1. Every shared record is scoped to `family_id`; every mutation proves family
   membership server-side.
2. Existing `User`, `Family`, JWT sessions, and parent/teen/child roles are the
   only identity system.
3. Financial records support parent-only visibility even when family-scoped.
4. Existing feature flags gate all expanded modules.
5. Imports are versioned, transactional, idempotent, and retain source IDs.
6. Source apps remain read-only and recoverable until the rollback window ends.

## Wave 0: reliable destination

- Make Prisma generation, lint, strict type checking, tests, build, and
  migrations blocking release gates.
- Remove committed production environment configuration.
- Fix open P0/P1 workflow, role, accessibility, and validation defects.
- Prove family isolation and role authorization.
- Establish tested backup, restore, migration, and rollback procedures.

Exit: a clean checkout produces a reproducible release and a production backup
can be restored into an isolated environment.

## Wave 1: chores and rewards

Add `ChoreAssignment`, `Habit`, `HabitLog`, `BadgeDefinition`, `EarnedBadge`,
`RewardRedemption`, `FamilyGoal`, and optionally `PushSubscription`. Keep
`Chore` as the recurring template. Move completion, evidence, approval, and XP
to assignments in one atomic transaction. Import ChoreChamps with record-count
and XP reconciliation before switching the UI.

Implementation status: schema and idempotent, transactional importer complete.
Imports default to dry-run and require explicit child-to-user identity mapping.

## Wave 2: recipes, meals, and shopping

Add family-scoped `Recipe`, `Ingredient`, `RecipeIngredient`, and
`MealPlanEntry`. Backfill `FamilyMeal`, then transition the API and UI. Generate
items into Family Planner's existing `List` and `ListItem` models while storing
recipe provenance and preventing duplicate ingredients.

Implementation status: family-scoped recipe, meal-plan, and shopping models plus
an idempotent, transactional importer are complete. The local source SQLite
snapshot contains zero records, so there is no current data backfill to execute.

## Wave 3: household budgeting

Add `FinancialAccount`, `Budget`, `Bill`, `BillPayment`, `SavingsGoal`,
`GoalContribution`, `DailyBudgetPeriod`, `NoSpendEntry`, and receipt metadata.
Map source transactions and categories into the existing models. Ship manual
finance first. Receipt OCR is opt-in; bank sync requires separate encryption,
privacy, deletion, webhook, and credential-rotation review.

Implementation status: categories, transactions, and wishlist items import into
native Family Planner models. All advanced Budget App records import losslessly
into `FinancialArchiveRecord` with their source model, source ID, and JSON
payload. Native screens for accounts, bills, savings goals, income schedules,
receipts, daily periods, and no-spend days remain separately scoped product work;
their archived data is retained and queryable until those screens are shipped.

## Import contract

- All importers validate and normalize the complete export before mutation.
- Dry-run is the default; persistence requires `dryRun: false` explicitly.
- Source identities are never copied into `User`; callers provide explicit maps.
- `ImportJob` records run state and reconciliation summaries.
- `ImportedRecord` provides source-to-target provenance and repeat-run idempotency.
- Any rejected relationship appears in the reconciliation summary with a reason.
- Parents invoke imports through `POST /api/admin/imports/{source}`. The request
  contains `data`, optional `identityMap`, and optional `dryRun`; dry-run defaults
  to true. `GET /api/admin/imports` returns the family's latest 50 import jobs.
- The user portability export includes consolidated chore, meal, shopping, and
  import data. Advanced finance archives are exported only to a parent.

## Wave 4: cutover

Run dry-run imports and reconciliation reports, back up all databases, migrate
one module at a time through staging, keep sources read-only for a rollback
window, redirect retired domains, and archive satellite repositories only after
production smoke tests and reconciliation pass.
