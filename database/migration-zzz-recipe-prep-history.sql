-- #460: expand-only, after migration-zz-bulk-cooking.sql.
-- NULL on old prepared sessions means no historical recipe was captured.
ALTER TABLE "MealBatch" ADD COLUMN IF NOT EXISTS "recipe_snapshot" JSONB;
ALTER TABLE "MealBatch" ADD COLUMN IF NOT EXISTS "recipe_snapshot_at" TIMESTAMP(3);
