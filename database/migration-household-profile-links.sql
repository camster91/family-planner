-- #557 expand-only. No tokens, account links, backfill or rollout enabled here.
BEGIN;
CREATE TABLE IF NOT EXISTS "HouseholdProfileLinkChallenge" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "member_id" TEXT NOT NULL,
  "issued_by" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "issued_token_version" INTEGER NOT NULL,
  "profile_revision" INTEGER NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "request_hash" TEXT NOT NULL,
  "state" TEXT NOT NULL DEFAULT 'pending' CHECK ("state" IN ('pending', 'claimed', 'linked', 'revoked')),
  "expires_at" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "claimed_by" TEXT REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "claimed_token_version" INTEGER,
  "claimed_at" TIMESTAMP(3),
  "linked_at" TIMESTAMP(3),
  "revision" INTEGER NOT NULL DEFAULT 0 CHECK ("revision" >= 0),
  FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CHECK ("profile_revision" >= 0 AND "issued_token_version" >= 0),
  CHECK ("claimed_token_version" IS NULL OR "claimed_token_version" >= 0),
  CHECK ("token_hash" ~ '^[a-f0-9]{64}$' AND "request_hash" ~ '^[a-f0-9]{64}$'),
  CHECK (("claimed_by" IS NULL AND "claimed_token_version" IS NULL AND "claimed_at" IS NULL)
    OR ("claimed_by" IS NOT NULL AND "claimed_token_version" IS NOT NULL AND "claimed_at" IS NOT NULL)),
  CHECK ("state" NOT IN ('claimed', 'linked') OR "claimed_by" IS NOT NULL),
  CHECK (("state" = 'linked') = ("linked_at" IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS "HouseholdProfileLinkChallenge_family_id_state_expires_at_idx"
  ON "HouseholdProfileLinkChallenge"("family_id", "state", "expires_at");
CREATE INDEX IF NOT EXISTS "HouseholdProfileLinkChallenge_member_id_family_id_idx"
  ON "HouseholdProfileLinkChallenge"("member_id", "family_id");
-- Expiry is reconciled explicitly under the household lock when issuing anew.
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdProfileLinkChallenge_active_member_key"
  ON "HouseholdProfileLinkChallenge"("member_id", "family_id") WHERE "state" IN ('pending', 'claimed');
COMMIT;
