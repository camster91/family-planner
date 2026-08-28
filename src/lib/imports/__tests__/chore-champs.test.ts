import { planChoreChampsImport } from '../chore-champs'

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
})

