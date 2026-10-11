-- #480 additive audit attribution. Existing actor fields remain authoritative.
-- Activity.user_id stays required and DeviceAuditEvent.actor_user_id keeps its
-- existing nullable/set-null contract. These nullable subject references are
-- dormant until a later member-domain writer/client stage is approved.
BEGIN;

-- The bootstrap creates these columns for a fresh database, but upgrades may
-- be missing them. Do not use ADD COLUMN IF NOT EXISTS alone: an existing
-- column with the wrong type, nullability or default must stop this migration.
DO $$
DECLARE
  table_name TEXT;
  table_oid OID;
  actual_type TEXT;
  actual_not_null BOOLEAN;
  actual_default TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Activity', 'DeviceAuditEvent'] LOOP
    table_oid := to_regclass(format('%I', table_name));
    IF table_oid IS NULL THEN
      RAISE EXCEPTION 'audit subject migration requires table %', table_name USING ERRCODE = '42P01';
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'subject_member_id' AND NOT attisdropped
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN subject_member_id TEXT', table_name);
    ELSE
      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      INTO actual_type, actual_not_null, actual_default
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = table_oid AND a.attname = 'subject_member_id' AND NOT a.attisdropped;
      IF actual_type <> 'text' OR actual_not_null OR actual_default IS NOT NULL THEN
        RAISE EXCEPTION '%."subject_member_id" must be nullable text without a default', table_name USING ERRCODE = '42804';
      END IF;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'subject_member_erased' AND NOT attisdropped
    ) THEN
      EXECUTE format('ALTER TABLE %I ADD COLUMN subject_member_erased BOOLEAN NOT NULL DEFAULT false', table_name);
    ELSE
      SELECT format_type(a.atttypid, a.atttypmod), a.attnotnull, pg_get_expr(d.adbin, d.adrelid)
      INTO actual_type, actual_not_null, actual_default
      FROM pg_attribute a
      LEFT JOIN pg_attrdef d ON d.adrelid = a.attrelid AND d.adnum = a.attnum
      WHERE a.attrelid = table_oid AND a.attname = 'subject_member_erased' AND NOT a.attisdropped;
      IF actual_type <> 'boolean' OR NOT actual_not_null OR actual_default IS DISTINCT FROM 'false' THEN
        RAISE EXCEPTION '%."subject_member_erased" must be non-null boolean DEFAULT false', table_name USING ERRCODE = '42804';
      END IF;
    END IF;
  END LOOP;
END $$;

-- A subject FK is deliberately NO ACTION: explicit account erasure must first
-- redact the subject and set its tombstone. Validate every semantic part of a
-- pre-existing named constraint; a name collision with weaker SQL is unsafe.
DO $$
DECLARE
  table_name TEXT;
  constraint_name TEXT;
  table_oid OID;
  member_attnum SMALLINT;
  family_attnum SMALLINT;
  ref_id_attnum SMALLINT;
  ref_family_attnum SMALLINT;
  existing RECORD;
BEGIN
  IF to_regclass('"HouseholdMember"') IS NULL THEN
    RAISE EXCEPTION 'audit subject migration requires HouseholdMember' USING ERRCODE = '42P01';
  END IF;
  SELECT attnum INTO ref_id_attnum FROM pg_attribute
    WHERE attrelid = to_regclass('"HouseholdMember"') AND attname = 'id' AND NOT attisdropped;
  SELECT attnum INTO ref_family_attnum FROM pg_attribute
    WHERE attrelid = to_regclass('"HouseholdMember"') AND attname = 'family_id' AND NOT attisdropped;
  IF ref_id_attnum IS NULL OR ref_family_attnum IS NULL THEN
    RAISE EXCEPTION 'HouseholdMember reference columns are missing' USING ERRCODE = '42703';
  END IF;
  FOREACH table_name IN ARRAY ARRAY['Activity', 'DeviceAuditEvent'] LOOP
    constraint_name := table_name || '_subject_member_fkey';
    table_oid := to_regclass(format('%I', table_name));
    SELECT attnum INTO member_attnum FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'subject_member_id' AND NOT attisdropped;
    SELECT attnum INTO family_attnum FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'family_id' AND NOT attisdropped;
    IF member_attnum IS NULL OR family_attnum IS NULL THEN
      RAISE EXCEPTION '% subject columns are missing', table_name USING ERRCODE = '42703';
    END IF;

    SELECT c.contype, c.confrelid, c.conkey, c.confkey, c.confdeltype, c.confupdtype,
           c.convalidated, c.condeferrable, c.condeferred
    INTO existing
    FROM pg_constraint c
    WHERE c.conname = constraint_name AND c.conrelid = table_oid;
    IF NOT FOUND THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I FOREIGN KEY (subject_member_id, family_id) REFERENCES "HouseholdMember" (id, family_id) ON DELETE NO ACTION ON UPDATE NO ACTION',
        table_name, constraint_name
      );
    ELSIF existing.contype <> 'f'
      OR existing.confrelid <> to_regclass('"HouseholdMember"')
      OR existing.conkey <> ARRAY[member_attnum, family_attnum]::SMALLINT[]
      OR existing.confkey <> ARRAY[ref_id_attnum, ref_family_attnum]::SMALLINT[]
      OR existing.confdeltype <> 'a' OR existing.confupdtype <> 'a'
      OR NOT existing.convalidated OR existing.condeferrable OR existing.condeferred THEN
      RAISE EXCEPTION '% has an incompatible subject foreign key', constraint_name USING ERRCODE = '42804';
    END IF;
  END LOOP;
END $$;

-- The erased bit is a one-way privacy state. The check covers row shape; the
-- trigger also prevents ordinary updates from clearing a subject without the
-- explicit tombstone, matching the existing chore-subject guard.
DO $$
DECLARE
  table_name TEXT;
  constraint_name TEXT;
  table_oid OID;
  existing RECORD;
  normalized_definition TEXT;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Activity', 'DeviceAuditEvent'] LOOP
    constraint_name := table_name || '_subject_member_erased_check';
    table_oid := to_regclass(format('%I', table_name));
    SELECT c.contype, c.convalidated, pg_get_constraintdef(c.oid, true) AS definition
    INTO existing
    FROM pg_constraint c
    WHERE c.conname = constraint_name AND c.conrelid = table_oid;
    IF NOT FOUND THEN
      EXECUTE format(
        'ALTER TABLE %I ADD CONSTRAINT %I CHECK (NOT subject_member_erased OR subject_member_id IS NULL)',
        table_name, constraint_name
      );
    ELSE
      normalized_definition := regexp_replace(lower(existing.definition), '[^a-z0-9_]', '', 'g');
      IF existing.contype <> 'c'
        OR normalized_definition <> 'checknotsubject_member_erasedorsubject_member_idisnull'
        OR NOT existing.convalidated THEN
        RAISE EXCEPTION '% has an incompatible erased-subject check', constraint_name USING ERRCODE = '42804';
      END IF;
    END IF;
  END LOOP;
END $$;

-- Validate named indexes rather than allowing an existing partial, expression,
-- invalid or differently ordered index to satisfy this migration by name.
DO $$
DECLARE
  table_name TEXT;
  index_name TEXT;
  table_oid OID;
  family_attnum SMALLINT;
  subject_attnum SMALLINT;
  family_collation OID;
  subject_collation OID;
  text_opclass OID;
  existing RECORD;
BEGIN
  FOREACH table_name IN ARRAY ARRAY['Activity', 'DeviceAuditEvent'] LOOP
    index_name := table_name || '_family_id_subject_member_id_idx';
    table_oid := to_regclass(format('%I', table_name));
    SELECT attnum, attcollation INTO family_attnum, family_collation FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'family_id' AND NOT attisdropped;
    SELECT attnum, attcollation INTO subject_attnum, subject_collation FROM pg_attribute
      WHERE attrelid = table_oid AND attname = 'subject_member_id' AND NOT attisdropped;
    IF family_attnum IS NULL OR subject_attnum IS NULL THEN
      RAISE EXCEPTION '% index columns are missing', table_name USING ERRCODE = '42703';
    END IF;
    SELECT oc.oid INTO text_opclass
    FROM pg_opclass oc
    JOIN pg_am am ON am.oid = oc.opcmethod
    JOIN pg_namespace n ON n.oid = oc.opcnamespace
    WHERE am.amname = 'btree' AND n.nspname = 'pg_catalog' AND oc.opcname = 'text_ops';
    IF text_opclass IS NULL THEN
      RAISE EXCEPTION 'pg_catalog.text_ops is missing' USING ERRCODE = '42704';
    END IF;
    SELECT i.indrelid, i.indkey, i.indisvalid, i.indisready, i.indpred, i.indexprs,
           i.indisunique, i.indnatts, i.indnkeyatts, i.indcollation,
           i.indclass, i.indoption, am.amname, c.relkind
    INTO existing
    FROM pg_class c
    JOIN pg_index i ON i.indexrelid = c.oid
    JOIN pg_am am ON am.oid = c.relam
    WHERE c.relname = index_name
      AND c.relnamespace = (SELECT relnamespace FROM pg_class WHERE oid = table_oid);
    IF NOT FOUND THEN
      EXECUTE format(
        'CREATE INDEX %I ON %I (family_id, subject_member_id)', index_name, table_name
      );
    ELSIF existing.indrelid <> table_oid
      -- int2vector can carry a zero-based array lower bound after catalog
      -- round-trips, so compare its canonical ordered text representation
      -- rather than array equality (which would reject a valid index).
      OR existing.indkey::text <> format('%s %s', family_attnum, subject_attnum)
      OR existing.indnatts <> 2 OR existing.indnkeyatts <> 2
      OR existing.indcollation::text <> format('%s %s', family_collation, subject_collation)
      OR existing.indclass::text <> format('%s %s', text_opclass, text_opclass)
      OR existing.indoption::text <> '0 0'
      OR existing.amname <> 'btree'
      OR NOT existing.indisvalid OR NOT existing.indisready
      OR existing.indpred IS NOT NULL OR existing.indexprs IS NOT NULL
      OR existing.indisunique OR existing.relkind <> 'i' THEN
      RAISE EXCEPTION '% has an incompatible subject index', index_name USING ERRCODE = '42804';
    END IF;
  END LOOP;
END $$;

CREATE OR REPLACE FUNCTION guard_audit_member_subject() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    IF OLD.subject_member_erased AND NOT NEW.subject_member_erased THEN
      RAISE EXCEPTION 'erased audit member subject cannot be restored' USING ERRCODE = '23514';
    END IF;
    IF OLD.subject_member_id IS NOT NULL
      AND NEW.subject_member_id IS NULL
      AND NOT NEW.subject_member_erased THEN
      RAISE EXCEPTION 'audit member subject can only be cleared by explicit erasure' USING ERRCODE = '23514';
    END IF;
  END IF;
  IF NEW.subject_member_erased AND NEW.subject_member_id IS NOT NULL THEN
    RAISE EXCEPTION 'erased audit member subject must be null' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS activity_member_subject_guard ON "Activity";
CREATE TRIGGER activity_member_subject_guard
  BEFORE INSERT OR UPDATE ON "Activity"
  FOR EACH ROW EXECUTE FUNCTION guard_audit_member_subject();
DROP TRIGGER IF EXISTS device_audit_event_member_subject_guard ON "DeviceAuditEvent";
CREATE TRIGGER device_audit_event_member_subject_guard
  BEFORE INSERT OR UPDATE ON "DeviceAuditEvent"
  FOR EACH ROW EXECUTE FUNCTION guard_audit_member_subject();

COMMIT;
