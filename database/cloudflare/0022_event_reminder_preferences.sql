-- How far ahead one account is reminded about events (in-app reminders).
-- Additive: nothing reads or writes this table unless
-- FAMILY_EVENT_REMINDERS_READY=1, and an account with no row uses the default.
CREATE TABLE "EventReminderPreference" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "hours" INTEGER NOT NULL CHECK (typeof("hours")='integer' AND "hours" IN (2, 12, 24, 48, 168)),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "EventReminderPreference_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
