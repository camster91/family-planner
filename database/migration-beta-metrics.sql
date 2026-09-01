CREATE TABLE IF NOT EXISTS "BetaMetricEvent" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "actor_role" TEXT NOT NULL,
  "event_name" TEXT NOT NULL,
  "success" BOOLEAN NOT NULL,
  "duration_ms" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "BetaMetricEvent_family_id_created_at_idx"
  ON "BetaMetricEvent"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "BetaMetricEvent_event_name_created_at_idx"
  ON "BetaMetricEvent"("event_name", "created_at");
DO $$ BEGIN
  ALTER TABLE "BetaMetricEvent" ADD CONSTRAINT "BetaMetricEvent_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
