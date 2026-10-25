-- #141 N1 additive source only. Unapplied/unverified. Loaded by migrate.js's
-- existing sorted migration-* discovery; no scheduler or producer activation.
BEGIN;
CREATE TABLE IF NOT EXISTS "NotificationEventOccurrence" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "occurrence_key" CHAR(64) NOT NULL,
  "envelope" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationEventOccurrence_key_shape" CHECK ("occurrence_key" ~ '^[a-f0-9]{64}$')
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationEventOccurrence_family_key"
  ON "NotificationEventOccurrence"("family_id", "occurrence_key");
CREATE INDEX IF NOT EXISTS "NotificationEventOccurrence_family_id_idx"
  ON "NotificationEventOccurrence"("family_id", "id");
-- Ordinary writers cannot renew/rebind accepted evidence. Household erasure may
-- delete rows; no time-based cleanup of this evidence is installed.
CREATE OR REPLACE FUNCTION public.herewoven_notification_event_immutable()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW IS DISTINCT FROM OLD THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification event is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_notification_event_immutable ON "NotificationEventOccurrence";
CREATE TRIGGER herewoven_notification_event_immutable BEFORE UPDATE
  ON "NotificationEventOccurrence" FOR EACH ROW
  EXECUTE FUNCTION public.herewoven_notification_event_immutable();
COMMIT;
