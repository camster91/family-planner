-- Migration: Reward table (Monetoni upgrade schema)
-- Run this in your production database (Coolify) after deploying
-- NOTE: Prisma uses PascalCase table names (e.g. "User", "Family") — NOT lowercase.

-- Drop the old rewards table if it exists (left over from old schema with title/point_cost).
-- This is destructive: any existing rewards will be lost. Safe in production only if
-- no rewards have been created yet.
DROP TABLE IF EXISTS "Reward" CASCADE;

-- Create the new Reward table matching the current Prisma schema
CREATE TABLE "Reward" (
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

-- Indexes (matching Prisma @@index directives)
CREATE INDEX "Reward_family_id_idx" ON "Reward"("family_id");
CREATE INDEX "Reward_family_id_status_idx" ON "Reward"("family_id", "status");
CREATE INDEX "Reward_claimed_by_idx" ON "Reward"("claimed_by");

-- Foreign keys (PascalCase table names — DO NOT use lowercase users/families)
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

-- IMPORTANT: If you already have a Reward table with the old columns (title, point_cost),
-- run this AFTER the table is created. It removes the legacy title column and renames
-- point_cost → cost. Only safe if Reward table is empty or you have backed up data.
--
-- ALTER TABLE "Reward" DROP COLUMN IF EXISTS "title";
-- ALTER TABLE "Reward" RENAME COLUMN "point_cost" TO "cost";
