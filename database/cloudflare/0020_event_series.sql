-- Repeating events (#124 follow-up). Additive and default-off: nothing reads
-- or writes these unless FAMILY_EVENT_REPEAT_READY=1.
-- A series is a small closed repeat (never an RRULE) plus the template its
-- occurrences are written from. Each occurrence is an ordinary Event row that
-- points back here; (series_id, series_occurrence_start) makes writing the
-- same occurrence twice impossible, so top-up on read is idempotent.
CREATE TABLE "EventSeries" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "every" TEXT NOT NULL,
    "time_zone" TEXT NOT NULL,
    "anchor_start" INTEGER NOT NULL CHECK ("anchor_start" IS NULL OR typeof("anchor_start")='integer'),
    "duration_ms" INTEGER NOT NULL DEFAULT 0,
    "until_day" TEXT,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "location" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'other',
    "participants" TEXT NOT NULL DEFAULT '[]',
    "generated_through" INTEGER NOT NULL CHECK ("generated_through" IS NULL OR typeof("generated_through")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "EventSeries_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventSeries_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventSeries_every_check" CHECK ("every" IN ('day','week','2weeks','month','year')),
    CONSTRAINT "EventSeries_duration_check" CHECK (typeof("duration_ms")='integer' AND "duration_ms" >= 0)
);
CREATE UNIQUE INDEX "EventSeries_id_family_id_key" ON "EventSeries"("id", "family_id");
CREATE INDEX "EventSeries_family_id_generated_through_idx" ON "EventSeries"("family_id", "generated_through");
CREATE INDEX "EventSeries_created_by_idx" ON "EventSeries"("created_by");

ALTER TABLE "Event" ADD COLUMN "series_id" TEXT REFERENCES "EventSeries" ("id") ON DELETE SET NULL ON UPDATE NO ACTION;
ALTER TABLE "Event" ADD COLUMN "series_occurrence_start" INTEGER CHECK ("series_occurrence_start" IS NULL OR typeof("series_occurrence_start")='integer');
ALTER TABLE "Event" ADD COLUMN "series_detached" INTEGER NOT NULL DEFAULT 0 CHECK ("series_detached" IS NULL OR "series_detached" IN (0,1));
CREATE UNIQUE INDEX "Event_series_id_series_occurrence_start_key" ON "Event"("series_id", "series_occurrence_start");

-- An occurrence belongs to a series of its own household, and a series never
-- moves household or changes who it was created by.
CREATE TRIGGER "Event_series_household_insert" BEFORE INSERT ON "Event"
WHEN NEW.series_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "EventSeries" WHERE id=NEW.series_id AND family_id=NEW.family_id)
BEGIN SELECT RAISE(ABORT,'Event series is outside the household'); END;
CREATE TRIGGER "Event_series_household_update" BEFORE UPDATE OF "series_id" ON "Event"
WHEN NEW.series_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "EventSeries" WHERE id=NEW.series_id AND family_id=NEW.family_id)
BEGIN SELECT RAISE(ABORT,'Event series is outside the household'); END;
CREATE TRIGGER "EventSeries_identity_update" BEFORE UPDATE ON "EventSeries"
WHEN NEW.id IS NOT OLD.id OR NEW.family_id IS NOT OLD.family_id
BEGIN SELECT RAISE(ABORT,'Event series identity is immutable'); END;
