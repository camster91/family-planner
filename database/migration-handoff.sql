-- Migration: Babysitter Handoff
-- Creates Handoff table with shareable token system

CREATE TABLE IF NOT EXISTS "Handoff" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "sitter_name" TEXT NOT NULL,
  "sitter_phone" TEXT,
  "arrival_time" TIMESTAMP(3),
  "departure_time" TIMESTAMP(3),
  "kids_bedtimes" TEXT,
  "where_snacks" TEXT,
  "pickup_authorized" TEXT,
  "code_words" TEXT,
  "pet_care" TEXT,
  "emergency_notes" TEXT,
  "house_notes" TEXT,
  "general_notes" TEXT,
  "share_token" TEXT UNIQUE NOT NULL,
  "share_expires_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT(now())
);

CREATE INDEX IF NOT EXISTS "Handoff_family_id_idx" ON "Handoff"("family_id");
DROP INDEX IF EXISTS "Handoff_share_token_idx";

DO $$ BEGIN ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Handoff" ADD CONSTRAINT "Handoff_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
