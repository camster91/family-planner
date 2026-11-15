-- How far ahead one account is reminded about events (in-app reminders).
-- Additive: nothing reads or writes this table unless
-- FAMILY_EVENT_REMINDERS_READY=1, and an account with no row uses the default.
BEGIN;
CREATE TABLE IF NOT EXISTS "EventReminderPreference" (
  "user_id" TEXT NOT NULL,
  "hours" INTEGER NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "EventReminderPreference_pkey" PRIMARY KEY ("user_id"),
  CONSTRAINT "EventReminderPreference_user_id_fkey" FOREIGN KEY ("user_id")
    REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
-- A closed set of lead times. Prisma does not model CHECK constraints.
ALTER TABLE "EventReminderPreference" DROP CONSTRAINT IF EXISTS "EventReminderPreference_hours_check";
ALTER TABLE "EventReminderPreference" ADD CONSTRAINT "EventReminderPreference_hours_check" CHECK ("hours" IN (2, 12, 24, 48, 168));
COMMIT;
