-- To-dos (#124 follow-up): who a list item is for and when it is due.
-- Additive and default-off: nothing reads or writes this table unless
-- FAMILY_LIST_TASKS_READY=1. A side table, so every existing ListItem read and
-- write is unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS "ListItemTask" (
  "item_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT,
  "member_id" TEXT,
  "due_day" TEXT,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ListItemTask_pkey" PRIMARY KEY ("item_id"),
  CONSTRAINT "ListItemTask_item_id_fkey" FOREIGN KEY ("item_id")
    REFERENCES "ListItem"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ListItemTask_family_id_fkey" FOREIGN KEY ("family_id")
    REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ListItemTask_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "ListItemTask_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id")
    REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
-- Prisma does not model CHECK constraints.
ALTER TABLE "ListItemTask" DROP CONSTRAINT IF EXISTS "ListItemTask_subject_check";
ALTER TABLE "ListItemTask" ADD CONSTRAINT "ListItemTask_subject_check" CHECK ("user_id" IS NULL OR "member_id" IS NULL);
ALTER TABLE "ListItemTask" DROP CONSTRAINT IF EXISTS "ListItemTask_content_check";
ALTER TABLE "ListItemTask" ADD CONSTRAINT "ListItemTask_content_check"
  CHECK ("user_id" IS NOT NULL OR "member_id" IS NOT NULL OR "due_day" IS NOT NULL);
ALTER TABLE "ListItemTask" DROP CONSTRAINT IF EXISTS "ListItemTask_due_day_check";
ALTER TABLE "ListItemTask" ADD CONSTRAINT "ListItemTask_due_day_check"
  CHECK ("due_day" IS NULL OR "due_day" ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}$');
CREATE INDEX IF NOT EXISTS "ListItemTask_family_id_idx" ON "ListItemTask"("family_id");
CREATE INDEX IF NOT EXISTS "ListItemTask_user_id_idx" ON "ListItemTask"("user_id");
CREATE INDEX IF NOT EXISTS "ListItemTask_member_id_family_id_idx" ON "ListItemTask"("member_id", "family_id");
-- The row's household must be the item's list's household, and an account
-- owner must be in it. Readers also join on the household.
CREATE OR REPLACE FUNCTION public.herewoven_list_item_task_household()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."item_id" IS DISTINCT FROM OLD."item_id" OR NEW."family_id" IS DISTINCT FROM OLD."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'List item task is outside the household';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public."ListItem" i JOIN public."List" l ON l."id" = i."list_id"
    WHERE i."id" = NEW."item_id" AND l."family_id" = NEW."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'List item task is outside the household';
  END IF;
  IF NEW."user_id" IS NOT NULL AND (TG_OP = 'INSERT' OR NEW."user_id" IS DISTINCT FROM OLD."user_id") AND NOT EXISTS (
    SELECT 1 FROM public."User" WHERE "id" = NEW."user_id" AND "family_id" = NEW."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'List item task is outside the household';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_list_item_task_household ON "ListItemTask";
CREATE TRIGGER herewoven_list_item_task_household BEFORE INSERT OR UPDATE ON "ListItemTask"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_list_item_task_household();
COMMIT;
