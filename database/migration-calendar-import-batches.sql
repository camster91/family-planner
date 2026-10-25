-- #134 additive source only; not applied in the no-QA follow-through.
-- Measure build locks/query plans before any separately authorized deployment.
CREATE INDEX IF NOT EXISTS "Event_family_subscription_id_idx"
  ON "Event" ("family_id", "source_subscription_id", "id");
-- Rollback: DROP INDEX IF EXISTS "Event_family_subscription_id_idx";
