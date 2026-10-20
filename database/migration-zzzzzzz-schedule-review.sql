-- #123 additive source only. No SQL/migration command has been executed.
-- Per-insertion identity and material version protect old proposal snapshots.
-- No shared family-version row: legacy multi-event writes must not acquire a
-- new collection lock after they already hold Event rows.
BEGIN;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "schedule_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "schedule_epoch" INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_schedule_epoch_check" CHECK ("schedule_epoch" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_schedule_epoch_check";
CREATE INDEX IF NOT EXISTS "Event_family_id_end_time_idx" ON "Event" ("family_id", "end_time");
-- Explicit uncertainty predicates in the bounded comparison read.
CREATE INDEX IF NOT EXISTS "Event_schedule_recurring_review_idx" ON "Event" ("family_id", "id") WHERE "recurrence" IS NOT NULL;
CREATE INDEX IF NOT EXISTS "Event_schedule_invalid_review_idx" ON "Event" ("family_id", "id") WHERE "end_time" <= "start_time";
CREATE OR REPLACE FUNCTION herewoven_schedule_event_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE changed boolean; old_row jsonb; new_row jsonb;
BEGIN
  old_row := to_jsonb(OLD); new_row := to_jsonb(NEW);
  SELECT EXISTS(SELECT 1 FROM unnest(ARRAY[
    'id','family_id','title','description','start_time','end_time','location',
    'event_type','is_task','project_id','recurrence','created_by',
    'source_subscription_id','source_uid','source_occurrence_start','source_connection_id'
  ]) AS field(key) WHERE (old_row->field.key) IS DISTINCT FROM (new_row->field.key)) INTO changed;
  NEW."schedule_generation" := OLD."schedule_generation";
  NEW."schedule_epoch" := GREATEST(OLD."schedule_epoch", COALESCE(NEW."schedule_epoch", OLD."schedule_epoch"));
  IF changed THEN NEW."schedule_epoch" := LEAST(2147483647::bigint, NEW."schedule_epoch"::bigint + 1)::integer; END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_schedule_event_epoch ON "Event";
CREATE TRIGGER herewoven_schedule_event_epoch BEFORE UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION herewoven_schedule_event_epoch();
COMMIT;
