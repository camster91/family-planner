-- Additive, content-free AI quota reservations. Source only; not applied here.
CREATE TABLE IF NOT EXISTS "AiUsagePolicy" (
  "family_id" TEXT PRIMARY KEY REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "enabled" BOOLEAN NOT NULL DEFAULT true,
  "daily_limit" INTEGER NOT NULL DEFAULT 120 CHECK ("daily_limit" BETWEEN 1 AND 10000),
  "user_daily_limit" INTEGER NOT NULL DEFAULT 40 CHECK ("user_daily_limit" BETWEEN 1 AND 1000),
  "monthly_budget_microusd" BIGINT CHECK ("monthly_budget_microusd" BETWEEN 0 AND 1000000000000),
  "input_rate" BIGINT CHECK ("input_rate" BETWEEN 0 AND 1000000000),
  "output_rate" BIGINT CHECK ("output_rate" BETWEEN 0 AND 1000000000),
  "priced_config_hash" TEXT CHECK ("priced_config_hash" ~ '^[a-f0-9]{64}$'),
  "updated_at" TIMESTAMPTZ NOT NULL DEFAULT now(),
  CONSTRAINT "AiUsagePolicy_rates_check" CHECK (num_nonnulls("input_rate", "output_rate") IN (0,2)),
  CONSTRAINT "AiUsagePolicy_budget_check" CHECK ("monthly_budget_microusd" IS NULL OR ("input_rate" IS NOT NULL AND "output_rate" IS NOT NULL AND "priced_config_hash" IS NOT NULL))
);
CREATE TABLE IF NOT EXISTS "AiUsageRequest" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  -- Erasure removes attribution while preserving anonymous household limits.
  "user_id" TEXT REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE NO ACTION,
  "job" TEXT NOT NULL CHECK ("job" IN ('assistant','capture_text','capture_photo')),
  "created_at" TIMESTAMPTZ NOT NULL,
  "finished_at" TIMESTAMPTZ,
  "outcome" TEXT NOT NULL DEFAULT 'pending' CHECK ("outcome" IN ('pending','accepted','refused','failed')),
  "provider_status" TEXT NOT NULL DEFAULT 'unconfirmed' CHECK ("provider_status" IN ('unconfirmed','response','timeout','error')),
  "latency_ms" INTEGER CHECK ("latency_ms" BETWEEN 0 AND 300000),
  "input_tokens" INTEGER CHECK ("input_tokens" BETWEEN 0 AND 100000000),
  "output_tokens" INTEGER CHECK ("output_tokens" BETWEEN 0 AND 100000000),
  "input_rate" BIGINT CHECK ("input_rate" BETWEEN 0 AND 1000000000),
  "output_rate" BIGINT CHECK ("output_rate" BETWEEN 0 AND 1000000000),
  "reserved_microusd" BIGINT CHECK ("reserved_microusd" >= 0),
  "estimated_microusd" BIGINT CHECK ("estimated_microusd" >= 0)
);
CREATE INDEX IF NOT EXISTS "AiUsageRequest_family_time_idx" ON "AiUsageRequest" ("family_id","created_at");
CREATE INDEX IF NOT EXISTS "AiUsageRequest_user_time_idx" ON "AiUsageRequest" ("user_id","created_at");
