import { prisma } from '@/lib/prisma'
import { normalizeFeatures } from '@/lib/features'

/**
 * Points, streaks and the leaderboard are a per-family setting (#248,
 * `gamification` in src/lib/features.ts). When a family has it off, no XP,
 * level, streak or chore-points value may reach the browser for any role —
 * not in the rendered HTML, the RSC payload, or the JSON of the APIs those
 * pages read. Server code strips the fields with the helpers below instead of
 * relying on the UI to hide them.
 *
 * XP itself keeps accruing in the background (chore verify still awards it),
 * so turning the setting back on shows current totals rather than a reset.
 */

/** User columns that carry gamification state. */
export const GAMIFICATION_USER_FIELDS = ['xp', 'level', 'streak', 'best_streak', 'last_chore_date'] as const
type GamificationUserField = (typeof GAMIFICATION_USER_FIELDS)[number]

/** Whether the family has Points & streaks on. No family = off. */
export async function isGamificationOn(familyId: string | null | undefined): Promise<boolean> {
  if (!familyId) return false
  const family = await prisma!.family.findUnique({
    where: { id: familyId },
    select: { features: true },
  })
  if (!family) return false
  return normalizeFeatures(family.features).gamification
}

/** A copy of `row` without xp / level / streak / best_streak / last_chore_date. */
export function omitUserGamification<T extends object>(row: T): Omit<T, GamificationUserField> {
  const out = { ...row } as Record<string, unknown>
  for (const k of GAMIFICATION_USER_FIELDS) delete out[k]
  return out as Omit<T, GamificationUserField>
}

/** A copy of a chore row without its `points` (and any derived `streak`). */
export function omitChorePoints<T extends object>(row: T): Omit<T, 'points' | 'streak'> {
  const out = { ...row } as Record<string, unknown>
  delete out.points
  delete out.streak
  return out as Omit<T, 'points' | 'streak'>
}
