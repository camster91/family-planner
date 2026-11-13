-- People on an event (#124 follow-up). Additive and default-off: no reader or
-- writer uses this table unless FAMILY_EVENT_PEOPLE_READY=1.
BEGIN;
CREATE TABLE IF NOT EXISTS "EventParticipant" (
  "id" TEXT NOT NULL,
  "event_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT,
  "member_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventParticipant_pkey" PRIMARY KEY ("id"),
  CONSTRAINT "EventParticipant_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id")
    REFERENCES "Event"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "EventParticipant_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "EventParticipant_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id")
    REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
-- Exactly one subject. Prisma does not model CHECK constraints.
ALTER TABLE "EventParticipant" DROP CONSTRAINT IF EXISTS "EventParticipant_subject_check";
ALTER TABLE "EventParticipant" ADD CONSTRAINT "EventParticipant_subject_check"
  CHECK (("user_id" IS NOT NULL AND "member_id" IS NULL) OR ("user_id" IS NULL AND "member_id" IS NOT NULL));
CREATE UNIQUE INDEX IF NOT EXISTS "EventParticipant_event_id_user_id_key" ON "EventParticipant"("event_id", "user_id");
CREATE UNIQUE INDEX IF NOT EXISTS "EventParticipant_event_id_member_id_key" ON "EventParticipant"("event_id", "member_id");
CREATE INDEX IF NOT EXISTS "EventParticipant_family_id_idx" ON "EventParticipant"("family_id");
CREATE INDEX IF NOT EXISTS "EventParticipant_user_id_idx" ON "EventParticipant"("user_id");
CREATE INDEX IF NOT EXISTS "EventParticipant_member_id_family_id_idx" ON "EventParticipant"("member_id", "family_id");
-- The account foreign key is by id only, so leaving a household never blocks
-- on this table. This guard keeps a foreign-household account from being
-- attached; readers also join on the event's household.
CREATE OR REPLACE FUNCTION public.herewoven_event_participant_household()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF TG_OP = 'UPDATE' AND (NEW."id" IS DISTINCT FROM OLD."id" OR NEW."event_id" IS DISTINCT FROM OLD."event_id"
    OR NEW."family_id" IS DISTINCT FROM OLD."family_id" OR NEW."user_id" IS DISTINCT FROM OLD."user_id"
    OR NEW."member_id" IS DISTINCT FROM OLD."member_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event participant identity is immutable';
  END IF;
  IF TG_OP = 'INSERT' AND NEW."user_id" IS NOT NULL AND NOT EXISTS (
    SELECT 1 FROM public."User" WHERE "id" = NEW."user_id" AND "family_id" = NEW."family_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Event participant account is outside the household';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_event_participant_household ON "EventParticipant";
CREATE TRIGGER herewoven_event_participant_household BEFORE INSERT OR UPDATE ON "EventParticipant"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_event_participant_household();
COMMIT;
