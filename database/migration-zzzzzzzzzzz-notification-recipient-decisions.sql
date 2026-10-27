-- #141 N2 additive/unverified source. No dispatcher/producer/scheduler enabled.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationEventOccurrence_id_family_key"
  ON "NotificationEventOccurrence"("id", "family_id");
CREATE TABLE IF NOT EXISTS "NotificationRecipientDecision" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "event_id" TEXT NOT NULL,
  "slot" INTEGER NOT NULL CHECK ("slot" >= 0 AND "slot" < 100),
  "user_id" TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "notification_id" TEXT REFERENCES "Notification"("id") ON DELETE SET NULL,
  "status" TEXT NOT NULL CHECK ("status" IN ('created', 'suppressed')),
  "quiet" BOOLEAN NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "NotificationRecipientDecision_event_family_fkey" FOREIGN KEY ("event_id", "family_id")
    REFERENCES "NotificationEventOccurrence"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "NotificationRecipientDecision_event_slot_key" ON "NotificationRecipientDecision"("event_id", "slot");
CREATE INDEX IF NOT EXISTS "NotificationRecipientDecision_family_id_idx" ON "NotificationRecipientDecision"("family_id", "id");
CREATE INDEX IF NOT EXISTS "NotificationRecipientDecision_user_idx" ON "NotificationRecipientDecision"("user_id");
CREATE INDEX IF NOT EXISTS "NotificationRecipientDecision_notification_idx" ON "NotificationRecipientDecision"("notification_id");
-- Preserve terminal slot identity/status. FK/account/inbox deletion may clear
-- links, but no writer may refill or redirect a completed slot afterward.
CREATE OR REPLACE FUNCTION public.herewoven_notification_recipient_terminal()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id"
    OR NEW."family_id" IS DISTINCT FROM OLD."family_id"
    OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
    OR NEW."slot" IS DISTINCT FROM OLD."slot"
    OR NEW."status" IS DISTINCT FROM OLD."status"
    OR NEW."quiet" IS DISTINCT FROM OLD."quiet"
    OR NEW."created_at" IS DISTINCT FROM OLD."created_at"
    OR (NEW."user_id" IS DISTINCT FROM OLD."user_id" AND NEW."user_id" IS NOT NULL)
    OR (NEW."notification_id" IS DISTINCT FROM OLD."notification_id" AND NEW."notification_id" IS NOT NULL) THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Notification recipient decision is terminal';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_notification_recipient_terminal ON "NotificationRecipientDecision";
CREATE TRIGGER herewoven_notification_recipient_terminal BEFORE UPDATE ON "NotificationRecipientDecision"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_notification_recipient_terminal();
COMMIT;
