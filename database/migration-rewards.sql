-- Migration: Add Reward model to production database
-- Run this in your production database (Coolify) after deploying
-- NOTE: Prisma uses PascalCase table names (e.g. "User", "Family") — NOT lowercase.

-- Drop the old rewards table if it exists (left over from old schema with title/point_cost)
DROP TABLE IF EXISTS "Reward" CASCADE;

-- Add Reward table
CREATE TABLE IF NOT EXISTS "Reward" (
    "id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 10,
    "icon" TEXT,
    "status" TEXT NOT NULL DEFAULT 'available',
    "created_by" TEXT NOT NULL,
    "claimed_by" TEXT,
    "claimed_at" TIMESTAMP(3),
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "approved_by" TEXT,
    "approved_at" TIMESTAMP(3),
    "redeemed_at" TIMESTAMP(3),
    "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Reward_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX IF NOT EXISTS "Reward_family_id_idx" ON "Reward"("family_id");
CREATE INDEX IF NOT EXISTS "Reward_family_id_status_idx" ON "Reward"("family_id", "status");
CREATE INDEX IF NOT EXISTS "Reward_claimed_by_idx" ON "Reward"("claimed_by");

-- Add foreign keys
DO $$ BEGIN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_family_id_fkey"
        FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_created_by_fkey"
        FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_claimed_by_fkey"
        FOREIGN KEY ("claimed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_approved_by_fkey"
        FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
