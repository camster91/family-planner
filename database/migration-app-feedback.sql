-- Private feedback inbox; no automatic public/external forwarding.
CREATE TABLE IF NOT EXISTS "AppFeedback" (
 "id" TEXT PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE,
 "request_id" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "details" TEXT NOT NULL,
 "page" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'received',
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- Align databases that already ran the draft migration. Repeated runs keep
-- matching constraints intact; replacing a constraint does not change rows.
DO $$ BEGIN
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"AppFeedback"'::regclass AND conname = 'AppFeedback_user_id_fkey' AND confupdtype <> 'c') THEN
  ALTER TABLE "AppFeedback" DROP CONSTRAINT "AppFeedback_user_id_fkey";
  ALTER TABLE "AppFeedback" ADD CONSTRAINT "AppFeedback_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
 IF EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = '"AppFeedback"'::regclass AND conname = 'AppFeedback_family_id_fkey' AND confupdtype <> 'c') THEN
  ALTER TABLE "AppFeedback" DROP CONSTRAINT "AppFeedback_family_id_fkey";
  ALTER TABLE "AppFeedback" ADD CONSTRAINT "AppFeedback_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE;
 END IF;
END $$;
CREATE UNIQUE INDEX IF NOT EXISTS "AppFeedback_user_id_request_id_key" ON "AppFeedback"("user_id", "request_id");
CREATE INDEX IF NOT EXISTS "AppFeedback_family_id_user_id_created_at_idx" ON "AppFeedback"("family_id", "user_id", "created_at");
