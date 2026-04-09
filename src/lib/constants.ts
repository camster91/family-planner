// App constants
export const APP_NAME = 'Family Planner'
export const APP_DESCRIPTION = 'Family management app for chores, calendar, communication, and tracking'

// Chore constants
export const CHORE_DIFFICULTY_POINTS = {
  easy: 10,
  medium: 25,
  hard: 50,
}

export const CHORE_STATUS = {
  PENDING: 'pending',
  IN_PROGRESS: 'in_progress',
  COMPLETED: 'completed',
  VERIFIED: 'verified',
  OVERDUE: 'overdue',
} as const

export const CHORE_FREQUENCY = {
  ONCE: 'once',
  DAILY: 'daily',
  WEEKLY: 'weekly',
  MONTHLY: 'monthly',
} as const

// User roles
export const USER_ROLES = {
  PARENT: 'parent',
  CHILD: 'child',
  TEEN: 'teen',
} as const

// Message types
export const MESSAGE_TYPES = {
  TEXT: 'text',
  IMAGE: 'image',
  VOICE: 'voice',
  ANNOUNCEMENT: 'announcement',
} as const

// Notification types
export const NOTIFICATION_TYPES = {
  CHORE: 'chore',
  EVENT: 'event',
  MESSAGE: 'message',
  REWARD: 'reward',
  SYSTEM: 'system',
} as const

// Age groups for interface customization
export const AGE_GROUPS = {
  YOUNG_CHILD: { min: 3, max: 7 },
  CHILD: { min: 8, max: 12 },
  TEEN: { min: 13, max: 17 },
  ADULT: { min: 18, max: 999 },
}

// Default chore categories
export const DEFAULT_CHORE_CATEGORIES = [
  'Kitchen',
  'Bathroom',
  'Bedroom',
  'Living Room',
  'Yard',
  'Pet Care',
  'Laundry',
  'Homework',
  'Personal Care',
  'Other',
]

// Default rewards
export const DEFAULT_REWARDS = [
  { title: 'Extra Screen Time', points: 100, description: '30 minutes of extra screen time' },
  { title: 'Special Treat', points: 150, description: 'Pick a special dessert or treat' },
  { title: 'Stay Up Late', points: 200, description: 'Stay up 30 minutes past bedtime' },
  { title: 'Choose Dinner', points: 250, description: 'Choose what the family has for dinner' },
  { title: 'Family Game Night', points: 300, description: 'Choose game for family game night' },
  { title: 'Special Outing', points: 500, description: 'Choose a special family outing' },
]

// Event colors
export const EVENT_COLORS = {
  SCHOOL: '#3B82F6', // Blue
  SPORTS: '#10B981', // Green
  APPOINTMENT: '#8B5CF6', // Purple
  FAMILY: '#F59E0B', // Yellow
  WORK: '#EC4899', // Pink
  OTHER: '#6B7280', // Gray
}

// Feature flags for phased rollout
export const FEATURE_FLAGS = {
  PHASE_1: {
    CHORE_MANAGEMENT: true,
    BASIC_CALENDAR: true,
    BASIC_MESSAGING: true,
    FAMILY_SETUP: true,
  },
  PHASE_2: {
    REWARDS_SYSTEM: true,
    RECURRING_CHORES: true,
    PHOTO_SHARING: true,
    SHARED_LISTS: true,
    GAMIFICATION: true,
    ACTIVITY_FEED: true,
    LEADERBOARD: true,
  },
  PHASE_3: {
    MOBILE_APPS: false,
    LOCATION_SERVICES: false,
    CALENDAR_SYNC: false,
    PUSH_NOTIFICATIONS: false,
  },
  PHASE_4: {
    ADVANCED_ANALYTICS: true,
    FAMILY_WELLNESS: false,
    EXTENDED_FAMILY: false,
    SUBSCRIPTIONS: false,
  },
}