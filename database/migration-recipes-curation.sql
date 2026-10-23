-- #460 expand-only. Startup runner applies after meal-planner domains.
-- Do not infer source identity from a description in SQL or overwrite family edits.
BEGIN;
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "source_url" TEXT;
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "source_key" VARCHAR(64);
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "favorite" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Recipe" ADD COLUMN IF NOT EXISTS "revision" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "Recipe_id_family_key" ON "Recipe"("id", "family_id");
CREATE INDEX IF NOT EXISTS "Recipe_family_source_idx" ON "Recipe"("family_id", "source_key");
CREATE TABLE IF NOT EXISTS "RecipeCollection" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL CHECK (char_length("name") BETWEEN 1 AND 60),
  "name_key" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RecipeCollection_id_family_key" UNIQUE ("id", "family_id"),
  CONSTRAINT "RecipeCollection_family_name_key" UNIQUE ("family_id", "name_key")
);
CREATE TABLE IF NOT EXISTS "RecipeCollectionEntry" (
  "recipe_id" TEXT NOT NULL,
  "collection_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  PRIMARY KEY ("recipe_id", "collection_id"),
  FOREIGN KEY ("recipe_id", "family_id") REFERENCES "Recipe"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("collection_id", "family_id") REFERENCES "RecipeCollection"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE INDEX IF NOT EXISTS "RecipeCollectionEntry_collection_id_family_id_idx" ON "RecipeCollectionEntry"("collection_id", "family_id");
COMMIT;
