-- Consolidation foundation: assignment occurrences and idempotent source imports.
-- Safe to run repeatedly.

CREATE TABLE IF NOT EXISTS "ChoreAssignment" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "chore_id" TEXT NOT NULL,
  "assigned_to" TEXT NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "photo_url" TEXT,
  "completed_at" TIMESTAMP(3),
  "completed_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "approved_by" TEXT,
  "approval_notes" TEXT,
  "xp_awarded" INTEGER NOT NULL DEFAULT 0,
  "idempotency_key" TEXT UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ImportJob" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "source_app" TEXT NOT NULL,
  "source_version" TEXT,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "dry_run" BOOLEAN NOT NULL DEFAULT true,
  "started_by" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completed_at" TIMESTAMP(3),
  "summary" JSONB,
  "error" TEXT
);

CREATE TABLE IF NOT EXISTS "ImportedRecord" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "import_job_id" TEXT NOT NULL,
  "source_app" TEXT NOT NULL,
  "source_model" TEXT NOT NULL,
  "source_id" TEXT NOT NULL,
  "target_model" TEXT NOT NULL,
  "target_id" TEXT NOT NULL,
  "checksum" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "ChoreAssignment_chore_assignee_due_key"
  ON "ChoreAssignment"("chore_id", "assigned_to", "due_date");
CREATE INDEX IF NOT EXISTS "ChoreAssignment_family_status_idx"
  ON "ChoreAssignment"("family_id", "status");
CREATE INDEX IF NOT EXISTS "ChoreAssignment_assignee_due_idx"
  ON "ChoreAssignment"("assigned_to", "due_date");
CREATE INDEX IF NOT EXISTS "ChoreAssignment_chore_id_idx"
  ON "ChoreAssignment"("chore_id");
CREATE INDEX IF NOT EXISTS "ImportJob_family_source_idx"
  ON "ImportJob"("family_id", "source_app");
CREATE INDEX IF NOT EXISTS "ImportJob_status_idx" ON "ImportJob"("status");
CREATE UNIQUE INDEX IF NOT EXISTS "ImportedRecord_source_key"
  ON "ImportedRecord"("family_id", "source_app", "source_model", "source_id");
CREATE INDEX IF NOT EXISTS "ImportedRecord_job_idx" ON "ImportedRecord"("import_job_id");
CREATE INDEX IF NOT EXISTS "ImportedRecord_target_idx"
  ON "ImportedRecord"("family_id", "target_model", "target_id");

DO $$ BEGIN
  ALTER TABLE "ChoreAssignment" ADD CONSTRAINT "ChoreAssignment_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChoreAssignment" ADD CONSTRAINT "ChoreAssignment_chore_id_fkey"
    FOREIGN KEY ("chore_id") REFERENCES "Chore"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChoreAssignment" ADD CONSTRAINT "ChoreAssignment_assigned_to_fkey"
    FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChoreAssignment" ADD CONSTRAINT "ChoreAssignment_completed_by_fkey"
    FOREIGN KEY ("completed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ChoreAssignment" ADD CONSTRAINT "ChoreAssignment_approved_by_fkey"
    FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImportJob" ADD CONSTRAINT "ImportJob_started_by_fkey"
    FOREIGN KEY ("started_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ImportedRecord" ADD CONSTRAINT "ImportedRecord_import_job_id_fkey"
    FOREIGN KEY ("import_job_id") REFERENCES "ImportJob"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

INSERT INTO "ChoreAssignment" (
  "id", "family_id", "chore_id", "assigned_to", "due_date", "status",
  "photo_url", "completed_at", "completed_by", "approved_at",
  "approval_notes", "xp_awarded", "idempotency_key", "created_at", "updated_at"
)
SELECT
  'legacy_' || md5(c."id"), c."family_id", c."id", c."assigned_to", c."due_date",
  CASE WHEN c."status" = 'verified' THEN 'approved' ELSE c."status" END,
  c."photo_url", c."completed_at",
  CASE WHEN c."completed_at" IS NOT NULL THEN c."assigned_to" ELSE NULL END,
  c."verified_at", c."verified_notes",
  CASE WHEN c."status" = 'verified' THEN c."points" ELSE 0 END,
  'legacy:' || c."id", c."created_at", CURRENT_TIMESTAMP
FROM "Chore" c
ON CONFLICT ("chore_id", "assigned_to", "due_date") DO NOTHING;
