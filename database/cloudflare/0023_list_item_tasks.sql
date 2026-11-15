-- To-dos (#124 follow-up): who a list item is for and when it is due.
-- Additive and default-off: nothing reads or writes this table unless
-- FAMILY_LIST_TASKS_READY=1. A side table, so every existing ListItem read and
-- write is unchanged. At most one row per item; the owner is a household
-- account or an email-free profile of the same household, never both.
CREATE TABLE "ListItemTask" (
    "item_id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT,
    "member_id" TEXT,
    "due_day" TEXT CHECK ("due_day" IS NULL OR ("due_day" GLOB '[0-9][0-9][0-9][0-9]-[0-9][0-9]-[0-9][0-9]')),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "ListItemTask_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "ListItem" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ListItemTask_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ListItemTask_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ListItemTask_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ListItemTask_subject_check" CHECK ("user_id" IS NULL OR "member_id" IS NULL),
    CONSTRAINT "ListItemTask_content_check" CHECK ("user_id" IS NOT NULL OR "member_id" IS NOT NULL OR "due_day" IS NOT NULL)
);
CREATE INDEX "ListItemTask_family_id_idx" ON "ListItemTask"("family_id");
CREATE INDEX "ListItemTask_user_id_idx" ON "ListItemTask"("user_id");
CREATE INDEX "ListItemTask_member_id_family_id_idx" ON "ListItemTask"("member_id", "family_id");
-- The row's household must be the item's list's household, and an account
-- owner must be in it. Readers also join on the household.
CREATE TRIGGER "ListItemTask_household_insert" BEFORE INSERT ON "ListItemTask"
WHEN NOT EXISTS (SELECT 1 FROM "ListItem" i JOIN "List" l ON l.id=i.list_id WHERE i.id=NEW.item_id AND l.family_id=NEW.family_id)
  OR (NEW.user_id IS NOT NULL AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW.user_id AND family_id=NEW.family_id))
BEGIN SELECT RAISE(ABORT,'List item task is outside the household'); END;
CREATE TRIGGER "ListItemTask_household_update" BEFORE UPDATE ON "ListItemTask"
WHEN NEW.item_id IS NOT OLD.item_id OR NEW.family_id IS NOT OLD.family_id
  OR (NEW.user_id IS NOT NULL AND NEW.user_id IS NOT OLD.user_id AND NOT EXISTS (SELECT 1 FROM "User" WHERE id=NEW.user_id AND family_id=NEW.family_id))
BEGIN SELECT RAISE(ABORT,'List item task is outside the household'); END;
