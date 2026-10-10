jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('next/headers', () => require('@/__tests__/helpers/two-household').nextHeadersMock)
jest.mock('@/lib/session', () => require('@/__tests__/helpers/two-household').sessionMock)
jest.mock('@/lib/prisma', () => ({ prisma: require('@/__tests__/helpers/two-household').fakePrisma }))
jest.mock('@/lib/feature-gate-server', () => ({ featureGate: jest.fn(async () => null) }))
jest.mock('@/lib/rate-limit-db', () => ({ checkRateLimit: jest.fn(async () => ({ allowed: true })) }))
jest.mock('@/lib/calendar-import/fetch', () => ({ fetchFeed: jest.fn() }))
import { POST } from '../preview/route'
import { POST as discover } from '../discover/route'
import { req, db } from '@/__tests__/helpers/two-household'
import { fetchFeed } from '@/lib/calendar-import/fetch'
import { featureGate } from '@/lib/feature-gate-server'
import { checkRateLimit } from '@/lib/rate-limit-db'
const mockFetch = fetchFeed as jest.Mock
beforeEach(() => { db.reset(); jest.clearAllMocks(); mockFetch.mockResolvedValue({ notModified: false, body: '<script type="application/ld+json">{"@type":"Recipe","name":"Fixture soup"}</script>' }); (featureGate as jest.Mock).mockResolvedValue(null); (checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true }) })
it('rejects anonymous and child calls before outbound requests', async () => {
 for (const as of [null, 'childA'] as const) expect((await POST(req({ as, method: 'POST', body: { url: 'https://example.org' } }))).status).toBe(as ? 403 : 401)
 expect(mockFetch).not.toHaveBeenCalled()
})
it('previews for either household parent/teen without storing recipe data', async () => {
 for (const as of ['parentA', 'teenA', 'parentB'] as const) {
 const response = await POST(req({ as, method: 'POST', body: { url: 'https://example.org/soup' } }))
 expect(response.status).toBe(200); expect((await response.json()).recipe.title).toBe('Fixture soup')
 }
 expect(db.writes).toHaveLength(0)
 expect(mockFetch).toHaveBeenCalledWith('https://example.org/soup', expect.objectContaining({ maxBytes: 2097152, accept: 'text/html' }))
})
it('rejects malformed link, disabled feature, throttling and unavailable source', async () => {
 const call = (url: string) => POST(req({ as: 'parentA', method: 'POST', body: { url } }))
 expect((await call('javascript:alert(1)')).status).toBe(400)
 ;(featureGate as jest.Mock).mockResolvedValue(new (require('next/server').NextResponse)('', { status: 403 }))
 expect((await call('https://example.org')).status).toBe(403)
 ;(featureGate as jest.Mock).mockResolvedValue(null)
 ;(checkRateLimit as jest.Mock).mockResolvedValue({ allowed: false })
 expect((await call('https://example.org')).status).toBe(429)
 ;(checkRateLimit as jest.Mock).mockResolvedValue({ allowed: true })
 mockFetch.mockRejectedValue(new Error('private address refused'))
 expect((await call('https://example.org')).status).toBe(422)
})

it('searches only a fixed source with encoded query and no private household data', async () => {
 mockFetch.mockResolvedValue({ notModified: false, body: '<a href="/recipes/soup">Fixture soup</a>' })
 const result = await discover(req({ as: 'childA', method: 'POST', body: { query: 'rice & soup', source: 'BBC Good Food' } }))
 expect(result.status).toBe(200)
 expect((await result.json()).results).toEqual([{ title: 'Fixture soup', url: 'https://www.bbcgoodfood.com/recipes/soup' }])
 expect(mockFetch).toHaveBeenCalledWith('https://www.bbcgoodfood.com/search?q=rice%20%26%20soup', expect.objectContaining({ accept: 'text/html' }))
 expect((await discover(req({ as: 'parentA', method: 'POST', body: { query: 'rice', source: 'https://localhost/' } }))).status).toBe(400)
 expect(db.writes).toHaveLength(0)
})
