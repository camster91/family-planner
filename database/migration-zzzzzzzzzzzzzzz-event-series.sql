-- Repeating events (#124 follow-up). Additive and default-off: nothing reads
-- or writes these unless FAMILY_EVENT_REPEAT_READY=1.
BEGIN;
CREATE TABLE IF NOT EXISTS "EventSeries" (
  "id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "every" TEXT NOT NULL,
  "time_zone" TEXT NOT NULL,
  "anchor_start" TIMESTAMP(3) NOT NULL,
  "duration_ms" INTEGER NOT NULL DEFAULT 0,
  "until_day" TEXT,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "location" TEXT,
  "event_type" TEXT NOT NULL DEFAULT 'other',
  "participants" TEXT NOT NULL DEFAULT '[]',
  "generated_through" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventSeries_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventSeries_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "EventSeries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
ALTER TABLE "EventSeries" DROP CONSTRAINT IF EXISTS "EventSeries_every_check";
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_every_check" CHECK ("every" IN ('day','week','2weeks','month','year'));
ALTER TABLE "EventSeries" DROP CONSTRAINT IF EXISTS "EventSeries_duration_check";
ALTER TABLE "EventSeries" ADD CONSTRAINT "EventSeries_duration_check" CHECK ("duration_ms" >= 0);
CREATE UNIQUE INDEX IF NOT EXISTS "EventSeries_id_family_id_key" ON "EventSeries"("id", "family_id");
CREATE INDEX IF NOT EXISTS "EventSeries_family_id_generated_through_idx" ON "EventSeries"("family_id", "generated_through");
CREATE INDEX IF NOT EXISTS "EventSeries_created_by_idx" ON "EventSeries"("created_by");

ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "series_id" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "series_occurrence_start" TIMESTAMP(3);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "series_detached" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" DROP CONSTRAINT IF EXISTS "Event_series_id_fkey";
ALTER TABLE "Event" ADD CONSTRAINT "Event_series_id_fkey" FOREIGN KEY ("series_id") REFERENCES "EventSeries"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
CREATE UNIQUE INDEX IF NOT EXISTS "Event_series_id_series_occurrence_start_key" ON "Event"("series_id", "series_occurrence_start");

-- An occurrence belongs to a series of its own household, and a series never
-- moves household.
CREATE OR REPLACE FUNCTION public.herewoven_event_series_household()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."series_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."EventSeries" WHERE "id" = NEW."series_id" AND "family_id" = NEW."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event series is outside the household';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_event_series_household ON "Event";
CREATE TRIGGER herewoven_event_series_household BEFORE INSERT OR UPDATE OF "series_id" ON "Event"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_event_series_household();
CREATE OR REPLACE FUNCTION public.herewoven_event_series_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."family_id" IS DISTINCT FROM OLD."family_id" THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event series identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_event_series_identity ON "EventSeries";
CREATE TRIGGER herewoven_event_series_identity BEFORE UPDATE ON "EventSeries"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_event_series_identity();
COMMIT;
