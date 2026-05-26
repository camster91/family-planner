-- Migration: Add email verification and password reset fields to users table
-- Run this on your production database

ALTER TABLE "users"
  ADD COLUMN IF NOT EXISTS email_verified BOOLEAN DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS reset_token VARCHAR(255),
  ADD COLUMN IF NOT EXISTS reset_token_expires TIMESTAMP;

-- Index for fast token lookups
CREATE INDEX IF NOT EXISTS idx_users_reset_token ON "users"(reset_token);

-- Backfill: mark all existing users as verified (they registered before verification was required)
UPDATE "users" SET email_verified = TRUE WHERE email_verified = FALSE;
