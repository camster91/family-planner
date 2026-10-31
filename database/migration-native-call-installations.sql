-- Additive compatibility schema. Native registration remains disabled by default.
CREATE TABLE IF NOT EXISTS "NativeCallInstallation" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE NO ACTION,
  "generation" INTEGER NOT NULL CHECK (generation >= 0),
  "epoch" TEXT NOT NULL,
  "revision" INTEGER NOT NULL DEFAULT 1 CHECK (revision > 0),
  "platform" TEXT NOT NULL CHECK (platform IN ('ios','android')),
  "label" TEXT NOT NULL CHECK (length(trim(label)) BETWEEN 1 AND 40),
  "provider" TEXT NOT NULL,
  "push_token_enc" TEXT,
  "token_fingerprint" TEXT NOT NULL,
  "revoked_at" TIMESTAMP(3),
  "last_command_id" TEXT NOT NULL,
  "last_command_hash" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "expires_at" TIMESTAMP(3) NOT NULL,
  CHECK ((revoked_at IS NULL AND push_token_enc IS NOT NULL) OR (revoked_at IS NOT NULL AND push_token_enc IS NULL)),
  CHECK ((platform='ios' AND provider='apns-voip') OR (platform='android' AND provider='fcm'))
);
CREATE UNIQUE INDEX IF NOT EXISTS "NativeCallInstallation_provider_token_fingerprint_key" ON "NativeCallInstallation"(provider,token_fingerprint);
CREATE INDEX IF NOT EXISTS "NativeCallInstallation_family_id_user_id_idx" ON "NativeCallInstallation"(family_id,user_id);
CREATE OR REPLACE FUNCTION native_call_user_authority_changed() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF OLD.token_version IS DISTINCT FROM NEW.token_version THEN
    DELETE FROM "NativeCallInstallation" WHERE user_id=OLD.id;
  ELSE
    UPDATE "NativeCallInstallation" SET push_token_enc=NULL,updated_at=CURRENT_TIMESTAMP,revoked_at=CURRENT_TIMESTAMP,revision=revision+1,expires_at=CURRENT_TIMESTAMP+INTERVAL '6 minutes' WHERE user_id=OLD.id AND revoked_at IS NULL;
  END IF;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS "NativeCallInstallation_user_authority_changed" ON "User";
CREATE TRIGGER "NativeCallInstallation_user_authority_changed" AFTER UPDATE OF family_id,token_version ON "User"
FOR EACH ROW WHEN (OLD.family_id IS DISTINCT FROM NEW.family_id OR OLD.token_version IS DISTINCT FROM NEW.token_version)
EXECUTE FUNCTION native_call_user_authority_changed();
CREATE OR REPLACE FUNCTION native_call_calling_disabled() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  UPDATE "NativeCallInstallation" SET push_token_enc=NULL,updated_at=CURRENT_TIMESTAMP,revoked_at=CURRENT_TIMESTAMP,revision=revision+1,expires_at=CURRENT_TIMESTAMP+INTERVAL '6 minutes' WHERE family_id=NEW.id AND revoked_at IS NULL;
  RETURN NEW;
END; $$;
DROP TRIGGER IF EXISTS "NativeCallInstallation_calling_disabled" ON "Family";
CREATE TRIGGER "NativeCallInstallation_calling_disabled" AFTER UPDATE OF features ON "Family"
FOR EACH ROW WHEN (NEW.features->'calling' IS DISTINCT FROM 'true'::jsonb)
EXECUTE FUNCTION native_call_calling_disabled();
