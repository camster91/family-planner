-- #480 expand-only, dormant. No backfill, assignment switch or account linking.
-- Startup's scripts/migrate.js runs this idempotent file after Family/User exist.
BEGIN;
CREATE UNIQUE INDEX IF NOT EXISTS "User_id_family_id_key" ON "User" ("id", "family_id");

CREATE TABLE IF NOT EXISTS "HouseholdMember" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "name" TEXT NOT NULL CHECK (length(btrim("name")) > 0),
  "role" TEXT NOT NULL DEFAULT 'child' CHECK ("role" IN ('parent', 'teen', 'child')),
  "age" INTEGER CHECK ("age" IS NULL OR "age" >= 0),
  "avatar_url" TEXT,
  "board_color" TEXT,
  "archived_at" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMember_id_family_id_key" ON "HouseholdMember" ("id", "family_id");
CREATE INDEX IF NOT EXISTS "HouseholdMember_family_id_archived_at_idx" ON "HouseholdMember" ("family_id", "archived_at");
-- Detached profiles retain a private erasure owner, never an access grant.
ALTER TABLE "HouseholdMember" ADD COLUMN IF NOT EXISTS "erasure_user_id" TEXT REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION;
CREATE INDEX IF NOT EXISTS "HouseholdMember_erasure_user_id_idx" ON "HouseholdMember" ("erasure_user_id");

CREATE TABLE IF NOT EXISTS "HouseholdMemberLegacyMapping" (
  "user_id" TEXT PRIMARY KEY,
  "member_id" TEXT NOT NULL UNIQUE,
  "family_id" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);
CREATE TABLE IF NOT EXISTS "HouseholdMemberAccountLink" (
  "member_id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL UNIQUE,
  "family_id" TEXT NOT NULL,
  "verified_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY ("user_id", "family_id") REFERENCES "User"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMemberLegacyMapping_user_id_family_id_key" ON "HouseholdMemberLegacyMapping" ("user_id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMemberLegacyMapping_member_id_family_id_key" ON "HouseholdMemberLegacyMapping" ("member_id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMemberAccountLink_user_id_family_id_key" ON "HouseholdMemberAccountLink" ("user_id", "family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdMemberAccountLink_member_id_family_id_key" ON "HouseholdMemberAccountLink" ("member_id", "family_id");

-- Family deletion clears User.family_id and cascades HouseholdMember rows.
-- Check the account side after both actions, rather than depending on trigger order.
-- Ordinary membership moves still fail at transaction commit while mappings exist.
ALTER TABLE "HouseholdMemberLegacyMapping" ALTER CONSTRAINT "HouseholdMemberLegacyMapping_user_id_family_id_fkey" DEFERRABLE INITIALLY DEFERRED;
ALTER TABLE "HouseholdMemberAccountLink" ALTER CONSTRAINT "HouseholdMemberAccountLink_user_id_family_id_fkey" DEFERRABLE INITIALLY DEFERRED;

-- A household person never moves between families by changing a foreign key.
CREATE OR REPLACE FUNCTION guard_household_member_family() RETURNS trigger AS $$
BEGIN
  IF NEW.family_id IS DISTINCT FROM OLD.family_id THEN
    RAISE EXCEPTION 'Household member family is immutable' USING ERRCODE = '23514';
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS household_member_family_immutable ON "HouseholdMember";
CREATE TRIGGER household_member_family_immutable BEFORE UPDATE OF family_id ON "HouseholdMember"
FOR EACH ROW EXECUTE FUNCTION guard_household_member_family();

CREATE OR REPLACE FUNCTION guard_household_member_erasure_owner() RETURNS trigger AS $$
BEGIN
  IF NEW.erasure_user_id IS NOT NULL AND NEW.archived_at IS NULL THEN
    RAISE EXCEPTION 'Erasure ownership requires an archived member' USING ERRCODE = '23514';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.erasure_user_id IS NOT NULL AND NEW.erasure_user_id IS DISTINCT FROM OLD.erasure_user_id THEN
    RAISE EXCEPTION 'Erasure ownership cannot be transferred' USING ERRCODE = '23514';
  END IF;
  IF NEW.erasure_user_id IS NOT NULL AND (TG_OP = 'INSERT' OR NEW.erasure_user_id IS DISTINCT FROM OLD.erasure_user_id) THEN
    IF NOT EXISTS (SELECT 1 FROM "User" WHERE id = NEW.erasure_user_id AND family_id = NEW.family_id) THEN
      RAISE EXCEPTION 'Erasure ownership requires current same-household membership' USING ERRCODE = '23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;
DROP TRIGGER IF EXISTS household_member_erasure_owner_guard ON "HouseholdMember";
CREATE TRIGGER household_member_erasure_owner_guard BEFORE INSERT OR UPDATE ON "HouseholdMember"
FOR EACH ROW EXECUTE FUNCTION guard_household_member_erasure_owner();
COMMIT;
