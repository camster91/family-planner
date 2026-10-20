-- #123 source only; no migration/DDL/DB operation has been run.
-- Depends on canonical Chore scoped identity and schedule Event epochs.
BEGIN;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "preparation_epoch" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "Event_id_family_id_key" ON "Event" ("id", "family_id");
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_preparation_epoch_check" CHECK ("preparation_epoch" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Event" VALIDATE CONSTRAINT "Event_preparation_epoch_check";
CREATE TABLE IF NOT EXISTS "EventPreparation" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "event_id" TEXT NOT NULL,
  "reviewed_event_source" TEXT NOT NULL CHECK ("reviewed_event_source" ~ '^[a-f0-9]{64}$'),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  CONSTRAINT "EventPreparation_event_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "Event"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
  CONSTRAINT "EventPreparation_id_family_id_key" UNIQUE ("id", "family_id"),
  CONSTRAINT "EventPreparation_event_id_family_id_key" UNIQUE ("event_id", "family_id")
);
CREATE TABLE IF NOT EXISTS "EventPreparationStep" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid()::text,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "preparation_id" TEXT NOT NULL, "chore_id" TEXT NOT NULL,
  "position" INTEGER NOT NULL CHECK ("position" BETWEEN 1 AND 99),
  "cue_anchor" TEXT, "cue_direction" TEXT, "cue_minutes" INTEGER,
  CONSTRAINT "EventPreparationStep_cue_check" CHECK (
    num_nonnulls("cue_anchor", "cue_direction", "cue_minutes") = 0 OR
    ("cue_anchor" IS NOT NULL AND "cue_anchor" IN ('start','end') AND "cue_direction" IS NOT NULL AND "cue_direction" IN ('before','after') AND "cue_minutes" IS NOT NULL AND "cue_minutes" BETWEEN 0 AND 525600)
  ),
  CONSTRAINT "EventPreparationStep_chore_id_family_id_key" UNIQUE ("chore_id", "family_id"),
  CONSTRAINT "EventPreparationStep_plan_fkey" FOREIGN KEY ("preparation_id", "family_id") REFERENCES "EventPreparation"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT "EventPreparationStep_chore_fkey" FOREIGN KEY ("chore_id", "family_id") REFERENCES "Chore"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  -- Reordering is atomic; no temporary invalid negative positions or replace-
  -- everything delete is needed. Never use ON CONFLICT on this deferred key.
  CONSTRAINT "EventPreparationStep_plan_position_key" UNIQUE ("preparation_id", "position") DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS "EventPreparation_family_id_idx" ON "EventPreparation" ("family_id");
CREATE INDEX IF NOT EXISTS "EventPreparationStep_family_id_idx" ON "EventPreparationStep" ("family_id");
CREATE OR REPLACE FUNCTION herewoven_preparation_event_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."preparation_epoch" := GREATEST(OLD."preparation_epoch", COALESCE(NEW."preparation_epoch", OLD."preparation_epoch"));
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_epoch ON "Event";
CREATE TRIGGER herewoven_preparation_epoch BEFORE UPDATE ON "Event" FOR EACH ROW EXECUTE FUNCTION herewoven_preparation_event_epoch();
CREATE OR REPLACE FUNCTION herewoven_preparation_identity() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  NEW."id" := OLD."id"; NEW."family_id" := OLD."family_id";
  IF TG_TABLE_NAME = 'EventPreparation' THEN
    NEW."event_id" := OLD."event_id";
    NEW."revision" := GREATEST(OLD."revision", COALESCE(NEW."revision", OLD."revision"));
    IF OLD."reviewed_event_source" IS DISTINCT FROM NEW."reviewed_event_source" THEN
      NEW."revision" := LEAST(2147483647::bigint, NEW."revision"::bigint + 1)::integer;
    END IF;
  ELSE
    NEW."preparation_id" := OLD."preparation_id"; NEW."chore_id" := OLD."chore_id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_identity ON "EventPreparation";
CREATE TRIGGER herewoven_preparation_identity BEFORE UPDATE ON "EventPreparation" FOR EACH ROW EXECUTE FUNCTION herewoven_preparation_identity();
DROP TRIGGER IF EXISTS herewoven_preparation_identity ON "EventPreparationStep";
CREATE TRIGGER herewoven_preparation_identity BEFORE UPDATE ON "EventPreparationStep" FOR EACH ROW EXECUTE FUNCTION herewoven_preparation_identity();
CREATE OR REPLACE FUNCTION herewoven_preparation_lifecycle() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE target_id text; owner_id text;
BEGIN
  IF TG_OP = 'DELETE' THEN target_id := OLD."event_id"; owner_id := OLD."family_id";
  ELSE target_id := NEW."event_id"; owner_id := NEW."family_id"; END IF;
  -- Only explicit plan lifecycle acquires the Event row, never ordinary
  -- Chore cascades. A deleted/moved Event is absent under its original scope.
  UPDATE "Event" SET "preparation_epoch" = LEAST(2147483647::bigint, "preparation_epoch"::bigint + 1)::integer WHERE "id" = target_id AND "family_id" = owner_id;
  IF TG_OP = 'DELETE' THEN RETURN OLD; END IF; RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_lifecycle ON "EventPreparation";
CREATE TRIGGER herewoven_preparation_lifecycle AFTER INSERT OR DELETE ON "EventPreparation" FOR EACH ROW EXECUTE FUNCTION herewoven_preparation_lifecycle();
CREATE OR REPLACE FUNCTION herewoven_preparation_step_version() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'INSERT' OR OLD."position" IS DISTINCT FROM NEW."position" OR OLD."cue_anchor" IS DISTINCT FROM NEW."cue_anchor" OR OLD."cue_direction" IS DISTINCT FROM NEW."cue_direction" OR OLD."cue_minutes" IS DISTINCT FROM NEW."cue_minutes" THEN
    UPDATE "EventPreparation" SET "revision" = LEAST(2147483647::bigint, "revision"::bigint + 1)::integer WHERE "id" = NEW."preparation_id" AND "family_id" = NEW."family_id";
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_step_version ON "EventPreparationStep";
CREATE TRIGGER herewoven_preparation_step_version AFTER INSERT OR UPDATE ON "EventPreparationStep" FOR EACH ROW EXECUTE FUNCTION herewoven_preparation_step_version();
-- Deliberately no step DELETE revision update: legacy multi-chore deletions
-- must not lock a shared plan and then another Chore. Membership removal is in
-- the scope fingerprint; returning to that membership requires an INSERT,
-- which advances revision. Plan delete/recreate advances Event lifecycle epoch.
CREATE OR REPLACE FUNCTION herewoven_preparation_chore_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "EventPreparationStep" WHERE "chore_id" = OLD."id" AND "family_id" = OLD."family_id";
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_chore_move ON "Chore";
CREATE TRIGGER herewoven_preparation_chore_move BEFORE UPDATE ON "Chore" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."family_id" IS DISTINCT FROM NEW."family_id") EXECUTE FUNCTION herewoven_preparation_chore_move();
CREATE OR REPLACE FUNCTION herewoven_preparation_event_move() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  DELETE FROM "EventPreparation" WHERE "event_id" = OLD."id" AND "family_id" = OLD."family_id";
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_preparation_event_move ON "Event";
-- Deferred Event FK permits cleanup after the outer Event update. Updating
-- that Event from a BEFORE cleanup's child lifecycle trigger would recurse.
CREATE TRIGGER herewoven_preparation_event_move AFTER UPDATE ON "Event" FOR EACH ROW WHEN (OLD."id" IS DISTINCT FROM NEW."id" OR OLD."family_id" IS DISTINCT FROM NEW."family_id") EXECUTE FUNCTION herewoven_preparation_event_move();
COMMIT;
