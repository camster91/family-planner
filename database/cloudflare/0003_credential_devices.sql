-- Device credentials, PIN reset and scoped audit support (#604).
-- Writers/pairing/elevation APIs are converted separately. Dates are Unix milliseconds.
CREATE UNIQUE INDEX "User_reset_token_unique" ON "User"("reset_token") WHERE "reset_token" IS NOT NULL;
CREATE UNIQUE INDEX "User_verify_token_unique" ON "User"("verify_token") WHERE "verify_token" IS NOT NULL;

CREATE TABLE "HouseholdMember" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "family_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "role" TEXT NOT NULL DEFAULT 'child',
  "age" INTEGER,
  "avatar_url" TEXT,
  "board_color" TEXT,
  "archived_at" INTEGER,
  "erasure_user_id" TEXT,
  "revision" INTEGER NOT NULL DEFAULT 0,
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("erasure_user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  UNIQUE ("id", "family_id"),
  CHECK (length(trim(name)) > 0),
  CHECK (role IN ('parent','teen','child')),
  CHECK (age IS NULL OR age >= 0),
  CHECK (revision >= 0)
);
CREATE INDEX "HouseholdMember_family_id_archived_at_idx" ON "HouseholdMember"("family_id", "archived_at");
CREATE INDEX "HouseholdMember_erasure_user_id_idx" ON "HouseholdMember"("erasure_user_id");

CREATE TABLE "HouseholdDevice" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "family_id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "platform" TEXT NOT NULL,
  "created_by" TEXT,
  "confirmed_by" TEXT,
  "paired_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "last_seen_at" INTEGER,
  "last_seen_app_version" TEXT,
  "revoked_at" INTEGER,
  "revoked_by" TEXT,
  "revoke_reason" TEXT,
  "elevation_token_hash" TEXT UNIQUE,
  "elevated_user_id" TEXT,
  "elevated_token_version" INTEGER,
  "elevation_method" TEXT,
  "elevation_started_at" INTEGER,
  "elevation_last_used_at" INTEGER,
  "elevation_expires_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE
);
CREATE INDEX "HouseholdDevice_family_id_revoked_at_idx" ON "HouseholdDevice"("family_id", "revoked_at");

CREATE TABLE "DeviceSession" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "device_id" TEXT NOT NULL,
  "family_id" TEXT NOT NULL,
  "access_token_hash" TEXT NOT NULL UNIQUE,
  "access_expires_at" INTEGER NOT NULL,
  "refresh_token_hash" TEXT NOT NULL UNIQUE,
  "refresh_expires_at" INTEGER NOT NULL,
  "first_used_at" INTEGER,
  "rotated_at" INTEGER,
  "replaced_by_id" TEXT UNIQUE,
  "revoked_at" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY ("device_id") REFERENCES "HouseholdDevice"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "DeviceSession_device_id_revoked_at_idx" ON "DeviceSession"("device_id", "revoked_at");
CREATE INDEX "DeviceSession_family_id_idx" ON "DeviceSession"("family_id");

CREATE TABLE "ParentElevationPin" (
  "user_id" TEXT PRIMARY KEY NOT NULL,
  "family_id" TEXT NOT NULL,
  "pin_hash" TEXT NOT NULL,
  "locked_until" INTEGER,
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE
);
CREATE INDEX "ParentElevationPin_family_id_idx" ON "ParentElevationPin"("family_id");

CREATE TABLE "DeviceAuditEvent" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "family_id" TEXT NOT NULL,
  "device_id" TEXT,
  "actor_user_id" TEXT,
  "subject_member_id" TEXT,
  "subject_member_erased" INTEGER NOT NULL DEFAULT 0 CHECK ("subject_member_erased" IN (0,1)),
  "type" TEXT NOT NULL,
  "metadata" TEXT CHECK ("metadata" IS NULL OR json_valid("metadata")),
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  FOREIGN KEY ("device_id") REFERENCES "HouseholdDevice"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("actor_user_id") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE,
  FOREIGN KEY ("subject_member_id", "family_id") REFERENCES "HouseholdMember"("id", "family_id") ON DELETE NO ACTION ON UPDATE NO ACTION,
  CHECK (subject_member_erased=0 OR subject_member_id IS NULL)
);
CREATE INDEX "DeviceAuditEvent_family_id_created_at_idx" ON "DeviceAuditEvent"("family_id", "created_at");
CREATE INDEX "DeviceAuditEvent_device_id_created_at_idx" ON "DeviceAuditEvent"("device_id", "created_at");
CREATE INDEX "DeviceAuditEvent_family_id_subject_member_id_idx" ON "DeviceAuditEvent"("family_id", "subject_member_id");
