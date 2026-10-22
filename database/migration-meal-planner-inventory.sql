-- Inventory foundation formerly in scripts/migrate.js POST_FEATURE_SQL.
-- Expand-only/idempotent: no table/column rename, row replacement or backfill.
-- Keep it after migration-meal-planner-domains.sql and before later food extensions.
-- ============ Food inventory (#263; additive) ============
-- New table only, no backfill. It references "Ingredient", which
-- migration-meal-planner-domains.sql creates. This sorted migration runs
-- immediately after that domain foundation and before food products/source
-- versions that depend on InventoryItem. The
-- "inventory" feature is off by default for new and existing households
-- (src/lib/features.ts), so no Family.features stamp is needed: a blob
-- without the key already reads as off. See
-- docs/architecture/MEALS_AND_GROCERIES.md "Food inventory".
CREATE TABLE IF NOT EXISTS "InventoryItem" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ingredient_id" TEXT,
  "amount" DOUBLE PRECISION,
  "unit" TEXT,
  "location" TEXT NOT NULL DEFAULT 'fridge',
  "expires_on" DATE,
  "added_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_location_idx" ON "InventoryItem"("family_id", "location");
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_expires_on_idx" ON "InventoryItem"("family_id", "expires_on");
CREATE INDEX IF NOT EXISTS "InventoryItem_ingredient_id_idx" ON "InventoryItem"("ingredient_id");

-- ============ Inventory foundation (#158/#121; additive) ============
-- Nullable or defaulted columns and one new table, no backfill. Old rows read
-- as best-before dates on active items, which is what they were. Finished
-- (consumed/discarded) items keep their row so Undo can put them back; the
-- adjustment row records who did what and what to restore. See
-- docs/architecture/MEALS_AND_GROCERIES.md §10 "Consume, discard and undo".
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "date_kind" TEXT NOT NULL DEFAULT 'best_before';
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "purchased_on" DATE;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "opened_on" DATE;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "finished_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_status_expires_on_idx" ON "InventoryItem"("family_id", "status", "expires_on");
CREATE TABLE IF NOT EXISTS "InventoryAdjustment" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount_delta" DOUBLE PRECISION,
  "amount_before" DOUBLE PRECISION,
  "amount_after" DOUBLE PRECISION,
  "status_before" TEXT NOT NULL,
  "status_after" TEXT NOT NULL,
  "actor_id" TEXT,
  "request_id" TEXT,
  "item_version" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undone_at" TIMESTAMP(3),
  "undone_by" TEXT
);
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryAdjustment_request_id_key" ON "InventoryAdjustment"("request_id");
CREATE INDEX IF NOT EXISTS "InventoryAdjustment_family_id_created_at_idx" ON "InventoryAdjustment"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "InventoryAdjustment_item_id_created_at_idx" ON "InventoryAdjustment"("item_id", "created_at");

