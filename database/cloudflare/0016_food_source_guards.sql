-- Native food-source continuity for the remaining grounded-planning graph.
-- Birth identities are server-owned UUIDs; epochs advance on ordinary updates.

ALTER TABLE "Family" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "Family" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "User" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "FamilyMeal" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "FamilyMeal" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

ALTER TABLE "MealPrepSession" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "MealPrepSession" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MealBatch" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "MealBatch" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "MealBatchConsumption" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "MealBatchConsumption" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "List" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "List" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "__Family_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__User_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__FamilyMeal_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__MealPrepSession_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__MealBatch_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__MealBatchConsumption_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);
CREATE TABLE "__List_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);

CREATE TRIGGER "Family_food_source_identity_guard" BEFORE UPDATE ON "Family"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__Family_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'Family food source identity or epoch changed'); END;
CREATE TRIGGER "Family_food_source_bounds_insert" BEFORE INSERT ON "Family"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'Family food epoch out of range'); END;
CREATE TRIGGER "Family_food_source_epoch" AFTER UPDATE ON "Family"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__Family_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "Family" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__Family_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "User_food_source_identity_guard" BEFORE UPDATE ON "User"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__User_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'User food source identity or epoch changed'); END;
CREATE TRIGGER "User_food_source_bounds_insert" BEFORE INSERT ON "User"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'User food epoch out of range'); END;
CREATE TRIGGER "User_food_source_epoch" AFTER UPDATE ON "User"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__User_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "User" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__User_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "FamilyMeal_food_source_identity_guard" BEFORE UPDATE ON "FamilyMeal"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__FamilyMeal_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'FamilyMeal food source identity or epoch changed'); END;
CREATE TRIGGER "FamilyMeal_food_source_bounds_insert" BEFORE INSERT ON "FamilyMeal"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'FamilyMeal food epoch out of range'); END;
CREATE TRIGGER "FamilyMeal_food_source_epoch" AFTER UPDATE ON "FamilyMeal"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__FamilyMeal_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "FamilyMeal" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__FamilyMeal_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "MealPrepSession_food_source_identity_guard" BEFORE UPDATE ON "MealPrepSession"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__MealPrepSession_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'MealPrepSession food source identity or epoch changed'); END;
CREATE TRIGGER "MealPrepSession_food_source_bounds_insert" BEFORE INSERT ON "MealPrepSession"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'MealPrepSession food epoch out of range'); END;
CREATE TRIGGER "MealPrepSession_food_source_epoch" AFTER UPDATE ON "MealPrepSession"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__MealPrepSession_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "MealPrepSession" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__MealPrepSession_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "MealBatch_food_source_identity_guard" BEFORE UPDATE ON "MealBatch"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__MealBatch_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'MealBatch food source identity or epoch changed'); END;
CREATE TRIGGER "MealBatch_food_source_bounds_insert" BEFORE INSERT ON "MealBatch"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'MealBatch food epoch out of range'); END;
CREATE TRIGGER "MealBatch_food_source_epoch" AFTER UPDATE ON "MealBatch"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__MealBatch_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "MealBatch" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__MealBatch_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "MealBatchConsumption_food_source_identity_guard" BEFORE UPDATE ON "MealBatchConsumption"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__MealBatchConsumption_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'MealBatchConsumption food source identity or epoch changed'); END;
CREATE TRIGGER "MealBatchConsumption_food_source_bounds_insert" BEFORE INSERT ON "MealBatchConsumption"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'MealBatchConsumption food epoch out of range'); END;
CREATE TRIGGER "MealBatchConsumption_food_source_epoch" AFTER UPDATE ON "MealBatchConsumption"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__MealBatchConsumption_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "MealBatchConsumption" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__MealBatchConsumption_food_epoch_rewrite" WHERE row_id=NEW.id;
END;

CREATE TRIGGER "List_food_source_identity_guard" BEFORE UPDATE ON "List"
WHEN NEW.food_generation IS NOT OLD.food_generation OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch OR NEW.food_epoch>2147483646 OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (SELECT 1 FROM "__List_food_epoch_rewrite" WHERE row_id=OLD.id))
BEGIN SELECT RAISE(ABORT,'List food source identity or epoch changed'); END;
CREATE TRIGGER "List_food_source_bounds_insert" BEFORE INSERT ON "List"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'List food epoch out of range'); END;
CREATE TRIGGER "List_food_source_epoch" AFTER UPDATE ON "List"
WHEN NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__List_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "List" SET food_epoch=min(2147483646,OLD.food_epoch+1) WHERE id=NEW.id;
  DELETE FROM "__List_food_epoch_rewrite" WHERE row_id=NEW.id;
END;
