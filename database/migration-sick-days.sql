-- Migration: Sick Days + Medications
-- Creates SickDay and Medication tables

CREATE TABLE IF NOT EXISTS "SickDay" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "family_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "started_at" TIMESTAMP(3) NOT NULL DEFAULT(now()),
  "ended_at" TIMESTAMP(3),
  "symptoms" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT('active'),
  "temperature_log" JSONB,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT(now())
);

CREATE TABLE IF NOT EXISTS "Medication" (
  "id" TEXT NOT NULL PRIMARY KEY,
  "sick_day_id" TEXT,
  "family_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dosage" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "next_dose_at" TIMESTAMP(3),
  "last_dose_at" TIMESTAMP(3),
  "active" BOOLEAN NOT NULL DEFAULT(true),
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP(3) NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP(3) NOT NULL DEFAULT(now())
);

CREATE INDEX IF NOT EXISTS "SickDay_family_id_status_idx" ON "SickDay"("family_id", "status");
CREATE INDEX IF NOT EXISTS "SickDay_person_id_idx" ON "SickDay"("person_id");
CREATE INDEX IF NOT EXISTS "Medication_family_id_active_idx" ON "Medication"("family_id", "active");
CREATE INDEX IF NOT EXISTS "Medication_person_id_idx" ON "Medication"("person_id");

DO $$ BEGIN ALTER TABLE "SickDay" ADD CONSTRAINT "SickDay_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SickDay" ADD CONSTRAINT "SickDay_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "SickDay" ADD CONSTRAINT "SickDay_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Medication" ADD CONSTRAINT "Medication_family_id_fkey" FOREIGN KEY ("family_id") REFERENCES "Family"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Medication" ADD CONSTRAINT "Medication_person_id_fkey" FOREIGN KEY ("person_id") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Medication" ADD CONSTRAINT "Medication_sick_day_id_fkey" FOREIGN KEY ("sick_day_id") REFERENCES "SickDay"("id") ON DELETE SET NULL ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN ALTER TABLE "Medication" ADD CONSTRAINT "Medication_created_by_fkey" FOREIGN KEY ("created_by") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE; EXCEPTION WHEN duplicate_object THEN NULL; END $$;
