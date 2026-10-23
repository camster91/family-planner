-- No identity, private records, features or shared-device credentials are stored here.

-- Personal display preferences and parent defaults (#560), additive and nullable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_preferences" JSONB;
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "display_preferences_revision" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "display_defaults" JSONB;
ALTER TABLE "Family" ADD COLUMN IF NOT EXISTS "display_defaults_revision" INTEGER NOT NULL DEFAULT 0;
