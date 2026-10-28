-- Lookup for hashed verification tokens and optional content-free household metrics.
CREATE INDEX "User_verify_token_idx" ON "User"("verify_token");
CREATE TABLE "BetaMetricDaily" (
  "family_id" TEXT NOT NULL,
  "day" TEXT NOT NULL,
  "metric" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY ("family_id", "day", "metric"),
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE
);
CREATE INDEX "BetaMetricDaily_day_idx" ON "BetaMetricDaily"("day");
