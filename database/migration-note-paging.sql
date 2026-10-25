-- Additive source only. Not applied in the no-QA follow-through.
-- Plan index build/locking and forward/rollback acceptance before deployment.
CREATE INDEX IF NOT EXISTS "PinnedNote_family_created_id_idx"
ON "PinnedNote" ("family_id", "created_at" DESC, "id" ASC);
-- Rollback: DROP INDEX IF EXISTS "PinnedNote_family_created_id_idx";
