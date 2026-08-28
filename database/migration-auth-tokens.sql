-- Authentication token fields on the canonical Prisma User table. Safe to rerun.
ALTER TABLE "User"
  ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "reset_token" TEXT,
  ADD COLUMN IF NOT EXISTS "reset_token_expires" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "verify_token" TEXT,
  ADD COLUMN IF NOT EXISTS "verify_token_expires" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "User_reset_token_idx" ON "User"("reset_token");
UPDATE "User" SET "email_verified" = TRUE WHERE "email_verified" = FALSE;
