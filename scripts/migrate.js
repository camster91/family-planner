// Database migration script
// 1. Connects to the PostgreSQL server
// 2. Creates the target database if it doesn't exist
// 3. Creates/updates tables to match the current Prisma schema
// 4. Runs any database/migration-*.sql files (sorted alphabetically, idempotent)
// 5. Runs POST_FEATURE_SQL (changes to tables those files create)
// Called from docker-entrypoint.sh before starting the server
//
// IMPORTANT: This file MUST stay in sync with prisma/schema.prisma.
// Whenever a model or column is added there, add it here as well.

const { Client } = require('pg')
const fs = require('fs')
const path = require('path')

// All CREATE statements use IF NOT EXISTS so this is idempotent.
// All ALTER statements use ADD COLUMN IF NOT EXISTS so existing tables get new columns.
const CREATE_TABLES_SQL = `
-- ============ Family ============
CREATE TABLE IF NOT EXISTS "Family" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "invite_code" TEXT UNIQUE NOT NULL,
  "subscription_tier" TEXT NOT NULL DEFAULT 'free',
  "feed_token" TEXT UNIQUE,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill feed_token for families created before calendar feeds existed
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "feed_token" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "Family_feed_token_key" ON "Family"("feed_token");

-- Per-family AI capture provider (key stored encrypted)
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "capture_ai_key_enc" TEXT;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "capture_ai_base_url" TEXT;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "capture_ai_model" TEXT;

-- Today board weather (#262; opt-in, default off; coarse place only)
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "weather_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "weather_latitude" DOUBLE PRECISION;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "weather_longitude" DOUBLE PRECISION;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "weather_label" TEXT;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "weather_unit" TEXT NOT NULL DEFAULT 'celsius';

-- Fridge calm display (#271; additive: idle minutes, night hours off, no photos)
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "ambient_idle_minutes" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "night_start" TEXT;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "night_end" TEXT;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "ambient_photo_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

-- Shared-device writes (#274; per-household opt-in, default off: SHARED_DEVICE.md §9.2)
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "device_writes_enabled" BOOLEAN NOT NULL DEFAULT false;

-- Beta usage counts (#287, D-6; per-household opt-in, default off)
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "beta_metrics_enabled" BOOLEAN NOT NULL DEFAULT false;

-- ============ User ============
CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT UNIQUE NOT NULL,
  "password" TEXT,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'parent',
  "age" INTEGER,
  "family_id" TEXT,
  "avatar_url" TEXT,
  "last_chore_date" TIMESTAMP(3),
  "xp" INTEGER NOT NULL DEFAULT 0,
  "level" INTEGER NOT NULL DEFAULT 1,
  "streak" INTEGER NOT NULL DEFAULT 0,
  "best_streak" INTEGER NOT NULL DEFAULT 0,
  "email_verified" BOOLEAN NOT NULL DEFAULT false,
  "reset_token" TEXT,
  "reset_token_expires" TIMESTAMP(3),
  "verify_token" TEXT,
  "verify_token_expires" TIMESTAMP(3),
  "token_version" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- Backfill auth token columns if older deployments predate them
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "last_chore_date" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "xp" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "level" INTEGER NOT NULL DEFAULT 1;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "best_streak" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "email_verified" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reset_token" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "reset_token_expires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verify_token" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "verify_token_expires" TIMESTAMP(3);
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "token_version" INTEGER NOT NULL DEFAULT 0;
-- Today board member colour (#262; palette key, NULL = fallback)
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "board_color" TEXT;
-- Per-member notification preferences (#286, PR101 D-5). Additive, DEFAULT true:
-- existing rows read as "everything on", which is today's behaviour.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notify_chores" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notify_events" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "notify_messages" BOOLEAN NOT NULL DEFAULT true;
-- Quiet hours (#141, O-32). Additive, default off: existing rows keep today's behaviour.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quiet_hours_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quiet_hours_start" TEXT NOT NULL DEFAULT '22:00';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quiet_hours_end" TEXT NOT NULL DEFAULT '07:00';
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "quiet_hours_time_zone" TEXT;
-- Morning summary (O-40). Additive, default off (opt-in): existing rows get nothing.
-- sent_on is the local YYYY-MM-DD of the last send (once-a-day dedupe key).
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "morning_summary_enabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "morning_summary_time_zone" TEXT;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "morning_summary_sent_on" TEXT;

-- ============ Chore ============
CREATE TABLE IF NOT EXISTS "Chore" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "points" INTEGER NOT NULL DEFAULT 10,
  "assigned_to" TEXT NOT NULL,
  "due_date" TIMESTAMP(3) NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'pending',
  "frequency" TEXT NOT NULL DEFAULT 'once',
  "difficulty" TEXT NOT NULL DEFAULT 'medium',
  "photo_url" TEXT,
  "photo_verified" BOOLEAN NOT NULL DEFAULT false,
  "verified_at" TIMESTAMP(3),
  "verified_notes" TEXT,
  "completed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "created_by" TEXT NOT NULL,
  "recurrence_id" TEXT,
  "is_template" BOOLEAN NOT NULL DEFAULT false,
  "icon" TEXT,
  "routine" TEXT,
  "routine_order" INTEGER,
  "rotation_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "rotation_index" INTEGER
);

-- Backfill the #184 recurrence columns for deployments whose Chore table predates them
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "recurrence_id" TEXT;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "is_template" BOOLEAN NOT NULL DEFAULT false;
-- #268 Undo: exact successor created by completing a legacy recurring one-off
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "successor_id" TEXT;
-- Picture routines (#272): additive, nullable. Existing chores have no icon or routine.
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "icon" TEXT;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine" TEXT;
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "routine_order" INTEGER;
-- Take turns (O-39): additive. Empty list = no rotation (today's behaviour);
-- a constant default is a metadata-only change, so this is cheap on a big table.
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "rotation_member_ids" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Chore" ADD COLUMN IF NOT EXISTS "rotation_index" INTEGER;

-- ============ Event ============
CREATE TABLE IF NOT EXISTS "Event" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "start_time" TIMESTAMP(3) NOT NULL,
  "end_time" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "event_type" TEXT NOT NULL DEFAULT 'other',
  "is_task" BOOLEAN NOT NULL DEFAULT false,
  "project_id" TEXT,
  "recurrence" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "is_task" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
-- #232 read-only ICS import: source identity of imported events (null for local events)
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "source_subscription_id" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "source_uid" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "source_occurrence_start" TIMESTAMP(3);
-- #264 two-way provider sync (additive): origin connection + last local change
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "source_connection_id" TEXT;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;

-- ============ CalendarSubscription (#232; feed URL stored encrypted) ============
CREATE TABLE IF NOT EXISTS "CalendarSubscription" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "url_enc" TEXT NOT NULL,
  "color" TEXT,
  "last_fetched_at" TIMESTAMP(3),
  "last_status" TEXT NOT NULL DEFAULT 'pending',
  "last_error" TEXT,
  "etag" TEXT,
  "last_modified" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "CalendarSubscription_family_id_idx" ON "CalendarSubscription"("family_id");

-- ============ Two-way Google/Microsoft calendar sync (#264; additive, dormant unless configured) ============
-- docs/architecture/CALENDAR_SYNC.md. OAuth tokens are encrypted with CALENDAR_TOKEN_KEY.
CREATE TABLE IF NOT EXISTS "CalendarConnection" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "calendar_id" TEXT,
  "calendar_name" TEXT,
  "access_token_enc" TEXT,
  "refresh_token_enc" TEXT,
  "token_expires_at" TIMESTAMP(3),
  "sync_cursor" TEXT,
  "push_mode" TEXT NOT NULL DEFAULT 'linked',
  "status" TEXT NOT NULL DEFAULT 'pending',
  "last_synced_at" TIMESTAMP(3),
  "last_error" TEXT,
  "conflicts_count" INTEGER NOT NULL DEFAULT 0,
  "last_conflict_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Run generation: a sync writes only while the generation it started with is current (#264 review).
ALTER TABLE "CalendarConnection" ADD COLUMN IF NOT EXISTS "generation" INTEGER NOT NULL DEFAULT 0;
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarConnection_family_id_user_id_provider_key" ON "CalendarConnection"("family_id", "user_id", "provider");
CREATE INDEX IF NOT EXISTS "CalendarConnection_family_id_idx" ON "CalendarConnection"("family_id");

CREATE TABLE IF NOT EXISTS "CalendarEventLink" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "connection_id" TEXT NOT NULL,
  "event_id" TEXT,
  "external_id" TEXT NOT NULL,
  "external_etag" TEXT,
  "external_updated_at" TIMESTAMP(3),
  "synced_hash" TEXT,
  "all_day" BOOLEAN NOT NULL DEFAULT false,
  "synced_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Idempotent import key: one local row per provider event per connection.
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEventLink_connection_id_external_id_key" ON "CalendarEventLink"("connection_id", "external_id");
-- One link per local event per connection. NULL event_id rows are delete tombstones (NULLs are distinct).
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarEventLink_connection_id_event_id_key" ON "CalendarEventLink"("connection_id", "event_id");
CREATE INDEX IF NOT EXISTS "CalendarEventLink_family_id_idx" ON "CalendarEventLink"("family_id");
CREATE INDEX IF NOT EXISTS "CalendarEventLink_event_id_idx" ON "CalendarEventLink"("event_id");

CREATE TABLE IF NOT EXISTS "CalendarOAuthState" (
  "id" TEXT PRIMARY KEY,
  "state_hash" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "provider" TEXT NOT NULL,
  "code_verifier_enc" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "used_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "CalendarOAuthState_state_hash_key" ON "CalendarOAuthState"("state_hash");
CREATE INDEX IF NOT EXISTS "CalendarOAuthState_user_id_idx" ON "CalendarOAuthState"("user_id");
CREATE INDEX IF NOT EXISTS "CalendarOAuthState_expires_at_idx" ON "CalendarOAuthState"("expires_at");

-- ============ Message ============
CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'text',
  "attachments" TEXT[] NOT NULL DEFAULT '{}',
  "read_by" TEXT[] NOT NULL DEFAULT '{}',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "attachments" TEXT[] NOT NULL DEFAULT '{}';
ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "read_by" TEXT[] NOT NULL DEFAULT '{}';

-- ============ Notification ============
CREATE TABLE IF NOT EXISTS "Notification" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "read" BOOLEAN NOT NULL DEFAULT false,
  "action_url" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ List ============
CREATE TABLE IF NOT EXISTS "List" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'grocery',
  "description" TEXT,
  "is_repeatable" BOOLEAN NOT NULL DEFAULT false,
  "last_purchased_at" TIMESTAMP(3),
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "is_repeatable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "last_purchased_at" TIMESTAMP(3);

-- ============ ListItem ============
CREATE TABLE IF NOT EXISTS "ListItem" (
  "id" TEXT PRIMARY KEY,
  "list_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "price" DOUBLE PRECISION,
  "purchased" BOOLEAN NOT NULL DEFAULT false,
  "category" TEXT,
  "notes" TEXT,
  "added_by" TEXT NOT NULL,
  "checked_by" TEXT,
  "checked_at" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "purchased" BOOLEAN NOT NULL DEFAULT false;

-- ============ Activity ============
-- Note: analytics events write to this table too (with type 'event_*') but
-- are filtered out in the user-facing /api/activity feed.
CREATE TABLE IF NOT EXISTS "Activity" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "type" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "metadata" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ Reward (Monetoni upgrade schema) ============
CREATE TABLE IF NOT EXISTS "Reward" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "cost" INTEGER NOT NULL DEFAULT 10,
  "icon" TEXT NOT NULL DEFAULT 'gift',
  "status" TEXT NOT NULL DEFAULT 'available',
  "created_by" TEXT NOT NULL,
  "claimed_by" TEXT,
  "claimed_at" TIMESTAMP(3),
  "approved" BOOLEAN NOT NULL DEFAULT false,
  "approved_by" TEXT,
  "approved_at" TIMESTAMP(3),
  "redeemed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- If a legacy Reward table exists with title/point_cost columns, fix it
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'Reward' AND column_name = 'title') THEN
    ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "name" TEXT;
    UPDATE "Reward" SET "name" = "title" WHERE "name" IS NULL;
    ALTER TABLE "Reward" ALTER COLUMN "name" SET NOT NULL;
    ALTER TABLE "Reward" DROP COLUMN "title";
  END IF;
  IF EXISTS (SELECT 1 FROM information_schema.columns
             WHERE table_name = 'Reward' AND column_name = 'point_cost') THEN
    ALTER TABLE "Reward" RENAME COLUMN "point_cost" TO "cost";
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'Reward' AND column_name = 'status') THEN
    ALTER TABLE "Reward" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'available';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'Reward' AND column_name = 'approved') THEN
    ALTER TABLE "Reward" ADD COLUMN "approved" BOOLEAN NOT NULL DEFAULT false;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM information_schema.columns
                 WHERE table_name = 'Reward' AND column_name = 'created_by') THEN
    ALTER TABLE "Reward" ADD COLUMN "created_by" TEXT;
    -- Backfill created_by from the first parent in the family, or any user as fallback
    UPDATE "Reward" r
    SET "created_by" = COALESCE(
      (SELECT u.id FROM "User" u
       WHERE u.family_id = r.family_id
       AND u.role = 'parent'
       LIMIT 1),
      (SELECT u.id FROM "User" u WHERE u.family_id = r.family_id LIMIT 1)
    )
    WHERE "created_by" IS NULL;
    UPDATE "Reward" SET "created_by" = (SELECT id FROM "User" LIMIT 1) WHERE "created_by" IS NULL;
    ALTER TABLE "Reward" ALTER COLUMN "created_by" SET NOT NULL;
  END IF;
END $$;

-- ============ Transaction (Monetoni budget) ============
CREATE TABLE IF NOT EXISTS "Transaction" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "amount" DOUBLE PRECISION NOT NULL,
  "type" TEXT NOT NULL,
  "category_id" TEXT,
  "description" TEXT,
  "notes" TEXT,
  "date" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "is_recurring" BOOLEAN NOT NULL DEFAULT false,
  "recurring_interval" TEXT,
  "list_item_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ BudgetCategory (Monetoni budget) ============
CREATE TABLE IF NOT EXISTS "BudgetCategory" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '📦',
  "color" TEXT NOT NULL DEFAULT '#6B7280',
  "type" TEXT NOT NULL DEFAULT 'expense',
  "budget_limit" DOUBLE PRECISION,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ Project (Monetoni projects) ============
CREATE TABLE IF NOT EXISTS "Project" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active',
  "color" TEXT NOT NULL DEFAULT '#3B82F6',
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ ProjectTask (Monetoni projects) ============
CREATE TABLE IF NOT EXISTS "ProjectTask" (
  "id" TEXT PRIMARY KEY,
  "project_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "completed" BOOLEAN NOT NULL DEFAULT false,
  "assigned_to" TEXT,
  "due_date" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ RateLimitEntry (Postgres-backed rate limiter) ============
-- Used by /api/auth/* to track failed attempts per (ip, endpoint) key.
-- Survives across replicas and restarts (unlike in-memory Map).
CREATE TABLE IF NOT EXISTS "RateLimitEntry" (
  "id" TEXT PRIMARY KEY,
  "key" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 1,
  "windowStart" TIMESTAMP(3) NOT NULL,
  "resetAt" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- key must be UNIQUE so concurrent requests upsert onto a single row instead
-- of racing find-then-create (#168 review). Old rows may hold duplicate keys,
-- so dedupe first, keeping the entry with the latest window.
DELETE FROM "RateLimitEntry" a
  USING "RateLimitEntry" b
  WHERE a.key = b.key
    AND (a."resetAt", a.created_at) < (b."resetAt", b.created_at);
DROP INDEX IF EXISTS "RateLimitEntry_key_idx";
CREATE UNIQUE INDEX IF NOT EXISTS "RateLimitEntry_key_key" ON "RateLimitEntry"("key");
CREATE INDEX IF NOT EXISTS "RateLimitEntry_resetAt_idx" ON "RateLimitEntry"("resetAt");

-- ============ FamilyInvite (email invites; token stored hashed) ============
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

-- ============ Upload (D3 chore photo ownership, #102) ============
-- Additive (expand phase): one ownership row per file stored by /api/upload.
-- Files stored before this table existed have no row and are served through
-- the legacy chore/assignment-reference fallback until they are backfilled.
CREATE TABLE IF NOT EXISTS "Upload" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "filename" TEXT NOT NULL,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "Upload_filename_key" ON "Upload"("filename");
CREATE INDEX IF NOT EXISTS "Upload_family_id_idx" ON "Upload"("family_id");
CREATE INDEX IF NOT EXISTS "Upload_uploaded_by_idx" ON "Upload"("uploaded_by");

-- ============ Shared device (#157 contract, #240; additive) ============
-- docs/architecture/SHARED_DEVICE.md §3. Tokens, codes, digits and PINs are
-- stored as hashes only. Expand only: no backfill, nothing to contract.
CREATE TABLE IF NOT EXISTS "HouseholdDevice" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "created_by" TEXT,
  "confirmed_by" TEXT,
  "paired_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_seen_at" TIMESTAMP(3),
  "last_seen_app_version" TEXT,
  "revoked_at" TIMESTAMP(3),
  "revoked_by" TEXT,
  "revoke_reason" TEXT,
  "elevation_token_hash" TEXT,
  "elevated_user_id" TEXT,
  "elevated_token_version" INTEGER,
  "elevation_method" TEXT,
  "elevation_started_at" TIMESTAMP(3),
  "elevation_last_used_at" TIMESTAMP(3),
  "elevation_expires_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "HouseholdDevice_elevation_token_hash_key" ON "HouseholdDevice"("elevation_token_hash");
CREATE INDEX IF NOT EXISTS "HouseholdDevice_family_id_revoked_at_idx" ON "HouseholdDevice"("family_id", "revoked_at");

CREATE TABLE IF NOT EXISTS "DevicePairing" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "code_hash" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "created_by" TEXT NOT NULL,
  "expires_at" TIMESTAMP(3) NOT NULL,
  "claimed_at" TIMESTAMP(3),
  "claim_token_hash" TEXT,
  "confirm_digits_hash" TEXT,
  "confirm_attempts" INTEGER NOT NULL DEFAULT 0,
  "claim_platform" TEXT,
  "claim_app_version" TEXT,
  "confirmed_at" TIMESTAMP(3),
  "confirmed_by" TEXT,
  "cancelled_at" TIMESTAMP(3),
  "device_id" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DevicePairing_code_hash_key" ON "DevicePairing"("code_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "DevicePairing_claim_token_hash_key" ON "DevicePairing"("claim_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "DevicePairing_device_id_key" ON "DevicePairing"("device_id");
CREATE INDEX IF NOT EXISTS "DevicePairing_family_id_expires_at_idx" ON "DevicePairing"("family_id", "expires_at");
-- #241 review: a pairing that replaces an existing tablet (additive, nullable).
ALTER TABLE "DevicePairing" ADD COLUMN IF NOT EXISTS "replaces_device_id" TEXT;
CREATE INDEX IF NOT EXISTS "DevicePairing_replaces_device_id_idx" ON "DevicePairing"("replaces_device_id");

CREATE TABLE IF NOT EXISTS "DeviceSession" (
  "id" TEXT PRIMARY KEY,
  "device_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "access_token_hash" TEXT NOT NULL,
  "access_expires_at" TIMESTAMP(3) NOT NULL,
  "refresh_token_hash" TEXT NOT NULL,
  "refresh_expires_at" TIMESTAMP(3) NOT NULL,
  "first_used_at" TIMESTAMP(3),
  "rotated_at" TIMESTAMP(3),
  "replaced_by_id" TEXT,
  "revoked_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceSession_access_token_hash_key" ON "DeviceSession"("access_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceSession_refresh_token_hash_key" ON "DeviceSession"("refresh_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "DeviceSession_replaced_by_id_key" ON "DeviceSession"("replaced_by_id");
CREATE INDEX IF NOT EXISTS "DeviceSession_device_id_revoked_at_idx" ON "DeviceSession"("device_id", "revoked_at");
CREATE INDEX IF NOT EXISTS "DeviceSession_family_id_idx" ON "DeviceSession"("family_id");

CREATE TABLE IF NOT EXISTS "ParentElevationPin" (
  "user_id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "pin_hash" TEXT NOT NULL,
  "locked_until" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "ParentElevationPin_family_id_idx" ON "ParentElevationPin"("family_id");

CREATE TABLE IF NOT EXISTS "DeviceAuditEvent" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "device_id" TEXT,
  "actor_user_id" TEXT,
  "type" TEXT NOT NULL,
  "metadata" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "DeviceAuditEvent_family_id_created_at_idx" ON "DeviceAuditEvent"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "DeviceAuditEvent_device_id_created_at_idx" ON "DeviceAuditEvent"("device_id", "created_at");

-- ============ Idempotency records (#162 offline sync; additive) ============
-- docs/architecture/OFFLINE_SYNC.md. Expand only: new table, no backfill.
CREATE TABLE IF NOT EXISTS "IdempotencyRecord" (
  "id" TEXT PRIMARY KEY,
  "scope" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT,
  "action" TEXT NOT NULL,
  "request_hash" TEXT NOT NULL,
  "response_status" INTEGER,
  "response_body" JSONB,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_expires_at_idx" ON "IdempotencyRecord"("expires_at");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_family_id_idx" ON "IdempotencyRecord"("family_id");
CREATE INDEX IF NOT EXISTS "IdempotencyRecord_user_id_idx" ON "IdempotencyRecord"("user_id");

-- ============ Today board weather cache (#262; additive) ============
CREATE TABLE IF NOT EXISTS "WeatherCache" (
  "family_id" TEXT PRIMARY KEY,
  "latitude" DOUBLE PRECISION NOT NULL,
  "longitude" DOUBLE PRECISION NOT NULL,
  "status" TEXT NOT NULL,
  "payload" JSONB,
  "fetched_at" TIMESTAMP(3) NOT NULL,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- ============ Foreign keys (idempotent) ============
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "FamilyInvite" ADD CONSTRAINT "FamilyInvite_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Upload" ADD CONSTRAINT "Upload_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Upload" ADD CONSTRAINT "Upload_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Shared device (#157, #240)
DO $$ BEGIN
  ALTER TABLE "HouseholdDevice" ADD CONSTRAINT "HouseholdDevice_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "HouseholdDevice" ADD CONSTRAINT "HouseholdDevice_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DevicePairing" ADD CONSTRAINT "DevicePairing_replaces_device_id_fkey" FOREIGN KEY ("replaces_device_id") REFERENCES "HouseholdDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceSession" ADD CONSTRAINT "DeviceSession_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "HouseholdDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ParentElevationPin" ADD CONSTRAINT "ParentElevationPin_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ParentElevationPin" ADD CONSTRAINT "ParentElevationPin_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceAuditEvent" ADD CONSTRAINT "DeviceAuditEvent_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceAuditEvent" ADD CONSTRAINT "DeviceAuditEvent_device_id_fkey" FOREIGN KEY ("device_id") REFERENCES "HouseholdDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "DeviceAuditEvent" ADD CONSTRAINT "DeviceAuditEvent_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Today board weather cache (#262)
DO $$ BEGIN
  ALTER TABLE "WeatherCache" ADD CONSTRAINT "WeatherCache_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
-- Idempotency records (#162)
DO $$ BEGIN
  ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "IdempotencyRecord" ADD CONSTRAINT "IdempotencyRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_source_subscription_id_fkey" FOREIGN KEY ("source_subscription_id") REFERENCES "CalendarSubscription"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "CalendarSubscription" ADD CONSTRAINT "CalendarSubscription_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarSubscription" ADD CONSTRAINT "CalendarSubscription_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- #264 calendar sync
DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_source_connection_id_fkey" FOREIGN KEY ("source_connection_id") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarConnection" ADD CONSTRAINT "CalendarConnection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "CalendarConnection"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarEventLink" ADD CONSTRAINT "CalendarEventLink_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarOAuthState" ADD CONSTRAINT "CalendarOAuthState_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "CalendarOAuthState" ADD CONSTRAINT "CalendarOAuthState_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Reward FKs (wrapped in existence check so legacy schemas without these columns don't error)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'created_by') THEN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'claimed_by') THEN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'approved_by') THEN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM information_schema.columns WHERE table_name = 'Reward' AND column_name = 'family_id') THEN
    ALTER TABLE "Reward" ADD CONSTRAINT "Reward_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "List" ADD CONSTRAINT "List_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "List" ADD CONSTRAINT "List_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Transaction" ADD CONSTRAINT "Transaction_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "BudgetCategory"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "BudgetCategory" ADD CONSTRAINT "BudgetCategory_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "BudgetCategory" ADD CONSTRAINT "BudgetCategory_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "Project" ADD CONSTRAINT "Project_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ProjectTask" ADD CONSTRAINT "ProjectTask_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- ============ Indexes ============
CREATE INDEX IF NOT EXISTS "User_family_id_idx" ON "User"("family_id");
CREATE INDEX IF NOT EXISTS "User_reset_token_idx" ON "User"("reset_token");

CREATE INDEX IF NOT EXISTS "Chore_family_id_idx" ON "Chore"("family_id");
CREATE INDEX IF NOT EXISTS "Chore_assigned_to_idx" ON "Chore"("assigned_to");
CREATE INDEX IF NOT EXISTS "Chore_status_idx" ON "Chore"("status");
CREATE INDEX IF NOT EXISTS "Chore_due_date_idx" ON "Chore"("due_date");
CREATE INDEX IF NOT EXISTS "Chore_family_id_status_idx" ON "Chore"("family_id", "status");
CREATE INDEX IF NOT EXISTS "Chore_family_id_assigned_to_idx" ON "Chore"("family_id", "assigned_to");
CREATE INDEX IF NOT EXISTS "Chore_family_id_due_date_idx" ON "Chore"("family_id", "due_date");
CREATE INDEX IF NOT EXISTS "Chore_recurrence_id_idx" ON "Chore"("recurrence_id");
-- Final concurrency guard for #184 series expansion: one occurrence per (series, date)
CREATE UNIQUE INDEX IF NOT EXISTS "Chore_recurrence_id_due_date_key" ON "Chore"("recurrence_id", "due_date");

CREATE INDEX IF NOT EXISTS "Event_family_id_idx" ON "Event"("family_id");
CREATE INDEX IF NOT EXISTS "Event_start_time_idx" ON "Event"("start_time");
CREATE INDEX IF NOT EXISTS "Event_family_id_start_time_idx" ON "Event"("family_id", "start_time");
CREATE INDEX IF NOT EXISTS "Event_project_id_idx" ON "Event"("project_id");
CREATE INDEX IF NOT EXISTS "Event_source_subscription_id_start_time_idx" ON "Event"("source_subscription_id", "start_time");
CREATE INDEX IF NOT EXISTS "Event_source_connection_id_idx" ON "Event"("source_connection_id");
-- Idempotent import upsert key (#232). NULLs are distinct, so local events never collide.
CREATE UNIQUE INDEX IF NOT EXISTS "Event_source_subscription_id_source_uid_source_occurrence_s_key" ON "Event"("source_subscription_id", "source_uid", "source_occurrence_start");

CREATE INDEX IF NOT EXISTS "Message_family_id_idx" ON "Message"("family_id");
CREATE INDEX IF NOT EXISTS "Message_sender_id_idx" ON "Message"("sender_id");
CREATE INDEX IF NOT EXISTS "Message_created_at_idx" ON "Message"("created_at");
CREATE INDEX IF NOT EXISTS "Message_family_id_created_at_idx" ON "Message"("family_id", "created_at");

CREATE INDEX IF NOT EXISTS "Reward_family_id_idx" ON "Reward"("family_id");
CREATE INDEX IF NOT EXISTS "Reward_family_id_status_idx" ON "Reward"("family_id", "status");
CREATE INDEX IF NOT EXISTS "Reward_claimed_by_idx" ON "Reward"("claimed_by");

CREATE INDEX IF NOT EXISTS "Notification_user_id_idx" ON "Notification"("user_id");
CREATE INDEX IF NOT EXISTS "Notification_read_idx" ON "Notification"("read");
CREATE INDEX IF NOT EXISTS "Notification_created_at_idx" ON "Notification"("created_at");
CREATE INDEX IF NOT EXISTS "Notification_user_id_read_idx" ON "Notification"("user_id", "read");

CREATE INDEX IF NOT EXISTS "List_family_id_idx" ON "List"("family_id");
CREATE INDEX IF NOT EXISTS "List_family_id_type_idx" ON "List"("family_id", "type");
CREATE INDEX IF NOT EXISTS "ListItem_list_id_idx" ON "ListItem"("list_id");
CREATE INDEX IF NOT EXISTS "ListItem_list_id_checked_idx" ON "ListItem"("list_id", "checked");

CREATE INDEX IF NOT EXISTS "Activity_family_id_idx" ON "Activity"("family_id");
CREATE INDEX IF NOT EXISTS "Activity_family_id_created_at_idx" ON "Activity"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "Activity_user_id_idx" ON "Activity"("user_id");

CREATE INDEX IF NOT EXISTS "Transaction_family_id_idx" ON "Transaction"("family_id");
CREATE INDEX IF NOT EXISTS "Transaction_family_id_date_idx" ON "Transaction"("family_id", "date");
CREATE INDEX IF NOT EXISTS "Transaction_user_id_idx" ON "Transaction"("user_id");
CREATE INDEX IF NOT EXISTS "Transaction_category_id_idx" ON "Transaction"("category_id");
CREATE INDEX IF NOT EXISTS "Transaction_family_id_type_idx" ON "Transaction"("family_id", "type");

CREATE INDEX IF NOT EXISTS "BudgetCategory_family_id_idx" ON "BudgetCategory"("family_id");
CREATE INDEX IF NOT EXISTS "BudgetCategory_family_id_type_idx" ON "BudgetCategory"("family_id", "type");

CREATE INDEX IF NOT EXISTS "Project_family_id_idx" ON "Project"("family_id");
CREATE INDEX IF NOT EXISTS "Project_family_id_status_idx" ON "Project"("family_id", "status");

CREATE INDEX IF NOT EXISTS "ProjectTask_project_id_idx" ON "ProjectTask"("project_id");
CREATE INDEX IF NOT EXISTS "ProjectTask_assigned_to_idx" ON "ProjectTask"("assigned_to");
`

// Runs AFTER the database/migration-*.sql files, for changes to tables those
// files create (e.g. "Anniversary" comes from migration-features.sql, so an
// ALTER in CREATE_TABLES_SQL would fail on a fresh database). Idempotent.
const POST_FEATURE_SQL = `
-- ============ Anniversary.created_by (D9, #102) ============
-- Additive and nullable: legacy rows keep NULL and stay parent-edit-only.
ALTER TABLE "Anniversary" ADD COLUMN IF NOT EXISTS "created_by" TEXT;
DO $$ BEGIN
  ALTER TABLE "Anniversary" ADD CONSTRAINT "Anniversary_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "Anniversary_created_by_idx" ON "Anniversary"("created_by");

-- ============ Family.features.gamification (#248) ============
-- Points, streaks and the leaderboard became an opt-in family setting. New
-- households get "gamification":false from the column default (see
-- database/migration-features.sql) and from POST /api/family. Households that
-- existed before the flag keep it ON: stamp true on every row whose blob lacks
-- the key. Only rows WITHOUT the key are touched, so re-running is a no-op and
-- a household a parent later turned off stays off. A NULL blob counts as
-- "lacks the key" (normalizeFeatures fills the other keys with defaults).
UPDATE "Family"
SET "features" = COALESCE("features", '{}'::jsonb) || '{"gamification":true}'::jsonb
WHERE "features" IS NULL
   OR (jsonb_typeof("features") = 'object' AND NOT ("features" ? 'gamification'));

-- ============ Canonical meal/grocery expand (ADR-0007, #250) ============
-- Additive only: nullable or defaulted columns, SET NULL foreign keys and
-- indexes. "FamilyMeal" comes from migration-features.sql and "Recipe" /
-- "Ingredient" from migration-meal-planner-domains.sql, so this lives here.
-- See docs/architecture/MEALS_AND_GROCERIES.md section 5.
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "servings" INTEGER;
ALTER TABLE "FamilyMeal" ADD COLUMN IF NOT EXISTS "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP;
DO $$ BEGIN
  ALTER TABLE "FamilyMeal" ADD CONSTRAINT "FamilyMeal_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "FamilyMeal_recipe_id_idx" ON "FamilyMeal"("recipe_id");

ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "ingredient_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "recipe_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "meal_id" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "amount" DOUBLE PRECISION;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "unit" TEXT;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source" TEXT NOT NULL DEFAULT 'manual';
-- Immutable 'meal:<id>' | 'recipe:<id>'; never rewritten (see the partial index below).
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source_key" TEXT;
-- IdempotencyRecord.id of the from-recipe request that created the row. No FK: records expire.
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "source_request_id" TEXT;
DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "FamilyMeal"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "ListItem_ingredient_id_idx" ON "ListItem"("ingredient_id");
CREATE INDEX IF NOT EXISTS "ListItem_recipe_id_idx" ON "ListItem"("recipe_id");
CREATE INDEX IF NOT EXISTS "ListItem_meal_id_idx" ON "ListItem"("meal_id");
CREATE INDEX IF NOT EXISTS "ListItem_source_request_id_idx" ON "ListItem"("source_request_id");
-- One open recipe-added row per (list, ingredient, source). Prisma cannot
-- express a partial index, so this file owns it (schema.prisma points here).
CREATE UNIQUE INDEX IF NOT EXISTS "ListItem_open_recipe_source_key"
  ON "ListItem"("list_id", "ingredient_id", "source_key")
  WHERE "checked" = false AND "source_key" IS NOT NULL AND "ingredient_id" IS NOT NULL;

-- ============ Food inventory (#263; additive) ============
-- New table only, no backfill. It references "Ingredient", which
-- migration-meal-planner-domains.sql creates, so it lives here. The
-- "inventory" feature is off by default for new and existing households
-- (src/lib/features.ts), so no Family.features stamp is needed: a blob
-- without the key already reads as off. See
-- docs/architecture/MEALS_AND_GROCERIES.md "Food inventory".
CREATE TABLE IF NOT EXISTS "InventoryItem" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "ingredient_id" TEXT,
  "amount" DOUBLE PRECISION,
  "unit" TEXT,
  "location" TEXT NOT NULL DEFAULT 'fridge',
  "expires_on" DATE,
  "added_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryItem" ADD CONSTRAINT "InventoryItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_location_idx" ON "InventoryItem"("family_id", "location");
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_expires_on_idx" ON "InventoryItem"("family_id", "expires_on");
CREATE INDEX IF NOT EXISTS "InventoryItem_ingredient_id_idx" ON "InventoryItem"("ingredient_id");

-- ============ Inventory foundation (#158/#121; additive) ============
-- Nullable or defaulted columns and one new table, no backfill. Old rows read
-- as best-before dates on active items, which is what they were. Finished
-- (consumed/discarded) items keep their row so Undo can put them back; the
-- adjustment row records who did what and what to restore. See
-- docs/architecture/MEALS_AND_GROCERIES.md §10 "Consume, discard and undo".
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "date_kind" TEXT NOT NULL DEFAULT 'best_before';
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "category" TEXT;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "purchased_on" DATE;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "opened_on" DATE;
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "status" TEXT NOT NULL DEFAULT 'active';
ALTER TABLE "InventoryItem" ADD COLUMN IF NOT EXISTS "finished_at" TIMESTAMP(3);
CREATE INDEX IF NOT EXISTS "InventoryItem_family_id_status_expires_on_idx" ON "InventoryItem"("family_id", "status", "expires_on");
CREATE TABLE IF NOT EXISTS "InventoryAdjustment" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "item_id" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "amount_delta" DOUBLE PRECISION,
  "amount_before" DOUBLE PRECISION,
  "amount_after" DOUBLE PRECISION,
  "status_before" TEXT NOT NULL,
  "status_after" TEXT NOT NULL,
  "actor_id" TEXT,
  "request_id" TEXT,
  "item_version" TIMESTAMP(3) NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "undone_at" TIMESTAMP(3),
  "undone_by" TEXT
);
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "InventoryAdjustment" ADD CONSTRAINT "InventoryAdjustment_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "InventoryAdjustment_request_id_key" ON "InventoryAdjustment"("request_id");
CREATE INDEX IF NOT EXISTS "InventoryAdjustment_family_id_created_at_idx" ON "InventoryAdjustment"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "InventoryAdjustment_item_id_created_at_idx" ON "InventoryAdjustment"("item_id", "created_at");

-- ============ Grocery store sections (#273; additive) ============
-- Nullable/defaulted columns and two new tables, no backfill. "Ingredient"
-- comes from migration-meal-planner-domains.sql, so this lives here. A list
-- without the column value sorts by section (default true); an ingredient
-- without a section falls through to the keyword map. See
-- docs/architecture/MEALS_AND_GROCERIES.md "Store sections".
ALTER TABLE "Ingredient" ADD COLUMN IF NOT EXISTS "section" TEXT;
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "sort_by_section" BOOLEAN NOT NULL DEFAULT true;
CREATE TABLE IF NOT EXISTS "GrocerySectionPreference" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name_key" TEXT NOT NULL,
  "section" TEXT NOT NULL,
  "updated_by" TEXT,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "GrocerySectionPreference" ADD CONSTRAINT "GrocerySectionPreference_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GrocerySectionPreference" ADD CONSTRAINT "GrocerySectionPreference_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "GrocerySectionPreference_family_id_name_key_key" ON "GrocerySectionPreference"("family_id", "name_key");
CREATE TABLE IF NOT EXISTS "GroceryShoppingSession" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "list_id" TEXT NOT NULL,
  "sections" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "last_tick_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "GroceryShoppingSession" ADD CONSTRAINT "GroceryShoppingSession_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "GroceryShoppingSession" ADD CONSTRAINT "GroceryShoppingSession_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "GroceryShoppingSession_family_id_last_tick_at_idx" ON "GroceryShoppingSession"("family_id", "last_tick_at");
CREATE INDEX IF NOT EXISTS "GroceryShoppingSession_list_id_last_tick_at_idx" ON "GroceryShoppingSession"("list_id", "last_tick_at");

-- ============ Household audit history (#285, PR101 D-4; additive) ============
-- New table only, no backfill. Deleted with the household (ON DELETE CASCADE);
-- a deleted member's rows keep their summary and lose the actor (SET NULL).
-- Kept 12 months, pruned when a parent reads it (no scheduled job). ADR-0008.
CREATE TABLE IF NOT EXISTS "AuditLog" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "actor_user_id" TEXT,
  "actor_kind" TEXT NOT NULL,
  "action" TEXT NOT NULL,
  "target_type" TEXT NOT NULL,
  "target_id" TEXT,
  "summary" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "AuditLog" ADD CONSTRAINT "AuditLog_actor_user_id_fkey" FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "AuditLog_family_id_created_at_idx" ON "AuditLog"("family_id", "created_at" DESC);

-- ============ Beta usage counts (#287, PR101 D-6; additive) ============
-- New table only, no backfill. One count per household, UTC day and fixed
-- metric name (src/lib/beta-metrics.ts); no user ids, text or content.
-- Deleted with the household (ON DELETE CASCADE) and when a parent turns the
-- counts off. Kept 13 months, pruned by the recorder (no scheduled job).
CREATE TABLE IF NOT EXISTS "BetaMetricDaily" (
  "family_id" TEXT NOT NULL,
  "day" DATE NOT NULL,
  "metric" TEXT NOT NULL,
  "count" INTEGER NOT NULL DEFAULT 0,
  CONSTRAINT "BetaMetricDaily_pkey" PRIMARY KEY ("family_id", "day", "metric")
);
DO $$ BEGIN
  ALTER TABLE "BetaMetricDaily" ADD CONSTRAINT "BetaMetricDaily_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
CREATE INDEX IF NOT EXISTS "BetaMetricDaily_day_idx" ON "BetaMetricDaily"("day");
`

async function migrate() {
  const databaseUrl = process.env.DATABASE_URL
  if (!databaseUrl) {
    console.error('DATABASE_URL not set, skipping migration')
    process.exit(0)
  }

  // Parse the DATABASE_URL to extract the target database name and server URL
  const url = new URL(databaseUrl)
  const targetDb = url.pathname.replace(/^\//, '') // e.g., 'familyplanner'

  // Whitelist the database name. CREATE DATABASE cannot be parameterized
  // (the pg library does not support DDL parameterization), so we MUST
  // validate the name before interpolating it into the SQL. Without this,
  // a compromised DATABASE_URL could inject arbitrary SQL in the database
  // name position.
  if (!/^[a-zA-Z0-9_]+$/.test(targetDb)) {
    throw new Error(
      `Invalid database name: '${targetDb}'. Database names must match /^[a-zA-Z0-9_]+$/.`
    )
  }

  // Step 1: Connect to the default 'postgres' database to create the target database if needed
  const serverUrl = new URL(databaseUrl)
  serverUrl.pathname = '/postgres'

  console.log(`Checking if database '${targetDb}' exists...`)
  const serverClient = new Client({ connectionString: serverUrl.toString() })

  let connected = false
  try {
    await serverClient.connect()
    connected = true
    const result = await serverClient.query(
      `SELECT 1 FROM pg_database WHERE datname = $1`,
      [targetDb]
    )

    if (result.rows.length === 0) {
      console.log(`Creating database '${targetDb}'...`)
      await serverClient.query(`CREATE DATABASE "${targetDb}"`)
      console.log(`Database '${targetDb}' created successfully`)
    } else {
      console.log(`Database '${targetDb}' already exists`)
    }
  } catch (error) {
    // If the 'postgres' maintenance db is unavailable (some managed hosts
    // rename it), MIGRATE_FALLBACK_DB names another db to connect through.
    // Without it we skip creation: the target db usually already exists and
    // the migrations below connect to it directly.
    const fallbackDb = process.env.MIGRATE_FALLBACK_DB?.trim()
    if (!fallbackDb) {
      console.warn(`Could not connect to the 'postgres' db to check '${targetDb}' (${error.message}); set MIGRATE_FALLBACK_DB to use another maintenance db. Continuing.`)
    } else {
      const fallbackUrl = new URL(databaseUrl)
      fallbackUrl.pathname = `/${fallbackDb}`
      console.log(`Failed to connect to 'postgres' db, trying '${fallbackDb}'...`)
      const fallbackClient = new Client({ connectionString: fallbackUrl.toString() })
      try {
        await fallbackClient.connect()
        const result = await fallbackClient.query(
          `SELECT 1 FROM pg_database WHERE datname = $1`,
          [targetDb]
        )
        if (result.rows.length === 0) {
          console.log(`Creating database '${targetDb}'...`)
          await fallbackClient.query(`CREATE DATABASE "${targetDb}"`)
          console.log(`Database '${targetDb}' created successfully`)
        } else {
          console.log(`Database '${targetDb}' already exists`)
        }
        await fallbackClient.end()
      } catch (err2) {
        console.error('Could not create database:', err2.message)
      }
    }
  } finally {
    if (connected) {
      try { await serverClient.end() } catch {}
    }
  }

  // Step 2: Connect to the target database and create/alter tables
  console.log('Running schema migration (idempotent)...')
  const dbClient = new Client({ connectionString: databaseUrl })

  try {
    await dbClient.connect()
    await dbClient.query(CREATE_TABLES_SQL)
    console.log('Schema migration completed successfully')

    // Step 3: Run every database/migration-*.sql file in alphabetical order.
    // These are per-feature migrations that were historically hand-run in
    // production. Loading them here means new columns / tables are picked
    // up automatically on every container start.
    //
    // Each file is expected to be idempotent (CREATE TABLE IF NOT EXISTS,
    // ADD COLUMN IF NOT EXISTS, etc.) so re-running is safe.
    const migrationsDir = path.join(__dirname, '..', 'database')
    if (fs.existsSync(migrationsDir)) {
      const files = fs
        .readdirSync(migrationsDir)
        .filter((f) => /^migration-.*\.sql$/.test(f))
        .sort()
      if (files.length > 0) {
        console.log(`Running ${files.length} per-feature migration file(s)...`)
        for (const file of files) {
          const filePath = path.join(migrationsDir, file)
          const sql = fs.readFileSync(filePath, 'utf8')
          await dbClient.query(sql)
          console.log(`  ✓ ${file}`)
        }
      }
    }

    // Step 4: changes to tables created by the per-feature files above.
    await dbClient.query(POST_FEATURE_SQL)
    console.log('Post-feature schema migration completed successfully')
  } catch (error) {
    console.error('Schema migration failed:', error.message)
    throw error
  } finally {
    await dbClient.end()
  }
}

migrate().catch((err) => {
  console.error('Migration script failed:', err)
  process.exit(1)
})
