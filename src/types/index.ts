// User roles
export type UserRole = 'parent' | 'child' | 'teen'

// User type
export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  age?: number
  family_id: string
  avatar_url?: string
  created_at: string
}

// Partial user type for queries that don't return all fields
export interface BasicUser {
  id: string
  name: string
  role: UserRole
  age?: number
  avatar_url?: string
}

// Family type
export interface Family {
  id: string
  name: string
  created_at: string
  subscription_tier: 'free' | 'premium' | 'family'
}

// Chore status
export type ChoreStatus = 'pending' | 'in_progress' | 'completed' | 'verified' | 'overdue'

// Chore frequency
export type ChoreFrequency = 'once' | 'daily' | 'weekly' | 'monthly'

// Chore type
export interface Chore {
  id: string
  family_id: string
  title: string
  description?: string
  points: number
  assigned_to: string // user_id
  due_date: string
  status: ChoreStatus
  frequency: ChoreFrequency
  difficulty: 'easy' | 'medium' | 'hard'
  verified_at?: string
  completed_at?: string
  created_at: string
}

// Event type
export interface Event {
  id: string
  family_id: string
  title: string
  description?: string
  start_time: string
  end_time: string
  location?: string
  recurrence?: string
  created_by: string
  created_at: string
}

// Message type
export interface Message {
  id: string
  family_id: string
  sender_id: string
  content: string
  type: 'text' | 'image' | 'voice' | 'announcement'
  attachments?: string[]
  read_by: string[] // user_ids
  created_at: string
}

// Reward type
export interface Reward {
  id: string
  family_id: string
  title: string
  description?: string
  point_cost: number
  claimed_by?: string
  claimed_at?: string
  created_at: string
}

// Notification type
export interface Notification {
  id: string
  user_id: string
  title: string
  message: string
  type: 'chore' | 'event' | 'message' | 'reward' | 'system' | 'list'
  read: boolean
  created_at: string
}

// List types
export type ListType = 'grocery' | 'todo' | 'meal_plan' | 'wishlist' | 'shopping'

// List type
export interface FamilyList {
  id: string
  family_id: string
  name: string
  type: ListType
  description?: string
  created_by: string
  created_at: string
  updated_at: string
}

// List item type
export interface ListItem {
  id: string
  list_id: string
  content: string
  checked: boolean
  quantity: number
  category?: string
  notes?: string
  added_by: string
  checked_by?: string
  checked_at?: string
  position: number
  created_at: string
  updated_at: string
}

// Meal plan type
export interface MealPlan {
  id: string
  family_id: string
  date: string
  meal_type: 'breakfast' | 'lunch' | 'dinner' | 'snack'
  recipe_name?: string
  notes?: string
  cook_id?: string
  created_by: string
  created_at: string
}

// Recipe type
export interface Recipe {
  id: string
  family_id: string
  name: string
  description?: string
  ingredients: string[]
  instructions: string[]
  prep_time?: number
  cook_time?: number
  servings?: number
  tags?: string[]
  created_by: string
  created_at: string
  updated_at: string
}

// Dashboard stats
export interface DashboardStats {
  total_chores: number
  completed_chores: number
  pending_chores: number
  total_points: number
  upcoming_events: number
  unread_messages: number
  family_streak: number
}