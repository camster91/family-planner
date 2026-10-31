-- Personal native reachability, not a second account/device identity model.
-- No dispatch is activated by this migration. Dates are Unix milliseconds.
CREATE TABLE "NativeCallInstallation" (
  "id" TEXT PRIMARY KEY NOT NULL,
  "family_id" TEXT NOT NULL,
  "user_id" TEXT NOT NULL,
  "generation" INTEGER NOT NULL CHECK (generation >= 0),
  "epoch" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  "platform" TEXT NOT NULL CHECK (platform IN ('ios','android')),
  "label" TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  "provider" TEXT NOT NULL,
  "push_token_enc" TEXT,
  "token_fingerprint" TEXT NOT NULL,
  "revoked_at" INTEGER,
  "last_command_id" TEXT NOT NULL,
  "last_command_hash" TEXT NOT NULL,
  "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "updated_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
  "expires_at" INTEGER NOT NULL,
  FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  CHECK ((revoked_at IS NULL AND push_token_enc IS NOT NULL) OR (revoked_at IS NOT NULL AND push_token_enc IS NULL)),
  CHECK ((platform='ios' AND provider='apns-voip') OR (platform='android' AND provider='fcm')),
  UNIQUE ("provider", "token_fingerprint")
);
CREATE INDEX "NativeCallInstallation_family_id_user_id_idx" ON "NativeCallInstallation" (family_id,user_id);
CREATE TRIGGER "NativeCallInstallation_user_authority_changed"
AFTER UPDATE OF family_id,token_version ON "User"
WHEN OLD.family_id IS NOT NEW.family_id OR OLD.token_version IS NOT NEW.token_version
BEGIN
  DELETE FROM "NativeCallInstallation" WHERE user_id=OLD.id AND OLD.token_version IS NOT NEW.token_version;
  UPDATE "NativeCallInstallation" SET push_token_enc=NULL,updated_at=CAST(unixepoch('subsec') * 1000 AS INTEGER),revoked_at=CAST(unixepoch('subsec') * 1000 AS INTEGER),revision=revision+1,expires_at=CAST(unixepoch('subsec') * 1000 AS INTEGER)+360000 WHERE user_id=OLD.id AND revoked_at IS NULL;
END;
CREATE TRIGGER "NativeCallInstallation_calling_disabled"
AFTER UPDATE OF features ON "Family"
WHEN json_extract(NEW.features,'$.calling') IS NOT 1
BEGIN
  UPDATE "NativeCallInstallation" SET push_token_enc=NULL,updated_at=CAST(unixepoch('subsec') * 1000 AS INTEGER),revoked_at=CAST(unixepoch('subsec') * 1000 AS INTEGER),revision=revision+1,expires_at=CAST(unixepoch('subsec') * 1000 AS INTEGER)+360000 WHERE family_id=NEW.id AND revoked_at IS NULL;
END;
