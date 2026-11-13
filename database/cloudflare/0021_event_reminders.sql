-- In-app event reminders (#124 follow-up). Additive and default-off: no reader
-- or writer uses this table unless FAMILY_EVENT_REMINDERS_READY=1.
-- One row is the lasting proof that one account was already considered for a
-- reminder about one event. It outlives the inbox row, so deleting or muting a
-- notification never makes an old reminder come back.
CREATE TABLE "EventReminder" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "EventReminder_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "Event" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventReminder_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX "EventReminder_event_id_user_id_key" ON "EventReminder"("event_id", "user_id");
CREATE INDEX "EventReminder_family_id_idx" ON "EventReminder"("family_id");
CREATE INDEX "EventReminder_user_id_idx" ON "EventReminder"("user_id");
-- The account foreign key is by id only, so leaving a household never blocks
-- on this table. This guard keeps a foreign-household account out.
CREATE TRIGGER "EventReminder_account_household_insert" BEFORE INSERT ON "EventReminder"
WHEN NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW.user_id AND family_id=NEW.family_id)
BEGIN SELECT RAISE(ABORT,'Event reminder account is outside the household'); END;
CREATE TRIGGER "EventReminder_identity_update" BEFORE UPDATE ON "EventReminder"
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.family_id IS NOT OLD.family_id OR NEW.user_id IS NOT OLD.user_id
BEGIN SELECT RAISE(ABORT,'Event reminder identity is immutable'); END;
