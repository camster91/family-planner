-- One-time email invites. Token is stored hashed. Safe to rerun.
CREATE TABLE IF NOT EXISTS "FamilyInvite" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "email" TEXT NOT NULL,
  "role" TEXT NOT NULL,
  "token_hash" TEXT NOT NULL UNIQUE,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "accepted_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE UNIQUE INDEX IF NOT EXISTS "FamilyInvite_token_hash_key" ON "FamilyInvite"("token_hash");
CREATE INDEX IF NOT EXISTS "FamilyInvite_family_id_email_idx" ON "FamilyInvite"("family_id", "email");
CREATE INDEX IF NOT EXISTS "FamilyInvite_expires_at_idx" ON "FamilyInvite"("expires_at");

DO $$ BEGIN
  ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_created_by_fkey"
    FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
