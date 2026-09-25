# Test Data & Seed Contract

The repository needs deterministic, synthetic fixtures so agents can build/test without private family data.

## Required households
Create at least two clearly fake households (`fixture-family-a`, `fixture-family-b`) with stable synthetic identities.

Each should include:
- one parent;
- one teen;
- one child;
- optional paired shared device fixture;
- calendar events across today/tomorrow/week and DST/timezone edges;
- pending/completed/verified chores;
- rewards;
- grocery/list data;
- meal/recipe data using whichever models #134 declares canonical;
- inventory/use-soon data once implemented;
- empty-state variants.

## Security fixtures
Include stable foreign IDs so tests can deliberately attempt family A -> family B reads/writes and relationship injection.

## UX fixtures
Provide deterministic scenarios such as:
- empty new household;
- busy school/work morning;
- evening dinner/use-soon/grocery state;
- long names/titles/translated strings;
- offline/pending/conflict UI mock data;
- parent-only content that must never appear in shared-device fixtures.

## Rules
- Never seed real names, emails, addresses, medications, messages or other private data from production.
- Fixture IDs/data should be repeatable enough for snapshots/E2E.
- Seed command should be safe for a dedicated development/test DB and refuse obvious production environments.
- Re-running should be idempotent or reset only a clearly fixture-owned dataset.
- Avoid using `prisma db push` as a hidden production migration strategy.

## Implemented commands (#154)
```bash
# Create or reconcile fixtures (idempotent; safe to re-run)
FIXTURES_ALLOW=1 DATABASE_URL=postgresql://postgres@localhost:5432/family_planner_dev npm run fixtures:seed

# Delete fixture-owned rows only
FIXTURES_ALLOW=1 DATABASE_URL=postgresql://postgres@localhost:5432/family_planner_dev npm run fixtures:reset
```
Run `node scripts/migrate.js` against the same `DATABASE_URL` first so the tables exist. The commands need Node >= 22.18 (they load the TypeScript fixture modules through Node's built-in type stripping; `.nvmrc` pins Node 22).

Optional: `FIXTURES_ANCHOR_DATE=<ISO date>` moves the whole dataset. Default anchor: `2026-01-05T12:00:00Z` (a Monday). Every timestamp is derived from the anchor, never from the wall clock, so the same anchor always produces the same rows (screenshots/snapshots stay deterministic).

Code:
- `src/lib/fixtures/dataset.ts`: ids, emails, fake password, `buildFixtureDataset(anchor)`.
- `src/lib/fixtures/guard.ts`: `evaluateFixtureTarget(env)` / `assertFixtureTargetAllowed(env)` (pure, unit tested).
- `src/lib/fixtures/seed.ts`: `seedFixtures` / `resetFixtures`.
- `src/lib/fixtures/index.ts`: import from `@/lib/fixtures` in tests.
- `scripts/fixtures.mjs`: the CLI behind the npm scripts.

### Target guard (fails closed)
The CLI refuses, before it opens a connection, unless **all** of these hold:
1. `FIXTURES_ALLOW` is exactly `1`.
2. `NODE_ENV` is not `production`. The production image and `docker-compose.yml` set `NODE_ENV=production`, so a command run inside the production container is refused.
3. `DATABASE_URL` is a `postgres://` / `postgresql://` URL with a host and a database name and no `host=` query override.
4. Neither host nor database name contains `ashbi` or `prod` (so `family.ashbi.ca` and `*prod*` names are refused).
5. The host is loopback (`localhost`, `127.x.x.x`, `::1`), **or** a single-label docker service name (`postgres`, `db`, ...) **and** the database name has a test/dev token (`test`, `tests`, `dev`, `development`, `ci`, `e2e`, `fixture`, `fixtures`, `scratch`, split on non-alphanumerics). Remote FQDNs and non-loopback IPs are always refused.

Rule 5 is stricter than "a docker service name is fine" because production uses host `postgres` with database `family_planner`. A compose-based dev database must therefore be named something like `family_planner_dev`.

### Ownership, idempotency and reset
- Every fixture row id starts with `fx_` (for example `fx_family_a`, `fx_user_a_parent`). Invite codes are `fx-invite-*`.
- **Seed** upserts every dataset row by id, restores anything a test changed (titles, statuses, the password), and prunes stale `fx_` rows from an older dataset version inside fixture families. It never updates or deletes a non-`fx_` row, except that a non-`fx_` chore occurrence on the same `(recurrence_id, due_date)` as a fixture series occurrence is replaced. Passwords are only rehashed when the stored hash no longer verifies, so a second run leaves the rows byte-identical.
- Before writing anything, seed refuses when a non-fixture user already has a fixture email or a non-fixture family has a fixture invite code.
- **Reset** deletes `fx_` families and `fx_` users. Household rows inside those families, including rows the app created during tests, go with them via `ON DELETE CASCADE`. Before deleting anything, reset refuses if a non-fixture user belongs to a fixture family, or if chores, events, lists, list items or rewards in a non-fixture family reference a fixture user.
- The ownership test is done in code (`isFixtureId`), not with SQL `LIKE 'fx_%'`: `_` is a LIKE wildcard, and Prisma's `startsWith` does not escape it.
- CI (`.github/workflows/release.yml`, Build & Test job) seeds twice against the job's disposable Postgres after migrations, runs the DB integration test (`src/lib/fixtures/__tests__/fixtures.integration.test.ts` checks for byte-identical rows, drift repair, refusals and a scoped reset), then resets.

### Accounts
Shared password for every fixture account: **`Fixture-Only-Passw0rd!`** (`FIXTURE_PASSWORD`). **It is FAKE and public in this repository. Use it only on local/test databases.** It is stored as a bcrypt hash made with `hashPassword` from `src/lib/auth.ts`.

| Household | Id | Role | Age | Name | Email |
|---|---|---|---|---|---|
| Family A (busy) `fx_family_a` | `fx_user_a_parent` | parent | – | Avery Fixture-A | parent.a@example.test |
| | `fx_user_a_teen` | teen | 15 | Taylor Fixture-A | teen.a@example.test |
| | `fx_user_a_child` | child | 8 | Casey Fixture-A | child.a@example.test |
| | `fx_user_a_child_longname` | child | 10 | Maximiliana-Josephine Featherstonehaugh-Worthington | child.longname.a@example.test |
| Family B (sparse) `fx_family_b` | `fx_user_b_parent` | parent | – | Blair Fixture-B | parent.b@example.test |
| | `fx_user_b_teen` | teen | 14 | Jordan Fixture-B | teen.b@example.test |
| | `fx_user_b_child` | child | 7 | Riley Fixture-B | child.b@example.test |
| Empty household `fx_family_empty` | `fx_user_empty_parent` | parent | – | Emery Fixture-Empty | parent.empty@example.test |

Roles come from `User.role` (`parent` / `teen` / `child`) plus `User.age`. All accounts have `email_verified = true`.

### Scenarios
- **Busy (Family A):** 14 events: today (school drop-off, stand-up, dentist, practice, long title), tomorrow, one crossing midnight UTC, a task event, a weekly RRULE event, a multi-day event, next week and yesterday. 11 chores covering every status (`pending`, `in_progress`, `completed`, `verified`, `overdue`), including one weekly recurring series (template `fx_chore_a_weekly_tpl` plus 3 occurrences, following the #184 `recurrence_id` / `is_template` model). 4 rewards (available, claimed, redeemed, inactive). 4 to-do lists (8-item list with 3 checked, a short list, a long-text list, an empty list). One `type: 'grocery'` list (see below).
- **Sparse (Family B):** one each of event, chore (teen), reward, to-do list and list item, plus one small `type: 'shopping'` list (see below). B's child has no chores (empty per-user state). These exist so negative tests have real foreign ids.
- **Empty household (`fx_family_empty`):** one parent and no data, for new-household empty states.
- **Long text:** `FIXTURE_LONG_TEXT` (long user name, event title, chore title, list item, grocery item, and a description with accented characters).

### Grocery / shopping lists
These use the existing `List` / `ListItem` model. The capture flow creates lists with `type: 'grocery'`; the dashboard Shopping card (`src/lib/shopping-snapshot.ts`) reads unchecked items from `grocery` and `shopping` lists, oldest `created_at` first, and shows at most 5 plus an "N more to buy" row. Grocery items have distinct, ascending `created_at` so that order is stable.

| Household | List id | Type | Name | Items (in card order) |
|---|---|---|---|---|
| Family A | `fx_list_a_grocery` (`FIXTURE_IDS.familyA.groceryList`) | `grocery` | Groceries | `fx_item_a_grocery_1` Milk (quantity 2, renders "Milk × 2"); `_2` long-text sourdough loaf (`FIXTURE_LONG_TEXT.groceryItem`); `_3` Bananas; `_4` Coffee beans (**checked**); `_5` Eggs (dozen); `_6` Cheddar cheese; `_7` Olive oil (**checked**); `_8` Dish soap |
| Family B | `fx_list_b_shopping` (`FIXTURE_IDS.familyB.shoppingList`) | `shopping` | Family B shopping | `fx_item_b_shopping_1` Printer ink (Family B); `fx_item_b_shopping_2` Light bulbs (Family B) (**checked**) |

Family A has 6 open items, so its card shows the first 5 and "1 more to buy" (Dish soap is the hidden one). Family B's card shows its single open item and no overflow row. Family B item texts are unique to Family B so leak checks can search for them.

### Cross-family ids for negative tests
`FIXTURE_CROSS_FAMILY.aToB` / `.bToA` give `{ actor, foreign }` id sets (`family`, `parent`, `teen`, `child`, `event`, `chore`, `list`, `listItem`, `reward`). Example:
```ts
import { FIXTURE_CROSS_FAMILY, FIXTURE_EMAILS, FIXTURE_PASSWORD } from '@/lib/fixtures'
const { actor, foreign } = FIXTURE_CROSS_FAMILY.aToB
// sign in as FIXTURE_EMAILS.familyA.parent, then GET /api/chores/${foreign.chore} -> expect 404/403
```

### Not yet covered (deferred)
- **Meal / recipe fixtures:** deferred until #149 settles the canonical meal model. Lists are seeded with `type` `todo`, `grocery` and `shopping` only; no `meal_plan` lists and no `ShoppingList`, `Recipe` or `MealPlan` rows.
- **Shared-device (tablet) fixtures:** deferred because the paired-device schema does not exist yet.
- Inventory/use-soon, offline/pending/conflict mock data, and DST-specific event edges beyond the midnight-UTC crossing. Use `FIXTURES_ANCHOR_DATE` near a DST change if you need that today.
- Tables without a foreign key to `Family` are not swept by reset. Rows the app writes there for fixture users could be left orphaned; none are seeded.

## Acceptance for seed implementation
- two-household isolation fixtures exist;
- one command creates/reconciles fixtures;
- command refuses production-like target;
- E2E can authenticate/use fixtures without manual DB edits;
- visual snapshots are deterministic;
- no production data dependency.