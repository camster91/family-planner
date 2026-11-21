-- All-day events (UI review item 9). Additive: one flag on Event and one on
-- the EventSeries template its repeats are written from. Default 0, so every
-- existing row and every older writer stays a timed event.
-- An all-day event keeps real instants: start is 00:00 of its first day and
-- end is 23:59 of its last day in the zone it was made in (imported feeds use
-- midnight to the next midnight). See docs/product/CALENDAR_WORKSPACE.md.
ALTER TABLE "Event" ADD COLUMN "all_day" INTEGER NOT NULL DEFAULT 0 CHECK ("all_day" IN (0,1));
ALTER TABLE "EventSeries" ADD COLUMN "all_day" INTEGER NOT NULL DEFAULT 0 CHECK ("all_day" IN (0,1));
