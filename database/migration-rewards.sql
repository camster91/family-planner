-- Migration: Add Reward model to production database
-- Run this in your production database (Coolify) after deploying

-- Add Reward table
CREATE TABLE IF NOT EXISTS "rewards" (
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

    CONSTRAINT "rewards_pkey" PRIMARY KEY ("id")
);

-- Add indexes
CREATE INDEX IF NOT EXISTS "rewards_family_id_idx" ON "rewards"("family_id");
CREATE INDEX IF NOT EXISTS "rewards_family_id_status_idx" ON "rewards"("family_id", "status");
CREATE INDEX IF NOT EXISTS "rewards_claimed_by_idx" ON "rewards"("claimed_by");

-- Add foreign keys (if they don't exist already)
-- Note: These may fail if constraints already exist, which is fine
DO $$ BEGIN
    ALTER TABLE "rewards" ADD CONSTRAINT "rewards_family_id_fkey" 
        FOREIGN KEY ("family_id") REFERENCES "families"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists
END $$;

DO $$ BEGIN
    ALTER TABLE "rewards" ADD CONSTRAINT "rewards_created_by_fkey" 
        FOREIGN KEY ("created_by") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists
END $$;

DO $$ BEGIN
    ALTER TABLE "rewards" ADD CONSTRAINT "rewards_claimed_by_fkey" 
        FOREIGN KEY ("claimed_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists
END $$;

DO $$ BEGIN
    ALTER TABLE "rewards" ADD CONSTRAINT "rewards_approved_by_fkey" 
        FOREIGN KEY ("approved_by") REFERENCES "users"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN
    -- Constraint already exists
END $$;
