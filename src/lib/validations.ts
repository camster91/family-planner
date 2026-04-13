import { z } from 'zod'

// Auth
export const loginSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password is required').max(128),
})

export const registerSchema = z.object({
  email: z.string().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().min(1, 'Name is required').max(100).trim(),
  role: z.enum(['parent', 'child', 'teen']).default('parent'),
})

// Chores
export const createChoreSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  points: z.number().int().min(0).max(1000).default(10),
  assigned_to: z.string().min(1),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
})

export const completeChoreSchema = z.object({
  choreId: z.string().min(1),
  photoUrl: z.string().max(500000).optional(), // base64 can be large
})

export const verifyChoreSchema = z.object({
  choreId: z.string().min(1),
  verificationNotes: z.string().max(500).optional(),
})

export const deleteChoreSchema = z.object({
  choreId: z.string().min(1),
})

// Events
export const createEventSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  start_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid start time'),
  end_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid end time').optional(),
  location: z.string().max(200).trim().optional(),
  event_type: z.enum(['school', 'sports', 'appointment', 'family', 'work', 'other']).default('other'),
})

// Family
export const createFamilySchema = z.object({
  name: z.string().min(1).max(100).trim(),
})

export const updateFamilySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().min(1).max(100).trim().optional(),
  subscription_tier: z.enum(['free', 'premium', 'family']).optional(),
})

export const deleteFamilySchema = z.object({
  familyId: z.string().min(1),
})

export const joinFamilySchema = z.object({
  familyId: z.string().min(1),
})

// Messages
export const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000).trim(),
  type: z.enum(['text', 'image', 'voice', 'announcement']).default('text'),
})

// Rewards
export const createRewardSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(500).trim().optional(),
  point_cost: z.number().int().min(1).max(100000),
  icon: z.string().max(50).default('gift'),
})

export const claimRewardSchema = z.object({
  rewardId: z.string().min(1),
})

// Notifications
export const createNotificationSchema = z.object({
  userId: z.string().min(1),
  title: z.string().min(1).max(200),
  message: z.string().min(1).max(1000),
  type: z.enum(['chore', 'event', 'message', 'reward', 'system', 'achievement', 'streak']),
})

export const updateNotificationSchema = z.object({
  notificationId: z.string().min(1).optional(),
  markAll: z.boolean().optional(),
})

export const deleteNotificationSchema = z.object({
  notificationId: z.string().min(1).optional(),
  clearAll: z.boolean().optional(),
})

// Lists
export const createListSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  type: z.enum(['grocery', 'todo', 'meal_plan', 'wishlist', 'shopping']),
  description: z.string().max(500).trim().optional(),
})

export const createListItemSchema = z.object({
  listId: z.string().min(1),
  content: z.string().min(1).max(500).trim(),
  quantity: z.number().int().min(1).max(9999).default(1),
  category: z.string().max(100).trim().optional(),
  notes: z.string().max(500).trim().optional(),
})

export const updateListItemSchema = z.object({
  itemId: z.string().min(1),
  checked: z.boolean().optional(),
  content: z.string().min(1).max(500).trim().optional(),
  quantity: z.number().int().min(1).max(9999).optional(),
  category: z.string().max(100).trim().optional(),
  notes: z.string().max(500).trim().optional(),
})

// Chores (update)
export const updateChoreSchema = z.object({
  choreId: z.string().min(1),
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  points: z.number().int().min(0).max(1000).optional(),
  assigned_to: z.string().min(1).optional(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
})

// Events (update + delete)
export const updateEventSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  start_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid start time').optional(),
  end_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid end time').optional(),
  location: z.string().max(200).trim().optional(),
  event_type: z.enum(['school', 'sports', 'appointment', 'family', 'work', 'other']).optional(),
})

export const deleteEventSchema = z.object({
  eventId: z.string().min(1),
})

// Rewards (update + delete)
export const updateRewardSchema = z.object({
  rewardId: z.string().min(1),
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(500).trim().optional(),
  point_cost: z.number().int().min(1).max(100000).optional(),
  icon: z.string().max(50).optional(),
})

export const deleteRewardSchema = z.object({
  rewardId: z.string().min(1),
})

// Lists (delete)
export const deleteListSchema = z.object({
  listId: z.string().min(1),
})

// Messages (mark as read)
export const markMessagesReadSchema = z.object({
  messageIds: z.array(z.string().min(1)).optional(),
  markAll: z.boolean().optional(),
})

// Auth (change password)
export const changePasswordSchema = z.object({
  currentPassword: z.string().min(1, 'Current password is required'),
  newPassword: z.string().min(8, 'New password must be at least 8 characters').max(128),
})

// Users
export const updateUserSchema = z.object({
  name: z.string().min(1).max(100).trim().optional(),
  age: z.union([z.number().int().min(1).max(150), z.string(), z.null()]).optional(),
})
