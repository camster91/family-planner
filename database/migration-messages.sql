-- Message pickup context and private message attachments.
-- Idempotent for deployments whose Message/Pickup tables already exist.

ALTER TABLE "Message" ADD COLUMN IF NOT EXISTS "pickup_id" TEXT;

CREATE TABLE IF NOT EXISTS "MessageAttachment" (
  "id" TEXT PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "uploaded_by" TEXT,
  "message_id" TEXT,
  "filename" TEXT NOT NULL UNIQUE,
  "content_type" TEXT NOT NULL,
  "size_bytes" INTEGER NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);

DO $$ BEGIN
  ALTER TABLE "Message" ADD CONSTRAINT "Message_pickup_id_fkey"
    FOREIGN KEY ("pickup_id") REFERENCES "Pickup"("id") ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
  ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_family_id_fkey"
    FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_uploaded_by_fkey"
    FOREIGN KEY ("uploaded_by") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "MessageAttachment" ADD CONSTRAINT "MessageAttachment_message_id_fkey"
    FOREIGN KEY ("message_id") REFERENCES "Message"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE INDEX IF NOT EXISTS "Message_pickup_id_idx" ON "Message"("pickup_id");
CREATE INDEX IF NOT EXISTS "MessageAttachment_family_id_idx" ON "MessageAttachment"("family_id");
CREATE INDEX IF NOT EXISTS "MessageAttachment_message_id_idx" ON "MessageAttachment"("message_id");
CREATE INDEX IF NOT EXISTS "MessageAttachment_uploaded_by_idx" ON "MessageAttachment"("uploaded_by");
CREATE INDEX IF NOT EXISTS "MessageAttachment_family_id_message_id_created_at_idx"
  ON "MessageAttachment"("family_id", "message_id", "created_at");
