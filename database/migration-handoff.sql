-- Migration: Babysitter Handoff
-- Creates Handoff table with shareable token system

CREATE TABLE IF NOT EXISTS "Handoff" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT(cuid()),
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
  "share_token" TEXT UNIQUE NOT NULL DEFAULT(cuid()),
  "share_expires_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT(now())
);

CREATE INDEX IF NOT EXISTS "Handoff_family_id_idx" ON "Handoff"("family_id");
CREATE INDEX IF NOT EXISTS "Handoff_share_token_idx" ON "Handoff"("share_token");
