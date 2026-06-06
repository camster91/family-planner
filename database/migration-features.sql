-- Migration: Per-family feature flags + new feature tables
-- Adds: Family.features (JSON), FamilyMeal, PinnedNote, Anniversary,
--       FamilyLocation, Pickup, Allowance tables.

-- 1. Per-family feature flags
ALTER TABLE "Family"
  ADD COLUMN IF NOT EXISTS "features" JSONB
  DEFAULT '{"meals":true,"notes":true,"anniversaries":true,"locations":false,"pickups":false,"allowance":false,"rewards":true,"budget":true,"projects":true,"messages":true,"analytics":true}'::jsonb;

-- 2. Family meals (the meal planning feature)
CREATE TABLE IF NOT EXISTS "FamilyMeal" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "date"         TIMESTAMP(3) NOT NULL,
  "meal_type"    TEXT NOT NULL,
  "recipe_name"  TEXT,
  "notes"        TEXT,
  "cook_id"      TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "created_by"   TEXT NOT NULL REFERENCES "User"("id"),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FamilyMeal_family_id_idx" ON "FamilyMeal"("family_id");
CREATE INDEX IF NOT EXISTS "FamilyMeal_family_id_date_idx" ON "FamilyMeal"("family_id", "date");

-- 3. Pinned notes (fridge board)
CREATE TABLE IF NOT EXISTS "PinnedNote" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "title"        TEXT NOT NULL,
  "body"         TEXT NOT NULL,
  "color"        TEXT NOT NULL DEFAULT 'yellow',
  "pinned"       BOOLEAN NOT NULL DEFAULT TRUE,
  "created_by"   TEXT NOT NULL REFERENCES "User"("id"),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "PinnedNote_family_id_idx" ON "PinnedNote"("family_id");

-- 4. Anniversaries & birthdays
CREATE TABLE IF NOT EXISTS "Anniversary" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "name"         TEXT NOT NULL,
  "type"         TEXT NOT NULL,
  "date"         TIMESTAMP(3) NOT NULL,
  "notes"        TEXT,
  "person_id"    TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Anniversary_family_id_idx" ON "Anniversary"("family_id");
CREATE INDEX IF NOT EXISTS "Anniversary_family_id_date_idx" ON "Anniversary"("family_id", "date");

-- 5. Saved locations (home, school, work, etc.)
CREATE TABLE IF NOT EXISTS "FamilyLocation" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "user_id"      TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "label"        TEXT NOT NULL,
  "address"      TEXT,
  "latitude"     DOUBLE PRECISION,
  "longitude"    DOUBLE PRECISION,
  "is_primary"   BOOLEAN NOT NULL DEFAULT FALSE,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "FamilyLocation_family_id_idx" ON "FamilyLocation"("family_id");
CREATE INDEX IF NOT EXISTS "FamilyLocation_user_id_idx" ON "FamilyLocation"("user_id");

-- 6. Pickups & dropoffs
CREATE TABLE IF NOT EXISTS "Pickup" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "title"        TEXT NOT NULL,
  "location"     TEXT,
  "pickup_time"  TIMESTAMP(3) NOT NULL,
  "assigned_to"  TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "created_by"   TEXT NOT NULL REFERENCES "User"("id"),
  "notes"        TEXT,
  "completed"    BOOLEAN NOT NULL DEFAULT FALSE,
  "completed_at" TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Pickup_family_id_idx" ON "Pickup"("family_id");
CREATE INDEX IF NOT EXISTS "Pickup_family_id_pickup_time_idx" ON "Pickup"("family_id", "pickup_time");
CREATE INDEX IF NOT EXISTS "Pickup_assigned_to_idx" ON "Pickup"("assigned_to");

-- 7. Allowance / IOU tracking
CREATE TABLE IF NOT EXISTS "Allowance" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "from_user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "to_user_id"   TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "amount"       DOUBLE PRECISION NOT NULL,
  "reason"       TEXT,
  "status"       TEXT NOT NULL DEFAULT 'pending',
  "scheduled_for" TIMESTAMP(3),
  "paid_at"      TIMESTAMP(3),
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "Allowance_family_id_idx" ON "Allowance"("family_id");
CREATE INDEX IF NOT EXISTS "Allowance_to_user_id_idx" ON "Allowance"("to_user_id");
CREATE INDEX IF NOT EXISTS "Allowance_status_idx" ON "Allowance"("status");
