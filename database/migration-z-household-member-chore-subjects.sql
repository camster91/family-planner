-- #480 expand-only. No profile-only assignments or automatic backfill.
BEGIN;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS assigned_member_id TEXT;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS member_subject_erased BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChoreAssignment" ADD COLUMN IF NOT EXISTS assigned_member_id TEXT;
ALTER TABLE "ChoreAssignment" ADD COLUMN IF NOT EXISTS member_subject_erased BOOLEAN NOT NULL DEFAULT false;
DO $$
DECLARE tbl TEXT;
BEGIN
  FOREACH tbl IN ARRAY ARRAY['Chore', 'ChoreAssignment'] LOOP
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_member_subject_fkey' AND conrelid = format('%I', tbl)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (assigned_member_id, family_id) REFERENCES "HouseholdMember" (id, family_id) ON DELETE NO ACTION ON UPDATE NO ACTION', tbl, tbl || '_member_subject_fkey');
    END IF;
    IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = tbl || '_erased_subject_check' AND conrelid = format('%I', tbl)::regclass) THEN
      EXECUTE format('ALTER TABLE %I ADD CONSTRAINT %I CHECK (NOT member_subject_erased OR assigned_member_id IS NULL)', tbl, tbl || '_erased_subject_check');
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS "Chore_family_id_assigned_member_id_idx" ON "Chore" (family_id, assigned_member_id);
CREATE INDEX IF NOT EXISTS "ChoreAssignment_family_id_assigned_member_id_idx" ON "ChoreAssignment" (family_id, assigned_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS "ChoreAssignment_chore_member_due_key" ON "ChoreAssignment" (chore_id, assigned_member_id, due_date);

-- Existing legacy-only rows stay valid. Once canonical ownership exists,
-- reassignment must update both IDs consistently. Ordinary status/history
-- updates remain valid after archive/detachment; they do not restore authority.
CREATE OR REPLACE FUNCTION guard_chore_member_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.member_subject_erased AND NOT NEW.member_subject_erased THEN
      RAISE EXCEPTION 'erased chore member subject cannot be restored' USING ERRCODE = '23514';
    END IF;
    IF OLD.assigned_member_id IS NOT NULL AND NEW.assigned_member_id IS NULL AND NOT NEW.member_subject_erased THEN
      RAISE EXCEPTION 'canonical chore subject can only be cleared by explicit erasure' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_member_id IS NOT DISTINCT FROM OLD.assigned_member_id
      AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
      AND NEW.family_id IS NOT DISTINCT FROM OLD.family_id THEN
      RETURN NEW;
    END IF;
  END IF;
  IF NEW.assigned_member_id IS NOT NULL THEN
    IF NOT EXISTS (SELECT 1 FROM "HouseholdMember" WHERE id = NEW.assigned_member_id AND family_id = NEW.family_id AND erasure_user_id IS NULL)
      OR NOT EXISTS (
        SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id = NEW.assigned_member_id AND user_id = NEW.assigned_to AND family_id = NEW.family_id
        UNION ALL
        SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id = NEW.assigned_member_id AND user_id = NEW.assigned_to AND family_id = NEW.family_id
      ) OR EXISTS (
        SELECT 1 FROM "HouseholdMemberLegacyMapping" WHERE member_id = NEW.assigned_member_id AND user_id <> NEW.assigned_to
        UNION ALL
        SELECT 1 FROM "HouseholdMemberAccountLink" WHERE member_id = NEW.assigned_member_id AND user_id <> NEW.assigned_to
      ) THEN
      RAISE EXCEPTION 'chore member subject needs explicit account reconciliation' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS chore_member_subject_guard ON "Chore";
CREATE TRIGGER chore_member_subject_guard BEFORE INSERT OR UPDATE ON "Chore" FOR EACH ROW EXECUTE FUNCTION guard_chore_member_subject();
DROP TRIGGER IF EXISTS chore_assignment_member_subject_guard ON "ChoreAssignment";
CREATE TRIGGER chore_assignment_member_subject_guard BEFORE INSERT OR UPDATE ON "ChoreAssignment" FOR EACH ROW EXECUTE FUNCTION guard_chore_member_subject();
COMMIT;
