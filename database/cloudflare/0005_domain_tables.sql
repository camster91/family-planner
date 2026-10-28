-- Fresh D1 domain-table foundation (#604), derived from the canonical Prisma
-- model/relationship definitions and reviewed as explicit SQLite SQL.
-- Canonical schema SHA-256: 50f23af0af23ca259cfbb57e0336ed59f499741f8eb0407393a8f7c7be716a6a
-- Dates use integer Unix milliseconds, booleans 0/1, JSON/arrays JSON TEXT.
-- Existing identity/device tables, stronger constraints and indexes are retained.
-- This is schema foundation only: legacy PostgreSQL CHECK/trigger invariants
-- require their explicit D1 guard migration before feature writers/cutover.
-- Ignored food_generation/food_epoch columns are intentionally omitted until
-- their version triggers can be installed together (scripts/migrate.js contract).
-- No production binding or data import is enabled by this migration.
PRAGMA foreign_keys = ON;

CREATE TABLE "Upload" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Upload_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Upload_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CalendarSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "url_enc" TEXT NOT NULL,
    "color" TEXT,
    "last_fetched_at" INTEGER CHECK ("last_fetched_at" IS NULL OR typeof("last_fetched_at")='integer'),
    "last_status" TEXT NOT NULL DEFAULT 'pending',
    "last_error" TEXT,
    "etag" TEXT,
    "last_modified" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "CalendarSubscription_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarSubscription_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CalendarConnection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "calendar_id" TEXT,
    "calendar_name" TEXT,
    "access_token_enc" TEXT,
    "refresh_token_enc" TEXT,
    "token_expires_at" INTEGER CHECK ("token_expires_at" IS NULL OR typeof("token_expires_at")='integer'),
    "sync_cursor" TEXT,
    "push_mode" TEXT NOT NULL DEFAULT 'linked',
    "generation" INTEGER NOT NULL DEFAULT 0,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "last_synced_at" INTEGER CHECK ("last_synced_at" IS NULL OR typeof("last_synced_at")='integer'),
    "last_error" TEXT,
    "conflicts_count" INTEGER NOT NULL DEFAULT 0,
    "last_conflict_at" INTEGER CHECK ("last_conflict_at" IS NULL OR typeof("last_conflict_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "CalendarConnection_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarConnection_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "CalendarEventLink" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "connection_id" TEXT NOT NULL,
    "event_id" TEXT,
    "external_id" TEXT NOT NULL,
    "external_etag" TEXT,
    "external_updated_at" INTEGER CHECK ("external_updated_at" IS NULL OR typeof("external_updated_at")='integer'),
    "synced_hash" TEXT,
    "all_day" INTEGER NOT NULL DEFAULT 0 CHECK ("all_day" IS NULL OR "all_day" IN (0,1)),
    "synced_at" INTEGER CHECK ("synced_at" IS NULL OR typeof("synced_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "CalendarEventLink_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEventLink_connection_id_fkey" FOREIGN KEY ("connection_id") REFERENCES "CalendarConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarEventLink_event_id_fkey" FOREIGN KEY ("event_id") REFERENCES "Event" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "CalendarOAuthState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "state_hash" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "code_verifier_enc" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL CHECK ("expires_at" IS NULL OR typeof("expires_at")='integer'),
    "used_at" INTEGER CHECK ("used_at" IS NULL OR typeof("used_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "CalendarOAuthState_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "CalendarOAuthState_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Chore" (
    "preparation_epoch" INTEGER NOT NULL DEFAULT 0,
    "responsibility_generation" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "responsibility_epoch" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "points" INTEGER NOT NULL DEFAULT 10,
    "assigned_to" TEXT,
    "assigned_member_id" TEXT,
    "member_subject_erased" INTEGER NOT NULL DEFAULT 0 CHECK ("member_subject_erased" IS NULL OR "member_subject_erased" IN (0,1)),
    "due_date" INTEGER NOT NULL CHECK ("due_date" IS NULL OR typeof("due_date")='integer'),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "frequency" TEXT NOT NULL DEFAULT 'once',
    "difficulty" TEXT NOT NULL DEFAULT 'medium',
    "photo_url" TEXT,
    "photo_verified" INTEGER NOT NULL DEFAULT 0 CHECK ("photo_verified" IS NULL OR "photo_verified" IN (0,1)),
    "verified_at" INTEGER CHECK ("verified_at" IS NULL OR typeof("verified_at")='integer'),
    "verified_notes" TEXT,
    "completed_at" INTEGER CHECK ("completed_at" IS NULL OR typeof("completed_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "created_by" TEXT NOT NULL,
    "recurrence_id" TEXT,
    "is_template" INTEGER NOT NULL DEFAULT 0 CHECK ("is_template" IS NULL OR "is_template" IN (0,1)),
    "successor_id" TEXT,
    "icon" TEXT,
    "routine" TEXT,
    "routine_order" INTEGER,
    "routine_stack_id" TEXT,
    "routine_anchor" TEXT,
    "routine_duration_minutes" INTEGER,
    "routine_series_config" TEXT CHECK ("routine_series_config" IS NULL OR json_valid("routine_series_config")),
    "rotation_member_ids" TEXT NOT NULL DEFAULT '[]' CHECK ("rotation_member_ids" IS NULL OR json_valid("rotation_member_ids")),
    "rotation_index" INTEGER,
    "weekly_days" TEXT NOT NULL DEFAULT '[]' CHECK ("weekly_days" IS NULL OR json_valid("weekly_days")),
    CONSTRAINT "Chore_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chore_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chore_assigned_member_id_family_id_fkey" FOREIGN KEY ("assigned_member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "Chore_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Chore_routine_stack_id_family_id_fkey" FOREIGN KEY ("routine_stack_id", "family_id") REFERENCES "RoutineStack" ("id", "family_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "RoutineStack" (
    "schedule_config" TEXT CHECK ("schedule_config" IS NULL OR json_valid("schedule_config")),
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "fingerprint" TEXT NOT NULL,
    "created_by" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "RoutineStack_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RoutineStack_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ChoreAssignment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "chore_id" TEXT NOT NULL,
    "assigned_to" TEXT NOT NULL,
    "assigned_member_id" TEXT,
    "member_subject_erased" INTEGER NOT NULL DEFAULT 0 CHECK ("member_subject_erased" IS NULL OR "member_subject_erased" IN (0,1)),
    "due_date" INTEGER NOT NULL CHECK ("due_date" IS NULL OR typeof("due_date")='integer'),
    "status" TEXT NOT NULL DEFAULT 'pending',
    "photo_url" TEXT,
    "completed_at" INTEGER CHECK ("completed_at" IS NULL OR typeof("completed_at")='integer'),
    "completed_by" TEXT,
    "approved_at" INTEGER CHECK ("approved_at" IS NULL OR typeof("approved_at")='integer'),
    "approved_by" TEXT,
    "approval_notes" TEXT,
    "xp_awarded" INTEGER NOT NULL DEFAULT 0,
    "idempotency_key" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "ChoreAssignment_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChoreAssignment_chore_id_fkey" FOREIGN KEY ("chore_id") REFERENCES "Chore" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChoreAssignment_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ChoreAssignment_assigned_member_id_family_id_fkey" FOREIGN KEY ("assigned_member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "ChoreAssignment_completed_by_fkey" FOREIGN KEY ("completed_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ChoreAssignment_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "ImportJob" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "source_app" TEXT NOT NULL,
    "source_version" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "dry_run" INTEGER NOT NULL DEFAULT 1 CHECK ("dry_run" IS NULL OR "dry_run" IN (0,1)),
    "started_by" TEXT NOT NULL,
    "started_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("started_at" IS NULL OR typeof("started_at")='integer'),
    "completed_at" INTEGER CHECK ("completed_at" IS NULL OR typeof("completed_at")='integer'),
    "summary" TEXT CHECK ("summary" IS NULL OR json_valid("summary")),
    "error" TEXT,
    CONSTRAINT "ImportJob_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportJob_started_by_fkey" FOREIGN KEY ("started_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ImportedRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "import_job_id" TEXT NOT NULL,
    "source_app" TEXT NOT NULL,
    "source_model" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "target_model" TEXT NOT NULL,
    "target_id" TEXT NOT NULL,
    "checksum" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "ImportedRecord_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ImportedRecord_import_job_id_fkey" FOREIGN KEY ("import_job_id") REFERENCES "ImportJob" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Recipe" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "instructions" TEXT,
    "prep_time" INTEGER,
    "cook_time" INTEGER,
    "servings" INTEGER NOT NULL DEFAULT 2,
    "image_url" TEXT,
    "source_url" TEXT,
    "source_key" TEXT,
    "favorite" INTEGER NOT NULL DEFAULT 0 CHECK ("favorite" IS NULL OR "favorite" IN (0,1)),
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Recipe_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Recipe_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "RecipeCollection" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "RecipeCollection_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "RecipeCollectionEntry" (
    "recipe_id" TEXT NOT NULL,
    "collection_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,

    PRIMARY KEY ("recipe_id", "collection_id"),
    CONSTRAINT "RecipeCollectionEntry_recipe_id_family_id_fkey" FOREIGN KEY ("recipe_id", "family_id") REFERENCES "Recipe" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "RecipeCollectionEntry_collection_id_family_id_fkey" FOREIGN KEY ("collection_id", "family_id") REFERENCES "RecipeCollection" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "Ingredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "unit" TEXT,
    "section" TEXT,
    CONSTRAINT "Ingredient_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RecipeIngredient" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "recipe_id" TEXT NOT NULL,
    "ingredient_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "unit" TEXT,
    "note" TEXT,
    CONSTRAINT "RecipeIngredient_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RecipeIngredient_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "MealPlan" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "start_date" INTEGER NOT NULL CHECK ("start_date" IS NULL OR typeof("start_date")='integer'),
    "end_date" INTEGER NOT NULL CHECK ("end_date" IS NULL OR typeof("end_date")='integer'),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "MealPlan_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlan_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "MealPlanEntry" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "meal_plan_id" TEXT NOT NULL,
    "recipe_id" TEXT NOT NULL,
    "date" INTEGER NOT NULL CHECK ("date" IS NULL OR typeof("date")='integer'),
    "meal_type" TEXT NOT NULL,
    "servings" INTEGER NOT NULL DEFAULT 2,
    CONSTRAINT "MealPlanEntry_meal_plan_id_fkey" FOREIGN KEY ("meal_plan_id") REFERENCES "MealPlan" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPlanEntry_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ShoppingList" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL DEFAULT 'Shopping List',
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "ShoppingList_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ShoppingList_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "ShoppingItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "shopping_list_id" TEXT NOT NULL,
    "ingredient_name" TEXT NOT NULL,
    "amount" REAL,
    "unit" TEXT,
    "category" TEXT,
    "checked" INTEGER NOT NULL DEFAULT 0 CHECK ("checked" IS NULL OR "checked" IN (0,1)),
    "recipe_id" TEXT,
    CONSTRAINT "ShoppingItem_shopping_list_id_fkey" FOREIGN KEY ("shopping_list_id") REFERENCES "ShoppingList" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FinancialArchiveRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "source_app" TEXT NOT NULL,
    "source_model" TEXT NOT NULL,
    "source_id" TEXT NOT NULL,
    "payload" TEXT NOT NULL CHECK ("payload" IS NULL OR json_valid("payload")),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "FinancialArchiveRecord_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Habit" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "icon" TEXT,
    "points" INTEGER NOT NULL DEFAULT 5,
    "is_active" INTEGER NOT NULL DEFAULT 1 CHECK ("is_active" IS NULL OR "is_active" IN (0,1)),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Habit_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Habit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "HabitLog" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "habit_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "logged_date" INTEGER NOT NULL CHECK ("logged_date" IS NULL OR typeof("logged_date")='integer'),
    "logged_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("logged_at" IS NULL OR typeof("logged_at")='integer'),
    "points_awarded" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "HabitLog_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HabitLog_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "Habit" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "HabitLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "BadgeDefinition" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL,
    "icon" TEXT NOT NULL,
    "requirement" TEXT NOT NULL CHECK ("requirement" IS NULL OR json_valid("requirement")),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "BadgeDefinition_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "EarnedBadge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "badge_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "earned_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("earned_at" IS NULL OR typeof("earned_at")='integer'),
    CONSTRAINT "EarnedBadge_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EarnedBadge_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "BadgeDefinition" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "EarnedBadge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "RewardRedemption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "reward_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "points" INTEGER NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'requested',
    "requested_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("requested_at" IS NULL OR typeof("requested_at")='integer'),
    "approved_by" TEXT,
    "approved_at" INTEGER CHECK ("approved_at" IS NULL OR typeof("approved_at")='integer'),
    "fulfilled_at" INTEGER CHECK ("fulfilled_at" IS NULL OR typeof("fulfilled_at")='integer'),
    "notes" TEXT,
    CONSTRAINT "RewardRedemption_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "Reward" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "RewardRedemption_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FamilyGoal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "target_points" INTEGER NOT NULL,
    "current_points" INTEGER NOT NULL DEFAULT 0,
    "reward" TEXT,
    "is_active" INTEGER NOT NULL DEFAULT 1 CHECK ("is_active" IS NULL OR "is_active" IN (0,1)),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "FamilyGoal_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "FamilyGoal_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "PushSubscription" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "endpoint" TEXT NOT NULL,
    "keys" TEXT NOT NULL CHECK ("keys" IS NULL OR json_valid("keys")),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "PushSubscription_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "PushSubscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Event" (
    "preparation_epoch" INTEGER NOT NULL DEFAULT 0,
    "schedule_generation" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "schedule_epoch" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "start_time" INTEGER NOT NULL CHECK ("start_time" IS NULL OR typeof("start_time")='integer'),
    "end_time" INTEGER NOT NULL CHECK ("end_time" IS NULL OR typeof("end_time")='integer'),
    "location" TEXT,
    "event_type" TEXT NOT NULL DEFAULT 'other',
    "is_task" INTEGER NOT NULL DEFAULT 0 CHECK ("is_task" IS NULL OR "is_task" IN (0,1)),
    "project_id" TEXT,
    "recurrence" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "source_subscription_id" TEXT,
    "source_uid" TEXT,
    "source_occurrence_start" INTEGER CHECK ("source_occurrence_start" IS NULL OR typeof("source_occurrence_start")='integer'),
    "source_connection_id" TEXT,
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Event_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Event_source_subscription_id_fkey" FOREIGN KEY ("source_subscription_id") REFERENCES "CalendarSubscription" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Event_source_connection_id_fkey" FOREIGN KEY ("source_connection_id") REFERENCES "CalendarConnection" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Message" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "sender_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'text',
    "attachments" TEXT NOT NULL DEFAULT '[]' CHECK ("attachments" IS NULL OR json_valid("attachments")),
    "read_by" TEXT NOT NULL DEFAULT '[]' CHECK ("read_by" IS NULL OR json_valid("read_by")),
    "pickup_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Message_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_sender_id_fkey" FOREIGN KEY ("sender_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Message_pickup_id_fkey" FOREIGN KEY ("pickup_id") REFERENCES "Pickup" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "MessageAttachment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "uploaded_by" TEXT,
    "message_id" TEXT,
    "filename" TEXT NOT NULL,
    "content_type" TEXT NOT NULL,
    "size_bytes" INTEGER NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "MessageAttachment_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MessageAttachment_uploaded_by_fkey" FOREIGN KEY ("uploaded_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MessageAttachment_message_id_fkey" FOREIGN KEY ("message_id") REFERENCES "Message" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Notification" (
    "snoozed_until" INTEGER CHECK ("snoozed_until" IS NULL OR typeof("snoozed_until")='integer'),
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "read" INTEGER NOT NULL DEFAULT 0 CHECK ("read" IS NULL OR "read" IN (0,1)),
    "action_url" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Notification_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "List" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL DEFAULT 'grocery',
    "description" TEXT,
    "image_url" TEXT,
    "is_repeatable" INTEGER NOT NULL DEFAULT 0 CHECK ("is_repeatable" IS NULL OR "is_repeatable" IN (0,1)),
    "last_purchased_at" INTEGER CHECK ("last_purchased_at" IS NULL OR typeof("last_purchased_at")='integer'),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    "sort_by_section" INTEGER NOT NULL DEFAULT 1 CHECK ("sort_by_section" IS NULL OR "sort_by_section" IN (0,1)),
    CONSTRAINT "List_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "List_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ListItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "list_id" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "checked" INTEGER NOT NULL DEFAULT 0 CHECK ("checked" IS NULL OR "checked" IN (0,1)),
    "quantity" INTEGER NOT NULL DEFAULT 1,
    "price" REAL,
    "purchased" INTEGER NOT NULL DEFAULT 0 CHECK ("purchased" IS NULL OR "purchased" IN (0,1)),
    "category" TEXT,
    "notes" TEXT,
    "added_by" TEXT NOT NULL,
    "checked_by" TEXT,
    "checked_at" INTEGER CHECK ("checked_at" IS NULL OR typeof("checked_at")='integer'),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    "ingredient_id" TEXT,
    "recipe_id" TEXT,
    "meal_id" TEXT,
    "amount" REAL,
    "unit" TEXT,
    "source" TEXT NOT NULL DEFAULT 'manual',
    "source_key" TEXT,
    "source_request_id" TEXT,
    CONSTRAINT "ListItem_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "List" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ListItem_checked_by_fkey" FOREIGN KEY ("checked_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ListItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ListItem_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "ListItem_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "FamilyMeal" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Activity" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "subject_member_id" TEXT,
    "subject_member_erased" INTEGER NOT NULL DEFAULT 0 CHECK ("subject_member_erased" IS NULL OR "subject_member_erased" IN (0,1)),
    "type" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "metadata" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Activity_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Activity_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Activity_subject_member_id_family_id_fkey" FOREIGN KEY ("subject_member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "Reward" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "notification_generation" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "notification_claim_id" TEXT,
    "notification_approval_id" TEXT,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "cost" INTEGER NOT NULL DEFAULT 10,
    "icon" TEXT NOT NULL DEFAULT 'gift',
    "status" TEXT NOT NULL DEFAULT 'available',
    "is_active" INTEGER NOT NULL DEFAULT 1 CHECK ("is_active" IS NULL OR "is_active" IN (0,1)),
    "created_by" TEXT NOT NULL,
    "claimed_by" TEXT,
    "claimed_at" INTEGER CHECK ("claimed_at" IS NULL OR typeof("claimed_at")='integer'),
    "approved" INTEGER NOT NULL DEFAULT 0 CHECK ("approved" IS NULL OR "approved" IN (0,1)),
    "approved_by" TEXT,
    "approved_at" INTEGER CHECK ("approved_at" IS NULL OR typeof("approved_at")='integer'),
    "redeemed_at" INTEGER CHECK ("redeemed_at" IS NULL OR typeof("redeemed_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Reward_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reward_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Reward_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Reward_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "Transaction" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "type" TEXT NOT NULL,
    "category_id" TEXT,
    "description" TEXT,
    "notes" TEXT,
    "date" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("date" IS NULL OR typeof("date")='integer'),
    "is_recurring" INTEGER NOT NULL DEFAULT 0 CHECK ("is_recurring" IS NULL OR "is_recurring" IN (0,1)),
    "recurring_interval" TEXT,
    "list_item_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    "import_metadata" TEXT CHECK ("import_metadata" IS NULL OR json_valid("import_metadata")),
    CONSTRAINT "Transaction_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Transaction_category_id_fkey" FOREIGN KEY ("category_id") REFERENCES "BudgetCategory" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "BudgetCategory" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "icon" TEXT NOT NULL DEFAULT '📦',
    "color" TEXT NOT NULL DEFAULT '#6B7280',
    "type" TEXT NOT NULL DEFAULT 'expense',
    "budget_limit" REAL,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "import_metadata" TEXT CHECK ("import_metadata" IS NULL OR json_valid("import_metadata")),
    CONSTRAINT "BudgetCategory_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "BudgetCategory_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "Project" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "status" TEXT NOT NULL DEFAULT 'active',
    "color" TEXT NOT NULL DEFAULT '#3B82F6',
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Project_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Project_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "ProjectTask" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "project_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "description" TEXT,
    "completed" INTEGER NOT NULL DEFAULT 0 CHECK ("completed" IS NULL OR "completed" IN (0,1)),
    "assigned_to" TEXT,
    "due_date" INTEGER CHECK ("due_date" IS NULL OR typeof("due_date")='integer'),
    "position" INTEGER NOT NULL DEFAULT 0,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "ProjectTask_project_id_fkey" FOREIGN KEY ("project_id") REFERENCES "Project" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "ProjectTask_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MealPrepSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "prepared_on" INTEGER NOT NULL CHECK ("prepared_on" IS NULL OR typeof("prepared_on")='integer'),
    "next_prep_on" INTEGER CHECK ("next_prep_on" IS NULL OR typeof("next_prep_on")='integer'),
    "prepared_at" INTEGER CHECK ("prepared_at" IS NULL OR typeof("prepared_at")='integer'),
    "created_by" TEXT,
    "source_request_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "MealPrepSession_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealPrepSession_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MealBatch" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "prep_session_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "name" TEXT NOT NULL,
    "total_servings" INTEGER NOT NULL,
    "reserve_storage" TEXT NOT NULL DEFAULT 'freezer',
    "recipe_id" TEXT,
    "recipe_snapshot" TEXT CHECK ("recipe_snapshot" IS NULL OR json_valid("recipe_snapshot")),
    "recipe_snapshot_at" INTEGER CHECK ("recipe_snapshot_at" IS NULL OR typeof("recipe_snapshot_at")='integer'),
    "cook_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "MealBatch_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealBatch_prep_session_id_fkey" FOREIGN KEY ("prep_session_id") REFERENCES "MealPrepSession" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealBatch_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MealBatch_cook_id_fkey" FOREIGN KEY ("cook_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "MealBatchConsumption" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "batch_id" TEXT NOT NULL,
    "allocation_key" TEXT,
    "meal_id" TEXT,
    "servings" INTEGER NOT NULL,
    "created_by" TEXT,
    "consumed_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("consumed_at" IS NULL OR typeof("consumed_at")='integer'),
    "cancelled_at" INTEGER CHECK ("cancelled_at" IS NULL OR typeof("cancelled_at")='integer'),
    "source_request_id" TEXT,
    CONSTRAINT "MealBatchConsumption_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealBatchConsumption_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "MealBatch" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "MealBatchConsumption_meal_id_fkey" FOREIGN KEY ("meal_id") REFERENCES "FamilyMeal" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "MealBatchConsumption_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FamilyMeal" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "date" INTEGER NOT NULL CHECK ("date" IS NULL OR typeof("date")='integer'),
    "meal_type" TEXT NOT NULL,
    "recipe_name" TEXT,
    "notes" TEXT,
    "cook_id" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "recipe_id" TEXT,
    "batch_id" TEXT,
    "batch_allocation_key" TEXT,
    "servings" INTEGER,
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "FamilyMeal_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "FamilyMeal_cook_id_fkey" FOREIGN KEY ("cook_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "FamilyMeal_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION,
    CONSTRAINT "FamilyMeal_recipe_id_fkey" FOREIGN KEY ("recipe_id") REFERENCES "Recipe" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "FamilyMeal_batch_id_fkey" FOREIGN KEY ("batch_id") REFERENCES "MealBatch" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "PinnedNote" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "color" TEXT NOT NULL DEFAULT 'yellow',
    "pinned" INTEGER NOT NULL DEFAULT 1 CHECK ("pinned" IS NULL OR "pinned" IN (0,1)),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "PinnedNote_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "PinnedNote_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "Anniversary" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "date" INTEGER NOT NULL CHECK ("date" IS NULL OR typeof("date")='integer'),
    "notes" TEXT,
    "person_id" TEXT,
    "created_by" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "Anniversary_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "Anniversary_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "Anniversary_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "FamilyLocation" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "address" TEXT,
    "latitude" REAL,
    "longitude" REAL,
    "is_primary" INTEGER NOT NULL DEFAULT 0 CHECK ("is_primary" IS NULL OR "is_primary" IN (0,1)),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "FamilyLocation_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "FamilyLocation_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "EmergencyContact" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "person_id" TEXT,
    "person_name" TEXT NOT NULL,
    "relationship" TEXT NOT NULL,
    "blood_type" TEXT,
    "allergies" TEXT,
    "medications" TEXT,
    "medical_conditions" TEXT,
    "doctor_name" TEXT,
    "doctor_phone" TEXT,
    "dentist_name" TEXT,
    "dentist_phone" TEXT,
    "insurance_provider" TEXT,
    "insurance_id" TEXT,
    "emergency_contact_name" TEXT,
    "emergency_contact_phone" TEXT,
    "emergency_contact_relation" TEXT,
    "notes" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "EmergencyContact_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EmergencyContact_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "Pickup" (
    "responsibility_generation" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "responsibility_epoch" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "location" TEXT,
    "pickup_time" INTEGER NOT NULL CHECK ("pickup_time" IS NULL OR typeof("pickup_time")='integer'),
    "assigned_to" TEXT,
    "created_by" TEXT NOT NULL,
    "notes" TEXT,
    "completed" INTEGER NOT NULL DEFAULT 0 CHECK ("completed" IS NULL OR "completed" IN (0,1)),
    "completed_at" INTEGER CHECK ("completed_at" IS NULL OR typeof("completed_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Pickup_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "Pickup_assigned_to_fkey" FOREIGN KEY ("assigned_to") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "Pickup_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE NO ACTION ON UPDATE NO ACTION
);

CREATE TABLE "Allowance" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "from_user_id" TEXT NOT NULL,
    "to_user_id" TEXT NOT NULL,
    "amount" REAL NOT NULL,
    "reason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "scheduled_for" INTEGER CHECK ("scheduled_for" IS NULL OR typeof("scheduled_for")='integer'),
    "paid_at" INTEGER CHECK ("paid_at" IS NULL OR typeof("paid_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Allowance_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "Allowance_from_user_id_fkey" FOREIGN KEY ("from_user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "Allowance_to_user_id_fkey" FOREIGN KEY ("to_user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "WishlistItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "requested_by" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "link" TEXT,
    "description" TEXT,
    "approx_price" DECIMAL,
    "status" TEXT NOT NULL DEFAULT 'idle',
    "denied_reason" TEXT,
    "status_changed_at" INTEGER CHECK ("status_changed_at" IS NULL OR typeof("status_changed_at")='integer'),
    "status_changed_by" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "WishlistItem_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "WishlistItem_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "WishlistItem_status_changed_by_fkey" FOREIGN KEY ("status_changed_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "Handoff" (
    "responsibility_generation" TEXT NOT NULL DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "responsibility_epoch" INTEGER NOT NULL DEFAULT 0,
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "sitter_name" TEXT NOT NULL,
    "sitter_phone" TEXT,
    "arrival_time" INTEGER CHECK ("arrival_time" IS NULL OR typeof("arrival_time")='integer'),
    "departure_time" INTEGER CHECK ("departure_time" IS NULL OR typeof("departure_time")='integer'),
    "kids_bedtimes" TEXT,
    "where_snacks" TEXT,
    "pickup_authorized" TEXT,
    "code_words" TEXT,
    "pet_care" TEXT,
    "emergency_notes" TEXT,
    "house_notes" TEXT,
    "general_notes" TEXT,
    "share_token" TEXT NOT NULL,
    "share_expires_at" INTEGER CHECK ("share_expires_at" IS NULL OR typeof("share_expires_at")='integer'),
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Handoff_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Handoff_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "SickDay" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "started_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("started_at" IS NULL OR typeof("started_at")='integer'),
    "ended_at" INTEGER CHECK ("ended_at" IS NULL OR typeof("ended_at")='integer'),
    "symptoms" TEXT,
    "severity" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'active',
    "temperature_log" TEXT CHECK ("temperature_log" IS NULL OR json_valid("temperature_log")),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "SickDay_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SickDay_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "SickDay_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "Medication" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "sick_day_id" TEXT,
    "family_id" TEXT NOT NULL,
    "person_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "dosage" TEXT NOT NULL,
    "schedule" TEXT NOT NULL,
    "next_dose_at" INTEGER CHECK ("next_dose_at" IS NULL OR typeof("next_dose_at")='integer'),
    "last_dose_at" INTEGER CHECK ("last_dose_at" IS NULL OR typeof("last_dose_at")='integer'),
    "active" INTEGER NOT NULL DEFAULT 1 CHECK ("active" IS NULL OR "active" IN (0,1)),
    "notes" TEXT,
    "created_by" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "Medication_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Medication_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "Medication_sick_day_id_fkey" FOREIGN KEY ("sick_day_id") REFERENCES "SickDay" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "Medication_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE RESTRICT ON UPDATE CASCADE
);

CREATE TABLE "DevicePairing" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "code_hash" TEXT NOT NULL,
    "label" TEXT NOT NULL,
    "created_by" TEXT NOT NULL,
    "expires_at" INTEGER NOT NULL CHECK ("expires_at" IS NULL OR typeof("expires_at")='integer'),
    "claimed_at" INTEGER CHECK ("claimed_at" IS NULL OR typeof("claimed_at")='integer'),
    "claim_token_hash" TEXT,
    "confirm_digits_hash" TEXT,
    "confirm_attempts" INTEGER NOT NULL DEFAULT 0,
    "claim_platform" TEXT,
    "claim_app_version" TEXT,
    "confirmed_at" INTEGER CHECK ("confirmed_at" IS NULL OR typeof("confirmed_at")='integer'),
    "confirmed_by" TEXT,
    "cancelled_at" INTEGER CHECK ("cancelled_at" IS NULL OR typeof("cancelled_at")='integer'),
    "device_id" TEXT,
    "replaces_device_id" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "DevicePairing_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevicePairing_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "DevicePairing_replaces_device_id_fkey" FOREIGN KEY ("replaces_device_id") REFERENCES "HouseholdDevice" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "IdempotencyRecord" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "scope" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT,
    "action" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "response_status" INTEGER,
    "response_body" TEXT CHECK ("response_body" IS NULL OR json_valid("response_body")),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "expires_at" INTEGER NOT NULL CHECK ("expires_at" IS NULL OR typeof("expires_at")='integer'),
    CONSTRAINT "IdempotencyRecord_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "IdempotencyRecord_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "FoodProduct" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "barcode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "brand" TEXT,
    "package_size" TEXT,
    "origin" TEXT NOT NULL DEFAULT 'manual',
    "source_url" TEXT,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "FoodProduct_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "InventoryItem" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "barcode" TEXT,
    "product_brand" TEXT,
    "package_size" TEXT,
    "product_source" TEXT,
    "ingredient_id" TEXT,
    "amount" REAL,
    "unit" TEXT,
    "location" TEXT NOT NULL DEFAULT 'fridge',
    "expires_on" INTEGER CHECK ("expires_on" IS NULL OR typeof("expires_on")='integer'),
    "date_kind" TEXT NOT NULL DEFAULT 'best_before',
    "category" TEXT,
    "purchased_on" INTEGER CHECK ("purchased_on" IS NULL OR typeof("purchased_on")='integer'),
    "opened_on" INTEGER CHECK ("opened_on" IS NULL OR typeof("opened_on")='integer'),
    "status" TEXT NOT NULL DEFAULT 'active',
    "finished_at" INTEGER CHECK ("finished_at" IS NULL OR typeof("finished_at")='integer'),
    "added_by" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "InventoryItem_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_ingredient_id_fkey" FOREIGN KEY ("ingredient_id") REFERENCES "Ingredient" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryItem_added_by_fkey" FOREIGN KEY ("added_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "InventoryAdjustment" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "item_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "amount_delta" REAL,
    "amount_before" REAL,
    "amount_after" REAL,
    "status_before" TEXT NOT NULL,
    "status_after" TEXT NOT NULL,
    "actor_id" TEXT,
    "request_id" TEXT,
    "item_version" INTEGER NOT NULL CHECK ("item_version" IS NULL OR typeof("item_version")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "undone_at" INTEGER CHECK ("undone_at" IS NULL OR typeof("undone_at")='integer'),
    "undone_by" TEXT,
    CONSTRAINT "InventoryAdjustment_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAdjustment_item_id_fkey" FOREIGN KEY ("item_id") REFERENCES "InventoryItem" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "InventoryAdjustment_actor_id_fkey" FOREIGN KEY ("actor_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE,
    CONSTRAINT "InventoryAdjustment_undone_by_fkey" FOREIGN KEY ("undone_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "WeatherCache" (
    "family_id" TEXT NOT NULL PRIMARY KEY,
    "latitude" REAL NOT NULL,
    "longitude" REAL NOT NULL,
    "status" TEXT NOT NULL,
    "payload" TEXT CHECK ("payload" IS NULL OR json_valid("payload")),
    "fetched_at" INTEGER NOT NULL CHECK ("fetched_at" IS NULL OR typeof("fetched_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "WeatherCache_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "GrocerySectionPreference" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "name_key" TEXT NOT NULL,
    "section" TEXT NOT NULL,
    "updated_by" TEXT,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "GrocerySectionPreference_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GrocerySectionPreference_updated_by_fkey" FOREIGN KEY ("updated_by") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE CASCADE
);

CREATE TABLE "GroceryShoppingSession" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "list_id" TEXT NOT NULL,
    "sections" TEXT NOT NULL DEFAULT '[]' CHECK ("sections" IS NULL OR json_valid("sections")),
    "started_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("started_at" IS NULL OR typeof("started_at")='integer'),
    "last_tick_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("last_tick_at" IS NULL OR typeof("last_tick_at")='integer'),
    CONSTRAINT "GroceryShoppingSession_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "GroceryShoppingSession_list_id_fkey" FOREIGN KEY ("list_id") REFERENCES "List" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "AppFeedback" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "request_id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "details" TEXT NOT NULL,
    "page" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'received',
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "AppFeedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE CASCADE,
    CONSTRAINT "AppFeedback_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE TABLE "HouseholdMemberLegacyMapping" (
    "user_id" TEXT NOT NULL PRIMARY KEY,
    "member_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "HouseholdMemberLegacyMapping_user_id_family_id_fkey" FOREIGN KEY ("user_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "HouseholdMemberLegacyMapping_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "HouseholdMemberAccountLink" (
    "member_id" TEXT NOT NULL PRIMARY KEY,
    "user_id" TEXT NOT NULL,
    "family_id" TEXT NOT NULL,
    "verified_at" INTEGER NOT NULL CHECK ("verified_at" IS NULL OR typeof("verified_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "HouseholdMemberAccountLink_user_id_family_id_fkey" FOREIGN KEY ("user_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION DEFERRABLE INITIALLY DEFERRED,
    CONSTRAINT "HouseholdMemberAccountLink_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "HouseholdProfileLinkChallenge" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "member_id" TEXT NOT NULL,
    "issued_by" TEXT NOT NULL,
    "issued_token_version" INTEGER NOT NULL,
    "profile_revision" INTEGER NOT NULL,
    "token_hash" TEXT NOT NULL,
    "request_hash" TEXT NOT NULL,
    "state" TEXT NOT NULL DEFAULT 'pending',
    "expires_at" INTEGER NOT NULL CHECK ("expires_at" IS NULL OR typeof("expires_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "claimed_by" TEXT,
    "claimed_token_version" INTEGER,
    "claimed_at" INTEGER CHECK ("claimed_at" IS NULL OR typeof("claimed_at")='integer'),
    "linked_at" INTEGER CHECK ("linked_at" IS NULL OR typeof("linked_at")='integer'),
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "HouseholdProfileLinkChallenge_issued_by_fkey" FOREIGN KEY ("issued_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "HouseholdProfileLinkChallenge_claimed_by_fkey" FOREIGN KEY ("claimed_by") REFERENCES "User" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "HouseholdProfileLinkChallenge_member_id_family_id_fkey" FOREIGN KEY ("member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "ResponsibilityState" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "protocol" TEXT NOT NULL DEFAULT 'herewoven.responsibility.v1',
    "family_id" TEXT NOT NULL,
    "chore_id" TEXT,
    "pickup_id" TEXT,
    "handoff_id" TEXT,
    "source_token" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "coordinator_id" TEXT,
    "backup_account_id" TEXT,
    "backup_member_id" TEXT,
    "primary_subject_account_id" TEXT,
    "primary_subject_member_id" TEXT,
    "primary_decision" TEXT,
    "primary_by_id" TEXT,
    "primary_method" TEXT,
    "primary_at" INTEGER CHECK ("primary_at" IS NULL OR typeof("primary_at")='integer'),
    "backup_decision" TEXT,
    "backup_by_id" TEXT,
    "backup_method" TEXT,
    "backup_at" INTEGER CHECK ("backup_at" IS NULL OR typeof("backup_at")='integer'),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "ResponsibilityState_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_chore_id_family_id_fkey" FOREIGN KEY ("chore_id", "family_id") REFERENCES "Chore" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_pickup_id_family_id_fkey" FOREIGN KEY ("pickup_id", "family_id") REFERENCES "Pickup" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_handoff_id_family_id_fkey" FOREIGN KEY ("handoff_id", "family_id") REFERENCES "Handoff" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_coordinator_id_family_id_fkey" FOREIGN KEY ("coordinator_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_backup_account_id_family_id_fkey" FOREIGN KEY ("backup_account_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_backup_member_id_family_id_fkey" FOREIGN KEY ("backup_member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_primary_subject_account_id_family_id_fkey" FOREIGN KEY ("primary_subject_account_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_primary_subject_member_id_family_id_fkey" FOREIGN KEY ("primary_subject_member_id", "family_id") REFERENCES "HouseholdMember" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_primary_by_id_family_id_fkey" FOREIGN KEY ("primary_by_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "ResponsibilityState_backup_by_id_family_id_fkey" FOREIGN KEY ("backup_by_id", "family_id") REFERENCES "User" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "EventPreparation" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "family_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "reviewed_event_source" TEXT NOT NULL,
    "revision" INTEGER NOT NULL DEFAULT 0,
    CONSTRAINT "EventPreparation_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventPreparation_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "Event" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "EventPreparationStep" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "family_id" TEXT NOT NULL,
    "preparation_id" TEXT NOT NULL,
    "chore_id" TEXT NOT NULL,
    "position" INTEGER NOT NULL,
    "cue_anchor" TEXT,
    "cue_direction" TEXT,
    "cue_minutes" INTEGER,
    CONSTRAINT "EventPreparationStep_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventPreparationStep_preparation_id_family_id_fkey" FOREIGN KEY ("preparation_id", "family_id") REFERENCES "EventPreparation" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "EventPreparationStep_chore_id_family_id_fkey" FOREIGN KEY ("chore_id", "family_id") REFERENCES "Chore" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "AiUsagePolicy" (
    "family_id" TEXT NOT NULL PRIMARY KEY,
    "revision" INTEGER NOT NULL DEFAULT 0,
    "enabled" INTEGER NOT NULL DEFAULT 1 CHECK ("enabled" IS NULL OR "enabled" IN (0,1)),
    "daily_limit" INTEGER NOT NULL DEFAULT 120,
    "user_daily_limit" INTEGER NOT NULL DEFAULT 40,
    "monthly_budget_microusd" INTEGER,
    "input_rate" INTEGER,
    "output_rate" INTEGER,
    "priced_config_hash" TEXT,
    "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("updated_at" IS NULL OR typeof("updated_at")='integer'),
    CONSTRAINT "AiUsagePolicy_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "AiUsageRequest" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "user_id" TEXT,
    "job" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    "finished_at" INTEGER CHECK ("finished_at" IS NULL OR typeof("finished_at")='integer'),
    "outcome" TEXT NOT NULL DEFAULT 'pending',
    "provider_status" TEXT NOT NULL DEFAULT 'unconfirmed',
    "latency_ms" INTEGER,
    "input_tokens" INTEGER,
    "output_tokens" INTEGER,
    "input_rate" INTEGER,
    "output_rate" INTEGER,
    "reserved_microusd" INTEGER,
    "estimated_microusd" INTEGER,
    CONSTRAINT "AiUsageRequest_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "AiUsageRequest_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE TABLE "ChoreTopUpCursor" (
    "family_id" TEXT NOT NULL PRIMARY KEY,
    "after_id" TEXT,
    CONSTRAINT "ChoreTopUpCursor_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "NotificationEventOccurrence" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "family_id" TEXT NOT NULL,
    "occurrence_key" TEXT NOT NULL,
    "envelope" TEXT NOT NULL CHECK ("envelope" IS NULL OR json_valid("envelope")),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "NotificationEventOccurrence_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION
);

CREATE TABLE "NotificationRecipientDecision" (
    "id" TEXT NOT NULL PRIMARY KEY DEFAULT (lower(hex(randomblob(4))) || '-' || lower(hex(randomblob(2))) || '-4' || substr(lower(hex(randomblob(2))),2) || '-' || substr('89ab',abs(random()%4)+1,1) || substr(lower(hex(randomblob(2))),2) || '-' || lower(hex(randomblob(6)))),
    "family_id" TEXT NOT NULL,
    "event_id" TEXT NOT NULL,
    "slot" INTEGER NOT NULL,
    "user_id" TEXT,
    "notification_id" TEXT,
    "status" TEXT NOT NULL,
    "quiet" INTEGER NOT NULL CHECK ("quiet" IS NULL OR "quiet" IN (0,1)),
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)) CHECK ("created_at" IS NULL OR typeof("created_at")='integer'),
    CONSTRAINT "NotificationRecipientDecision_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family" ("id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "NotificationRecipientDecision_event_id_family_id_fkey" FOREIGN KEY ("event_id", "family_id") REFERENCES "NotificationEventOccurrence" ("id", "family_id") ON DELETE CASCADE ON UPDATE NO ACTION,
    CONSTRAINT "NotificationRecipientDecision_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User" ("id") ON DELETE SET NULL ON UPDATE NO ACTION,
    CONSTRAINT "NotificationRecipientDecision_notification_id_fkey" FOREIGN KEY ("notification_id") REFERENCES "Notification" ("id") ON DELETE SET NULL ON UPDATE NO ACTION
);

CREATE UNIQUE INDEX "Upload_filename_key" ON "Upload"("filename");

CREATE INDEX "Upload_family_id_idx" ON "Upload"("family_id");

CREATE INDEX "Upload_uploaded_by_idx" ON "Upload"("uploaded_by");

CREATE INDEX "CalendarSubscription_family_id_idx" ON "CalendarSubscription"("family_id");

CREATE INDEX "CalendarConnection_family_id_idx" ON "CalendarConnection"("family_id");

CREATE UNIQUE INDEX "CalendarConnection_family_id_user_id_provider_key" ON "CalendarConnection"("family_id", "user_id", "provider");

CREATE INDEX "CalendarEventLink_family_id_idx" ON "CalendarEventLink"("family_id");

CREATE INDEX "CalendarEventLink_event_id_idx" ON "CalendarEventLink"("event_id");

CREATE UNIQUE INDEX "CalendarEventLink_connection_id_external_id_key" ON "CalendarEventLink"("connection_id", "external_id");

CREATE UNIQUE INDEX "CalendarEventLink_connection_id_event_id_key" ON "CalendarEventLink"("connection_id", "event_id");

CREATE UNIQUE INDEX "CalendarOAuthState_state_hash_key" ON "CalendarOAuthState"("state_hash");

CREATE INDEX "CalendarOAuthState_user_id_idx" ON "CalendarOAuthState"("user_id");

CREATE INDEX "CalendarOAuthState_expires_at_idx" ON "CalendarOAuthState"("expires_at");

CREATE INDEX "Chore_family_id_idx" ON "Chore"("family_id");

CREATE INDEX "Chore_assigned_to_idx" ON "Chore"("assigned_to");

CREATE INDEX "Chore_status_idx" ON "Chore"("status");

CREATE INDEX "Chore_due_date_idx" ON "Chore"("due_date");

CREATE INDEX "Chore_family_id_status_idx" ON "Chore"("family_id", "status");

CREATE INDEX "Chore_family_id_assigned_to_idx" ON "Chore"("family_id", "assigned_to");

CREATE INDEX "Chore_family_id_assigned_member_id_idx" ON "Chore"("family_id", "assigned_member_id");

CREATE INDEX "Chore_family_member_due_idx" ON "Chore"("family_id", "assigned_member_id", "due_date");

CREATE INDEX "Chore_family_id_due_date_idx" ON "Chore"("family_id", "due_date");

CREATE INDEX "Chore_recurrence_id_idx" ON "Chore"("recurrence_id");

CREATE INDEX "Chore_family_id_routine_stack_id_idx" ON "Chore"("family_id", "routine_stack_id");

CREATE UNIQUE INDEX "Chore_recurrence_id_due_date_key" ON "Chore"("recurrence_id", "due_date");

CREATE UNIQUE INDEX "Chore_id_family_id_key" ON "Chore"("id", "family_id");

CREATE INDEX "RoutineStack_family_id_updated_at_idx" ON "RoutineStack"("family_id", "updated_at");

CREATE UNIQUE INDEX "RoutineStack_id_family_id_key" ON "RoutineStack"("id", "family_id");

CREATE UNIQUE INDEX "ChoreAssignment_idempotency_key_key" ON "ChoreAssignment"("idempotency_key");

CREATE INDEX "ChoreAssignment_family_id_assigned_member_id_idx" ON "ChoreAssignment"("family_id", "assigned_member_id");

CREATE INDEX "ChoreAssignment_family_status_idx" ON "ChoreAssignment"("family_id", "status");

CREATE INDEX "ChoreAssignment_assignee_due_idx" ON "ChoreAssignment"("assigned_to", "due_date");

CREATE INDEX "ChoreAssignment_chore_id_idx" ON "ChoreAssignment"("chore_id");

CREATE UNIQUE INDEX "ChoreAssignment_chore_assignee_due_key" ON "ChoreAssignment"("chore_id", "assigned_to", "due_date");

CREATE UNIQUE INDEX "ChoreAssignment_chore_member_due_key" ON "ChoreAssignment"("chore_id", "assigned_member_id", "due_date");

CREATE INDEX "ImportJob_family_source_idx" ON "ImportJob"("family_id", "source_app");

CREATE INDEX "ImportJob_status_idx" ON "ImportJob"("status");

CREATE INDEX "ImportedRecord_job_idx" ON "ImportedRecord"("import_job_id");

CREATE INDEX "ImportedRecord_target_idx" ON "ImportedRecord"("family_id", "target_model", "target_id");

CREATE UNIQUE INDEX "ImportedRecord_source_key" ON "ImportedRecord"("family_id", "source_app", "source_model", "source_id");

CREATE INDEX "Recipe_family_title_idx" ON "Recipe"("family_id", "title");

CREATE INDEX "Recipe_family_source_idx" ON "Recipe"("family_id", "source_key");

CREATE UNIQUE INDEX "Recipe_id_family_key" ON "Recipe"("id", "family_id");

CREATE UNIQUE INDEX "RecipeCollection_id_family_key" ON "RecipeCollection"("id", "family_id");

CREATE UNIQUE INDEX "RecipeCollection_family_name_key" ON "RecipeCollection"("family_id", "name_key");

CREATE INDEX "RecipeCollectionEntry_collection_id_family_id_idx" ON "RecipeCollectionEntry"("collection_id", "family_id");

CREATE UNIQUE INDEX "Ingredient_family_name_key" ON "Ingredient"("family_id", "name");

CREATE INDEX "RecipeIngredient_ingredient_idx" ON "RecipeIngredient"("ingredient_id");

CREATE UNIQUE INDEX "RecipeIngredient_recipe_ingredient_key" ON "RecipeIngredient"("recipe_id", "ingredient_id");

CREATE INDEX "MealPlan_family_start_idx" ON "MealPlan"("family_id", "start_date");

CREATE INDEX "MealPlanEntry_recipe_idx" ON "MealPlanEntry"("recipe_id");

CREATE UNIQUE INDEX "MealPlanEntry_plan_date_type_key" ON "MealPlanEntry"("meal_plan_id", "date", "meal_type");

CREATE INDEX "ShoppingList_family_created_idx" ON "ShoppingList"("family_id", "created_at");

CREATE INDEX "ShoppingItem_list_checked_idx" ON "ShoppingItem"("shopping_list_id", "checked");

CREATE INDEX "FinancialArchiveRecord_family_model_idx" ON "FinancialArchiveRecord"("family_id", "source_model");

CREATE UNIQUE INDEX "FinancialArchiveRecord_source_key" ON "FinancialArchiveRecord"("family_id", "source_app", "source_model", "source_id");

CREATE INDEX "Habit_family_active_idx" ON "Habit"("family_id", "is_active");

CREATE INDEX "HabitLog_family_date_idx" ON "HabitLog"("family_id", "logged_date");

CREATE INDEX "HabitLog_user_logged_idx" ON "HabitLog"("user_id", "logged_at");

CREATE UNIQUE INDEX "HabitLog_habit_user_date_key" ON "HabitLog"("habit_id", "user_id", "logged_date");

CREATE INDEX "BadgeDefinition_family_idx" ON "BadgeDefinition"("family_id");

CREATE UNIQUE INDEX "BadgeDefinition_family_name_key" ON "BadgeDefinition"("family_id", "name");

CREATE INDEX "EarnedBadge_family_earned_idx" ON "EarnedBadge"("family_id", "earned_at");

CREATE INDEX "EarnedBadge_user_idx" ON "EarnedBadge"("user_id");

CREATE UNIQUE INDEX "EarnedBadge_badge_user_key" ON "EarnedBadge"("badge_id", "user_id");

CREATE INDEX "RewardRedemption_family_status_idx" ON "RewardRedemption"("family_id", "status");

CREATE INDEX "RewardRedemption_requester_requested_idx" ON "RewardRedemption"("requested_by", "requested_at");

CREATE INDEX "RewardRedemption_reward_idx" ON "RewardRedemption"("reward_id");

CREATE INDEX "FamilyGoal_family_active_idx" ON "FamilyGoal"("family_id", "is_active");

CREATE INDEX "PushSubscription_family_idx" ON "PushSubscription"("family_id");

CREATE UNIQUE INDEX "PushSubscription_user_endpoint_key" ON "PushSubscription"("user_id", "endpoint");

CREATE INDEX "Event_family_id_idx" ON "Event"("family_id");

CREATE INDEX "Event_start_time_idx" ON "Event"("start_time");

CREATE INDEX "Event_family_id_start_time_idx" ON "Event"("family_id", "start_time");

CREATE INDEX "Event_family_id_end_time_idx" ON "Event"("family_id", "end_time");

CREATE INDEX "Event_project_id_idx" ON "Event"("project_id");

CREATE INDEX "Event_source_subscription_id_start_time_idx" ON "Event"("source_subscription_id", "start_time");

CREATE INDEX "Event_source_connection_id_idx" ON "Event"("source_connection_id");

CREATE INDEX "Event_family_id_project_id_is_task_source_uid_idx" ON "Event"("family_id", "project_id", "is_task", "source_uid");

CREATE INDEX "Event_family_id_project_id_is_task_title_idx" ON "Event"("family_id", "project_id", "is_task", "title");

CREATE INDEX "Event_family_subscription_id_idx" ON "Event"("family_id", "source_subscription_id", "id");

CREATE UNIQUE INDEX "Event_id_family_id_key" ON "Event"("id", "family_id");

CREATE UNIQUE INDEX "Event_source_subscription_id_source_uid_source_occurrence_start_key" ON "Event"("source_subscription_id", "source_uid", "source_occurrence_start");

CREATE INDEX "Message_family_id_idx" ON "Message"("family_id");

CREATE INDEX "Message_sender_id_idx" ON "Message"("sender_id");

CREATE INDEX "Message_created_at_idx" ON "Message"("created_at");

CREATE INDEX "Message_family_id_created_at_idx" ON "Message"("family_id", "created_at");

CREATE INDEX "Message_pickup_id_idx" ON "Message"("pickup_id");

CREATE UNIQUE INDEX "MessageAttachment_filename_key" ON "MessageAttachment"("filename");

CREATE INDEX "MessageAttachment_family_id_idx" ON "MessageAttachment"("family_id");

CREATE INDEX "MessageAttachment_message_id_idx" ON "MessageAttachment"("message_id");

CREATE INDEX "MessageAttachment_uploaded_by_idx" ON "MessageAttachment"("uploaded_by");

CREATE INDEX "MessageAttachment_family_id_message_id_created_at_idx" ON "MessageAttachment"("family_id", "message_id", "created_at");

CREATE INDEX "Notification_user_id_idx" ON "Notification"("user_id");

CREATE INDEX "Notification_read_idx" ON "Notification"("read");

CREATE INDEX "Notification_created_at_idx" ON "Notification"("created_at");

CREATE INDEX "Notification_user_id_read_idx" ON "Notification"("user_id", "read");

CREATE INDEX "List_family_id_idx" ON "List"("family_id");

CREATE INDEX "List_family_id_type_idx" ON "List"("family_id", "type");

CREATE INDEX "ListItem_list_id_idx" ON "ListItem"("list_id");

CREATE INDEX "ListItem_list_id_checked_idx" ON "ListItem"("list_id", "checked");

CREATE INDEX "ListItem_ingredient_id_idx" ON "ListItem"("ingredient_id");

CREATE INDEX "ListItem_recipe_id_idx" ON "ListItem"("recipe_id");

CREATE INDEX "ListItem_meal_id_idx" ON "ListItem"("meal_id");

CREATE INDEX "ListItem_source_request_id_idx" ON "ListItem"("source_request_id");

CREATE INDEX "Activity_family_id_idx" ON "Activity"("family_id");

CREATE INDEX "Activity_family_id_created_at_idx" ON "Activity"("family_id", "created_at");

CREATE INDEX "Activity_user_id_idx" ON "Activity"("user_id");

CREATE INDEX "Activity_family_id_subject_member_id_idx" ON "Activity"("family_id", "subject_member_id");

CREATE INDEX "Reward_family_id_idx" ON "Reward"("family_id");

CREATE INDEX "Reward_family_id_status_idx" ON "Reward"("family_id", "status");

CREATE INDEX "Reward_claimed_by_idx" ON "Reward"("claimed_by");

CREATE INDEX "Transaction_family_id_idx" ON "Transaction"("family_id");

CREATE INDEX "Transaction_family_id_date_idx" ON "Transaction"("family_id", "date");

CREATE INDEX "Transaction_user_id_idx" ON "Transaction"("user_id");

CREATE INDEX "Transaction_category_id_idx" ON "Transaction"("category_id");

CREATE INDEX "Transaction_family_id_type_idx" ON "Transaction"("family_id", "type");

CREATE INDEX "BudgetCategory_family_id_idx" ON "BudgetCategory"("family_id");

CREATE INDEX "BudgetCategory_family_id_type_idx" ON "BudgetCategory"("family_id", "type");

CREATE INDEX "Project_family_id_idx" ON "Project"("family_id");

CREATE INDEX "Project_family_id_status_idx" ON "Project"("family_id", "status");

CREATE INDEX "ProjectTask_project_id_idx" ON "ProjectTask"("project_id");

CREATE INDEX "ProjectTask_assigned_to_idx" ON "ProjectTask"("assigned_to");

CREATE INDEX "ProjectTask_project_id_position_created_at_id_idx" ON "ProjectTask"("project_id", "position", "created_at", "id");

CREATE INDEX "ProjectTask_project_id_id_idx" ON "ProjectTask"("project_id", "id");

CREATE UNIQUE INDEX "MealPrepSession_source_request_id_key" ON "MealPrepSession"("source_request_id");

CREATE INDEX "MealPrepSession_family_id_created_at_id_idx" ON "MealPrepSession"("family_id", "created_at", "id");

CREATE INDEX "MealBatch_family_id_idx" ON "MealBatch"("family_id");

CREATE UNIQUE INDEX "MealBatch_prep_session_id_position_key" ON "MealBatch"("prep_session_id", "position");

CREATE UNIQUE INDEX "MealBatchConsumption_source_request_id_key" ON "MealBatchConsumption"("source_request_id");

CREATE INDEX "MealBatchConsumption_family_id_batch_id_cancelled_at_idx" ON "MealBatchConsumption"("family_id", "batch_id", "cancelled_at");

CREATE INDEX "MealBatchConsumption_family_id_batch_id_allocation_key_idx" ON "MealBatchConsumption"("family_id", "batch_id", "allocation_key");

CREATE UNIQUE INDEX "FamilyMeal_batch_allocation_key_key" ON "FamilyMeal"("batch_allocation_key");

CREATE INDEX "FamilyMeal_batch_id_idx" ON "FamilyMeal"("batch_id");

CREATE INDEX "FamilyMeal_family_id_idx" ON "FamilyMeal"("family_id");

CREATE INDEX "FamilyMeal_family_id_date_idx" ON "FamilyMeal"("family_id", "date");

CREATE INDEX "FamilyMeal_recipe_id_idx" ON "FamilyMeal"("recipe_id");

CREATE INDEX "PinnedNote_family_id_idx" ON "PinnedNote"("family_id");

CREATE INDEX "PinnedNote_family_created_id_idx" ON "PinnedNote"("family_id", "created_at" DESC, "id" ASC);

CREATE INDEX "Anniversary_family_id_idx" ON "Anniversary"("family_id");

CREATE INDEX "Anniversary_family_id_date_idx" ON "Anniversary"("family_id", "date");

CREATE INDEX "Anniversary_created_by_idx" ON "Anniversary"("created_by");

CREATE INDEX "FamilyLocation_family_id_idx" ON "FamilyLocation"("family_id");

CREATE INDEX "FamilyLocation_user_id_idx" ON "FamilyLocation"("user_id");

CREATE INDEX "EmergencyContact_family_id_idx" ON "EmergencyContact"("family_id");

CREATE INDEX "Pickup_family_id_idx" ON "Pickup"("family_id");

CREATE INDEX "Pickup_family_id_pickup_time_idx" ON "Pickup"("family_id", "pickup_time");

CREATE INDEX "Pickup_assigned_to_idx" ON "Pickup"("assigned_to");

CREATE UNIQUE INDEX "Pickup_id_family_id_key" ON "Pickup"("id", "family_id");

CREATE INDEX "Allowance_family_id_idx" ON "Allowance"("family_id");

CREATE INDEX "Allowance_to_user_id_idx" ON "Allowance"("to_user_id");

CREATE INDEX "Allowance_status_idx" ON "Allowance"("status");

CREATE INDEX "WishlistItem_family_id_idx" ON "WishlistItem"("family_id");

CREATE INDEX "WishlistItem_requested_by_idx" ON "WishlistItem"("requested_by");

CREATE UNIQUE INDEX "Handoff_share_token_key" ON "Handoff"("share_token");

CREATE INDEX "Handoff_family_id_idx" ON "Handoff"("family_id");

CREATE UNIQUE INDEX "Handoff_id_family_id_key" ON "Handoff"("id", "family_id");

CREATE INDEX "SickDay_family_id_status_idx" ON "SickDay"("family_id", "status");

CREATE INDEX "SickDay_person_id_idx" ON "SickDay"("person_id");

CREATE INDEX "Medication_family_id_active_idx" ON "Medication"("family_id", "active");

CREATE INDEX "Medication_person_id_idx" ON "Medication"("person_id");

CREATE UNIQUE INDEX "DevicePairing_code_hash_key" ON "DevicePairing"("code_hash");

CREATE UNIQUE INDEX "DevicePairing_claim_token_hash_key" ON "DevicePairing"("claim_token_hash");

CREATE UNIQUE INDEX "DevicePairing_device_id_key" ON "DevicePairing"("device_id");

CREATE INDEX "DevicePairing_family_id_expires_at_idx" ON "DevicePairing"("family_id", "expires_at");

CREATE INDEX "DevicePairing_replaces_device_id_idx" ON "DevicePairing"("replaces_device_id");

CREATE INDEX "IdempotencyRecord_expires_at_idx" ON "IdempotencyRecord"("expires_at");

CREATE INDEX "IdempotencyRecord_family_id_idx" ON "IdempotencyRecord"("family_id");

CREATE INDEX "IdempotencyRecord_user_id_idx" ON "IdempotencyRecord"("user_id");

CREATE UNIQUE INDEX "IdempotencyRecord_scope_key_key" ON "IdempotencyRecord"("scope", "key");

CREATE UNIQUE INDEX "FoodProduct_family_barcode_key" ON "FoodProduct"("family_id", "barcode");

CREATE INDEX "InventoryItem_family_id_location_idx" ON "InventoryItem"("family_id", "location");

CREATE INDEX "InventoryItem_family_id_expires_on_idx" ON "InventoryItem"("family_id", "expires_on");

CREATE INDEX "InventoryItem_family_id_status_expires_on_idx" ON "InventoryItem"("family_id", "status", "expires_on");

CREATE INDEX "InventoryItem_ingredient_id_idx" ON "InventoryItem"("ingredient_id");

CREATE UNIQUE INDEX "InventoryAdjustment_request_id_key" ON "InventoryAdjustment"("request_id");

CREATE INDEX "InventoryAdjustment_family_id_created_at_idx" ON "InventoryAdjustment"("family_id", "created_at");

CREATE INDEX "InventoryAdjustment_item_id_created_at_idx" ON "InventoryAdjustment"("item_id", "created_at");

CREATE UNIQUE INDEX "GrocerySectionPreference_family_id_name_key_key" ON "GrocerySectionPreference"("family_id", "name_key");

CREATE INDEX "GroceryShoppingSession_family_id_last_tick_at_idx" ON "GroceryShoppingSession"("family_id", "last_tick_at");

CREATE INDEX "GroceryShoppingSession_list_id_last_tick_at_idx" ON "GroceryShoppingSession"("list_id", "last_tick_at");

CREATE INDEX "AppFeedback_family_id_user_id_created_at_idx" ON "AppFeedback"("family_id", "user_id", "created_at");

CREATE UNIQUE INDEX "AppFeedback_user_id_request_id_key" ON "AppFeedback"("user_id", "request_id");

CREATE UNIQUE INDEX "HouseholdMemberLegacyMapping_member_id_key" ON "HouseholdMemberLegacyMapping"("member_id");

CREATE UNIQUE INDEX "HouseholdMemberLegacyMapping_user_id_family_id_key" ON "HouseholdMemberLegacyMapping"("user_id", "family_id");

CREATE UNIQUE INDEX "HouseholdMemberLegacyMapping_member_id_family_id_key" ON "HouseholdMemberLegacyMapping"("member_id", "family_id");

CREATE UNIQUE INDEX "HouseholdMemberAccountLink_user_id_key" ON "HouseholdMemberAccountLink"("user_id");

CREATE UNIQUE INDEX "HouseholdMemberAccountLink_user_id_family_id_key" ON "HouseholdMemberAccountLink"("user_id", "family_id");

CREATE UNIQUE INDEX "HouseholdMemberAccountLink_member_id_family_id_key" ON "HouseholdMemberAccountLink"("member_id", "family_id");

CREATE UNIQUE INDEX "HouseholdProfileLinkChallenge_token_hash_key" ON "HouseholdProfileLinkChallenge"("token_hash");

CREATE INDEX "HouseholdProfileLinkChallenge_family_id_state_expires_at_idx" ON "HouseholdProfileLinkChallenge"("family_id", "state", "expires_at");

CREATE INDEX "HouseholdProfileLinkChallenge_member_id_family_id_idx" ON "HouseholdProfileLinkChallenge"("member_id", "family_id");

CREATE INDEX "ResponsibilityState_family_id_updated_at_idx" ON "ResponsibilityState"("family_id", "updated_at");

CREATE INDEX "ResponsibilityState_coordinator_id_family_id_idx" ON "ResponsibilityState"("coordinator_id", "family_id");

CREATE INDEX "ResponsibilityState_backup_account_id_family_id_idx" ON "ResponsibilityState"("backup_account_id", "family_id");

CREATE INDEX "ResponsibilityState_backup_member_id_family_id_idx" ON "ResponsibilityState"("backup_member_id", "family_id");

CREATE INDEX "ResponsibilityState_primary_subject_account_id_family_id_idx" ON "ResponsibilityState"("primary_subject_account_id", "family_id");

CREATE INDEX "ResponsibilityState_primary_subject_member_id_family_id_idx" ON "ResponsibilityState"("primary_subject_member_id", "family_id");

CREATE INDEX "ResponsibilityState_primary_by_id_family_id_idx" ON "ResponsibilityState"("primary_by_id", "family_id");

CREATE INDEX "ResponsibilityState_backup_by_id_family_id_idx" ON "ResponsibilityState"("backup_by_id", "family_id");

CREATE UNIQUE INDEX "ResponsibilityState_chore_id_family_id_key" ON "ResponsibilityState"("chore_id", "family_id");

CREATE UNIQUE INDEX "ResponsibilityState_pickup_id_family_id_key" ON "ResponsibilityState"("pickup_id", "family_id");

CREATE UNIQUE INDEX "ResponsibilityState_handoff_id_family_id_key" ON "ResponsibilityState"("handoff_id", "family_id");

CREATE INDEX "EventPreparation_family_id_idx" ON "EventPreparation"("family_id");

CREATE UNIQUE INDEX "EventPreparation_id_family_id_key" ON "EventPreparation"("id", "family_id");

CREATE UNIQUE INDEX "EventPreparation_event_id_family_id_key" ON "EventPreparation"("event_id", "family_id");

CREATE INDEX "EventPreparationStep_family_id_idx" ON "EventPreparationStep"("family_id");

CREATE UNIQUE INDEX "EventPreparationStep_chore_id_family_id_key" ON "EventPreparationStep"("chore_id", "family_id");

CREATE UNIQUE INDEX "EventPreparationStep_plan_position_key" ON "EventPreparationStep"("preparation_id", "position");

CREATE INDEX "AiUsageRequest_family_time_idx" ON "AiUsageRequest"("family_id", "created_at");

CREATE INDEX "AiUsageRequest_user_time_idx" ON "AiUsageRequest"("user_id", "created_at");

CREATE INDEX "NotificationEventOccurrence_family_id_idx" ON "NotificationEventOccurrence"("family_id", "id");

CREATE UNIQUE INDEX "NotificationEventOccurrence_id_family_key" ON "NotificationEventOccurrence"("id", "family_id");

CREATE UNIQUE INDEX "NotificationEventOccurrence_family_key" ON "NotificationEventOccurrence"("family_id", "occurrence_key");

CREATE INDEX "NotificationRecipientDecision_family_id_idx" ON "NotificationRecipientDecision"("family_id", "id");

CREATE INDEX "NotificationRecipientDecision_user_idx" ON "NotificationRecipientDecision"("user_id");

CREATE INDEX "NotificationRecipientDecision_notification_idx" ON "NotificationRecipientDecision"("notification_id");

CREATE UNIQUE INDEX "NotificationRecipientDecision_event_slot_key" ON "NotificationRecipientDecision"("event_id", "slot");
