-- #123 additive consent source only. Do not activate before PostgreSQL/lifecycle QA.
BEGIN;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "responsibility_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "responsibility_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Pickup" ADD COLUMN IF NOT EXISTS "responsibility_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Pickup" ADD COLUMN IF NOT EXISTS "responsibility_epoch" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Handoff" ADD COLUMN IF NOT EXISTS "responsibility_generation" TEXT NOT NULL DEFAULT gen_random_uuid()::text;
ALTER TABLE "Handoff" ADD COLUMN IF NOT EXISTS "responsibility_epoch" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "Chore_id_family_id_key" ON "Chore" ("id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Pickup_id_family_id_key" ON "Pickup" ("id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "Handoff_id_family_id_key" ON "Handoff" ("id", "family_id");

DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_responsibility_epoch_check" CHECK ("responsibility_epoch" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Chore" VALIDATE CONSTRAINT "Chore_responsibility_epoch_check";
DO $$ BEGIN
  ALTER TABLE "Pickup" ADD CONSTRAINT "Pickup_responsibility_epoch_check" CHECK ("responsibility_epoch" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Pickup" VALIDATE CONSTRAINT "Pickup_responsibility_epoch_check";
DO $$ BEGIN
  ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_responsibility_epoch_check" CHECK ("responsibility_epoch" >= 0) NOT VALID;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
ALTER TABLE "Handoff" VALIDATE CONSTRAINT "Handoff_responsibility_epoch_check";

CREATE TABLE IF NOT EXISTS "ResponsibilityState" (
  "id" TEXT PRIMARY KEY,
  "protocol" TEXT NOT NULL DEFAULT 'herewoven.responsibility.v1',
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "chore_id" TEXT, "pickup_id" TEXT, "handoff_id" TEXT,
  "source_token" TEXT NOT NULL CHECK ("source_token" ~ '^[a-f0-9]{64}$'),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "coordinator_id" TEXT, "backup_account_id" TEXT, "backup_member_id" TEXT,
  "primary_subject_account_id" TEXT, "primary_subject_member_id" TEXT,
  "primary_decision" TEXT, "primary_by_id" TEXT, "primary_method" TEXT, "primary_at" TIMESTAMP(3),
  "backup_decision" TEXT, "backup_by_id" TEXT, "backup_method" TEXT, "backup_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ResponsibilityState_target_check" CHECK (num_nonnulls("chore_id", "pickup_id", "handoff_id") = 1),
  CONSTRAINT "ResponsibilityState_backup_check" CHECK (num_nonnulls("backup_account_id", "backup_member_id") <= 1 AND ("backup_member_id" IS NULL OR "chore_id" IS NOT NULL)),
  CONSTRAINT "ResponsibilityState_coordinator_check" CHECK ("coordinator_id" IS NULL OR "handoff_id" IS NOT NULL),
  CONSTRAINT "ResponsibilityState_distinct_handoff_backup_check" CHECK ("coordinator_id" IS NULL OR "backup_account_id" IS NULL OR "coordinator_id" <> "backup_account_id"),
  CONSTRAINT "ResponsibilityState_primary_statement_check" CHECK (
    (num_nonnulls("primary_subject_account_id", "primary_subject_member_id", "primary_decision", "primary_by_id", "primary_method", "primary_at") = 0)
    OR ("primary_decision" IS NOT NULL AND "primary_decision" IN ('accepted', 'declined') AND "primary_by_id" IS NOT NULL AND "primary_at" IS NOT NULL
      AND "primary_method" IS NOT NULL
      AND (("primary_method" = 'self' AND "primary_subject_account_id" IS NOT NULL AND "primary_subject_member_id" IS NULL AND "primary_subject_account_id" = "primary_by_id")
        OR ("primary_method" = 'parent-recorded' AND "primary_subject_member_id" IS NOT NULL AND "primary_subject_account_id" IS NULL AND "chore_id" IS NOT NULL))
      AND ("handoff_id" IS NULL OR ("coordinator_id" IS NOT NULL AND "primary_subject_account_id" = "coordinator_id")))
  ),
  CONSTRAINT "ResponsibilityState_backup_statement_check" CHECK (
    num_nonnulls("backup_decision", "backup_by_id", "backup_method", "backup_at") = 0
    OR ("backup_decision" IS NOT NULL AND "backup_decision" IN ('accepted', 'declined') AND "backup_by_id" IS NOT NULL AND "backup_at" IS NOT NULL
      AND "backup_method" IS NOT NULL
      AND (("backup_method" = 'self' AND "backup_account_id" IS NOT NULL AND "backup_member_id" IS NULL AND "backup_account_id" = "backup_by_id")
        OR ("backup_method" = 'parent-recorded' AND "backup_member_id" IS NOT NULL AND "backup_account_id" IS NULL AND "chore_id" IS NOT NULL)))
  ),
  FOREIGN KEY ("chore_id", "family_id") REFERENCES "Chore"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("pickup_id", "family_id") REFERENCES "Pickup"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("handoff_id", "family_id") REFERENCES "Handoff"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("coordinator_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("backup_account_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("backup_member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("primary_subject_account_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("primary_subject_member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("primary_by_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("backup_by_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE UNIQUE INDEX IF NOT EXISTS "ResponsibilityState_chore_id_family_id_key" ON "ResponsibilityState" ("chore_id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ResponsibilityState_pickup_id_family_id_key" ON "ResponsibilityState" ("pickup_id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "ResponsibilityState_handoff_id_family_id_key" ON "ResponsibilityState" ("handoff_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_family_id_updated_at_idx" ON "ResponsibilityState" ("family_id", "updated_at");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_coordinator_id_family_id_idx" ON "ResponsibilityState" ("coordinator_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_backup_account_id_family_id_idx" ON "ResponsibilityState" ("backup_account_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_backup_member_id_family_id_idx" ON "ResponsibilityState" ("backup_member_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_primary_subject_account_id_family_id_idx" ON "ResponsibilityState" ("primary_subject_account_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_primary_subject_member_id_family_id_idx" ON "ResponsibilityState" ("primary_subject_member_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_primary_by_id_family_id_idx" ON "ResponsibilityState" ("primary_by_id", "family_id");
CREATE INDEX IF NOT EXISTS "ResponsibilityState_backup_by_id_family_id_idx" ON "ResponsibilityState" ("backup_by_id", "family_id");

-- Epochs survive legacy writes and lifecycle removal of the metadata row.
-- Generation is immutable during UPDATE; delete/recreate receives a fresh UUID.
CREATE OR REPLACE FUNCTION herewoven_responsibility_target_epoch() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE old_row jsonb := to_jsonb(OLD); new_row jsonb := to_jsonb(NEW); fields text[]; changed boolean;
BEGIN
  IF TG_TABLE_NAME = 'Chore' THEN
    fields := ARRAY['family_id','title','description','points','assigned_to','assigned_member_id','member_subject_erased','due_date','frequency','weekly_days','difficulty','recurrence_id','is_template','rotation_member_ids','rotation_index','routine','routine_order','routine_stack_id','routine_anchor','routine_duration_minutes','routine_series_config','icon'];
  ELSIF TG_TABLE_NAME = 'Pickup' THEN
    fields := ARRAY['family_id','title','location','pickup_time','assigned_to','notes'];
  ELSE
    fields := ARRAY['family_id','sitter_name','sitter_phone','arrival_time','departure_time','kids_bedtimes','where_snacks','pickup_authorized','code_words','pet_care','emergency_notes','house_notes','general_notes'];
  END IF;
  SELECT EXISTS(SELECT 1 FROM unnest(fields) AS f(key) WHERE (old_row->f.key) IS DISTINCT FROM (new_row->f.key)) INTO changed;
  NEW."responsibility_generation" := OLD."responsibility_generation";
  NEW."responsibility_epoch" := GREATEST(OLD."responsibility_epoch", COALESCE(NEW."responsibility_epoch", OLD."responsibility_epoch"));
  IF changed THEN NEW."responsibility_epoch" := LEAST(2147483647::bigint, NEW."responsibility_epoch"::bigint + 1)::integer; END IF;
  IF OLD."family_id" IS DISTINCT FROM NEW."family_id" THEN
    DELETE FROM "ResponsibilityState" WHERE "family_id" = OLD."family_id" AND
      ((TG_TABLE_NAME = 'Chore' AND "chore_id" = OLD."id") OR (TG_TABLE_NAME = 'Pickup' AND "pickup_id" = OLD."id") OR (TG_TABLE_NAME = 'Handoff' AND "handoff_id" = OLD."id"));
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_responsibility_epoch ON "Chore";
CREATE TRIGGER herewoven_responsibility_epoch BEFORE UPDATE ON "Chore" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_target_epoch();
DROP TRIGGER IF EXISTS herewoven_responsibility_epoch ON "Pickup";
CREATE TRIGGER herewoven_responsibility_epoch BEFORE UPDATE ON "Pickup" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_target_epoch();
DROP TRIGGER IF EXISTS herewoven_responsibility_epoch ON "Handoff";
CREATE TRIGGER herewoven_responsibility_epoch BEFORE UPDATE ON "Handoff" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_target_epoch();

-- Called before identity changes/FK cascades. Clear participation and advance
-- the canonical epoch first, closing metadata-delete/recreate ABA as well.
CREATE OR REPLACE FUNCTION herewoven_retire_responsibility_participation(account_id text, member_id text) RETURNS void LANGUAGE plpgsql AS $$
DECLARE item record;
BEGIN
  -- Invalidate existing canonical primary work even when no metadata row has
  -- been created yet; pending first confirmations cannot survive identity ABA.
  IF account_id IS NOT NULL THEN
    UPDATE "Chore" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "assigned_to" = account_id;
    UPDATE "Pickup" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "assigned_to" = account_id;
  END IF;
  IF member_id IS NOT NULL THEN
    UPDATE "Chore" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "assigned_member_id" = member_id;
  END IF;
  FOR item IN SELECT "id", "family_id", "chore_id", "pickup_id", "handoff_id" FROM "ResponsibilityState"
    WHERE (account_id IS NOT NULL AND account_id IN ("coordinator_id", "backup_account_id", "primary_subject_account_id", "primary_by_id", "backup_by_id"))
       OR (member_id IS NOT NULL AND member_id IN ("backup_member_id", "primary_subject_member_id"))
    ORDER BY "family_id", COALESCE("chore_id", "pickup_id", "handoff_id"), "id"
  LOOP
    IF item.chore_id IS NOT NULL THEN UPDATE "Chore" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "id" = item.chore_id AND "family_id" = item.family_id;
    ELSIF item.pickup_id IS NOT NULL THEN UPDATE "Pickup" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "id" = item.pickup_id AND "family_id" = item.family_id;
    ELSE UPDATE "Handoff" SET "responsibility_epoch" = LEAST(2147483647::bigint, "responsibility_epoch"::bigint + 1)::integer WHERE "id" = item.handoff_id AND "family_id" = item.family_id;
    END IF;
    DELETE FROM "ResponsibilityState" WHERE "id" = item.id AND "family_id" = item.family_id;
  END LOOP;
END $$;
CREATE OR REPLACE FUNCTION herewoven_responsibility_identity_retirement() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_TABLE_NAME = 'User' THEN
    IF TG_OP = 'DELETE' THEN PERFORM herewoven_retire_responsibility_participation(OLD."id", NULL); RETURN OLD;
    ELSIF OLD."family_id" IS DISTINCT FROM NEW."family_id" OR OLD."role" IS DISTINCT FROM NEW."role" THEN PERFORM herewoven_retire_responsibility_participation(OLD."id", NULL); END IF;
  ELSIF TG_TABLE_NAME = 'HouseholdMember' THEN
    IF TG_OP = 'DELETE' THEN PERFORM herewoven_retire_responsibility_participation(NULL, OLD."id"); RETURN OLD;
    ELSIF ROW(OLD."family_id", OLD."role", OLD."age", OLD."archived_at", OLD."erasure_user_id") IS DISTINCT FROM ROW(NEW."family_id", NEW."role", NEW."age", NEW."archived_at", NEW."erasure_user_id") THEN PERFORM herewoven_retire_responsibility_participation(NULL, OLD."id"); END IF;
  ELSE
    IF TG_OP <> 'INSERT' THEN PERFORM herewoven_retire_responsibility_participation(NULL, OLD."member_id"); END IF;
    IF TG_OP <> 'DELETE' THEN PERFORM herewoven_retire_responsibility_participation(NULL, NEW."member_id"); END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS herewoven_responsibility_retirement ON "User";
CREATE TRIGGER herewoven_responsibility_retirement BEFORE UPDATE OR DELETE ON "User" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_identity_retirement();
DROP TRIGGER IF EXISTS herewoven_responsibility_retirement ON "HouseholdMember";
CREATE TRIGGER herewoven_responsibility_retirement BEFORE UPDATE OR DELETE ON "HouseholdMember" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_identity_retirement();
DROP TRIGGER IF EXISTS herewoven_responsibility_retirement ON "HouseholdMemberLegacyMapping";
CREATE TRIGGER herewoven_responsibility_retirement AFTER INSERT OR UPDATE OR DELETE ON "HouseholdMemberLegacyMapping" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_identity_retirement();
DROP TRIGGER IF EXISTS herewoven_responsibility_retirement ON "HouseholdMemberAccountLink";
CREATE TRIGGER herewoven_responsibility_retirement AFTER INSERT OR UPDATE OR DELETE ON "HouseholdMemberAccountLink" FOR EACH ROW EXECUTE FUNCTION herewoven_responsibility_identity_retirement();
COMMIT;
