-- Port the household-person identity guards from migration-household-members.sql.
-- A name-only profile never moves households or transfers erasure ownership.
CREATE TRIGGER "HouseholdMember_family_immutable"
BEFORE UPDATE OF "family_id" ON "HouseholdMember"
WHEN NEW."family_id" IS NOT OLD."family_id"
BEGIN
  SELECT RAISE(ABORT, 'Household member family is immutable');
END;

CREATE TRIGGER "HouseholdMember_erasure_insert_guard"
BEFORE INSERT ON "HouseholdMember"
WHEN NEW."erasure_user_id" IS NOT NULL AND (
  NEW."archived_at" IS NULL OR NOT EXISTS (
    SELECT 1 FROM "User" WHERE "id"=NEW."erasure_user_id" AND "family_id"=NEW."family_id"
  )
)
BEGIN
  SELECT RAISE(ABORT, 'Erasure ownership requires archived same-household membership');
END;

CREATE TRIGGER "HouseholdMember_erasure_update_guard"
BEFORE UPDATE ON "HouseholdMember"
WHEN (OLD."erasure_user_id" IS NOT NULL AND NEW."erasure_user_id" IS NOT OLD."erasure_user_id")
  OR (NEW."erasure_user_id" IS NOT NULL AND (
    NEW."archived_at" IS NULL OR NOT EXISTS (
      SELECT 1 FROM "User" WHERE "id"=NEW."erasure_user_id" AND "family_id"=NEW."family_id"
    )
  ))
BEGIN
  SELECT RAISE(ABORT, 'Erasure ownership requires an archived same-household account and cannot transfer');
END;
