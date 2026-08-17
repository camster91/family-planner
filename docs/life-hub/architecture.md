# Life Hub consolidation architecture

Parent epic: #87

## Decision

`family-planner` becomes the canonical application shell for the family/personal Life Hub. `meal-planner`, `chore-champs`, and `lifestreak` remain source repositories until their useful capabilities and user data have been migrated and verified.

This is a consolidation, not a repository dump. Source code is ported only when it fits the shared shell, domain model, permissions, accessibility baseline, and deployment strategy.

## Product model

The app has two layers:

1. **Shell** — Today, Life Chat, Apps, Search, Notifications, Family/Profile/Settings.
2. **Mini apps** — focused domains such as Chores, Habits, Meals, Calendar, Lists, Rewards, Budget, Projects, Messages, Emergency, and optional family modules.

A mini app owns its domain UI and APIs but uses shared authentication, family scoping, design tokens, audit/recovery conventions, feature flags, and responsive/accessibility requirements.

## Source-to-target map

| Source | Target mini app | Preserve | Reconcile / do not duplicate |
| --- | --- | --- | --- |
| `family-planner` | Shell + existing modules | Family/User identity, current Chore/Reward/FamilyMeal/List data, feature flags, Today, Calendar, Budget, Projects, Messages, family operations | Becomes source of truth |
| `meal-planner` | Meals | Recipes, ingredients, recipe ingredients, reusable meal plans, servings, shopping-list generation | Reuse Family Planner identity, PostgreSQL, Lists and existing `FamilyMeal`; do not bring a second auth system or SQLite runtime |
| `chore-champs` | Chores + Rewards | Parent approval, kid-first UX, badges, redemptions, streak/consistency mechanics, assignment history | Reuse Family Planner Family/User/Chore/Reward; do not create a second Family/Kid login model |
| `lifestreak` | Habits | Generic Habit/HabitLog model, schedules, partial/quantitative tracking, skips/pauses, schedule-aware insights | Habits are general-purpose. Spiritual routines may be optional templates only. Do not make JW-specific routes or data mandatory |

## Mini-app contract

Every mini app must define:

- stable key, title, description, icon and route;
- owning domain models and API routes;
- family/user authorization rules;
- parent/teen/child access matrix when applicable;
- empty/loading/error/offline/saving/saved/retry states;
- mobile, tablet, desktop and 200% zoom behaviour;
- keyboard and screen-reader behaviour;
- export/import representation before source-app retirement;
- Life Chat read tools and, separately, proposed write actions;
- audit/undo/recovery requirements for destructive or consequential actions.

## Life Chat architecture

Life Chat is a conversational interface over the mini apps. It is not itself the source of truth.

### Phase A — navigation and read-only foundation

- Natural-language navigation to mini apps.
- Suggested prompts and app discovery.
- No data mutations.
- No external AI provider required for navigation intent resolution.

### Phase B — structured read tools

Each mini app exposes deterministic, family-scoped read operations such as:

- `today.summary`
- `calendar.list`
- `chores.list_open`
- `habits.today`
- `habits.weekly_review`
- `meals.week_plan`
- `recipes.search`
- `lists.get`
- `budget.summary`
- `projects.status`

The server authorizes and executes the tool first. A language model may summarize the returned structured data, but it does not bypass authorization or query the database directly.

### Phase C — confirmed actions

Write operations use a two-step contract:

1. **Propose** — Life Chat returns an explicit structured preview including affected records and consequences.
2. **Confirm** — the user explicitly approves the exact proposed action before execution.

Confirmation is required for create/update/delete/send/share, financial changes, permission/access changes, account changes, and other consequential mutations. Idempotency and audit records are required. Undo is provided where technically possible.

## Child and health boundaries

- Parent-controlled child profiles remain the authority for kid-facing chores, rewards and habits.
- AI-generated content for children should be age-appropriate and should not create hidden communications or expose data across family members beyond the established role rules.
- Sick Days & Meds data may be summarized or organized, but Life Chat must not diagnose conditions, determine medication doses, or replace professional medical advice.

## Data migration rules

1. Inventory source schemas and storage keys before writing transforms.
2. Export or snapshot source data before any destructive cleanup.
3. Migrations are versioned, deterministic and idempotent.
4. Preserve original IDs in migration metadata when practical.
5. Compare source and target record counts plus important field-level checks.
6. Ambiguous records are quarantined for review, not silently discarded.
7. Source repos/apps stay available until migration is verified.
8. Archiving or retiring a source app requires separate explicit approval.

## Delivery waves

### Wave 0 — shell foundation

- Mini-app registry.
- Apps hub.
- Life Chat read-only navigation shell.
- This architecture document.

### Wave 1 — Meals

Add recipes/ingredients/reusable plans and shopping-list generation to the existing Meals module. Keep existing `FamilyMeal` records intact and map them into the richer model without rewriting history.

### Wave 2 — Chores

Port ChoreChamps approval, badges, redemption history and child-first interaction patterns onto Family Planner's existing family/user/chore/reward models.

### Wave 3 — Habits

Implement the generic LifeStreak direction: Habit, HabitLog, schedules, due-state engine, quantitative progress, Today integration and schedule-aware insights.

### Wave 4 — Life Chat reads

Add authorized structured read tools across the mini apps.

### Wave 5 — confirmed Life Chat actions

Add proposed actions, explicit confirmations, audit logs, idempotency, recovery and undo.

### Wave 6 — import and source retirement

Run verified imports for each source app. Retire or archive source apps only after explicit approval.

## Quality gates

Before any consolidation PR is ready to merge:

- lint and type-check pass;
- unit/integration tests for the changed domain pass;
- production build passes;
- Prisma schema/migration validation passes where applicable;
- representative 320/375/430, 768/1024 and 1366/1920 layouts are checked;
- keyboard, screen-reader labels/focus, reduced motion and 200% zoom are checked;
- family isolation and role authorization are tested;
- migration changes include rollback/recovery evidence.

Production deployment is separate from merge and requires explicit approval.