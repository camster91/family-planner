-- #480 first profile-only chore expansion. This is an expand-only migration;
-- the application gate and protocol manifest remain off until all readers and
-- subject-aware writers have passed their proof.
BEGIN;

ALTER TABLE "Chore" ALTER COLUMN assigned_to DROP NOT NULL;

DO $$
DECLARE
  existing RECORD;
BEGIN
  SELECT c.contype, c.convalidated,
         pg_get_constraintdef(c.oid, true) AS definition
  INTO existing
  FROM pg_constraint c
  WHERE c.conrelid = '"Chore"'::regclass
    AND c.conname = 'Chore_at_least_one_subject_check';
  IF NOT FOUND THEN
    ALTER TABLE "Chore"
      ADD CONSTRAINT "Chore_at_least_one_subject_check"
      -- A redacted profile-only history row has no active subject by design;
      -- its sticky erasure marker is the only permitted subjectless state.
      CHECK (assigned_to IS NOT NULL OR assigned_member_id IS NOT NULL OR member_subject_erased);
  ELSIF existing.contype <> 'c'
    OR regexp_replace(lower(existing.definition), '[^a-z0-9_]', '', 'g')
      <> 'checkassigned_toisnotnullorassigned_member_idisnotnullormember_subject_erased'
    OR NOT existing.convalidated THEN
    RAISE EXCEPTION 'Chore_at_least_one_subject_check has an incompatible definition' USING ERRCODE = '42804';
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Chore_family_member_due_idx"
  ON "Chore" (family_id, assigned_member_id, due_date);

DO $$
DECLARE
  table_oid OID := '"Chore"'::regclass;
  expected_key TEXT;
  expected_collation TEXT;
  expected_opclass TEXT;
  existing RECORD;
BEGIN
  SELECT string_agg(a.attnum::TEXT, ' ' ORDER BY names.ordinality)
  INTO expected_key
  FROM unnest(ARRAY['family_id', 'assigned_member_id', 'due_date'])
    WITH ORDINALITY AS names(column_name, ordinality)
  JOIN pg_attribute a
    ON a.attrelid = table_oid AND a.attname = names.column_name AND NOT a.attisdropped;
  SELECT string_agg(a.attcollation::TEXT, ' ' ORDER BY names.ordinality),
         string_agg(opc.oid::TEXT, ' ' ORDER BY names.ordinality)
  INTO expected_collation, expected_opclass
  FROM unnest(ARRAY['family_id', 'assigned_member_id', 'due_date'])
    WITH ORDINALITY AS names(column_name, ordinality)
  JOIN pg_attribute a
    ON a.attrelid = table_oid AND a.attname = names.column_name AND NOT a.attisdropped
  LEFT JOIN pg_opclass opc
    ON opc.opcmethod = (SELECT oid FROM pg_am WHERE amname = 'btree')
    AND opc.opcintype = a.atttypid
    AND opc.opcdefault;
  SELECT i.indrelid, i.indkey::TEXT AS indkey_text, i.indnatts,
         i.indnkeyatts, i.indoption::TEXT AS indoption_text,
         i.indcollation::TEXT AS indcollation_text,
         i.indclass::TEXT AS indclass_text,
         i.indisunique, i.indisvalid, i.indisready, i.indpred,
         i.indexprs, am.amname, c.relkind
  INTO existing
  FROM pg_class c
  JOIN pg_index i ON i.indexrelid = c.oid
  JOIN pg_am am ON am.oid = c.relam
  WHERE c.relname = 'Chore_family_member_due_idx'
    AND c.relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = table_oid);
  IF expected_key IS NULL THEN
    RAISE EXCEPTION 'Chore_family_member_due_idx expected columns are missing' USING ERRCODE = '42703';
  ELSIF expected_collation IS NULL OR expected_opclass IS NULL THEN
    RAISE EXCEPTION 'Chore_family_member_due_idx expected btree collation/opclass is missing' USING ERRCODE = '42704';
  ELSIF NOT FOUND THEN
    RAISE EXCEPTION 'Chore_family_member_due_idx was not created' USING ERRCODE = '42P01';
  ELSIF existing.indrelid <> table_oid
    OR existing.indkey_text <> expected_key
    OR existing.indnatts <> 3 OR existing.indnkeyatts <> 3
    OR existing.indoption_text <> '0 0 0'
    OR existing.indcollation_text <> expected_collation
    OR existing.indclass_text <> expected_opclass
    OR existing.indisunique
    OR existing.amname <> 'btree'
    OR NOT existing.indisvalid OR NOT existing.indisready
    OR existing.indpred IS NOT NULL OR existing.indexprs IS NOT NULL
    OR existing.relkind <> 'i' THEN
    RAISE EXCEPTION 'Chore_family_member_due_idx has an incompatible definition' USING ERRCODE = '42804';
  END IF;
END $$;

-- The z migration already owns this trigger name. Replace its account-only
-- member branch with the explicit profile-only branch while retaining the
-- existing mapped-account invariants and sticky erasure behavior.
CREATE OR REPLACE FUNCTION guard_chore_member_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.member_subject_erased AND NOT NEW.member_subject_erased THEN
      RAISE EXCEPTION 'erased chore member subject cannot be restored' USING ERRCODE = '23514';
    END IF;
    IF OLD.assigned_member_id IS NOT NULL
      AND NEW.assigned_member_id IS NULL
      AND NOT NEW.member_subject_erased THEN
      RAISE EXCEPTION 'canonical chore subject can only be cleared by explicit erasure' USING ERRCODE = '23514';
    END IF;
    IF NEW.assigned_member_id IS NOT DISTINCT FROM OLD.assigned_member_id
      AND NEW.assigned_to IS NOT DISTINCT FROM OLD.assigned_to
      AND NEW.family_id IS NOT DISTINCT FROM OLD.family_id THEN
      RETURN NEW;
    END IF;
  END IF;

  IF NEW.assigned_member_id IS NULL THEN
    IF NEW.assigned_to IS NULL AND NOT NEW.member_subject_erased THEN
      RAISE EXCEPTION 'chore needs an account or profile subject' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- ChoreAssignment is the legacy per-occurrence account ledger and remains
  -- intentionally non-nullable in this slice. Only the canonical Chore row
  -- may carry a profile-only subject.
  IF TG_TABLE_NAME = 'ChoreAssignment' AND NEW.assigned_to IS NULL THEN
    RAISE EXCEPTION 'chore assignment needs an account subject' USING ERRCODE = '23514';
  END IF;

  -- A profile-only row is allowed only for an active, same-household,
  -- unlinked/unmapped presentation profile. A profile role never substitutes
  -- for an account or grants authority.
  IF NEW.assigned_to IS NULL THEN
    IF NEW.member_subject_erased
      OR NOT EXISTS (
        SELECT 1 FROM "HouseholdMember"
        WHERE id = NEW.assigned_member_id
          AND family_id = NEW.family_id
          AND archived_at IS NULL
          AND erasure_user_id IS NULL
      )
      OR EXISTS (
        SELECT 1 FROM "HouseholdMember"
        WHERE id = NEW.assigned_member_id
          AND family_id = NEW.family_id
          AND (
            role NOT IN ('child', 'teen', 'parent')
            OR (
              age IS NOT NULL AND (
                (role = 'child' AND (age < 0 OR age > 17))
                OR (role = 'teen' AND (age < 13 OR age > 17))
                OR (role = 'parent' AND (age < 18 OR age > 120))
              )
            )
          )
      )
      OR EXISTS (
        SELECT 1 FROM "HouseholdMemberLegacyMapping"
        WHERE member_id = NEW.assigned_member_id AND family_id = NEW.family_id
        UNION ALL
        SELECT 1 FROM "HouseholdMemberAccountLink"
        WHERE member_id = NEW.assigned_member_id AND family_id = NEW.family_id
      ) THEN
      RAISE EXCEPTION 'profile chore subject must be active and unlinked' USING ERRCODE = '23514';
    END IF;
    RETURN NEW;
  END IF;

  -- Existing reconciled account rows retain their exact mapping/link contract.
  IF NOT EXISTS (
      SELECT 1 FROM "HouseholdMember"
      WHERE id = NEW.assigned_member_id
        AND family_id = NEW.family_id
        AND erasure_user_id IS NULL
    )
    OR NOT EXISTS (
      SELECT 1
      FROM "HouseholdMemberLegacyMapping"
      WHERE member_id = NEW.assigned_member_id
        AND user_id = NEW.assigned_to
        AND family_id = NEW.family_id
      UNION ALL
      SELECT 1
      FROM "HouseholdMemberAccountLink"
      WHERE member_id = NEW.assigned_member_id
        AND user_id = NEW.assigned_to
        AND family_id = NEW.family_id
    )
    OR EXISTS (
      SELECT 1
      FROM "HouseholdMemberLegacyMapping"
      WHERE member_id = NEW.assigned_member_id
        AND family_id = NEW.family_id
        AND user_id <> NEW.assigned_to
      UNION ALL
      SELECT 1
      FROM "HouseholdMemberAccountLink"
      WHERE member_id = NEW.assigned_member_id
        AND family_id = NEW.family_id
        AND user_id <> NEW.assigned_to
    ) THEN
    RAISE EXCEPTION 'chore member subject needs explicit account reconciliation' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS chore_member_subject_guard ON "Chore";
CREATE TRIGGER chore_member_subject_guard
  BEFORE INSERT OR UPDATE ON "Chore"
  FOR EACH ROW EXECUTE FUNCTION guard_chore_member_subject();

-- A profile chore keeps its presentation subject active and role/age
-- compatible. Account-mapped profiles and historical/archived-only rows are
-- intentionally outside this guard; their existing lifecycle remains intact.
CREATE OR REPLACE FUNCTION guard_profile_chore_member_age() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE'
    AND (
      NEW.role IS DISTINCT FROM OLD.role
      OR NEW.age IS DISTINCT FROM OLD.age
      OR NEW.archived_at IS DISTINCT FROM OLD.archived_at
    )
    AND NEW.archived_at IS NULL
    AND EXISTS (
      SELECT 1 FROM "Chore"
      WHERE family_id = NEW.family_id
        AND assigned_member_id = NEW.id
        AND assigned_to IS NULL
        AND NOT member_subject_erased
    )
    AND (
      NEW.role NOT IN ('child', 'teen', 'parent')
      OR (
        NEW.age IS NOT NULL AND (
          (NEW.role = 'child' AND (NEW.age < 0 OR NEW.age > 17))
          OR (NEW.role = 'teen' AND (NEW.age < 13 OR NEW.age > 17))
          OR (NEW.role = 'parent' AND (NEW.age < 18 OR NEW.age > 120))
        )
      )
    ) THEN
    RAISE EXCEPTION 'profile chore subject role and age are incompatible' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS household_member_profile_chore_age_guard ON "HouseholdMember";
CREATE TRIGGER household_member_profile_chore_age_guard
  BEFORE UPDATE OF role, age, archived_at ON "HouseholdMember"
  FOR EACH ROW EXECUTE FUNCTION guard_profile_chore_member_age();

-- ChoreAssignment remains account-only in this slice. Keep its existing
-- trigger attached, but do not make its required assigned_to nullable.
COMMIT;
