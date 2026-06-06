-- Migration: Wishlist items
-- Adds: WishlistItem table for family wishlists

CREATE TABLE IF NOT EXISTS "WishlistItem" (
  "id"                  TEXT PRIMARY KEY,
  "family_id"          TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "requested_by"       TEXT NOT NULL REFERENCES "User"("id") ON DELETE CASCADE,
  "title"              TEXT NOT NULL,
  "link"               TEXT,
  "description"        TEXT,
  "approx_price"       DECIMAL(10,2),
  "status"             TEXT NOT NULL DEFAULT 'idle',
  "denied_reason"      TEXT,
  "status_changed_at"  TIMESTAMP(3),
  "status_changed_by"  TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "created_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"         TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "WishlistItem_family_id_idx" ON "WishlistItem"("family_id");
CREATE INDEX IF NOT EXISTS "WishlistItem_requested_by_idx" ON "WishlistItem"("requested_by");