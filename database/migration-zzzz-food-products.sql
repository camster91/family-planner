-- #125 expand-only. Apply after inventory/domain migrations. No backfill or data replacement.
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "barcode" VARCHAR(14);
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "product_brand" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "package_size" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "product_source" TEXT;
CREATE TABLE IF NOT EXISTS "FoodProduct" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "barcode" VARCHAR(14) NOT NULL, "name" TEXT NOT NULL, "brand" TEXT, "package_size" TEXT,
  "origin" TEXT NOT NULL DEFAULT 'manual', "source_url" TEXT, "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "FoodProduct_family_barcode_key" UNIQUE ("family_id", "barcode")
);
