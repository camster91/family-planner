-- #123/#144 additive source only. Unapplied until consolidated migration QA.
-- Independent row identities; no shared food/family counter, collection lock,
-- new domain store or requirement for installed clients to send new fields.
BEGIN;
CREATE OR REPLACE FUNCTION public.herewoven_food_source_version()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- Never trust an imported/browser-supplied old identity for a new row.
    NEW."food_generation" := gen_random_uuid()::text;
    NEW."food_epoch" := 0;
  ELSE
    -- Count every update, including no-ops. Conservatively invalidates reviews
    -- without a fragile allowlist that misses a new material legacy field.
    IF OLD."food_epoch" >= 2147483646 THEN
      RAISE EXCEPTION USING ERRCODE = '22003', MESSAGE = 'Food source version exhausted';
    END IF;
    NEW."food_generation" := OLD."food_generation";
    NEW."food_epoch" := OLD."food_epoch" + 1;
  END IF;
  RETURN NEW;
END $$;
DO $$
DECLARE table_name text;
BEGIN
  FOREACH table_name IN ARRAY ARRAY[
    'Family','User','Recipe','RecipeIngredient','Ingredient','InventoryItem',
    'FamilyMeal','MealPrepSession','MealBatch','MealBatchConsumption','List'
  ] LOOP
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS "food_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text', table_name);
    EXECUTE format('ALTER TABLE public.%I ADD COLUMN IF NOT EXISTS "food_epoch" INTEGER NOT NULL DEFAULT 0', table_name);
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = to_regclass(format('public.%I', table_name)) AND conname = table_name || '_food_epoch_check') THEN
      EXECUTE format('ALTER TABLE public.%I ADD CONSTRAINT %I CHECK ("food_epoch" BETWEEN 0 AND 2147483646) NOT VALID', table_name, table_name || '_food_epoch_check');
    END IF;
    EXECUTE format('ALTER TABLE public.%I VALIDATE CONSTRAINT %I', table_name, table_name || '_food_epoch_check');
    EXECUTE format('DROP TRIGGER IF EXISTS herewoven_food_source_version ON public.%I', table_name);
    EXECUTE format('CREATE TRIGGER herewoven_food_source_version BEFORE INSERT OR UPDATE ON public.%I FOR EACH ROW EXECUTE FUNCTION public.herewoven_food_source_version()', table_name);
    EXECUTE format('ALTER TABLE public.%I ENABLE ALWAYS TRIGGER herewoven_food_source_version', table_name);
  END LOOP;
END $$;
COMMIT;
