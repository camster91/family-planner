-- Private feedback inbox; no automatic public/external forwarding.
CREATE TABLE IF NOT EXISTS "AppFeedback" (
 "id" TEXT PRIMARY KEY,
 "user_id" TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
 "family_id" TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
 "request_id" TEXT NOT NULL,
 "kind" TEXT NOT NULL,
 "title" TEXT NOT NULL,
 "details" TEXT NOT NULL,
 "page" TEXT NOT NULL,
 "status" TEXT NOT NULL DEFAULT 'received',
 "created_at" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE UNIQUE INDEX IF NOT EXISTS "AppFeedback_user_id_request_id_key" ON "AppFeedback"("user_id", "request_id");
CREATE INDEX IF NOT EXISTS "AppFeedback_family_id_user_id_created_at_idx" ON "AppFeedback"("family_id", "user_id", "created_at");
