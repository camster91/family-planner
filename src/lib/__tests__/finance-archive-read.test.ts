/** Source cases only; unrun. Real SQL/query-plan/lock/privacy acceptance remains open. */
import type { PrismaClient } from '@prisma/client'
import { archiveCursor, parseArchivePaging, readFinanceArchivePage, FinanceArchiveReadError } from '../finance-archive-read'
jest.mock('../household-lock', () => ({ lockUser: jest.fn(async () => undefined), lockHousehold: jest.fn(async () => undefined) }))
const owner = { userId: 'parent-a', familyId: 'family-a', generation: 3 }
const savedFlag = process.env.FINANCE_ARCHIVE_REVIEW_ENABLED
beforeEach(() => { process.env.FINANCE_ARCHIVE_REVIEW_ENABLED = '1' })
afterEach(() => { if (savedFlag === undefined) delete process.env.FINANCE_ARCHIVE_REVIEW_ENABLED; else process.env.FINANCE_ARCHIVE_REVIEW_ENABLED = savedFlag })
function dbWith(change = {}) {
  const query = jest.fn().mockResolvedValueOnce([{ model: 'other', count: '3' }]).mockResolvedValueOnce([])
  const tx = { user: { findUnique: jest.fn(async () => ({ family_id: owner.familyId, role: 'parent', token_version: 3, family: { features: { budget: true } }, ...change })) }, $queryRaw: query }
  const transaction = jest.fn(async (callback: (value: typeof tx) => Promise<unknown>) => callback(tx))
  return { db: { $transaction: transaction } as unknown as Pick<PrismaClient, '$transaction'>, tx, query, transaction }
}
it('binds tie positions to the original household and filter without requiring a surviving pivot', () => {
  const row = { id: 'deleted-pivot', created_at: new Date('2026-10-25T12:00:00.000Z') }
  const cursor = archiveCursor(owner.familyId, 'bills', row)
  expect(parseArchivePaging(new URLSearchParams({ model: 'bills', cursor }), owner.familyId)).toEqual({ model: 'bills', cursor: { id: row.id, createdAt: row.created_at } })
  expect(() => parseArchivePaging(new URLSearchParams({ model: 'bills', cursor }), 'family-b')).toThrow(FinanceArchiveReadError)
  expect(() => parseArchivePaging(new URLSearchParams({ model: 'accounts', cursor }), owner.familyId)).toThrow(FinanceArchiveReadError)
  for (const query of ['model=bills&model=accounts', 'cursor=', 'model=future-model', 'limit=10000'])
    expect(() => parseArchivePaging(new URLSearchParams(query), owner.familyId)).toThrow(FinanceArchiveReadError)
})
it('stays unavailable without the explicit private gate', async () => {
  delete process.env.FINANCE_ARCHIVE_REVIEW_ENABLED
  const { db, transaction } = dbWith()
  await expect(readFinanceArchivePage(db, owner, { model: null, cursor: null })).rejects.toMatchObject({ code: 'UNAVAILABLE' })
  expect(transaction).not.toHaveBeenCalled()
})
it.each([{ role: 'child' }, { role: 'teen' }, { family_id: 'family-b' }, { token_version: 4 }])('refuses changed live authority before archive reads: %p', async change => {
  const { db, query } = dbWith(change)
  await expect(readFinanceArchivePage(db, owner, { model: null, cursor: null })).rejects.toMatchObject({ code: 'OWNER_CHANGED' })
  expect(query).not.toHaveBeenCalled()
})
it('returns metadata and explicit unknown-model counts with one bounded lookahead and no payload', async () => {
  const { db, query } = dbWith()
  const rows = Array.from({ length: 25 }, (_, i) => ({ id: `archive-${String(i).padStart(2, '0')}`, created_at: new Date('2026-10-25T12:00:00.000Z'), source_app: 'synthetic-source', source_model: 'bills', source_id: `synthetic-${i}`, truncated: false }))
  query.mockReset().mockResolvedValueOnce([{ model: 'other', count: '3' }, { model: 'bills', count: '25' }]).mockResolvedValueOnce(rows)
  const page = await readFinanceArchivePage(db, owner, { model: 'bills', cursor: null })
  expect(page.rows).toHaveLength(24)
  expect(page.rows[0]).not.toHaveProperty('payload')
  expect(page.counts.find(row => row.model === 'other')?.count).toBe('3')
  expect(parseArchivePaging(new URLSearchParams({ model: 'bills', cursor: page.nextCursor! }), owner.familyId).cursor?.id).toBe('archive-23')
  // Inspect assembled source SQL; this does not simulate or execute PostgreSQL.
  for (const [sql] of query.mock.calls) expect(sql.values).toContain(owner.familyId)
  expect(query.mock.calls[1][0].strings.join('?')).not.toMatch(/payload/)
  expect(query.mock.calls[1][0].strings.join('?')).toContain('LIMIT 25')
})
