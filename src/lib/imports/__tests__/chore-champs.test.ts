import { planChoreChampsImport } from '../chore-champs'
import { importChoreChamps } from '../persist-chore-champs'

const source = {
  version: '1',
  family: { id: 'source-family', name: 'Ashley family' },
  kids: [{ id: 'kid-1', name: 'Sam' }],
  chores: [{
    id: 'chore-1',
    title: '  Dishes  ',
    description: '  After dinner  ',
    basePoints: 12,
    difficulty: 'HARD',
    recurring: 'DAILY',
    isActive: true,
    createdAt: '2026-08-01T00:00:00.000Z',
  }],
  assignments: [{
    id: 'assignment-1',
    choreId: 'chore-1',
    kidId: 'kid-1',
    dueDate: '2026-08-29T12:00:00.000Z',
    status: 'COMPLETED',
    completedAt: '2026-08-29T13:00:00.000Z',
    createdAt: '2026-08-28T12:00:00.000Z',
  }],
}

describe('planChoreChampsImport', () => {
  it('normalizes chores and maps assignments to Family Planner users', () => {
    const plan = planChoreChampsImport(source, { 'kid-1': 'user-1' })

    expect(plan.chores[0]).toMatchObject({
      sourceId: 'chore-1',
      title: 'Dishes',
      description: 'After dinner',
      difficulty: 'hard',
      frequency: 'daily',
    })
    expect(plan.assignments[0]).toMatchObject({
      sourceId: 'assignment-1',
      targetUserId: 'user-1',
      status: 'completed',
      idempotencyKey: 'chore-champs:assignment:assignment-1',
    })
    expect(plan.skippedAssignments).toEqual([])
  })

  it('reports assignments whose kid is not mapped instead of guessing identity', () => {
    const plan = planChoreChampsImport(source, {})

    expect(plan.assignments).toEqual([])
    expect(plan.skippedAssignments).toEqual([
      { sourceId: 'assignment-1', reason: 'No user mapping for kid kid-1' },
    ])
  })

  it('rejects malformed dates before any database mutation is planned', () => {
    const invalid = structuredClone(source)
    invalid.assignments[0].dueDate = 'not-a-date'

    expect(() => planChoreChampsImport(invalid, { 'kid-1': 'user-1' })).toThrow()
  })

  it('plans habits, rewards, goals, and badges without importing source identities', () => {
    const expanded = {
      ...source,
      habits: [{ id: 'habit-1', title: 'Read', points: 5, isActive: true, createdAt: '2026-08-01T00:00:00Z' }],
      habitLogs: [{ id: 'log-1', habitId: 'habit-1', kidId: 'kid-1', loggedDate: '2026-08-28', loggedAt: '2026-08-28T12:00:00Z' }],
      rewards: [{ id: 'reward-1', title: 'Movie', cost: 20, isActive: true, createdAt: '2026-08-01T00:00:00Z' }],
      redemptions: [{ id: 'redemption-1', rewardId: 'reward-1', kidId: 'kid-1', points: 20, createdAt: '2026-08-28T13:00:00Z' }],
      familyGoals: [{ id: 'goal-1', title: 'Team week', targetPoints: 100, currentPoints: 45, isActive: true, createdAt: '2026-08-01T00:00:00Z' }],
      badges: [{ id: 'badge-1', name: 'Starter', description: 'First chore', icon: 'star', requirement: 'FIRST_CHORE', createdAt: '2026-08-01T00:00:00Z' }],
      earnedBadges: [{ id: 'earned-1', badgeId: 'badge-1', kidId: 'kid-1', earnedAt: '2026-08-28T14:00:00Z' }],
    }

    const plan = planChoreChampsImport(expanded, { 'kid-1': 'user-1' })

    expect(plan.habits).toHaveLength(1)
    expect(plan.habitLogs[0]).toMatchObject({ sourceHabitId: 'habit-1', targetUserId: 'user-1' })
    expect(plan.rewards[0]).toMatchObject({ name: 'Movie', cost: 20 })
    expect(plan.redemptions[0]).toMatchObject({ sourceRewardId: 'reward-1', targetUserId: 'user-1' })
    expect(plan.familyGoals[0]).toMatchObject({ targetPoints: 100, currentPoints: 45 })
    expect(plan.badges[0].requirement).toEqual({ type: 'legacy', value: 'FIRST_CHORE' })
    expect(plan.earnedBadges[0]).toMatchObject({ sourceBadgeId: 'badge-1', targetUserId: 'user-1' })
    expect(plan.skippedRecords).toEqual([])
  })

  it('defaults to a database-free dry run', async () => {
    const result = await importChoreChamps(source, {
      familyId: 'family-1',
      startedBy: 'parent-1',
      kidToUserId: { 'kid-1': 'user-1' },
    })

    expect(result.jobId).toBeNull()
    expect(result.summary.created).toEqual({})
    expect(result.plan.assignments).toHaveLength(1)
  })
})
