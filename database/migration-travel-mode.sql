ALTER TABLE families ADD COLUMN IF NOT EXISTS travel_mode_active boolean DEFAULT false;
ALTER TABLE families ADD COLUMN IF NOT EXISTS travel_start_date timestamp;
ALTER TABLE families ADD COLUMN IF NOT EXISTS travel_end_date timestamp;
ALTER TABLE families ADD COLUMN IF NOT EXISTS travel_destination text;