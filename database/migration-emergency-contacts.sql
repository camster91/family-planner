-- Migration: Emergency contacts
-- Adds: EmergencyContact table for printable medical + emergency info cards

CREATE TABLE IF NOT EXISTS "EmergencyContact" (
  "id"           TEXT PRIMARY KEY,
  "family_id"    TEXT NOT NULL REFERENCES "Family"("id") ON DELETE CASCADE,
  "person_id"    TEXT REFERENCES "User"("id") ON DELETE SET NULL,
  "person_name"  TEXT NOT NULL,
  "relationship" TEXT NOT NULL,
  "blood_type" TEXT,
  "allergies"   TEXT,
  "medications" TEXT,
  "medical_conditions" TEXT,
  "doctor_name"  TEXT,
  "doctor_phone" TEXT,
  "dentist_name" TEXT,
  "dentist_phone" TEXT,
  "insurance_provider" TEXT,
  "insurance_id" TEXT,
  "emergency_contact_name"  TEXT,
  "emergency_contact_phone" TEXT,
  "emergency_contact_relation" TEXT,
  "notes"        TEXT,
  "created_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updated_at"   TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS "EmergencyContact_family_id_idx" ON "EmergencyContact"("family_id");
