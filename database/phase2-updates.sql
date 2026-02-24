-- Family Planner Phase 2 Database Updates
-- Run this AFTER setup.sql and updates.sql

-- Create lists table for shared family lists (grocery, todo, etc.)
CREATE TABLE IF NOT EXISTS lists (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  type TEXT NOT NULL DEFAULT 'grocery' CHECK (type IN ('grocery', 'todo', 'shopping', 'meal_plan', 'wishlist')),
  description TEXT,
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create list items table
CREATE TABLE IF NOT EXISTS list_items (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  list_id UUID NOT NULL REFERENCES lists(id) ON DELETE CASCADE,
  content TEXT NOT NULL,
  checked BOOLEAN DEFAULT false,
  added_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  checked_by UUID REFERENCES users(id),
  checked_at TIMESTAMP WITH TIME ZONE,
  quantity INTEGER DEFAULT 1,
  category TEXT,
  notes TEXT,
  position INTEGER DEFAULT 0,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create meal plans table (extends lists for meal planning)
CREATE TABLE IF NOT EXISTS meal_plans (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  date DATE NOT NULL,
  meal_type TEXT NOT NULL CHECK (meal_type IN ('breakfast', 'lunch', 'dinner', 'snack')),
  recipe_name TEXT,
  notes TEXT,
  cook_id UUID REFERENCES users(id),
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Create recipes table
CREATE TABLE IF NOT EXISTS recipes (
  id UUID DEFAULT uuid_generate_v4() PRIMARY KEY,
  family_id UUID NOT NULL REFERENCES families(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  description TEXT,
  ingredients JSONB NOT NULL DEFAULT '[]'::jsonb,
  instructions JSONB NOT NULL DEFAULT '[]'::jsonb,
  prep_time INTEGER, -- in minutes
  cook_time INTEGER, -- in minutes
  servings INTEGER,
  tags TEXT[],
  created_by UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL,
  updated_at TIMESTAMP WITH TIME ZONE DEFAULT TIMEZONE('utc'::text, NOW()) NOT NULL
);

-- Add indexes for performance
CREATE INDEX IF NOT EXISTS idx_lists_family_id ON lists(family_id);
CREATE INDEX IF NOT EXISTS idx_lists_type ON lists(type);
CREATE INDEX IF NOT EXISTS idx_list_items_list_id ON list_items(list_id);
CREATE INDEX IF NOT EXISTS idx_list_items_checked ON list_items(checked);
CREATE INDEX IF NOT EXISTS idx_meal_plans_family_id ON meal_plans(family_id);
CREATE INDEX IF NOT EXISTS idx_meal_plans_date ON meal_plans(date);
CREATE INDEX IF NOT EXISTS idx_recipes_family_id ON recipes(family_id);
CREATE INDEX IF NOT EXISTS idx_recipes_tags ON recipes USING GIN(tags);

-- Enable RLS for new tables
ALTER TABLE lists ENABLE ROW LEVEL SECURITY;
ALTER TABLE list_items ENABLE ROW LEVEL SECURITY;
ALTER TABLE meal_plans ENABLE ROW LEVEL SECURITY;
ALTER TABLE recipes ENABLE ROW LEVEL SECURITY;

-- RLS Policies for lists
CREATE POLICY "Family members can view lists" ON lists
  FOR SELECT USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family members can create lists" ON lists
  FOR INSERT WITH CHECK (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family members can update lists" ON lists
  FOR UPDATE USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family members can delete lists" ON lists
  FOR DELETE USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

-- RLS Policies for list_items
CREATE POLICY "Family members can view list items" ON list_items
  FOR SELECT USING (list_id IN (SELECT id FROM lists WHERE family_id IN (SELECT family_id FROM users WHERE id = auth.uid())));

CREATE POLICY "Family members can manage list items" ON list_items
  FOR ALL USING (list_id IN (SELECT id FROM lists WHERE family_id IN (SELECT family_id FROM users WHERE id = auth.uid())));

-- RLS Policies for meal_plans
CREATE POLICY "Family members can view meal plans" ON meal_plans
  FOR SELECT USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family members can manage meal plans" ON meal_plans
  FOR ALL USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

-- RLS Policies for recipes
CREATE POLICY "Family members can view recipes" ON recipes
  FOR SELECT USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

CREATE POLICY "Family members can manage recipes" ON recipes
  FOR ALL USING (family_id IN (SELECT family_id FROM users WHERE id = auth.uid()));

-- Update notifications table to include list types
-- (Already handled in setup.sql)

-- Add sample data for testing (optional)
-- Uncomment to create test lists and recipes
/*
INSERT INTO lists (family_id, name, type, description, created_by) 
SELECT 
  f.id,
  'Weekly Grocery List',
  'grocery',
  'Our weekly grocery shopping list',
  u.id
FROM families f
JOIN users u ON u.family_id = f.id AND u.role = 'parent'
LIMIT 1;

INSERT INTO list_items (list_id, content, added_by, category)
SELECT 
  l.id,
  'Milk',
  l.created_by,
  'Dairy'
FROM lists l
WHERE l.name = 'Weekly Grocery List'
UNION ALL
SELECT 
  l.id,
  'Eggs',
  l.created_by,
  'Dairy'
FROM lists l
WHERE l.name = 'Weekly Grocery List';
*/

-- Add photo support to chores for verification
ALTER TABLE chores ADD COLUMN IF NOT EXISTS photo_url TEXT;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS photo_verified BOOLEAN DEFAULT false;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS verification_notes TEXT;

-- Add age filters for chores
ALTER TABLE chores ADD COLUMN IF NOT EXISTS age_min INTEGER;
ALTER TABLE chores ADD COLUMN IF NOT EXISTS age_max INTEGER;

-- Create storage bucket for chore photos (run in Supabase Storage SQL)
-- CREATE POLICY "Chore photos are accessible by family members" ON storage.objects
--   FOR SELECT USING (bucket_id = 'chore-photos' AND (storage.foldername(name))[1] IN (
--     SELECT family_id::text FROM users WHERE id = auth.uid()
--   ));
-- 
-- CREATE POLICY "Users can upload their own chore photos" ON storage.objects
--   FOR INSERT WITH CHECK (bucket_id = 'chore-photos' AND auth.uid() = owner);

COMMENT ON TABLE lists IS 'Shared family lists for groceries, todos, etc.';
COMMENT ON TABLE list_items IS 'Items within a shared list';
COMMENT ON TABLE meal_plans IS 'Family meal planning by date';
COMMENT ON TABLE recipes IS 'Family recipe collection';