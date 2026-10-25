/** Authored/unrun. Transport preconditions; SQL/isolation acceptance is separate. */
jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/finance-archive-read', () => ({
  ...jest.requireActual('@/lib/finance-archive-read'),
  financeArchiveReviewEnabled: jest.fn(() => true), readFinanceArchivePage: jest.fn(async () => ({ protocol: 'synthetic-metadata-page' })),
}))
import { GET } from '../route'
import { db, req } from '@/__tests__/helpers/two-household'
import { readFinanceArchivePage } from '@/lib/finance-archive-read'
import { FINANCE_ARCHIVE_OWNER_HEADER } from '@/lib/finance-archive-contract'
beforeEach(() => { db.reset(); jest.mocked(readFinanceArchivePage).mockClear() })
it('refuses a child before reading expected owner or archive data', async () => {
  expect((await GET(req({ as: 'childA' }))).status).toBe(403)
  expect(readFinanceArchivePage).not.toHaveBeenCalled()
})
it('refuses missing or foreign original household context before archive queries', async () => {
  for (const expected of [null, { userId: 'parent-a', familyId: 'family-B', generation: 0 }]) {
    const response = await GET(req({ as: 'parentA', headers: expected ? { [FINANCE_ARCHIVE_OWNER_HEADER]: JSON.stringify(expected) } : {} }))
    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ code: 'OWNER_CHANGED' })
    expect(response.headers.get('Cache-Control')).toBe('private, no-store')
  }
  expect(readFinanceArchivePage).not.toHaveBeenCalled()
})
