-- Native recipe continuity (#123/#144).
--
-- 0013 owns InventoryItem. Recipe, Ingredient and RecipeIngredient have the
-- same server-owned birth identity/epoch contract so saved recipe reviews can
-- distinguish an edited source from a deleted-and-recreated row.
-- SQLite triggers cannot assign NEW.* in a BEFORE trigger; the native writer
-- therefore generates the UUID and binds it on insert while these guards make
-- the identity immutable and advance the epoch after every update.

ALTER TABLE "Recipe" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' ||
  lower(hex(randomblob(6)))
);
ALTER TABLE "Recipe" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "Ingredient" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' ||
  lower(hex(randomblob(6)))
);
ALTER TABLE "Ingredient" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "RecipeIngredient" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' ||
  lower(hex(randomblob(6)))
);
ALTER TABLE "RecipeIngredient" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

-- SQLite cannot assign NEW.* in a BEFORE trigger.  These private marker tables
-- let the AFTER trigger perform the one internal epoch rewrite without
-- allowing a caller to supply an arbitrary forward epoch.  D1 executes each
-- request serially, and the marker is created/removed in the same statement
-- transaction as the guarded row update.
CREATE TABLE "__Recipe_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__Ingredient_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__RecipeIngredient_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);

CREATE TRIGGER "Recipe_food_source_identity_guard" BEFORE UPDATE ON "Recipe"
WHEN NEW.food_generation IS NOT OLD.food_generation
  OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch
  OR NEW.food_epoch>2147483646
  OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (
    SELECT 1 FROM "__Recipe_food_epoch_rewrite" WHERE row_id=OLD.id
  ))
BEGIN SELECT RAISE(ABORT,'Recipe food source identity or epoch changed'); END;
CREATE TRIGGER "Recipe_food_source_bounds_insert" BEFORE INSERT ON "Recipe"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'Recipe food epoch out of range'); END;
CREATE TRIGGER "Recipe_food_source_epoch" AFTER UPDATE ON "Recipe"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__Recipe_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "Recipe" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__Recipe_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "Ingredient_food_source_identity_guard" BEFORE UPDATE ON "Ingredient"
WHEN NEW.food_generation IS NOT OLD.food_generation
  OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch
  OR NEW.food_epoch>2147483646
  OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (
    SELECT 1 FROM "__Ingredient_food_epoch_rewrite" WHERE row_id=OLD.id
  ))
BEGIN SELECT RAISE(ABORT,'Ingredient food source identity or epoch changed'); END;
CREATE TRIGGER "Ingredient_food_source_bounds_insert" BEFORE INSERT ON "Ingredient"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'Ingredient food epoch out of range'); END;
CREATE TRIGGER "Ingredient_food_source_epoch" AFTER UPDATE ON "Ingredient"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__Ingredient_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "Ingredient" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__Ingredient_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "RecipeIngredient_food_source_identity_guard" BEFORE UPDATE ON "RecipeIngredient"
WHEN NEW.food_generation IS NOT OLD.food_generation
  OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch
  OR NEW.food_epoch>2147483646
  OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (
    SELECT 1 FROM "__RecipeIngredient_food_epoch_rewrite" WHERE row_id=OLD.id
  ))
BEGIN SELECT RAISE(ABORT,'RecipeIngredient food source identity or epoch changed'); END;
CREATE TRIGGER "RecipeIngredient_food_source_bounds_insert" BEFORE INSERT ON "RecipeIngredient"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'RecipeIngredient food epoch out of range'); END;
CREATE TRIGGER "RecipeIngredient_food_source_epoch" AFTER UPDATE ON "RecipeIngredient"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__RecipeIngredient_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "RecipeIngredient" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__RecipeIngredient_food_epoch_rewrite" WHERE row_id=NEW.id;
END;
