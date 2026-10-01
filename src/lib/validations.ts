import { z } from 'zod'
import { ROUTINE_ICON_KEYS, ROUTINE_NAME_MAX, ROUTINE_ORDER_MAX, normalizeRoutineName } from '@/lib/routine-icons'

// Auth
// Trimmed before the format check, so an autofilled trailing space does not
// fail a correct sign-in. The login route also matches the lower-cased form
// (new accounts are stored lower-cased; a phone keyboard capitalises the
// first letter).
export const loginSchema = z.object({
  email: z.string().trim().email('Invalid email format').max(255),
  password: z.string().min(1, 'Password is required').max(128),
})

export const registerSchema = z.object({
  email: z.string().trim().toLowerCase().email('Invalid email format').max(255),
  password: z.string().min(8, 'Password must be at least 8 characters').max(128),
  name: z.string().trim().min(1, 'Name is required').max(100),
  role: z.enum(['parent', 'child', 'teen']).default('parent'),
  inviteToken: z.string().length(64).optional(),
})

// Chores
// Picture routines (#272). `icon` is a key of the built-in set; `routine` a
// short label (empty clears); `routine_order` the step number. null clears.
const choreIconSchema = z.enum(ROUTINE_ICON_KEYS, {
  errorMap: () => ({ message: 'Choose a picture from the list' }),
})
const choreRoutineSchema = z
  .string()
  .max(200, `Routine name must be ${ROUTINE_NAME_MAX} characters or fewer`)
  .transform((v) => normalizeRoutineName(v))
  .refine((v) => v === null || v.length <= ROUTINE_NAME_MAX, `Routine name must be ${ROUTINE_NAME_MAX} characters or fewer`)
const choreRoutineOrderSchema = z
  .number()
  .int('Step must be a whole number')
  .min(1, 'Step must be 1 or more')
  .max(ROUTINE_ORDER_MAX, `Step must be ${ROUTINE_ORDER_MAX} or less`)

export const createChoreSchema = z.object({
  title: z.string().trim().min(1).max(200),
  // The chore forms send null for an empty description.
  description: z.string().max(1000).trim().nullable().optional(),
  points: z.number().int().min(0).max(1000).default(10),
  assigned_to: z.string().min(1),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date'),
  difficulty: z.enum(['easy', 'medium', 'hard']).default('medium'),
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).default('once'),
  // An /api/upload result owned by the caller's family (D3); checked in the route.
  photo_url: z.string().max(500).nullable().optional(),
  icon: choreIconSchema.nullable().optional(),
  routine: choreRoutineSchema.nullable().optional(),
  routine_order: choreRoutineOrderSchema.nullable().optional(),
})

export const completeChoreSchema = z.object({
  choreId: z.string().min(1),
  // An /api/upload result owned by the caller's family (D3); checked in the route.
  photoUrl: z.string().max(500).nullable().optional(),
})

// Undo a completion (#268/#269): the chore goes back to pending.
export const uncompleteChoreSchema = z.object({
  choreId: z.string().min(1),
})

// A parent checks a completed chore. `decision` defaults to 'approve' so older
// clients that send only { choreId } keep working; 'reject' sends the chore
// back to the child (status 'pending') with the optional note as the reason.
export const verifyChoreSchema = z.object({
  choreId: z.string().min(1),
  decision: z.enum(['approve', 'reject']).default('approve'),
  verificationNotes: z.string().max(500).trim().optional(),
})

export const deleteChoreSchema = z.object({
  choreId: z.string().min(1),
})

// Events
// RRULE string (e.g. "FREQ=WEEKLY;BYDAY=MO") — consumed by the ICS feed.
// The charset is deliberately restricted (no CR/LF, colons beyond the optional
// RRULE: prefix) so an injected value cannot smuggle extra ICS lines into the
// calendar feed, which interpolates recurrence verbatim.
export const recurrenceSchema = z
  .string()
  .max(200)
  .trim()
  .refine((val) => /^(RRULE:)?[A-Za-z0-9;:=,.\-/]+$/.test(val), 'Invalid recurrence rule')
  .nullable()
  .optional()

export const createEventSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).trim().nullable().optional(),
  start_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid start time'),
  end_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid end time').optional(),
  location: z.string().max(200).trim().nullable().optional(),
  event_type: z.enum(['school', 'sports', 'appointment', 'family', 'work', 'other']).default('other'),
  recurrence: recurrenceSchema,
})

// Family
export const createFamilySchema = z.object({
  name: z.string().trim().min(1).max(100),
})

export const updateFamilySchema = z.object({
  familyId: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
  subscription_tier: z.enum(['free', 'premium', 'family']).optional(),
})

export const deleteFamilySchema = z.object({
  familyId: z.string().min(1),
})

export const joinFamilySchema = z
  .object({
    inviteCode: z.string().min(8).max(64).trim().optional(),
    token: z.string().length(64).optional(),
  })
  .refine((data) => Boolean(data.token || data.inviteCode), {
    message: 'inviteCode or token is required',
  })

export const createEmailInviteSchema = z.object({
  // Trim before the format check (a pasted " a@b.com " is valid) and store the
  // lower-cased address, as registration does.
  email: z.string().trim().toLowerCase().email('Valid email is required').max(255),
  role: z.enum(['parent', 'teen', 'child']),
})

// Messages
export const sendMessageSchema = z.object({
  content: z.string().trim().min(1).max(5000),
  type: z.enum(['text', 'image', 'voice', 'announcement']).default('text'),
})

// Rewards
export const createRewardSchema = z.object({
  name: z.string().trim().min(1).max(200),
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
  name: z.string().trim().min(1).max(200),
  // O-8 (ADR-0007): the UI no longer offers 'meal_plan' for new lists; meals
  // live in FamilyMeal. The server still accepts it so installed Android
  // bundles that show the old picker keep working until a version gate exists.
  type: z.enum(['grocery', 'todo', 'meal_plan', 'wishlist', 'shopping']),
  // Accept null too (clients sometimes send null for optional fields); treat as undefined.
  description: z.union([z.string().max(500).trim(), z.null()]).optional().transform(v => v ?? undefined),
})

const listItemAmount = z.number().finite().min(0).max(100000)
const listItemUnit = z.string().trim().min(1).max(32)

export const createListItemSchema = z.object({
  listId: z.string().min(1),
  content: z.string().trim().min(1).max(500),
  quantity: z.number().int().min(1).max(9999).default(1),
  category: z.string().max(100).trim().optional(),
  notes: z.string().max(500).trim().optional(),
  // Grocery provenance (ADR-0007, O-6). Optional; old clients never send them.
  // `ingredient_id` must be an Ingredient of the list's household (checked in the route).
  amount: listItemAmount.optional(),
  unit: listItemUnit.optional(),
  ingredient_id: z.string().min(1).max(128).optional(),
})

export const updateListItemSchema = z.object({
  itemId: z.string().min(1),
  checked: z.boolean().optional(),
  content: z.string().trim().min(1).max(500).optional(),
  quantity: z.number().int().min(1).max(9999).optional(),
  category: z.string().max(100).trim().optional(),
  notes: z.string().max(500).trim().optional(),
  // null clears. `ingredient_id` is household-validated in src/lib/list-item-update.ts.
  amount: listItemAmount.nullable().optional(),
  unit: listItemUnit.nullable().optional(),
  ingredient_id: z.string().min(1).max(128).nullable().optional(),
})

// Chores (update)
// These fields are set only by dedicated endpoints:
//   - status, photo_verified, verified_at, verified_notes → POST /api/chores/verify (parent;
//     `decision: 'approve'` verifies, `decision: 'reject'` sends it back to pending)
//   - status (completed), photo_url, photo_verified (false) → POST /api/chores/complete (any member)
// Children/teens may NOT set them via PATCH.
export const updateChoreSchema = z.object({
  choreId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  // null clears the description (the edit form sends null when emptied).
  description: z.string().max(1000).trim().nullable().optional(),
  points: z.number().int().min(0).max(1000).optional(),
  assigned_to: z.string().min(1).optional(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional(),
  difficulty: z.enum(['easy', 'medium', 'hard']).optional(),
  frequency: z.enum(['once', 'daily', 'weekly', 'monthly']).optional(),
  // For a generated copy of a recurring series: apply `frequency` to the whole
  // series (O-33). Without it a copy's frequency is left alone.
  apply_to_series: z.boolean().optional(),
  // An /api/upload result owned by the caller's family (D3), or null to clear;
  // checked in the route.
  photo_url: z.string().max(500).nullable().optional(),
  // Picture routines (#272); null clears.
  icon: choreIconSchema.nullable().optional(),
  routine: choreRoutineSchema.nullable().optional(),
  routine_order: choreRoutineOrderSchema.nullable().optional(),
})

// Events (update + delete)
export const updateEventSchema = z.object({
  eventId: z.string().min(1),
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).trim().nullable().optional(),
  start_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid start time').optional(),
  end_time: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid end time').optional(),
  location: z.string().max(200).trim().nullable().optional(),
  event_type: z.enum(['school', 'sports', 'appointment', 'family', 'work', 'other']).optional(),
  recurrence: recurrenceSchema,
})

export const deleteEventSchema = z.object({
  eventId: z.string().min(1),
})

// Rewards (update + delete)
export const updateRewardSchema = z.object({
  rewardId: z.string().min(1),
  name: z.string().trim().min(1).max(200).optional(),
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
  name: z.string().trim().min(1).max(100).optional(),
  // A string form must be digits (empty clears): "abc" or "1e9" used to reach
  // the database as NaN / out-of-range and answer 500.
  age: z
    .union([
      z.number().int().min(1).max(150),
      z
        .string()
        .trim()
        .refine((v) => v === '' || (/^\d{1,3}$/.test(v) && Number(v) >= 1 && Number(v) <= 150), 'Age must be between 1 and 150'),
      z.null(),
    ])
    .optional(),
})

// Budget - Transactions
// Non-zero, at least 0.01, at most 2 decimal places. The decimal check runs on
// the string form because float math is unreliable (19.99 * 100 is not 1999).
const amountSchema = z
  .number()
  .refine((v) => v !== 0, 'Amount must not be zero')
  .refine((v) => Math.abs(v) >= 0.01, 'Amount too small')
  .refine(
    (v) => /^-?\d+(\.\d{1,2})?$/.test(String(v)),
    'Amount supports at most 2 decimal places'
  )

export const createTransactionSchema = z.object({
  amount: amountSchema,
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
  amount: amountSchema.optional(),
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
  name: z.string().trim().min(1).max(100),
  icon: z.string().max(10).default('📦'),
  color: z.string().max(20).default('#6B7280'),
  type: z.enum(['income', 'expense']).default('expense'),
  budget_limit: z.number().min(0).optional().nullable(),
})

export const updateCategorySchema = z.object({
  categoryId: z.string().min(1),
  name: z.string().trim().min(1).max(100).optional(),
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
  name: z.string().trim().min(1).max(200),
  description: z.string().max(1000).trim().optional(),
  color: z.string().max(20).default('#3B82F6'),
  status: z.enum(['active', 'completed', 'archived']).default('active'),
})

export const updateProjectSchema = z.object({
  name: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).trim().optional(),
  color: z.string().max(20).optional(),
  status: z.enum(['active', 'completed', 'archived']).optional(),
})

// Project Tasks
export const createProjectTaskSchema = z.object({
  title: z.string().trim().min(1).max(200),
  description: z.string().max(1000).trim().optional(),
  assigned_to: z.string().min(1).optional().nullable(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional().nullable(),
})

export const updateProjectTaskSchema = z.object({
  title: z.string().trim().min(1).max(200).optional(),
  description: z.string().max(1000).trim().optional().nullable(),
  completed: z.boolean().optional(),
  assigned_to: z.string().min(1).optional().nullable(),
  due_date: z.string().refine((val) => !isNaN(Date.parse(val)), 'Invalid date').optional().nullable(),
  position: z.number().int().min(0).optional(),
})

// Shared: a string that parses to a real date (`new Date(x)` is not Invalid Date).
const validDateString = (message: string) =>
  z.string({ required_error: message, invalid_type_error: message }).refine((val) => !isNaN(Date.parse(val)), message)

// Anniversaries
const anniversaryType = z.enum(['birthday', 'anniversary', 'custom'], {
  errorMap: () => ({ message: 'Invalid type' }),
})

export const createAnniversarySchema = z.object(
  {
    name: z
      .string({ required_error: 'name, type, and date are required', invalid_type_error: 'name must be a string' })
      .trim()
      .min(1, 'name, type, and date are required')
      .max(200),
    type: anniversaryType,
    date: validDateString('date must be a valid date'),
    notes: z.string({ invalid_type_error: 'notes must be a string' }).max(2000).nullable().optional(),
    person_id: z.string({ invalid_type_error: 'person_id must be a string' }).nullable().optional(),
  },
  { invalid_type_error: 'Request body must be a JSON object' }
)

export const updateAnniversarySchema = z.object(
  {
    name: z
      .string({ invalid_type_error: 'name must be a string' })
      .trim()
      .min(1, 'name cannot be empty')
      .max(200)
      .optional(),
    type: anniversaryType.optional(),
    date: validDateString('date must be a valid date').optional(),
    notes: z.string({ invalid_type_error: 'notes must be a string' }).max(2000).nullable().optional(),
    person_id: z.string({ invalid_type_error: 'person_id must be a string' }).nullable().optional(),
  },
  { invalid_type_error: 'Request body must be a JSON object' }
)

// Pickups
export const createPickupSchema = z.object(
  {
    title: z
      .string({ required_error: 'title and pickup_time required', invalid_type_error: 'title must be a string' })
      .trim()
      .min(1, 'title and pickup_time required')
      .max(200),
    location: z.string({ invalid_type_error: 'location must be a string' }).max(500).nullable().optional(),
    pickup_time: validDateString('pickup_time must be a valid date-time'),
    assigned_to: z.string({ invalid_type_error: 'assigned_to must be a string' }).nullable().optional(),
    notes: z.string({ invalid_type_error: 'notes must be a string' }).max(2000).nullable().optional(),
  },
  { invalid_type_error: 'Request body must be a JSON object' }
)

// Allowance
export const createAllowanceSchema = z.object(
  {
    to_user_id: z
      .string({
        required_error: 'to_user_id and positive amount required',
        invalid_type_error: 'to_user_id and positive amount required',
      })
      .min(1, 'to_user_id and positive amount required'),
    amount: z
      .number({
        required_error: 'to_user_id and positive amount required',
        invalid_type_error: 'to_user_id and positive amount required',
      })
      .finite('to_user_id and positive amount required')
      .positive('to_user_id and positive amount required'),
    reason: z.string({ invalid_type_error: 'reason must be a string' }).max(500).nullable().optional(),
  },
  { invalid_type_error: 'Request body must be a JSON object' }
)
