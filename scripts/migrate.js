// Database migration script
// 1. Connects to the PostgreSQL server
// 2. Creates the target database if it doesn't exist
// 3. Creates/updates tables to match the current Prisma schema
// 4. Runs any database/migration-*.sql files (sorted alphabetically, idempotent)
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
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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
  "created_by" TEXT NOT NULL
);

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
CREATE INDEX IF NOT EXISTS "RateLimitEntry_key_idx" ON "RateLimitEntry"("key");
CREATE INDEX IF NOT EXISTS "RateLimitEntry_resetAt_idx" ON "RateLimitEntry"("resetAt");

-- ============ Foreign keys (idempotent) ============
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;
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

CREATE INDEX IF NOT EXISTS "Event_family_id_idx" ON "Event"("family_id");
CREATE INDEX IF NOT EXISTS "Event_start_time_idx" ON "Event"("start_time");
CREATE INDEX IF NOT EXISTS "Event_family_id_start_time_idx" ON "Event"("family_id", "start_time");
CREATE INDEX IF NOT EXISTS "Event_project_id_idx" ON "Event"("project_id");

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
    // If connecting to 'postgres' db fails, try 'glowos' (for Coolify-managed databases)
    const fallbackUrl = new URL(databaseUrl)
    fallbackUrl.pathname = '/glowos'
    console.log(`Failed to connect to 'postgres' db, trying 'glowos'...`)
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
          try {
            await dbClient.query(sql)
            console.log(`  ✓ ${file}`)
          } catch (err) {
            // Don't crash the container on a single migration failure —
            // the bundled CREATE_TABLES_SQL above has already ensured the
            // base schema is in place. Log and continue so the app starts.
            console.error(`  ✗ ${file}: ${err.message}`)
          }
        }
      }
    }
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
