-- Native inventory continuity (#123/#144).
-- InventoryItem's food identity is server-owned. It is never accepted from a
-- browser/device and advances on every material update, including stock
-- amount and lifecycle changes.
ALTER TABLE "InventoryItem" ADD COLUMN "food_generation" TEXT NOT NULL DEFAULT (
  lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' ||
  substr(lower(hex(randomblob(2))),2) || '-' ||
  '8' || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))
);
ALTER TABLE "InventoryItem" ADD COLUMN "food_epoch" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE "__InventoryItem_food_epoch_rewrite" ("row_id" TEXT NOT NULL PRIMARY KEY);

CREATE TRIGGER "InventoryItem_food_source_identity_guard" BEFORE UPDATE ON "InventoryItem"
WHEN NEW.food_generation IS NOT OLD.food_generation
  OR typeof(NEW.food_epoch)<>'integer'
  OR NEW.food_epoch<OLD.food_epoch
  OR NEW.food_epoch>2147483646
  OR OLD.food_epoch>=2147483646
  OR (NEW.food_epoch IS NOT OLD.food_epoch AND NOT EXISTS (
    SELECT 1 FROM "__InventoryItem_food_epoch_rewrite" WHERE row_id=OLD.id
  ))
BEGIN SELECT RAISE(ABORT,'InventoryItem food source identity or epoch changed'); END;

CREATE TRIGGER "InventoryItem_food_source_bounds_insert" BEFORE INSERT ON "InventoryItem"
WHEN typeof(NEW.food_epoch)<>'integer' OR NEW.food_epoch<0 OR NEW.food_epoch>2147483646
BEGIN SELECT RAISE(ABORT,'InventoryItem food epoch out of range'); END;

CREATE TRIGGER "InventoryItem_food_source_epoch" AFTER UPDATE ON "InventoryItem"
WHEN (NEW.family_id IS NOT OLD.family_id
  OR NEW.name IS NOT OLD.name
  OR NEW.barcode IS NOT OLD.barcode
  OR NEW.product_brand IS NOT OLD.product_brand
  OR NEW.package_size IS NOT OLD.package_size
  OR NEW.product_source IS NOT OLD.product_source
  OR NEW.ingredient_id IS NOT OLD.ingredient_id
  OR NEW.amount IS NOT OLD.amount
  OR NEW.unit IS NOT OLD.unit
  OR NEW.location IS NOT OLD.location
  OR NEW.expires_on IS NOT OLD.expires_on
  OR NEW.date_kind IS NOT OLD.date_kind
  OR NEW.category IS NOT OLD.category
  OR NEW.purchased_on IS NOT OLD.purchased_on
  OR NEW.opened_on IS NOT OLD.opened_on
  OR NEW.status IS NOT OLD.status
  OR NEW.finished_at IS NOT OLD.finished_at
  OR NEW.added_by IS NOT OLD.added_by
  OR NEW.food_epoch<OLD.food_epoch)
  AND NEW.food_epoch IS OLD.food_epoch
BEGIN
  INSERT OR REPLACE INTO "__InventoryItem_food_epoch_rewrite"(row_id) VALUES(NEW.id);
  UPDATE "InventoryItem"
  SET food_epoch=min(2147483646,OLD.food_epoch+1)
  WHERE id=NEW.id;
  DELETE FROM "__InventoryItem_food_epoch_rewrite" WHERE row_id=NEW.id;
END;
