-- Monetoni compatibility upgrades on canonical Prisma tables. Safe to rerun.
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "is_repeatable" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "List" ADD COLUMN IF NOT EXISTS "last_purchased_at" TIMESTAMP(3);
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "price" DOUBLE PRECISION;
ALTER TABLE "ListItem" ADD COLUMN IF NOT EXISTS "purchased" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "is_task" BOOLEAN NOT NULL DEFAULT FALSE;
ALTER TABLE "Event" ADD COLUMN IF NOT EXISTS "project_id" TEXT;
CREATE INDEX IF NOT EXISTS "Event_project_id_idx" ON "Event"("project_id");
CREATE INDEX IF NOT EXISTS "Transaction_family_id_idx" ON "Transaction"("family_id");
CREATE INDEX IF NOT EXISTS "Transaction_family_id_date_idx" ON "Transaction"("family_id", "date");
CREATE INDEX IF NOT EXISTS "BudgetCategory_family_id_idx" ON "BudgetCategory"("family_id");
CREATE INDEX IF NOT EXISTS "Project_family_id_idx" ON "Project"("family_id");
CREATE INDEX IF NOT EXISTS "ProjectTask_project_id_idx" ON "ProjectTask"("project_id");

-- Seed defaults only when a real parent can own them. Re-running is duplicate-safe.
INSERT INTO "BudgetCategory" ("id", "family_id", "name", "icon", "color", "type", "created_by")
SELECT md5(f.id || ':' || category.name), f.id, category.name, category.icon, category.color, category.type,
  (SELECT u.id FROM "User" u WHERE u.family_id = f.id AND u.role = 'parent' ORDER BY u.created_at LIMIT 1)
FROM "Family" f
CROSS JOIN (VALUES
  ('Groceries', '🛒', '#10B981', 'expense'), ('Dining Out', '🍽️', '#F59E0B', 'expense'),
  ('Transport', '🚗', '#3B82F6', 'expense'), ('Shopping', '🛍️', '#EC4899', 'expense'),
  ('Bills', '📄', '#8B5CF6', 'expense'), ('Entertainment', '🎮', '#F97316', 'expense'),
  ('Health', '💊', '#06B6D4', 'expense'), ('Salary', '💼', '#10B981', 'income'),
  ('Freelance', '💻', '#3B82F6', 'income'), ('Other Income', '💰', '#8B5CF6', 'income')
) AS category(name, icon, color, type)
WHERE EXISTS (SELECT 1 FROM "User" u WHERE u.family_id = f.id AND u.role = 'parent')
  AND NOT EXISTS (SELECT 1 FROM "BudgetCategory" existing WHERE existing.family_id = f.id AND existing.name = category.name);
