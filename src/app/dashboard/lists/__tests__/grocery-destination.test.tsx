/** @jest-environment node */
const mockUser = jest.fn()
const mockMembership = jest.fn()
const mockLists = jest.fn()
jest.mock('@/lib/supabase/server', () => ({ getServerUser: () => mockUser() }))
jest.mock('@/lib/prisma', () => ({ prisma: { user: { findUnique: (...args: unknown[]) => mockMembership(...args) }, list: { findMany: (...args: unknown[]) => mockLists(...args) } } }))
jest.mock('next/navigation', () => ({ redirect: (url: string) => { throw new Error(`REDIRECT:${url}`) } }))
import Destination from '../groceries/page'
beforeEach(() => { jest.clearAllMocks(); mockUser.mockResolvedValue({ id: 'fixture-user' }); mockMembership.mockResolvedValue({ family_id: 'family-A' }) })
it('opens the single grocery list directly, with household/type ownership enforced', async () => {
 mockLists.mockResolvedValue([{ id: 'grocery-A' }])
 await expect(Destination()).rejects.toThrow('REDIRECT:/dashboard/lists/grocery-A')
 expect(mockLists).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id: 'family-A', type: 'grocery' }, take: 2 }))
})
it.each([{ rows: [] }, { rows: [{ id: 'grocery-A' }, { id: 'grocery-B' }] }])('offers only the grocery overview for zero/multiple lists', async ({ rows }) => {
 mockLists.mockResolvedValue(rows)
 await expect(Destination()).rejects.toThrow('REDIRECT:/dashboard/lists?type=grocery')
})
it('does not query household lists for missing session or membership', async () => {
 mockUser.mockResolvedValue(null); expect(await Destination()).toBeNull()
 mockUser.mockResolvedValue({ id: 'fixture-user' }); mockMembership.mockResolvedValue({ family_id: null }); expect(await Destination()).toBeNull()
 expect(mockLists).not.toHaveBeenCalled()
})
it('uses the signed-in user current household rather than a supplied query', async () => {
 mockMembership.mockResolvedValue({ family_id: 'family-B' }); mockLists.mockResolvedValue([{ id: 'grocery-B' }])
 await expect(Destination()).rejects.toThrow('REDIRECT:/dashboard/lists/grocery-B')
 expect(mockLists).toHaveBeenCalledWith(expect.objectContaining({ where: { family_id: 'family-B', type: 'grocery' } }))
})
