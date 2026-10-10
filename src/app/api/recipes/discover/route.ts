import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { fetchFeed } from '@/lib/calendar-import/fetch'
import { extractRecipeLinks, recipeSources } from '@/lib/recipe-discovery'
export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error
  const gate = await featureGate(auth.user.family_id, 'meals')
  if (gate) return gate
  const limit = await checkRateLimit(`recipe-search:${auth.user.id}`, 15, 60000)
  if (!limit.allowed) return NextResponse.json({ error: 'Please wait a minute before searching again.' }, { status: 429 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid search.' }, { status: 400 }) }
  const input = body as { query?: unknown; source?: unknown } | null
  const source = recipeSources.find(source => source.name === input?.source)
  const query = typeof input?.query === 'string' ? input.query.trim() : ''
  if (!source || query.length < 2 || query.length > 120) return NextResponse.json({ error: 'Choose a source and enter 2–120 characters.' }, { status: 400 })
  try {
    const searchUrl = `${source.search}${encodeURIComponent(query)}`
    const page = await fetchFeed(searchUrl, { accept: 'text/html', userAgent: 'Herewoven-RecipeDiscovery/1.0' })
    const results = page.notModified ? [] : extractRecipeLinks(page.body, searchUrl)
    return NextResponse.json({ results, source: source.name, searchUrl }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'This source is unavailable here. Use its search link below or try another source.' }, { status: 422 })
  }
}
