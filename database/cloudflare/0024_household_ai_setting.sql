-- App-held AI opt-in (#144, owner decision 2026-11-19). Additive and
-- default-off: no row means the household has not opted in. Nothing reads
-- this table unless FAMILY_CLAUDE_AI_READY=1. A side table, so every existing
-- Family read and write is unchanged. Content-free: a switch, a cap in integer
-- micro-USD (default $2 a month) and a revision for lost-update protection.
-- AiUsageRequest.job has no CHECK in D1; the new 'smart_add' job needs no change.
CREATE TABLE "HouseholdAiSetting" (
    "family_id" TEXT NOT NULL PRIMARY KEY,
    "smart_helpers_enabled" INTEGER NOT NULL DEFAULT 0 CHECK ("smart_helpers_enabled" IN (0,1)),
    "monthly_cap_microusd" INTEGER NOT NULL DEFAULT 2000000 CHECK ("monthly_cap_microusd" BETWEEN 0 AND 1000000000),
    "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "HouseholdAiSetting_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
