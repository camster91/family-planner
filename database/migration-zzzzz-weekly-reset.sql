-- #123 personal weekly reset; additive source, not activation or migration proof.
BEGIN;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weekly_reset_progress" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "weekly_reset_revision" INTEGER NOT NULL DEFAULT 0;
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_weekly_reset_revision_check" CHECK ("weekly_reset_revision" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "User" VALIDATE CONSTRAINT "User_weekly_reset_revision_check";
COMMIT;
