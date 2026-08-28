-- ChoreChamps domains beyond chore assignments. Safe to rerun.

CREATE TABLE IF NOT EXISTS "Habit" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT, "icon" TEXT, "points" INTEGER NOT NULL DEFAULT 5,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "HabitLog" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "habit_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL, "logged_date" DATE NOT NULL,
  "logged_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "points_awarded" INTEGER NOT NULL DEFAULT 0
);
CREATE TABLE IF NOT EXISTS "BadgeDefinition" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT, "name" TEXT NOT NULL,
  "description" TEXT NOT NULL, "icon" TEXT NOT NULL, "requirement" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "EarnedBadge" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "badge_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL, "earned_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "RewardRedemption" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "reward_id" TEXT NOT NULL,
  "requested_by" TEXT NOT NULL, "points" INTEGER NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'requested',
  "requested_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "approved_by" TEXT, "approved_at" TIMESTAMP(3), "fulfilled_at" TIMESTAMP(3),
  "notes" TEXT
);
CREATE TABLE IF NOT EXISTS "FamilyGoal" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "title" TEXT NOT NULL,
  "description" TEXT, "target_points" INTEGER NOT NULL,
  "current_points" INTEGER NOT NULL DEFAULT 0, "reward" TEXT,
  "is_active" BOOLEAN NOT NULL DEFAULT true, "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE IF NOT EXISTS "PushSubscription" (
  "id" TEXT PRIMARY KEY, "family_id" TEXT NOT NULL, "user_id" TEXT NOT NULL,
  "endpoint" TEXT NOT NULL, "keys" JSONB NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

ALTER TABLE "Reward" ADD COLUMN IF NOT EXISTS "is_active" BOOLEAN NOT NULL DEFAULT true;

CREATE INDEX IF NOT EXISTS "Habit_family_active_idx" ON "Habit"("family_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "HabitLog_habit_user_date_key" ON "HabitLog"("habit_id", "user_id", "logged_date");
CREATE INDEX IF NOT EXISTS "HabitLog_family_date_idx" ON "HabitLog"("family_id", "logged_date");
CREATE INDEX IF NOT EXISTS "HabitLog_user_logged_idx" ON "HabitLog"("user_id", "logged_at");
CREATE UNIQUE INDEX IF NOT EXISTS "BadgeDefinition_family_name_key" ON "BadgeDefinition"("family_id", "name");
CREATE INDEX IF NOT EXISTS "BadgeDefinition_family_idx" ON "BadgeDefinition"("family_id");
CREATE UNIQUE INDEX IF NOT EXISTS "EarnedBadge_badge_user_key" ON "EarnedBadge"("badge_id", "user_id");
CREATE INDEX IF NOT EXISTS "EarnedBadge_family_earned_idx" ON "EarnedBadge"("family_id", "earned_at");
CREATE INDEX IF NOT EXISTS "EarnedBadge_user_idx" ON "EarnedBadge"("user_id");
CREATE INDEX IF NOT EXISTS "RewardRedemption_family_status_idx" ON "RewardRedemption"("family_id", "status");
CREATE INDEX IF NOT EXISTS "RewardRedemption_requester_requested_idx" ON "RewardRedemption"("requested_by", "requested_at");
CREATE INDEX IF NOT EXISTS "RewardRedemption_reward_idx" ON "RewardRedemption"("reward_id");
CREATE INDEX IF NOT EXISTS "FamilyGoal_family_active_idx" ON "FamilyGoal"("family_id", "is_active");
CREATE UNIQUE INDEX IF NOT EXISTS "PushSubscription_user_endpoint_key" ON "PushSubscription"("user_id", "endpoint");
CREATE INDEX IF NOT EXISTS "PushSubscription_family_idx" ON "PushSubscription"("family_id");

DO $$ BEGIN ALTER TABLE "Habit" ADD CONSTRAINT "Habit_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Habit" ADD CONSTRAINT "Habit_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_habit_id_fkey" FOREIGN KEY ("habit_id") REFERENCES "Habit"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "HabitLog" ADD CONSTRAINT "HabitLog_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "BadgeDefinition" ADD CONSTRAINT "BadgeDefinition_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EarnedBadge" ADD CONSTRAINT "EarnedBadge_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EarnedBadge" ADD CONSTRAINT "EarnedBadge_badge_id_fkey" FOREIGN KEY ("badge_id") REFERENCES "BadgeDefinition"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "EarnedBadge" ADD CONSTRAINT "EarnedBadge_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_reward_id_fkey" FOREIGN KEY ("reward_id") REFERENCES "Reward"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_requested_by_fkey" FOREIGN KEY ("requested_by") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "RewardRedemption" ADD CONSTRAINT "RewardRedemption_approved_by_fkey" FOREIGN KEY ("approved_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FamilyGoal" ADD CONSTRAINT "FamilyGoal_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "FamilyGoal" ADD CONSTRAINT "FamilyGoal_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "PushSubscription" ADD CONSTRAINT "PushSubscription_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
