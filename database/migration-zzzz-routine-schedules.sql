-- #450 durable future schedules extend existing canonical RoutineStack/Chore.
-- Source only until the integrated migration/compatibility gate is accepted.
-- Existing occurrence stacks and chores stay NULL; no adoption/backfill.
BEGIN;
ALTER TABLE "RoutineStack" ADD COLUMN IF NOT EXISTS "schedule_config" JSONB;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_anchor" VARCHAR(200);
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_duration_minutes" INTEGER;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_series_config" JSONB;
DO $$ BEGIN
  ALTER TABLE "RoutineStack" ADD CONSTRAINT "RoutineStack_schedule_protocol_check"
    CHECK ("schedule_config" IS NULL OR COALESCE(
      jsonb_typeof("schedule_config") = 'object' AND
      "schedule_config"->>'protocol' = 'herewoven.routine-schedule.v1', false)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "RoutineStack" VALIDATE CONSTRAINT "RoutineStack_schedule_protocol_check";
DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_routine_duration_check"
    CHECK ("routine_duration_minutes" IS NULL OR "routine_duration_minutes" BETWEEN 1 AND 1440) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Chore" VALIDATE CONSTRAINT "Chore_routine_duration_check";
DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_routine_series_protocol_check"
    CHECK ("routine_series_config" IS NULL OR COALESCE(
      jsonb_typeof("routine_series_config") = 'object' AND
      "routine_series_config"->>'protocol' = 'herewoven.routine-step-series.v1', false)) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Chore" VALIDATE CONSTRAINT "Chore_routine_series_protocol_check";
COMMIT;
