-- Native private-object lifecycle guards (#storage).
--
-- Upload metadata and R2 objects cannot share a transaction.  A cleanup lease
-- keeps a filename unavailable from the moment stale metadata is claimed
-- until its object has been removed.  last_accessed_at lets a successful
-- household dedupe win the race with a stale-row candidate before a lease is
-- claimed.  The lease tables intentionally have no foreign key to the row
-- they protect: the row is deleted while the lease is still held, then the
-- object is removed, and only then is the lease released.
ALTER TABLE "Upload" ADD COLUMN "last_accessed_at" INTEGER NOT NULL DEFAULT 0
  CHECK ("last_accessed_at" IS NULL OR typeof("last_accessed_at")='integer');
CREATE INDEX "Upload_lifecycle_idx" ON "Upload"("family_id","filename","last_accessed_at");

CREATE TABLE "UploadCleanupLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "upload_id" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "UploadCleanupLease_family_filename_key" UNIQUE ("family_id","filename")
);
CREATE INDEX "UploadCleanupLease_upload_idx" ON "UploadCleanupLease"("upload_id");

ALTER TABLE "MessageAttachment" ADD COLUMN "last_accessed_at" INTEGER NOT NULL DEFAULT 0
  CHECK ("last_accessed_at" IS NULL OR typeof("last_accessed_at")='integer');
CREATE INDEX "MessageAttachment_lifecycle_idx" ON "MessageAttachment"("family_id","filename","last_accessed_at");

CREATE TABLE "MessageAttachmentCleanupLease" (
    "id" TEXT NOT NULL PRIMARY KEY,
    "family_id" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "attachment_id" TEXT NOT NULL,
    "created_at" INTEGER NOT NULL DEFAULT (CAST(unixepoch('subsec') * 1000 AS INTEGER)),
    CONSTRAINT "MessageAttachmentCleanupLease_family_filename_key" UNIQUE ("family_id","filename")
);
CREATE INDEX "MessageAttachmentCleanupLease_attachment_idx" ON "MessageAttachmentCleanupLease"("attachment_id");
