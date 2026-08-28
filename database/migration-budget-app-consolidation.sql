-- Budget App consolidation: native core records plus a lossless advanced-finance archive. Safe to rerun.

ALTER TABLE "Transaction" ADD COLUMN IF NOT EXISTS "import_metadata" JSONB;
ALTER TABLE "BudgetCategory" ADD COLUMN IF NOT EXISTS "import_metadata" JSONB;

CREATE TABLE IF NOT EXISTS "FinancialArchiveRecord" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "source_app" TEXT NOT NULL,
  "source_model" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "payload" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FinancialArchiveRecord_source_key"
  ON "FinancialArchiveRecord"("family_id", "source_app", "source_model", "source_id");
CREATE INDEX IF NOT EXISTS "FinancialArchiveRecord_family_model_idx"
  ON "FinancialArchiveRecord"("family_id", "source_model");

DO $$ BEGIN
  ALTER TABLE "FinancialArchiveRecord" ADD CONSTRAINT "FinancialArchiveRecord_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
