-- Non-destructive Reward compatibility migration. Safe to rerun.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'title') THEN
    ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "name" TEXT;
    UPDATE "Reward" SET "name" = "title" WHERE "name" IS NULL;
    ALTER TABLE "Reward" ALTER COLUMN "name" SET NOT NULL;
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'point_cost')
     AND NOT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'cost') THEN
    ALTER TABLE "Reward" RENAME COLUMN "point_cost" TO "cost";
  END IF;
END $$;
ALTER TABLE "Reward"
  ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'available',
  ADD COLUMN IF NOT EXISTS "approved" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT TRUE;
ALTER TABLE "Reward" ALTER COLUMN "icon" DROP NOT NULL;
CREATE INDEX IF NOT EXISTS "Reward_family_id_idx" ON "Reward"("family_id");
CREATE INDEX IF NOT EXISTS "Reward_family_id_status_idx" ON "Reward"("family_id", "status");
CREATE INDEX IF NOT EXISTS "Reward_claimed_by_idx" ON "Reward"("claimed_by");
