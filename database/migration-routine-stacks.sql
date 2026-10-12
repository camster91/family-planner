-- Routine stack identity foundation (additive, no backfill).
-- Existing chores remain valid with a NULL routine_stack_id.  A display label
-- is never used to infer membership or merge legacy rows.
BEGIN;

CREATE TABLE IF NOT EXISTS "RoutineStack" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "version" INTEGER NOT NULL DEFAULT 1,
  "fingerprint" TEXT NOT NULL,
  "created_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "RoutineStack" ALTER COLUMN "created_by" DROP NOT NULL;

ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_stack_id" TEXT;

ALTER TABLE "RoutineStack" DROP CONSTRAINT IF EXISTS "RoutineStack_created_by_fkey";
DO $$ BEGIN
  ALTER TABLE "RoutineStack"
    ADD CONSTRAINT "RoutineStack_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id")
    ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "RoutineStack"
    ADD CONSTRAINT "RoutineStack_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id")
    ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$
DECLARE
  table_oid oid := '"RoutineStack"'::regclass;
  id_attnum smallint;
  family_id_attnum smallint;
  expected_keys smallint[];
  existing_keys smallint[];
  existing_deferrable boolean;
  existing_deferred boolean;
  existing_relkind "char";
  existing_index_relid oid;
  existing_unique boolean;
  existing_valid boolean;
  existing_ready boolean;
  existing_predicate text;
  existing_expressions text;
  existing_index_keys smallint[];
BEGIN
  SELECT attnum::smallint INTO id_attnum
  FROM pg_attribute
  WHERE attrelid = table_oid AND attname = 'id' AND NOT attisdropped;
  SELECT attnum::smallint INTO family_id_attnum
  FROM pg_attribute
  WHERE attrelid = table_oid AND attname = 'family_id' AND NOT attisdropped;
  IF id_attnum IS NULL OR family_id_attnum IS NULL THEN
    RAISE EXCEPTION 'RoutineStack_id_family_id_key cannot be checked because its columns are missing';
  END IF;
  expected_keys := ARRAY[id_attnum, family_id_attnum]::smallint[];

  SELECT
    ARRAY(SELECT value::smallint FROM unnest(conkey) WITH ORDINALITY AS key(value, ord) ORDER BY ord),
    condeferrable,
    condeferred
    INTO existing_keys, existing_deferrable, existing_deferred
  FROM pg_constraint
  WHERE conrelid = table_oid
    AND conname = 'RoutineStack_id_family_id_key'
    AND contype = 'u';
  IF existing_keys IS NOT NULL THEN
    IF existing_keys <> expected_keys OR existing_deferrable OR existing_deferred THEN
      RAISE EXCEPTION 'RoutineStack_id_family_id_key exists with the wrong unique constraint shape';
    END IF;
  ELSE
    SELECT
      c.relkind,
      i.indrelid,
      i.indisunique,
      i.indisvalid,
      i.indisready,
      i.indpred::text,
      i.indexprs::text,
      ARRAY(SELECT value::smallint FROM unnest(i.indkey::smallint[]) WITH ORDINALITY AS key(value, ord) ORDER BY ord)
      INTO existing_relkind, existing_index_relid, existing_unique, existing_valid, existing_ready,
        existing_predicate, existing_expressions, existing_index_keys
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
    LEFT JOIN pg_index i ON i.indexrelid = c.oid
    WHERE n.nspname = 'public'
      AND c.relname = 'RoutineStack_id_family_id_key';
    IF existing_relkind IS NULL THEN
      ALTER TABLE "RoutineStack"
        ADD CONSTRAINT "RoutineStack_id_family_id_key"
        UNIQUE ("id", "family_id");
    ELSIF existing_relkind <> 'i' OR existing_index_relid IS DISTINCT FROM table_oid
      OR existing_unique IS DISTINCT FROM true
      OR existing_valid IS DISTINCT FROM true OR existing_ready IS DISTINCT FROM true
      OR existing_predicate IS NOT NULL OR existing_expressions IS NOT NULL
      OR existing_index_keys <> expected_keys THEN
      RAISE EXCEPTION 'RoutineStack_id_family_id_key exists with the wrong relation shape';
    END IF;
    -- A valid pre-existing unique index is equivalent protection. Leave it
    -- in place instead of colliding with its relation name on retry.
  END IF;
END $$;

DO $$ BEGIN
  ALTER TABLE "Chore"
    ADD CONSTRAINT "Chore_routine_stack_fkey"
    FOREIGN KEY ("routine_stack_id", "family_id")
    REFERENCES "RoutineStack"("id", "family_id")
    ON DELETE NO ACTION ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "RoutineStack_family_id_updated_at_idx"
  ON "RoutineStack" ("family_id", "updated_at");
CREATE INDEX IF NOT EXISTS "Chore_family_id_routine_stack_id_idx"
  ON "Chore" ("family_id", "routine_stack_id");

COMMIT;
