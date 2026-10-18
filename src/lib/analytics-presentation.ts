// Pure client-safe DTO validation for GET /api/analytics.
// Keep this module free of React, Next, database, and server-only imports so
// pages and tests can share the canonical response boundary safely.

// From GET /api/analytics. xp/level/streak/best_streak are only present when
// the family has Points & streaks on (#248).
export interface Member {
  id: string
  name: string
  role: string
  avatar_url?: string | null
  completedChores: number
  totalChores: number
  xp?: number
  level?: number
  streak?: number
  best_streak?: number
}

export interface WeeklyTrend {
  date: string
  day: string
  count: number
  points?: number
}

export interface AnalyticsData {
  members: Member[]
  weeklyCompletion: number
  weeklyTrend: WeeklyTrend[]
  gamification: boolean
  summary: {
    totalChores: number
    completedChores: number
    completionRate: number
    currentStreak: number
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function isCount(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && Number.isInteger(value) && value >= 0
}

function isPercent(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 100
}

function isDateOnly(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false
  const parsed = new Date(`${value}T00:00:00Z`)
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === value
}

/**
 * Parse the canonical analytics response without turning a malformed 200 into
 * a believable empty household. Unknown additive fields remain allowed, and
 * gamification fields remain optional because the API omits them when the
 * family setting is off.
 */
export function parseAnalyticsPayload(payload: unknown): AnalyticsData | null {
  if (!isRecord(payload)) return null
  if (typeof payload.weeklyCompletion !== 'number' || !isPercent(payload.weeklyCompletion)) return null
  if (typeof payload.gamification !== 'boolean') return null
  if (!isRecord(payload.summary)) return null

  const summary = payload.summary
  if (!isCount(summary.totalChores) || !isCount(summary.completedChores)) return null
  if (summary.completedChores > summary.totalChores) return null
  if (!isPercent(summary.completionRate) || !isCount(summary.currentStreak)) return null

  if (!Array.isArray(payload.members) || !Array.isArray(payload.weeklyTrend)) return null

  const memberIds = new Set<string>()
  const members: Member[] = []
  for (const value of payload.members) {
    if (!isRecord(value)) return null
    if (typeof value.id !== 'string' || value.id.length === 0 || memberIds.has(value.id)) return null
    if (typeof value.name !== 'string' || typeof value.role !== 'string') return null
    if (!isCount(value.completedChores) || !isCount(value.totalChores) || value.completedChores > value.totalChores) return null
    memberIds.add(value.id)
    members.push({
      id: value.id,
      name: value.name,
      role: value.role,
      avatar_url: typeof value.avatar_url === 'string' ? value.avatar_url : null,
      completedChores: value.completedChores,
      totalChores: value.totalChores,
      xp: isCount(value.xp) ? value.xp : undefined,
      level: isCount(value.level) ? value.level : undefined,
      streak: isCount(value.streak) ? value.streak : undefined,
      best_streak: isCount(value.best_streak) ? value.best_streak : undefined,
    })
  }

  const trendDates = new Set<string>()
  const weeklyTrend: WeeklyTrend[] = []
  for (const value of payload.weeklyTrend) {
    if (!isRecord(value) || !isDateOnly(value.date) || trendDates.has(value.date)) return null
    if (typeof value.day !== 'string' || !isCount(value.count)) return null
    if (value.points !== undefined && !isCount(value.points)) return null
    trendDates.add(value.date)
    weeklyTrend.push({
      date: value.date,
      day: value.day,
      count: value.count,
      points: isCount(value.points) ? value.points : undefined,
    })
  }

  return {
    members,
    weeklyCompletion: payload.weeklyCompletion,
    weeklyTrend,
    gamification: payload.gamification,
    summary: {
      totalChores: summary.totalChores,
      completedChores: summary.completedChores,
      completionRate: summary.completionRate,
      currentStreak: summary.currentStreak,
    },
  }
}
