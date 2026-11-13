-- In-app event reminders (#124 follow-up). Additive and default-off: no reader
-- or writer uses this table unless FAMILY_EVENT_REMINDERS_READY=1.
-- One row is the lasting proof that one account was already considered for a
-- reminder about one event; it outlives the inbox row.
BEGIN;
CREATE TABLE IF NOT EXISTS "EventReminder" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventReminder_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventReminder_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id")
    REFERENCES "Event"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "EventReminder_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "EventReminder_event_id_user_id_key" ON "EventReminder"("event_id", "user_id");
CREATE INDEX IF NOT EXISTS "EventReminder_family_id_idx" ON "EventReminder"("family_id");
CREATE INDEX IF NOT EXISTS "EventReminder_user_id_idx" ON "EventReminder"("user_id");
CREATE OR REPLACE FUNCTION public.herewoven_event_reminder_household()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
    OR NEW."family_id" IS DISTINCT FROM OLD."family_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event reminder identity is immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NOT EXISTS (
    SELECT 1 FROM public."User" WHERE "id" = NEW."user_id" AND "family_id" = NEW."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event reminder account is outside the household';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_event_reminder_household ON "EventReminder";
CREATE TRIGGER herewoven_event_reminder_household BEFORE INSERT OR UPDATE ON "EventReminder"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_event_reminder_household();
COMMIT;
