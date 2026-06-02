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
  photoUrl: z.string().max(500000).nullable().optional(),
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
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(500).trim().optional(),
  cost: z.number().int().min(1).max(100000),
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
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(500).trim().optional(),
  cost: z.number().int().min(1).max(100000).optional(),
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

// Budget - Transactions
export const createTransactionSchema = z.object({
  amount: z.number().refine((v) => v !== 0, 'Amount must not be zero'),
  type: z.enum(['income', 'expense']),
  category_id: z.string().min(1).optional().nullable(),
  description: z.string().max(500).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional(),
  is_recurring: z.boolean().default(false),
  recurring_interval: z.enum(['weekly', 'biweekly', 'monthly']).optional().nullable(),
})

export const updateTransactionSchema = z.object({
  transactionId: z.string().min(1),
  amount: z.number().refine((v) => v !== 0, 'Amount must not be zero').optional(),
  type: z.enum(['income', 'expense']).optional(),
  category_id: z.string().min(1).optional().nullable(),
  description: z.string().max(500).trim().optional().nullable(),
  notes: z.string().max(2000).trim().optional().nullable(),
  date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional(),
  is_recurring: z.boolean().optional(),
  recurring_interval: z.enum(['weekly', 'biweekly', 'monthly']).optional().nullable(),
})

export const deleteTransactionSchema = z.object({
  transactionId: z.string().min(1),
})

// Budget - Categories
export const createCategorySchema = z.object({
  name: z.string().min(1).max(100).trim(),
  icon: z.string().max(10).default('📦'),
  color: z.string().max(20).default('#6B7280'),
  type: z.enum(['income', 'expense']).default('expense'),
  budget_limit: z.number().min(0).optional().nullable(),
})

export const updateCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().min(1).max(100).trim().optional(),
  icon: z.string().max(10).optional(),
  color: z.string().max(20).optional(),
  type: z.enum(['income', 'expense']).optional(),
  budget_limit: z.number().min(0).optional().nullable(),
})

export const deleteCategorySchema = z.object({
  categoryId: z.string().min(1),
})

// Projects
export const createProjectSchema = z.object({
  name: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  color: z.string().max(20).default('#3B82F6'),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
})

export const updateProjectSchema = z.object({
  name: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional(),
  color: z.string().max(20).optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
})

// Project Tasks
export const createProjectTaskSchema = z.object({
  title: z.string().min(1).max(200).trim(),
  description: z.string().max(1000).trim().optional(),
  assigned_to: z.string().min(1).optional().nullable(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional().nullable(),
})

export const updateProjectTaskSchema = z.object({
  title: z.string().min(1).max(200).trim().optional(),
  description: z.string().max(1000).trim().optional().nullable(),
  completed: z.boolean().optional(),
  assigned_to: z.string().min(1).optional().nullable(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional().nullable(),
  position: z.number().int().min(0).optional(),
})
