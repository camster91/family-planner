-- Migration: Sick Days + Medications
-- Creates SickDay and Medication tables

CREATE TABLE IF NOT EXISTS "SickDay" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT(cuid()),
  "family_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "started_at" TIMESTAMP NOT NULL DEFAULT(now()),
  "ended_at" TIMESTAMP,
  "symptoms" TEXT,
  "severity" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT('active'),
  "temperature_log" JSONB,
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP NOT NULL DEFAULT(now())
);

CREATE TABLE IF NOT EXISTS "Medication" (
  "id" TEXT NOT NULL PRIMARY KEY DEFAULT(cuid()),
  "sick_day_id" TEXT,
  "family_id" TEXT NOT NULL,
  "person_id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "dosage" TEXT NOT NULL,
  "schedule" TEXT NOT NULL,
  "next_dose_at" TIMESTAMP,
  "last_dose_at" TIMESTAMP,
  "active" BOOLEAN NOT NULL DEFAULT(true),
  "notes" TEXT,
  "created_by" TEXT NOT NULL,
  "created_at" TIMESTAMP NOT NULL DEFAULT(now()),
  "updated_at" TIMESTAMP NOT NULL DEFAULT(now())
);

CREATE INDEX IF NOT EXISTS "SickDay_family_id_status_idx" ON "SickDay"("family_id", "status");
CREATE INDEX IF NOT EXISTS "SickDay_person_id_idx" ON "SickDay"("person_id");
CREATE INDEX IF NOT EXISTS "Medication_family_id_active_idx" ON "Medication"("family_id", "active");
CREATE INDEX IF NOT EXISTS "Medication_person_id_idx" ON "Medication"("person_id");
