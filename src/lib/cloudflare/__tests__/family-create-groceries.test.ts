// Native D1 household creation makes the first "Groceries" list in the same
// batch as the family and membership (owner-approved review item A4).
//
// Runs the real D1 migrations in an in-memory SQLite database (node:sqlite)
// behind a minimal D1Store adapter whose `batch` is one transaction, as D1's
// is. scripts/cloudflare/identity-smoke.mjs covers the same batch on workerd.
import fs from 'node:fs'
import path from 'node:path'
import type { D1Store } from '@/lib/cloudflare/database'
import { createD1Family } from '@/lib/cloudflare/family-create'
import { readD1GetStarted, readD1TodayStarts } from '@/lib/cloudflare/today-home'
import { DEFAULT_GROCERY_LIST_NAME } from '@/lib/grocery-from-recipe-contract'

// The installed @types/node predates node:sqlite (Node 22.13+), so type the
// small part this test uses.
type SqliteParam = string | number | null
interface SqliteStatement {
  get(...params: SqliteParam[]): unknown
  all(...params: SqliteParam[]): unknown[]
  run(...params: SqliteParam[]): { changes: number | bigint }
}
interface SqliteDatabase {
  exec(sql: string): void
  prepare(sql: string): SqliteStatement
}
const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqliteDatabase }

type Row = Record<string, unknown>

function sqliteD1(): { store: D1Store; sql: SqliteDatabase } {
  const sql = new DatabaseSync(':memory:')
  const dir = path.join(process.cwd(), 'database/cloudflare')
  for (const file of fs.readdirSync(dir).filter((name) => name.endsWith('.sql')).sort()) {
    sql.exec(fs.readFileSync(path.join(dir, file), 'utf8'))
  }
  const statement = (query: string, values: unknown[] = []) => {
    // D1 numbers its parameters ?1..?N; node:sqlite binds them positionally.
    const prepared = () => sql.prepare(query)
    const args = values as Array<string | number | null>
    const api = {
      bind: (...next: unknown[]) => statement(query, next),
      first: async <T,>() => (prepared().get(...args) as T | undefined) ?? null,
      all: async <T,>() => ({ results: prepared().all(...args) as T[], success: true, meta: {} }),
      run: async () => {
        const result = prepared().run(...args)
        return { success: true, meta: { changes: Number(result.changes) } }
      },
      __exec: () => {
        const stmt = prepared()
        return /^\s*(SELECT|WITH)/i.test(query) ? stmt.all(...args) : (stmt.run(...args), [])
      },
    }
    return api
  }
  const session = {
    prepare: (query: string) => statement(query),
    batch: async (statements: Array<ReturnType<typeof statement>>) => {
      sql.exec('BEGIN')
      try {
        const out = statements.map((s) => ({ results: s.__exec() as Row[], success: true, meta: {} }))
        sql.exec('COMMIT')
        return out
      } catch (error) {
        sql.exec('ROLLBACK')
        throw error
      }
    },
  }
  const store = { ...session, withSession: () => session } as unknown as D1Store
  return { store, sql }
}

const input = (userId: string, familyId: string, tokenVersion = 0) => ({
  userId,
  tokenVersion,
  familyId,
  name: 'Fabricated household',
  inviteCode: `code-${familyId}`,
  features: JSON.stringify({ lists: true }),
  now: 1_000,
  groceryListId: `groceries-${familyId}`,
  groceryListName: DEFAULT_GROCERY_LIST_NAME,
})

describe('createD1Family: the first grocery list', () => {
  let db: ReturnType<typeof sqliteD1>
  const lists = () =>
    db.sql.prepare('SELECT id, family_id, name, type, created_by FROM "List" ORDER BY id').all() as Row[]
  beforeEach(() => {
    db = sqliteD1()
    for (const [id, version] of [['owner-a', 0], ['owner-b', 0], ['revoked', 3]] as const) {
      db.sql.prepare('INSERT INTO "User" (id, email, name, token_version) VALUES (?, ?, ?, ?)').run(id, `${id}@example.test`, id, version)
    }
  })

  it('creates exactly one "Groceries" list for the new household, by its creator', async () => {
    const family = await createD1Family(db.store, input('owner-a', 'family-a'))
    expect(typeof family).toBe('object')
    expect((family as { id: string }).id).toBe('family-a')
    expect(lists()).toEqual([
      { id: 'groceries-family-a', family_id: 'family-a', name: 'Groceries', type: 'grocery', created_by: 'owner-a' },
    ])
  })

  it('is idempotent: a second create for the same account adds no family and no list', async () => {
    await createD1Family(db.store, input('owner-a', 'family-a'))
    expect(await createD1Family(db.store, input('owner-a', 'family-again'))).toBe('already')
    expect(lists()).toHaveLength(1)
    expect(db.sql.prepare('SELECT count(*) AS n FROM "Family"').get()).toEqual({ n: 1 })
  })

  it('a refused create (revoked session) writes no list', async () => {
    expect(await createD1Family(db.store, input('revoked', 'family-r', 2))).toBe('gone')
    expect(lists()).toEqual([])
  })

  it('keeps each household to its own list', async () => {
    await createD1Family(db.store, input('owner-a', 'family-a'))
    await createD1Family(db.store, input('owner-b', 'family-b'))
    expect(lists().map((row) => [row.id, row.family_id])).toEqual([
      ['groceries-family-a', 'family-a'],
      ['groceries-family-b', 'family-b'],
    ])
    // The honest Today empty states see it; Get started's calendar step is still open.
    expect(await readD1TodayStarts('family-a', db.store)).toEqual({ hasChore: false, hasGroceryList: true })
    expect(await readD1GetStarted('family-a', 'parent', new Date(2_000), db.store)).toEqual({
      invited: false,
      hasChore: false,
      hasEvent: false,
      hasCalendar: false,
    })
  })
})

describe('readD1GetStarted: Connect your calendar', () => {
  it('ticks for a subscription or a two-way connection in this household only', async () => {
    const db = sqliteD1()
    db.sql.exec(`INSERT INTO "User" (id, email, name) VALUES ('p', 'p@example.test', 'p'), ('q', 'q@example.test', 'q');`)
    await createD1Family(db.store, input('p', 'fam-1'))
    await createD1Family(db.store, input('q', 'fam-2'))
    const calendar = async (familyId: string) => (await readD1GetStarted(familyId, 'parent', new Date(2_000), db.store))!.hasCalendar
    expect(await calendar('fam-1')).toBe(false)

    db.sql.prepare(`INSERT INTO "CalendarSubscription" (id, family_id, name, url_enc, created_by) VALUES ('s1', 'fam-2', 'School', 'v1:x', 'q')`).run()
    expect(await calendar('fam-1')).toBe(false)
    expect(await calendar('fam-2')).toBe(true)

    db.sql.prepare(`INSERT INTO "CalendarConnection" (id, family_id, user_id, provider) VALUES ('c1', 'fam-1', 'p', 'google')`).run()
    expect(await calendar('fam-1')).toBe(true)
  })

  it('reports no grocery list for an older household without one', async () => {
    const db = sqliteD1()
    expect(await readD1TodayStarts('no-such-family', db.store)).toEqual({ hasChore: false, hasGroceryList: false })
  })
})
