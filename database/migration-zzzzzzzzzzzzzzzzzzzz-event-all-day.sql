-- All-day events (UI review item 9). PostgreSQL equivalent of
-- database/cloudflare/0025_event_all_day.sql. Expand-only: one flag on Event
-- and one on the EventSeries template, both default false, so existing rows
-- and older writers stay timed events.
BEGIN;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "all_day" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "EventSeries" ADD COLUMN IF NOT EXISTS "all_day" BOOLEAN NOT NULL DEFAULT false;
COMMIT;
