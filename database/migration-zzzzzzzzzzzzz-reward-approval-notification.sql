-- #141 additive approval identity; source only, UNAPPLIED. No backfill/events.
BEGIN;
ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "notification_approval_id" TEXT;
CREATE OR REPLACE FUNCTION public.herewoven_reward_notification_identity()
RETURNS trigger LANGUAGE plpgsql SET search_path = pg_catalog, pg_temp AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."family_id" IS DISTINCT FROM OLD."family_id"
     OR NEW."notification_generation" IS DISTINCT FROM OLD."notification_generation"
     OR (OLD."notification_claim_id" IS NOT NULL AND NEW."notification_claim_id" IS DISTINCT FROM OLD."notification_claim_id")
     OR (OLD."notification_approval_id" IS NOT NULL AND NEW."notification_approval_id" IS DISTINCT FROM OLD."notification_approval_id") THEN
    RAISE EXCEPTION USING ERRCODE = '23514', MESSAGE = 'Reward notification identity is immutable';
  END IF;
  RETURN NEW;
END $$;
-- Existing trigger installed by the immediately preceding claim migration calls
-- this replacement function; no second trigger or identity reset is introduced.
COMMIT;
