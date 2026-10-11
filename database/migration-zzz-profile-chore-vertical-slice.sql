-- #480 first profile-only chore expansion. This is an expand-only migration;
-- the application gate and protocol manifest remain off until all readers and
-- subject-aware writers have passed their proof.
BEGIN;

ALTER TABLE "Chore" ALTER COLUMN assigned_to DROP NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conrelid = '"Chore"'::regclass
      AND conname = 'Chore_at_least_one_subject_check'
  ) THEN
    ALTER TABLE "Chore"
      ADD CONSTRAINT "Chore_at_least_one_subject_check"
      -- A redacted profile-only history row has no active subject by design;
      -- its sticky erasure marker is the only permitted subjectless state.
      CHECK (assigned_to IS NOT NULL OR assigned_member_id IS NOT NULL OR member_subject_erased);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Chore_family_member_due_idx"
  ON "Chore" (family_id, assigned_member_id, due_date);

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

-- ChoreAssignment remains account-only in this slice. Keep its existing
-- trigger attached, but do not make its required assigned_to nullable.
COMMIT;
