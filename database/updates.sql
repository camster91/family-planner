-- Family Planner Database Updates
-- Run this AFTER running setup.sql

-- Add reminder tracking fields to events table
ALTER TABLE events 
ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS daily_reminder_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_hours_before INTEGER DEFAULT 1;

-- Add overdue tracking to chores table
ALTER TABLE chores
ADD COLUMN IF NOT EXISTS overdue_notification_sent BOOLEAN DEFAULT false,
ADD COLUMN IF NOT EXISTS reminder_sent BOOLEAN DEFAULT false;

-- Create invites table for invitation system
CREATE TABLE IF NOT EXISTS invites (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  email TEXT NOT NULL,
  code TEXT NOT NULL UNIQUE,
  role TEXT NOT NULL DEFAULT 'child' CHECK (role IN ('parent', 'child', 'teen')),
  invited_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  expires_at TIMESTAMP WITH TIME ZONE NOT NULL,
  accepted_at TIMESTAMP WITH TIME ZONE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_invites_code ON invites(code);
CREATE INDEX IF NOT EXISTS idx_invites_family_id ON invites(family_id);
CREATE INDEX IF NOT EXISTS idx_invites_email ON invites(email);

-- Enable RLS for invites
ALTER TABLE invites ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Family members can view invites" ON invites
  FOR SELECT USING (
    family_id IN (SELECT family_id FROM users WHERE id = auth.uid())
  );

CREATE POLICY "Parents can create invites" ON invites
  FOR INSERT WITH CHECK (
    invited_by = auth.uid() AND
    invited_by IN (SELECT id FROM users WHERE role = 'parent' AND family_id = invites.family_id)
  );

CREATE POLICY "Parents can delete invites" ON invites
  FOR DELETE USING (
    invited_by = auth.uid() AND
    invited_by IN (SELECT id FROM users WHERE role = 'parent' AND family_id = invites.family_id)
  );

-- Add sample notification types for testing
INSERT INTO notifications (user_id, title, message, type, read)
SELECT 
  u.id,
  'Welcome to Family Planner!',
  'Start by creating chores, adding events, and inviting family members.',
  'system',
  false
FROM users u
WHERE NOT EXISTS (
  SELECT 1 FROM notifications n 
  WHERE n.user_id = u.id 
  AND n.title = 'Welcome to Family Planner!'
)
ON CONFLICT DO NOTHING;

-- Create function to clean up expired invites
CREATE OR REPLACE FUNCTION cleanup_expired_invites()
RETURNS void AS $$
BEGIN
  DELETE FROM invites WHERE expires_at < NOW();
END;
$$ LANGUAGE plpgsql;

-- Create function to send chore completion notifications
CREATE OR REPLACE FUNCTION notify_chore_completion()
RETURNS TRIGGER AS $$
BEGIN
  -- When a chore is marked as completed
  IF NEW.status = 'completed' AND OLD.status != 'completed' THEN
    -- Insert notification for the parent/creator
    IF NEW.created_by != NEW.assigned_to THEN
      INSERT INTO notifications (user_id, title, message, type)
      VALUES (
        NEW.created_by,
        'Chore Completed! 🎉',
        'A chore has been marked as completed.',
        'chore'
      );
    END IF;
    
    -- Insert notification for the person who completed it
    INSERT INTO notifications (user_id, title, message, type)
    VALUES (
      NEW.assigned_to,
      'Great Job!',
      'You completed a chore!',
      'reward'
    );
  END IF;
  
  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

-- Create trigger for chore completion notifications
DROP TRIGGER IF EXISTS on_chore_completed ON chores;
CREATE TRIGGER on_chore_completed
  AFTER UPDATE ON chores
  FOR EACH ROW
  EXECUTE FUNCTION notify_chore_completion();

-- Update sample data with new fields
-- (Uncomment to add sample data for testing)
/*
UPDATE events 
SET reminder_hours_before = 1 
WHERE reminder_hours_before IS NULL;

UPDATE chores 
SET overdue_notification_sent = false,
    reminder_sent = false
WHERE overdue_notification_sent IS NULL;
*/

-- Add comment explaining the updates
COMMENT ON TABLE invites IS 'Stores family invitation codes and status';
COMMENT ON COLUMN events.reminder_sent IS 'Whether immediate reminder (1 hour before) has been sent';
COMMENT ON COLUMN events.daily_reminder_sent IS 'Whether daily reminder (24 hours before) has been sent';
COMMENT ON COLUMN chores.overdue_notification_sent IS 'Whether overdue notification has been sent';
COMMENT ON COLUMN chores.reminder_sent IS 'Whether reminder notification has been sent';