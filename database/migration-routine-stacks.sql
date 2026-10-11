-- Routine stack identity foundation (additive, no backfill).
-- Existing chores remain valid with a NULL routine_stack_id.  A display label
-- is never used to infer membership or merge legacy rows.
BEGIN;

CREATE TABLE IF NOT EXISTS "RoutineStack" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fingerprint" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "RoutineStack" ALTER COLUMN "created_by" DROP NOT NULL;

ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_stack_id" TEXT;

ALTER TABLE "RoutineStack" DROP CONSTRAINT IF EXISTS "RoutineStack_created_by_fkey";
DO $$ BEGIN
  ALTER TABLE "RoutineStack"
    ADD CONSTRAINT "RoutineStack_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RoutineStack"
    ADD CONSTRAINT "RoutineStack_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RoutineStack"
    ADD CONSTRAINT "RoutineStack_id_family_id_key"
    UNIQUE ("id", "family_id");
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Chore"
    ADD CONSTRAINT "Chore_routine_stack_fkey"
    FOREIGN KEY ("routine_stack_id", "family_id")
    REFERENCES "RoutineStack"("id", "family_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "RoutineStack_family_id_updated_at_idx"
  ON "RoutineStack" ("family_id", "updated_at");
CREATE INDEX IF NOT EXISTS "Chore_family_id_routine_stack_id_idx"
  ON "Chore" ("family_id", "routine_stack_id");

COMMIT;
