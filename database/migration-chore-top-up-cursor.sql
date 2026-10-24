-- #450/#134 expand-only foreground traversal metadata. No backfill/activation.
BEGIN;
CREATE TABLE IF NOT EXISTS "ChoreTopUpCursor" (
  "family_id" TEXT PRIMARY KEY,
  "after_id" TEXT,
  CONSTRAINT "ChoreTopUpCursor_family_id_fkey" FOREIGN KEY ("family_id")
    REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE NO ACTION
);
COMMIT;
