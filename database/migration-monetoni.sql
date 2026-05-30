-- Migration: Monetoni-style modules — Budget, Projects, upgraded Lists/Calendar
-- Run on production PostgreSQL database at Coolify

-- Transaction model for budget tracking
CREATE TABLE IF NOT EXISTS "transactions" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_id" TEXT NOT NULL REFERENCES "families"("id") ON DELETE CASCADE,
  "user_id" TEXT NOT NULL REFERENCES "users"("id"),
  "amount" DOUBLE PRECISION NOT NULL,
  "type" TEXT NOT NULL CHECK ("type" IN ('income', 'expense')),
  "category_id" TEXT REFERENCES "budget_categories"("id") ON DELETE SET NULL,
  "description" TEXT,
  "notes" TEXT,
  "date" TIMESTAMP NOT NULL DEFAULT NOW(),
  "is_recurring" BOOLEAN NOT NULL DEFAULT FALSE,
  "recurring_interval" TEXT CHECK ("recurring_interval" IN ('weekly', 'biweekly', 'monthly')),
  "list_item_id" TEXT,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_transactions_family ON "transactions"("family_id");
CREATE INDEX IF NOT EXISTS idx_transactions_family_date ON "transactions"("family_id", "date");
CREATE INDEX IF NOT EXISTS idx_transactions_user ON "transactions"("user_id");
CREATE INDEX IF NOT EXISTS idx_transactions_category ON "transactions"("category_id");
CREATE INDEX IF NOT EXISTS idx_transactions_family_type ON "transactions"("family_id", "type");

-- Budget categories
CREATE TABLE IF NOT EXISTS "budget_categories" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_id" TEXT NOT NULL REFERENCES "families"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "icon" TEXT NOT NULL DEFAULT '📦',
  "color" TEXT NOT NULL DEFAULT '#6B7280',
  "type" TEXT NOT NULL DEFAULT 'expense' CHECK ("type" IN ('income', 'expense')),
  "budget_limit" DOUBLE PRECISION,
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_budget_categories_family ON "budget_categories"("family_id");
CREATE INDEX IF NOT EXISTS idx_budget_categories_family_type ON "budget_categories"("family_id", "type");

-- Projects
CREATE TABLE IF NOT EXISTS "projects" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "family_id" TEXT NOT NULL REFERENCES "families"("id") ON DELETE CASCADE,
  "name" TEXT NOT NULL,
  "description" TEXT,
  "status" TEXT NOT NULL DEFAULT 'active' CHECK ("status" IN ('active', 'completed', 'archived')),
  "color" TEXT NOT NULL DEFAULT '#3B82F6',
  "created_by" TEXT NOT NULL REFERENCES "users"("id"),
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_projects_family ON "projects"("family_id");
CREATE INDEX IF NOT EXISTS idx_projects_family_status ON "projects"("family_id", "status");

-- Project tasks
CREATE TABLE IF NOT EXISTS "project_tasks" (
  "id" TEXT PRIMARY KEY DEFAULT gen_random_uuid(),
  "project_id" TEXT NOT NULL REFERENCES "projects"("id") ON DELETE CASCADE,
  "title" TEXT NOT NULL,
  "description" TEXT,
  "completed" BOOLEAN NOT NULL DEFAULT FALSE,
  "assigned_to" TEXT REFERENCES "users"("id"),
  "due_date" TIMESTAMP,
  "position" INTEGER NOT NULL DEFAULT 0,
  "created_at" TIMESTAMP NOT NULL DEFAULT NOW(),
  "updated_at" TIMESTAMP NOT NULL DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_project_tasks_project ON "project_tasks"("project_id");
CREATE INDEX IF NOT EXISTS idx_project_tasks_assigned ON "project_tasks"("assigned_to");

-- Upgrades to existing tables

-- Lists: add is_repeatable and last_purchased_at
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "is_repeatable" BOOLEAN DEFAULT FALSE;
ALTER TABLE "lists" ADD COLUMN IF NOT EXISTS "last_purchased_at" TIMESTAMP;

-- List items: add price and purchased
ALTER TABLE "list_items" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
ALTER TABLE "list_items" ADD COLUMN IF NOT EXISTS "purchased" BOOLEAN DEFAULT FALSE;

-- Events: add is_task and project_id
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "is_task" BOOLEAN DEFAULT FALSE;
ALTER TABLE "events" ADD COLUMN IF NOT EXISTS "project_id" TEXT REFERENCES "projects"("id") ON DELETE SET NULL;
CREATE INDEX IF NOT EXISTS idx_events_project ON "events"("project_id");

-- Default budget categories for existing families
INSERT INTO "budget_categories" ("family_id", "name", "icon", "color", "type", "created_by")
SELECT f.id, cat.name, cat.icon, cat.color, cat.type, f.id
FROM "families" f
CROSS JOIN (
  VALUES 
    ('Groceries', '🛒', '#10B981', 'expense'),
    ('Dining Out', '🍽️', '#F59E0B', 'expense'),
    ('Transport', '🚗', '#3B82F6', 'expense'),
    ('Shopping', '🛍️', '#EC4899', 'expense'),
    ('Bills', '📄', '#8B5CF6', 'expense'),
    ('Entertainment', '🎮', '#F97316', 'expense'),
    ('Health', '💊', '#06B6D4', 'expense'),
    ('Salary', '💼', '#10B981', 'income'),
    ('Freelance', '💻', '#3B82F6', 'income'),
    ('Other Income', '💰', '#8B5CF6', 'income')
) AS cat(name, icon, color, type)
WHERE NOT EXISTS (
  SELECT 1 FROM "budget_categories" WHERE "budget_categories"."family_id" = f.id AND "budget_categories"."name" = cat.name
);
