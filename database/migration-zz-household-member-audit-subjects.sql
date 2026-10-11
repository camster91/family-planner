-- #480 additive audit attribution. Existing actor fields remain authoritative.
-- Activity.user_id stays required and DeviceAuditEvent.actor_user_id keeps its
-- existing nullable/set-null contract. These nullable subject references are
-- dormant until a later member-domain writer/client stage is approved.
BEGIN;

ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "subject_member_id" TEXT;
ALTER TABLE "Activity" ADD COLUMN IF NOT EXISTS "subject_member_erased" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "DeviceAuditEvent" ADD COLUMN IF NOT EXISTS "subject_member_id" TEXT;
ALTER TABLE "DeviceAuditEvent" ADD COLUMN IF NOT EXISTS "subject_member_erased" BOOLEAN NOT NULL DEFAULT false;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Activity_subject_member_fkey'
      AND conrelid = '"Activity"'::regclass
  ) THEN
    ALTER TABLE "Activity"
      ADD CONSTRAINT "Activity_subject_member_fkey"
      FOREIGN KEY ("subject_member_id", "family_id")
      REFERENCES "HouseholdMember" ("id", "family_id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'Activity_subject_member_erased_check'
      AND conrelid = '"Activity"'::regclass
  ) THEN
    ALTER TABLE "Activity"
      ADD CONSTRAINT "Activity_subject_member_erased_check"
      CHECK (NOT "subject_member_erased" OR "subject_member_id" IS NULL);
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DeviceAuditEvent_subject_member_fkey'
      AND conrelid = '"DeviceAuditEvent"'::regclass
  ) THEN
    ALTER TABLE "DeviceAuditEvent"
      ADD CONSTRAINT "DeviceAuditEvent_subject_member_fkey"
      FOREIGN KEY ("subject_member_id", "family_id")
      REFERENCES "HouseholdMember" ("id", "family_id")
      ON DELETE NO ACTION ON UPDATE NO ACTION;
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM pg_constraint
    WHERE conname = 'DeviceAuditEvent_subject_member_erased_check'
      AND conrelid = '"DeviceAuditEvent"'::regclass
  ) THEN
    ALTER TABLE "DeviceAuditEvent"
      ADD CONSTRAINT "DeviceAuditEvent_subject_member_erased_check"
      CHECK (NOT "subject_member_erased" OR "subject_member_id" IS NULL);
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Activity_family_id_subject_member_id_idx"
  ON "Activity" ("family_id", "subject_member_id");
CREATE INDEX IF NOT EXISTS "DeviceAuditEvent_family_id_subject_member_id_idx"
  ON "DeviceAuditEvent" ("family_id", "subject_member_id");

COMMIT;
