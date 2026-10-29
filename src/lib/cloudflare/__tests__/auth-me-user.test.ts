import { findD1AuthMeUser } from '@/lib/cloudflare/accounts'
import type { D1Statement, D1Store } from '@/lib/cloudflare/database'

function fakeDatabase(row: Record<string, unknown> | null) {
  let sql = ''
  let bound: unknown[] = []
  const statement = {
    bind: (...values: unknown[]) => {
      bound = values
      return statement
    },
    first: async <T>() => row as T | null,
    all: async <T>() => ({ results: row ? [row as T] : [], success: true, meta: { changes: 0 } }),
    run: async () => ({ success: true, meta: { changes: 0 } }),
  } as unknown as D1Statement
  const session = {
    prepare: (query: string) => {
      sql = query
      return statement
    },
    batch: async () => [],
  }
  return {
    db: {
      prepare: session.prepare,
      batch: session.batch,
      withSession: () => session,
    } as unknown as D1Store,
    query: () => sql,
    parameters: () => bound,
  }
}

describe('findD1AuthMeUser', () => {
  it('reads the token generation and family card in one direct D1 query', async () => {
    const createdAt = Date.parse('2026-10-01T00:00:00.000Z')
    const lastChoreDate = Date.parse('2026-10-02T00:00:00.000Z')
    const fixture = fakeDatabase({
      id: 'user-a',
      email: 'parent@example.test',
      name: 'Parent',
      role: 'parent',
      age: null,
      family_id: 'family-a',
      avatar_url: null,
      created_at: createdAt,
      xp: 12,
      level: 2,
      streak: 3,
      best_streak: 4,
      last_chore_date: lastChoreDate,
      family_record_id: 'family-a',
      family_name: 'Home',
      family_subscription_tier: 'free',
      family_features: '{"gamification":false}',
    })

    const result = await findD1AuthMeUser(fixture.db, 'user-a', 7)

    expect(fixture.query()).toContain('LEFT JOIN "Family" f ON f.id = u.family_id')
    expect(fixture.query()).toContain('WHERE u.id=?1 AND u.token_version=?2')
    expect(fixture.parameters()).toEqual(['user-a', 7])
    expect(result).toMatchObject({
      user: {
        id: 'user-a',
        family_id: 'family-a',
        family: { id: 'family-a', name: 'Home', subscription_tier: 'free' },
      },
      familyFeatures: { gamification: false },
    })
    expect(result?.user.created_at).toEqual(new Date(createdAt))
    expect(result?.user.last_chore_date).toEqual(new Date(lastChoreDate))
    expect(result?.user).not.toHaveProperty('family_features')
  })

  it('keeps a user without a family private and returns no result for a stale generation', async () => {
    const noFamily = fakeDatabase({
      id: 'user-a',
      email: 'parent@example.test',
      name: 'Parent',
      role: 'parent',
      age: null,
      family_id: null,
      avatar_url: null,
      created_at: 0,
      xp: 0,
      level: 1,
      streak: 0,
      best_streak: 0,
      last_chore_date: null,
      family_record_id: null,
      family_name: null,
      family_subscription_tier: null,
      family_features: null,
    })

    const result = await findD1AuthMeUser(noFamily.db, 'user-a', 7)
    expect(result?.user.family).toBeNull()
    expect(result?.familyFeatures).toBeNull()

    const stale = fakeDatabase(null)
    await expect(findD1AuthMeUser(stale.db, 'user-a', 8)).resolves.toBeNull()
  })
})
