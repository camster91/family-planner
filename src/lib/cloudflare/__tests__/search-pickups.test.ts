// D1 household search includes pickups (same rule as the Postgres loader in
// src/lib/household-search.ts): household-scoped, only while the household
// has pickups on, matched on title/location/notes, notes never returned.
jest.mock('@opennextjs/cloudflare', () => ({ getCloudflareContext: () => ({ env: {} }) }))

import { readD1HouseholdSearch } from '../search'
import type { D1Store, SqlValue } from '../database'

type Prepared = { sql: string; binds: SqlValue[] }

function fakeStore(features: Record<string, boolean>, pickupRows: unknown[]) {
  const prepared: Prepared[] = []
  const statement = (sql: string) => {
    const entry: Prepared = { sql, binds: [] }
    prepared.push(entry)
    const api = {
      bind(...values: SqlValue[]) {
        entry.binds = values
        return api
      },
      async first<T>() {
        return { family_id: 'family-a', role: 'parent', token_version: 0, features: JSON.stringify(features) } as T
      },
      async all<T>() {
        return { results: (sql.includes('FROM "Pickup"') ? pickupRows : []) as T[], success: true, meta: { changes: 0 } }
      },
      async run() {
        return { success: true, meta: { changes: 0 } }
      },
    }
    return api
  }
  const session = { prepare: statement, batch: jest.fn() }
  const store = { ...session, withSession: () => session } as unknown as D1Store
  return { store, prepared }
}

const actor = { userId: 'parent-a', familyId: 'family-a', role: 'parent', generation: 0 }

describe('readD1HouseholdSearch pickups', () => {
  it('finds a pickup by its words, bound to the household, without returning notes', async () => {
    const { store, prepared } = fakeStore({ pickups: true }, [
      { id: 'p1', title: 'Soccer practice drop-off', location: 'Field 3', pickup_time: Date.UTC(2026, 2, 2, 16) },
    ])
    const result = await readD1HouseholdSearch(actor, 'soccer', store)
    expect(result.status).toBe(200)
    expect((result.body as { results: unknown[] }).results).toEqual([
      { type: 'pickup', id: 'p1', title: 'Soccer practice drop-off', subtitle: 'Field 3', href: '/dashboard/pickups', date: '2026-03-02T16:00:00.000Z' },
    ])
    const query = prepared.find((p) => p.sql.includes('FROM "Pickup"'))!
    expect(query.sql).toMatch(/WHERE family_id=\?1/)
    expect(query.sql).toMatch(/lower\(COALESCE\(notes,''\)\) LIKE \?2/)
    expect(query.sql).not.toMatch(/SELECT[^]*notes[^]*FROM "Pickup"/)
    expect(query.binds).toEqual(['family-a', '%soccer%'])
  })

  it('does not search pickups while the household has them off', async () => {
    const { store, prepared } = fakeStore({ pickups: false }, [
      { id: 'p1', title: 'Soccer practice drop-off', location: null, pickup_time: Date.UTC(2026, 2, 2, 16) },
    ])
    const result = await readD1HouseholdSearch(actor, 'soccer', store)
    expect((result.body as { results: unknown[] }).results).toEqual([])
    expect(prepared.some((p) => p.sql.includes('FROM "Pickup"'))).toBe(false)
  })
})
