-- Additive #538; canonical FamilyMeal/Recipe tables already exist at this point.
CREATE TABLE IF NOT EXISTS "MealPrepSession" (
 "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "prepared_on" TIMESTAMP(3) NOT NULL, "next_prep_on" TIMESTAMP(3), "prepared_at" TIMESTAMP(3),
 "created_by" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE, "source_request_id" TEXT,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MealPrepSession_source_request_id_key" ON "MealPrepSession"("source_request_id");
CREATE INDEX IF NOT EXISTS "MealPrepSession_family_id_created_at_id_idx" ON "MealPrepSession"("family_id","created_at","id");
CREATE TABLE IF NOT EXISTS "MealBatch" (
 "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "prep_session_id" TEXT NOT NULL REFERENCES "MealPrepSession"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "position" INTEGER NOT NULL CHECK ("position" BETWEEN 0 AND 7), "name" TEXT NOT NULL,
 "total_servings" INTEGER NOT NULL CHECK ("total_servings" BETWEEN 1 AND 50),
 "reserve_storage" TEXT NOT NULL DEFAULT 'freezer' CHECK ("reserve_storage" IN ('fridge','freezer')),
 "recipe_id" TEXT REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "cook_id" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "MealBatch_prep_session_id_position_key" ON "MealBatch"("prep_session_id","position");
CREATE INDEX IF NOT EXISTS "MealBatch_family_id_idx" ON "MealBatch"("family_id");
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "batch_id" TEXT;
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "batch_allocation_key" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "FamilyMeal_batch_allocation_key_key" ON "FamilyMeal"("batch_allocation_key");
DO $$ BEGIN
 ALTER TABLE "FamilyMeal" ADD CONSTRAINT "FamilyMeal_batch_id_fkey"
 FOREIGN KEY ("batch_id") REFERENCES "MealBatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "FamilyMeal_batch_id_idx" ON "FamilyMeal"("batch_id");
CREATE TABLE IF NOT EXISTS "MealBatchConsumption" (
 "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "batch_id" TEXT NOT NULL REFERENCES "MealBatch"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "allocation_key" TEXT, "meal_id" TEXT REFERENCES "FamilyMeal"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "servings" INTEGER NOT NULL CHECK ("servings" BETWEEN 1 AND 50),
 "created_by" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
 "consumed_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "cancelled_at" TIMESTAMP(3),
 "source_request_id" TEXT
);
CREATE UNIQUE INDEX IF NOT EXISTS "MealBatchConsumption_source_request_id_key" ON "MealBatchConsumption"("source_request_id");
CREATE INDEX IF NOT EXISTS "MealBatchConsumption_family_id_batch_id_cancelled_at_idx" ON "MealBatchConsumption"("family_id","batch_id","cancelled_at");

CREATE INDEX IF NOT EXISTS "MealBatchConsumption_family_id_batch_id_allocation_key_idx" ON "MealBatchConsumption"("family_id","batch_id","allocation_key");
