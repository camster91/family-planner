-- Travel mode fields on the canonical Prisma Family table. Safe to rerun.
ALTER TABLE "Family"
  ADD COLUMN IF NOT EXISTS "travel_mode_active" BOOLEAN NOT NULL DEFAULT FALSE,
  ADD COLUMN IF NOT EXISTS "travel_start_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "travel_end_date" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "travel_destination" TEXT;
