# Meal/grocery backfill (ADR-0007) runbook

This runbook covers running `scripts/backfill-meals-groceries.mjs` against **production**. It does not authorize that run.

> **Approval gate.** A production run (dry-run included, because it reads household data) needs **Cameron's explicit approval for that specific run** (`AGENTS.md` approval boundaries; ADR-0007 O-9). A merge approval, a passing build or a rehearsal is not approval. Issue #250 shipped the tooling only; no production run happened in it.

References: [ADR-0007](../architecture/adr/0007-canonical-meal-recipe-grocery-models.md), [MEALS_AND_GROCERIES.md](../architecture/MEALS_AND_GROCERIES.md) sections 4 and 6, `src/lib/backfill/meals-groceries.ts` (rules), `docs/testing/TEST_DATA.md` (rehearsal fixtures).

## What the script does

| Mode | Command | Writes |
| --- | --- | --- |
| Dry-run (default) | `npm run backfill:meals-groceries [-- --family <id>]` | Nothing. Read-only transaction per family; prints counts only (no row content). |
| Apply | `npm run backfill:meals-groceries -- --apply --family <id>` | One transaction per family: `FamilyMeal`, `List` (`type='grocery'`), `ListItem` (`source='import'`), one `ImportJob` (`source_app='fp-canonical-149'`) and `ImportedRecord` provenance. Sets `FamilyMeal.recipe_id` on a same-name slot collision only where it was null. |
| Reverse | `npm run backfill:meals-groceries -- --reverse --family <id> [--job <id>]` | Deletes rows the job created while still unmodified (`updated_at = created_at`), clears recipe links it set if unchanged, removes its provenance. Reports anything kept. |

Never touched: `MealPlan`, `MealPlanEntry`, `ShoppingList`, `ShoppingItem` (read only). Never written: a reference to another household. A foreign `ShoppingItem.recipe_id` is nulled and reported; a `MealPlanEntry` whose recipe belongs to another household is skipped. Creator columns (`FamilyMeal.created_by`, `List.created_by`, `ListItem.added_by`) only ever get a member of the family: a legacy creator from another household (or a missing one) is replaced by `--started-by` or the family's oldest parent and counted as "creators remapped" (details in `summary.remapped[]`); if the family has no parent, those rows are skipped as `no_in_family_actor`. Review the remap count in the dry-run: a non-zero value means legacy data already linked two households. Every skipped row (unknown `meal_type`, empty name, foreign recipe on an entry, missing target list, no in-family actor) is archived verbatim (except that a foreign or missing `created_by` is redacted to null) with its reason in that family's `ImportJob.summary.skipped[]`, and every `MealPlan` is mapped to that job (`ImportedRecord target_model='ImportJob'`). `--apply`/`--reverse` need `--family` (or an explicit `--all-families`). A re-run creates 0 rows.

Per-family reconciliation printed by every run: `MealPlanEntry = created + linked + skipped(archived) + already`, `ShoppingItem = created + skipped(archived) + already`, `ShoppingList = created + skipped(archived) + already`, `MealPlan = archived + already`. A family that does not reconcile is rolled back and the command exits 1.

## Target guard

The script refuses before connecting unless the target is local/disposable by the fixture guard rules (`src/lib/fixtures/guard.ts`: loopback, or a docker service name with a test/dev database name; no `prod`/`ashbi` marker; `NODE_ENV` not `production`). Any other target, production included, additionally needs **both**:

- the `--i-have-approval` flag, and
- `BACKFILL_ALLOW_PRODUCTION=1` in the environment.

A malformed `DATABASE_URL` is always refused. Only pass these two after Cameron has approved the exact run; record the approval (link or quote) in the run log.

## Preconditions (all required)

1. ADR-0007 child C (UI) has shipped (O-9), so imported meals and lists are visible and editable.
2. The release that contains this script and the #250 schema expand is deployed, and `node scripts/migrate.js` has run (the container does this on start). Check: `SELECT column_name FROM information_schema.columns WHERE table_name = 'ListItem' AND column_name IN ('source', 'source_key', 'source_request_id');` returns 3 rows.
3. A fresh backup exists and an isolated restore of it was verified (`scripts/backup.sh`, `scripts/restore.sh`, `RELEASE_AND_ROLLBACK.md`).
4. The rehearsal passed on the release commit: CI "Verify fixture seed is idempotent" (runs `src/lib/backfill/__tests__/meals-groceries.integration.test.ts`), or locally:
   ```bash
   DATABASE_URL=postgresql://postgres:postgres@localhost:5432/fp_backfill_rehearsal node scripts/migrate.js
   DATABASE_URL=... FIXTURES_ALLOW=1 npm run fixtures:seed
   DATABASE_URL=... FIXTURES_ALLOW=1 RUN_DB_INTEGRATION=1 npx jest src/lib/backfill --runInBand --forceExit
   ```
   Better still, a dry-run and apply against a restored copy of the production backup on an isolated disposable database.
5. Cameron has approved: the commit SHA, the target, dry-run first, then apply for the named families (or `--all-families`).

## Procedure

The production image contains only `scripts/migrate.js`, not this script. Run it from a checkout of the **exact deployed commit** (`npm ci`, Node >= 22.18) on a machine that can reach the production database by a route Cameron approves. Do not copy credentials into the repository or shell history files.

1. **Dry-run** (approved):
   ```bash
   BACKFILL_ALLOW_PRODUCTION=1 DATABASE_URL=<prod url> npm run -s backfill:meals-groceries -- --i-have-approval --json > backfill-dry-run.json
   ```
   Review per-family counts, skip reasons and nulled references with Cameron. Stop if any family fails reconciliation or the skip volume is unexpected (the ADR-0007 revisit trigger).
2. **Apply** (approved separately, after the dry-run review), one family first:
   ```bash
   BACKFILL_ALLOW_PRODUCTION=1 DATABASE_URL=<prod url> npm run -s backfill:meals-groceries -- --i-have-approval --apply --family <id> --json > backfill-apply-<id>.json
   ```
   Then the remaining approved families (repeat `--family`, or `--all-families` if approved).
3. **Verify:** re-run the dry-run; every family must show `create=0` everywhere and reconcile. Spot-check an imported list and meal in the app as that family's parent (with the family's consent, or on data Cameron owns).
4. **Record** the commit SHA, approval reference, the JSON outputs (counts only), job ids and the verification result.

## Rollback

- **App:** unaffected. The expand columns are nullable/defaulted; old code ignores them.
- **Data:** `--reverse --family <id> [--job <id>]` (approved like any production write) removes rows that are still unmodified and reverts recipe links that are unchanged. Rows people edited or ticked are kept and listed; reversal is then partial by design. The job stays as `partially_reversed` with its archive, and a re-apply does not duplicate kept rows.
- Legacy rows are never modified, so the backfill can always be re-run.
- Anything beyond that (for example after heavy edits) is a backup restore decision for Cameron.

## Out of scope

Dropping or rewriting the legacy tables and `ImportedRecord` targets is ADR-0007 child E, which needs its own approval and a verified backup.
