-- #141 additive source only. UNAPPLIED. No historical transitions backfilled.
BEGIN;
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "notification_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "notification_claim_id" TEXT;
CREATE OR REPLACE FUNCTION public.herewoven_reward_notification_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."family_id" IS DISTINCT FROM OLD."family_id"
     OR NEW."notification_generation" IS DISTINCT FROM OLD."notification_generation"
     OR (OLD."notification_claim_id" IS NOT NULL AND NEW."notification_claim_id" IS DISTINCT FROM OLD."notification_claim_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reward notification identity is immutable';
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_reward_notification_identity ON "Reward";
CREATE TRIGGER herewoven_reward_notification_identity BEFORE UPDATE ON "Reward"
  FOR EACH ROW EXECUTE FUNCTION public.herewoven_reward_notification_identity();
COMMIT;
