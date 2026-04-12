// Database migration script
// 1. Connects to the PostgreSQL server
// 2. Creates the target database if it doesn't exist
// 3. Creates tables and indexes if they don't exist
// Called from docker-entrypoint.sh before starting the server

const { Client } = require('pg')

const CREATE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS "Family" (
  "id" TEXT PRIMARY KEY,
  "name" TEXT NOT NULL,
  "invite_code" TEXT UNIQUE NOT NULL,
  "subscription_tier" TEXT NOT NULL DEFAULT 'free',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "User" (
  "id" TEXT PRIMARY KEY,
  "email" TEXT UNIQUE NOT NULL,
  "password" TEXT,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'parent',
  "age" INTEGER,
  "family_id" TEXT,
  "avatar_url" TEXT,
  "points" INTEGER NOT NULL DEFAULT 0,
  "level" INTEGER NOT NULL DEFAULT 1,
  "xp" INTEGER NOT NULL DEFAULT 0,
  "streak" INTEGER NOT NULL DEFAULT 0,
  "best_streak" INTEGER NOT NULL DEFAULT 0,
  "last_chore_date" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS "Event" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "start_time" TIMESTAMP(3) NOT NULL,
  "end_time" TIMESTAMP(3) NOT NULL,
  "location" TEXT,
  "event_type" TEXT NOT NULL DEFAULT 'other',
  "recurrence" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Message" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "sender_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'text',
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "Reward" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "point_cost" INTEGER NOT NULL,
  "icon" TEXT NOT NULL DEFAULT 'gift',
  "claimed_by" TEXT,
  "claimed_at" TIMESTAMP(3),
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

CREATE TABLE IF NOT EXISTS "List" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "type" TEXT NOT NULL DEFAULT 'grocery',
  "description" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "ListItem" (
  "id" TEXT PRIMARY KEY,
  "list_id" TEXT NOT NULL,
  "content" TEXT NOT NULL,
  "checked" BOOLEAN NOT NULL DEFAULT false,
  "quantity" INTEGER NOT NULL DEFAULT 1,
  "category" TEXT,
  "notes" TEXT,
  "added_by" TEXT NOT NULL,
  "checked_by" TEXT,
  "checked_at" TIMESTAMP(3),
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS "UserBadge" (
  "id" TEXT PRIMARY KEY,
  "user_id" TEXT NOT NULL,
  "badge_id" TEXT NOT NULL,
  "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

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

-- Foreign keys
DO $$ BEGIN
  ALTER TABLE "User" ADD CONSTRAINT "User_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Chore" ADD CONSTRAINT "Chore_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Event" ADD CONSTRAINT "Event_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Reward" ADD CONSTRAINT "Reward_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Reward" ADD CONSTRAINT "Reward_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Notification" ADD CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "List" ADD CONSTRAINT "List_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "List" ADD CONSTRAINT "List_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "List"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "ListItem" ADD CONSTRAINT "ListItem_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

DO $$ BEGIN
  ALTER TABLE "Activity" ADD CONSTRAINT "Activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "User_family_id_idx" ON "User"("family_id");
CREATE INDEX IF NOT EXISTS "Chore_family_id_idx" ON "Chore"("family_id");
CREATE INDEX IF NOT EXISTS "Chore_assigned_to_idx" ON "Chore"("assigned_to");
CREATE INDEX IF NOT EXISTS "Chore_status_idx" ON "Chore"("status");
CREATE INDEX IF NOT EXISTS "Chore_due_date_idx" ON "Chore"("due_date");
CREATE INDEX IF NOT EXISTS "Chore_family_id_status_idx" ON "Chore"("family_id", "status");
CREATE INDEX IF NOT EXISTS "Chore_family_id_assigned_to_idx" ON "Chore"("family_id", "assigned_to");
CREATE INDEX IF NOT EXISTS "Event_family_id_idx" ON "Event"("family_id");
CREATE INDEX IF NOT EXISTS "Event_start_time_idx" ON "Event"("start_time");
CREATE INDEX IF NOT EXISTS "Event_family_id_start_time_idx" ON "Event"("family_id", "start_time");
CREATE INDEX IF NOT EXISTS "Message_family_id_idx" ON "Message"("family_id");
CREATE INDEX IF NOT EXISTS "Message_sender_id_idx" ON "Message"("sender_id");
CREATE INDEX IF NOT EXISTS "Message_created_at_idx" ON "Message"("created_at");
CREATE INDEX IF NOT EXISTS "Message_family_id_created_at_idx" ON "Message"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "Reward_family_id_idx" ON "Reward"("family_id");
CREATE INDEX IF NOT EXISTS "Reward_claimed_by_idx" ON "Reward"("claimed_by");
CREATE INDEX IF NOT EXISTS "Reward_family_id_claimed_by_idx" ON "Reward"("family_id", "claimed_by");
CREATE INDEX IF NOT EXISTS "Notification_user_id_idx" ON "Notification"("user_id");
CREATE INDEX IF NOT EXISTS "Notification_read_idx" ON "Notification"("read");
CREATE INDEX IF NOT EXISTS "Notification_created_at_idx" ON "Notification"("created_at");
CREATE INDEX IF NOT EXISTS "Notification_user_id_read_idx" ON "Notification"("user_id", "read");
CREATE INDEX IF NOT EXISTS "List_family_id_idx" ON "List"("family_id");
CREATE INDEX IF NOT EXISTS "List_family_id_type_idx" ON "List"("family_id", "type");
CREATE INDEX IF NOT EXISTS "ListItem_list_id_idx" ON "ListItem"("list_id");
CREATE INDEX IF NOT EXISTS "ListItem_list_id_checked_idx" ON "ListItem"("list_id", "checked");
CREATE INDEX IF NOT EXISTS "UserBadge_user_id_idx" ON "UserBadge"("user_id");
CREATE INDEX IF NOT EXISTS "Activity_family_id_idx" ON "Activity"("family_id");
CREATE INDEX IF NOT EXISTS "Activity_family_id_created_at_idx" ON "Activity"("family_id", "created_at");
CREATE INDEX IF NOT EXISTS "Activity_user_id_idx" ON "Activity"("user_id");

-- Unique constraint for UserBadge
DO $$ BEGIN
  ALTER TABLE "UserBadge" ADD CONSTRAINT "UserBadge_user_id_badge_id_key" UNIQUE ("user_id", "badge_id");
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
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

  // Step 1: Connect to the default 'postgres' database to create the target database if needed
  const serverUrl = new URL(databaseUrl)
  serverUrl.pathname = '/postgres'

  console.log(`Checking if database '${targetDb}' exists...`)
  const serverClient = new Client({ connectionString: serverUrl.toString() })

  try {
    await serverClient.connect()
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
    try { await serverClient.end() } catch {}
  }

  // Step 2: Connect to the target database and create tables
  console.log('Creating tables...')
  const dbClient = new Client({ connectionString: databaseUrl })

  try {
    await dbClient.connect()
    await dbClient.query(CREATE_TABLES_SQL)
    console.log('Database migration completed successfully')
  } catch (error) {
    console.error('Database migration failed:', error.message)
  } finally {
    await dbClient.end()
  }
}

migrate()