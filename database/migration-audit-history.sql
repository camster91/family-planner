CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "actor_id" TEXT,
  "action" TEXT NOT NULL,
  "resource_type" TEXT NOT NULL,
  "resource_id" TEXT,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "AuditLog_family_id_created_at_idx"
  ON "AuditLog"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "AuditLog_family_id_action_idx"
  ON "AuditLog"("family_id", "action");
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
