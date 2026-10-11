-- #480 expand-only. No profile-only assignments or automatic backfill.
BEGIN;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS assigned_member_id TEXT;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS member_subject_erased BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ChoreAssignment" ADD COLUMN IF NOT EXISTS assigned_member_id TEXT;
ALTER TABLE "ChoreAssignment" ADD COLUMN IF NOT EXISTS member_subject_erased BOOLEAN NOT NULL DEFAULT false;
-- Validate named foreign keys and checks rather than accepting a weaker object
-- that happens to have the expected name. A rerun must stop on schema drift.
DO $$
DECLARE
  tbl TEXT;
  table_oid OID;
  member_attnum SMALLINT;
  family_attnum SMALLINT;
  ref_id_attnum SMALLINT;
  ref_family_attnum SMALLINT;
  existing RECORD;
BEGIN
  IF to_regclass('"HouseholdMember"') IS NULL THEN
    RAISE EXCEPTION 'profile subject migration requires HouseholdMember' USING ERRCODE = '42P01';
  END IF;
  SELECT attnum INTO ref_id_attnum FROM pg_attribute
    WHERE attrelid = to_regclass('"HouseholdMember"') AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO ref_family_attnum FROM pg_attribute
    WHERE attrelid = to_regclass('"HouseholdMember"') AND attname = 'family_id' AND NOT attisdropped;
  IF ref_id_attnum IS NULL OR ref_family_attnum IS NULL THEN
    RAISE EXCEPTION 'HouseholdMember reference columns are missing' USING ERRCODE = '42703';
  END IF;

  FOREACH tbl IN ARRAY ARRAY['Chore', 'ChoreAssignment'] LOOP
    table_oid := format('%I', tbl)::regclass;
    SELECT attnum INTO member_attnum FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'assigned_member_id' AND NOT attisdropped;
    SELECT attnum INTO family_attnum FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'family_id' AND NOT attisdropped;
    IF member_attnum IS NULL OR family_attnum IS NULL THEN
      RAISE EXCEPTION '% subject columns are missing', tbl USING ERRCODE = '42703';
    END IF;

    SELECT c.contype, c.confrelid, c.conkey, c.confkey, c.confdeltype,
           c.confupdtype, c.convalidated, c.condeferrable, c.condeferred
    INTO existing
    FROM pg_constraint c
    WHERE c.conname = tbl || '_member_subject_fkey' AND c.conrelid = table_oid;
    IF NOT FOUND THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (assigned_member_id, family_id) REFERENCES "HouseholdMember" (id, family_id) ON DELETE NO ACTION ON UPDATE NO ACTION',
        tbl, tbl || '_member_subject_fkey'
      );
    ELSIF existing.contype <> 'f'
      OR existing.confrelid <> to_regclass('"HouseholdMember"')
      OR existing.conkey <> ARRAY[member_attnum, family_attnum]::SMALLINT[]
      OR existing.confkey <> ARRAY[ref_id_attnum, ref_family_attnum]::SMALLINT[]
      OR existing.confdeltype <> 'a' OR existing.confupdtype <> 'a'
      OR NOT existing.convalidated OR existing.condeferrable OR existing.condeferred THEN
      RAISE EXCEPTION '%_member_subject_fkey has an incompatible definition', tbl USING ERRCODE = '42804';
    END IF;

    SELECT c.contype, c.convalidated,
           pg_get_constraintdef(c.oid, true) AS definition
    INTO existing
    FROM pg_constraint c
    WHERE c.conname = tbl || '_erased_subject_check' AND c.conrelid = table_oid;
    IF NOT FOUND THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (NOT member_subject_erased OR assigned_member_id IS NULL)',
        tbl, tbl || '_erased_subject_check'
      );
    ELSIF existing.contype <> 'c'
      OR regexp_replace(lower(existing.definition), '[^a-z0-9_]', '', 'g')
        <> 'checknotmember_subject_erasedorassigned_member_idisnull'
      OR NOT existing.convalidated THEN
      RAISE EXCEPTION '%_erased_subject_check has an incompatible definition', tbl USING ERRCODE = '42804';
    END IF;
  END LOOP;
END $$;
CREATE INDEX IF NOT EXISTS "Chore_family_id_assigned_member_id_idx" ON "Chore" (family_id, assigned_member_id);
CREATE INDEX IF NOT EXISTS "ChoreAssignment_family_id_assigned_member_id_idx" ON "ChoreAssignment" (family_id, assigned_member_id);
CREATE UNIQUE INDEX IF NOT EXISTS "ChoreAssignment_chore_member_due_key" ON "ChoreAssignment" (chore_id, assigned_member_id, due_date);

-- Validate the named indexes' ordered keys and physical safety properties. A
-- partial, invalid, expression, differently ordered, or non-btree substitute
-- must never satisfy this migration by name alone.
DO $$
DECLARE
  index_name TEXT;
  table_name TEXT;
  expected_names TEXT[];
  expected_count INTEGER;
  expected_unique BOOLEAN;
  table_oid OID;
  expected_key TEXT;
  expected_options TEXT;
  expected_collation TEXT;
  expected_opclass TEXT;
  existing RECORD;
BEGIN
  FOREACH index_name IN ARRAY ARRAY[
    'Chore_family_id_assigned_member_id_idx',
    'ChoreAssignment_family_id_assigned_member_id_idx',
    'ChoreAssignment_chore_member_due_key'
  ] LOOP
    IF index_name = 'Chore_family_id_assigned_member_id_idx' THEN
      table_name := 'Chore';
      expected_names := ARRAY['family_id', 'assigned_member_id'];
      expected_unique := false;
    ELSIF index_name = 'ChoreAssignment_family_id_assigned_member_id_idx' THEN
      table_name := 'ChoreAssignment';
      expected_names := ARRAY['family_id', 'assigned_member_id'];
      expected_unique := false;
    ELSE
      table_name := 'ChoreAssignment';
      expected_names := ARRAY['chore_id', 'assigned_member_id', 'due_date'];
      expected_unique := true;
    END IF;
    expected_count := cardinality(expected_names);
    table_oid := format('%I', table_name)::regclass;
    SELECT string_agg(a.attnum::TEXT, ' ' ORDER BY names.ordinality)
    INTO expected_key
    FROM unnest(expected_names) WITH ORDINALITY AS names(column_name, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = table_oid AND a.attname = names.column_name AND NOT a.attisdropped;
    SELECT string_agg(a.attcollation::TEXT, ' ' ORDER BY names.ordinality),
           string_agg(opc.oid::TEXT, ' ' ORDER BY names.ordinality)
    INTO expected_collation, expected_opclass
    FROM unnest(expected_names) WITH ORDINALITY AS names(column_name, ordinality)
    JOIN pg_attribute a
      ON a.attrelid = table_oid AND a.attname = names.column_name AND NOT a.attisdropped
    LEFT JOIN pg_opclass opc
      ON opc.opcmethod = (SELECT oid FROM pg_am WHERE amname = 'btree')
      AND opc.opcintype = a.atttypid
      AND opc.opcdefault;
    expected_options := array_to_string(array_fill(0, ARRAY[expected_count]), ' ');
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
    WHERE c.relname = index_name
      AND c.relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = table_oid);
    IF expected_key IS NULL THEN
      RAISE EXCEPTION '% expected columns are missing', index_name USING ERRCODE = '42703';
    ELSIF expected_collation IS NULL OR expected_opclass IS NULL THEN
      RAISE EXCEPTION '% expected btree collation/opclass is missing', index_name USING ERRCODE = '42704';
    ELSIF NOT FOUND THEN
      RAISE EXCEPTION '% was not created', index_name USING ERRCODE = '42P01';
    ELSIF existing.indrelid <> table_oid
      OR existing.indkey_text <> expected_key
      OR existing.indnatts <> expected_count
      OR existing.indnkeyatts <> expected_count
      OR existing.indoption_text <> expected_options
      OR existing.indcollation_text <> expected_collation
      OR existing.indclass_text <> expected_opclass
      OR existing.indisunique IS DISTINCT FROM expected_unique
      OR existing.amname <> 'btree'
      OR NOT existing.indisvalid OR NOT existing.indisready
      OR existing.indpred IS NOT NULL OR existing.indexprs IS NOT NULL
      OR existing.relkind <> 'i' THEN
      RAISE EXCEPTION '% has an incompatible definition', index_name USING ERRCODE = '42804';
    END IF;
  END LOOP;
END $$;

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
