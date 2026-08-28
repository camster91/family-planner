-- Meal Planner domains, scoped to a Family Planner family. Safe to rerun.

CREATE TABLE IF NOT EXISTS "Recipe" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT, "instructions" TEXT, "prep_time" INTEGER,
  "cook_time" INTEGER, "servings" INTEGER NOT NULL DEFAULT 2, "image_url" TEXT,
  "created_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "Ingredient" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "name" TEXT NOT NULL, "unit" TEXT
);
CREATE TABLE IF NOT EXISTS "RecipeIngredient" (
  "id" TEXT PRIMARY KEY, "recipe_id" TEXT NOT NULL, "ingredient_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL, "unit" TEXT, "note" TEXT
);
CREATE TABLE IF NOT EXISTS "MealPlan" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "name" TEXT NOT NULL,
  "start_date" DATE NOT NULL, "end_date" DATE NOT NULL, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "MealPlanEntry" (
  "id" TEXT PRIMARY KEY, "meal_plan_id" TEXT NOT NULL, "recipe_id" TEXT NOT NULL,
  "date" DATE NOT NULL, "meal_type" TEXT NOT NULL, "servings" INTEGER NOT NULL DEFAULT 2
);
CREATE TABLE IF NOT EXISTS "ShoppingList" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "name" TEXT NOT NULL DEFAULT 'Shopping List',
  "created_by" TEXT NOT NULL, "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "ShoppingItem" (
  "id" TEXT PRIMARY KEY, "shopping_list_id" TEXT NOT NULL, "ingredient_name" TEXT NOT NULL,
  "amount" DOUBLE PRECISION, "unit" TEXT, "category" TEXT,
  "checked" BOOLEAN NOT NULL DEFAULT false, "recipe_id" TEXT
);

CREATE INDEX IF NOT EXISTS "Recipe_family_title_idx" ON "Recipe"("family_id", "title");
CREATE UNIQUE INDEX IF NOT EXISTS "Ingredient_family_name_key" ON "Ingredient"("family_id", "name");
CREATE UNIQUE INDEX IF NOT EXISTS "RecipeIngredient_recipe_ingredient_key" ON "RecipeIngredient"("recipe_id", "ingredient_id");
CREATE INDEX IF NOT EXISTS "RecipeIngredient_ingredient_idx" ON "RecipeIngredient"("ingredient_id");
CREATE INDEX IF NOT EXISTS "MealPlan_family_start_idx" ON "MealPlan"("family_id", "start_date");
CREATE UNIQUE INDEX IF NOT EXISTS "MealPlanEntry_plan_date_type_key" ON "MealPlanEntry"("meal_plan_id", "date", "meal_type");
CREATE INDEX IF NOT EXISTS "MealPlanEntry_recipe_idx" ON "MealPlanEntry"("recipe_id");
CREATE INDEX IF NOT EXISTS "ShoppingList_family_created_idx" ON "ShoppingList"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "ShoppingItem_list_checked_idx" ON "ShoppingItem"("shopping_list_id", "checked");

DO $$ BEGIN ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Recipe" ADD CONSTRAINT "Recipe_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Ingredient" ADD CONSTRAINT "Ingredient_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RecipeIngredient" ADD CONSTRAINT "RecipeIngredient_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MealPlan" ADD CONSTRAINT "MealPlan_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_meal_plan_id_fkey" FOREIGN KEY ("meal_plan_id") REFERENCES "MealPlan"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "MealPlanEntry" ADD CONSTRAINT "MealPlanEntry_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ShoppingList" ADD CONSTRAINT "ShoppingList_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "ShoppingItem" ADD CONSTRAINT "ShoppingItem_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "ShoppingList"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
