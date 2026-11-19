-- App-held AI opt-in (#144, owner decision 2026-11-19). PostgreSQL
-- equivalent of database/cloudflare/0024_household_ai_setting.sql.
-- Expand-only: a new side table (default off) and a WIDER job CHECK on
-- AiUsageRequest that adds 'smart_add' to the existing values. Older code
-- never writes the new value and keeps working unchanged.
BEGIN;
CREATE TABLE IF NOT EXISTS "HouseholdAiSetting" (
  "family_id" TEXT NOT NULL,
  "smart_helpers_enabled" BOOLEAN NOT NULL DEFAULT false,
  "monthly_cap_microusd" BIGINT NOT NULL DEFAULT 2000000,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "updated_at" TIMESTAMPTZ(6) NOT NULL DEFAULT now(),
  CONSTRAINT "HouseholdAiSetting_pkey" PRIMARY KEY ("family_id"),
  CONSTRAINT "HouseholdAiSetting_family_id_fkey" FOREIGN KEY ("family_id")
    REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
-- Prisma does not model CHECK constraints.
ALTER TABLE "HouseholdAiSetting" DROP CONSTRAINT IF EXISTS "HouseholdAiSetting_cap_check";
ALTER TABLE "HouseholdAiSetting" ADD CONSTRAINT "HouseholdAiSetting_cap_check"
  CHECK ("monthly_cap_microusd" BETWEEN 0 AND 1000000000);
ALTER TABLE "HouseholdAiSetting" DROP CONSTRAINT IF EXISTS "HouseholdAiSetting_revision_check";
ALTER TABLE "HouseholdAiSetting" ADD CONSTRAINT "HouseholdAiSetting_revision_check"
  CHECK ("revision" >= 0);
DO $$
BEGIN
  IF to_regclass('public."AiUsageRequest"') IS NOT NULL THEN
    ALTER TABLE "AiUsageRequest" DROP CONSTRAINT IF EXISTS "AiUsageRequest_job_check";
    ALTER TABLE "AiUsageRequest" ADD CONSTRAINT "AiUsageRequest_job_check"
      CHECK ("job" IN ('assistant','capture_text','capture_photo','smart_add'));
  END IF;
END $$;
COMMIT;
