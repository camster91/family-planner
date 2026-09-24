// awardChoreXP: XP must be applied as an atomic increment (so a concurrent
// rewards/claim decrement is never overwritten), and the streak is a UTC
// calendar-day streak rather than "+1 per chore within 48h".

type UserRow = {
  id: string
  xp: number
  level: number
  streak: number
  best_streak: number
  last_chore_date: Date | null
}

let user: UserRow
// Hook run after the award has read the user row but before it writes, to
// simulate a concurrent rewards/claim deduction landing in between.
let betweenReadAndWrite: (() => void) | null = null
const queryRaw = jest.fn(async () => [])

const tx = {
  $queryRaw: queryRaw,
  user: {
    findUnique: async ({ where }: { where: { id: string } }) => {
      if (where.id !== user.id) return null
      const snapshot = { ...user }
      betweenReadAndWrite?.()
      return snapshot
    },
    update: async ({ data }: { data: Record<string, unknown> }) => {
      for (const [k, v] of Object.entries(data)) {
        if (v && typeof v === 'object' && 'increment' in (v as object)) {
          ;(user as Record<string, unknown>)[k] =
            ((user as Record<string, unknown>)[k] as number) + (v as { increment: number }).increment
        } else {
          ;(user as Record<string, unknown>)[k] = v
        }
      }
      return { ...user }
    },
  },
}

jest.mock('@/lib/prisma', () => ({
  prisma: {
    $transaction: async (fn: (t: unknown) => Promise<unknown>) => fn(tx),
  },
}))

import { awardChoreXP, nextStreak, utcDayDiff, levelForXp } from '@/lib/gamification-server'

const NOW = new Date('2026-09-24T10:00:00Z')

beforeEach(() => {
  jest.useFakeTimers({ now: NOW })
  betweenReadAndWrite = null
  queryRaw.mockClear()
  user = { id: 'kid', xp: 50, level: 1, streak: 0, best_streak: 0, last_chore_date: null }
})

afterEach(() => {
  jest.useRealTimers()
})

describe('awardChoreXP', () => {
  it('increments XP instead of overwriting a concurrent deduction', async () => {
    // rewards/claim deducts 30 XP after the award read the row.
    betweenReadAndWrite = () => {
      user.xp -= 30
    }

    const result = await awardChoreXP('kid', 'easy', 10)

    expect(result.xpGained).toBe(10)
    // 50 - 30 + 10; the old absolute write produced 60 (the claim was undone).
    expect(user.xp).toBe(30)
    expect(result.newXp).toBe(30)
  })

  it('locks the user row before reading it', async () => {
    await awardChoreXP('kid', 'easy', 10)
    expect(queryRaw).toHaveBeenCalledTimes(1)
  })

  it('runs inside a caller-supplied transaction', async () => {
    const result = await awardChoreXP('kid', 'easy', 10, tx as never)
    expect(result.newXp).toBe(60)
  })

  it('computes the level from the incremented total', async () => {
    user.xp = 95
    const result = await awardChoreXP('kid', 'easy', 10)
    expect(result.levelUp).toBe(true)
    expect(result.newLevel).toBe(2)
    expect(user.level).toBe(2)
  })

  it('throws when the user does not exist', async () => {
    await expect(awardChoreXP('nobody', 'easy', 10)).rejects.toThrow('User not found')
  })

  it('does not advance the streak for a second chore on the same day', async () => {
    user.streak = 3
    user.best_streak = 3
    user.last_chore_date = new Date('2026-09-24T01:00:00Z')

    const result = await awardChoreXP('kid', 'easy', 10)
    expect(result.streak).toBe(3)
    expect(user.streak).toBe(3)
  })

  it('advances the streak on the next calendar day and tracks best streak', async () => {
    user.streak = 3
    user.best_streak = 3
    // Only ~11h earlier, but on the previous UTC day.
    user.last_chore_date = new Date('2026-09-23T23:00:00Z')

    const result = await awardChoreXP('kid', 'easy', 10)
    expect(result.streak).toBe(4)
    expect(result.bestStreak).toBe(4)
  })

  it('resets the streak after a missed day but keeps best streak', async () => {
    user.streak = 5
    user.best_streak = 5
    // Within 48h, but two calendar days ago.
    user.last_chore_date = new Date('2026-09-22T12:00:00Z')

    const result = await awardChoreXP('kid', 'easy', 10)
    expect(result.streak).toBe(1)
    expect(result.bestStreak).toBe(5)
  })
})

describe('streak helpers', () => {
  it('utcDayDiff compares UTC dates only', () => {
    expect(utcDayDiff(new Date('2026-09-23T23:59:59Z'), new Date('2026-09-24T00:00:01Z'))).toBe(1)
    expect(utcDayDiff(new Date('2026-09-24T00:00:00Z'), new Date('2026-09-24T23:59:59Z'))).toBe(0)
  })

  it('nextStreak starts at 1 with no history and is at least 1 on the same day', () => {
    expect(nextStreak(0, null, NOW)).toBe(1)
    expect(nextStreak(0, NOW, NOW)).toBe(1)
  })

  it('levelForXp never lowers the level and can climb several levels', () => {
    expect(levelForXp(0, 3)).toBe(3)
    expect(levelForXp(350, 1)).toBe(4) // thresholds 100, 200, 300
  })
})
