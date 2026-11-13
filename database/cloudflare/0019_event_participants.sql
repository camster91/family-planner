-- People on an event (#124 follow-up). Additive and default-off: no reader or
-- writer uses this table unless FAMILY_EVENT_PEOPLE_READY=1.
-- A participant is either a household account or an email-free profile of the
-- same household as the event, never both and never neither.
CREATE TABLE "EventParticipant" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "event_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT,
    "member_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "EventParticipant_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "Event" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventParticipant_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventParticipant_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventParticipant_subject_check" CHECK (("user_id" IS NOT NULL AND "member_id" IS NULL) OR ("user_id" IS NULL AND "member_id" IS NOT NULL))
);
CREATE UNIQUE INDEX "EventParticipant_event_id_user_id_key" ON "EventParticipant"("event_id", "user_id");
CREATE UNIQUE INDEX "EventParticipant_event_id_member_id_key" ON "EventParticipant"("event_id", "member_id");
CREATE INDEX "EventParticipant_family_id_idx" ON "EventParticipant"("family_id");
CREATE INDEX "EventParticipant_user_id_idx" ON "EventParticipant"("user_id");
CREATE INDEX "EventParticipant_member_id_family_id_idx" ON "EventParticipant"("member_id", "family_id");
-- The account foreign key is by id only, so leaving a household never blocks
-- on this table. This guard keeps a foreign-household account from being
-- attached; readers also join on the event's household.
CREATE TRIGGER "EventParticipant_account_household_insert" BEFORE INSERT ON "EventParticipant"
WHEN NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW.user_id AND family_id=NEW.family_id)
BEGIN SELECT RAISE(ABORT,'Event participant account is outside the household'); END;
CREATE TRIGGER "EventParticipant_identity_update" BEFORE UPDATE ON "EventParticipant"
WHEN NEW.id IS NOT OLD.id OR NEW.event_id IS NOT OLD.event_id OR NEW.family_id IS NOT OLD.family_id
  OR NEW.user_id IS NOT OLD.user_id OR NEW.member_id IS NOT OLD.member_id
BEGIN SELECT RAISE(ABORT,'Event participant identity is immutable'); END;
