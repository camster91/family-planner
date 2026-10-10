import { NextRequest, NextResponse } from 'next/server'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { canEditRecipe } from '@/lib/recipes'
import { fetchFeed } from '@/lib/calendar-import/fetch'
import { extractOnlineRecipe, publicRecipeUrl } from '@/lib/recipe-discovery'

export const runtime = 'nodejs'
export async function POST(request: NextRequest) {
  const [auth, error] = await authenticateWithFamily(request)
  if (error) return error
  const gate = await featureGate(auth.user.family_id, 'meals')
  if (gate) return gate
  if (!canEditRecipe(auth.user.role)) return NextResponse.json({ error: 'Ask a parent or teen to import a recipe.' }, { status: 403 })
  const limit = await checkRateLimit(`recipe-preview:${auth.user.id}`, 15, 60000)
  if (!limit.allowed) return NextResponse.json({ error: 'Please wait a minute before importing another recipe.' }, { status: 429 })
  let body: unknown
  try { body = await request.json() } catch { return NextResponse.json({ error: 'Invalid recipe link.' }, { status: 400 }) }
  const raw = body && typeof body === 'object' ? (body as { url?: unknown }).url : undefined
  const url = typeof raw === 'string' ? publicRecipeUrl(raw) : null
  if (!url) return NextResponse.json({ error: 'Use a public HTTPS recipe link.' }, { status: 400 })
  try {
    // Shared transport pins public DNS addresses, validates each redirect,
    // caps response bytes and enforces a timeout. No cookies or credentials.
    const page = await fetchFeed(url, { accept: 'text/html', userAgent: 'Herewoven-RecipePreview/1.0', maxBytes: 2 * 1024 * 1024 })
    const recipe = page.notModified ? null : extractOnlineRecipe(page.body, url)
    if (!recipe) return NextResponse.json({ error: 'No readable recipe found. Open the original or add the recipe manually.' }, { status: 422 })
    return NextResponse.json({ recipe }, { headers: { 'Cache-Control': 'private, no-store' } })
  } catch {
    return NextResponse.json({ error: 'This recipe could not be read. Open the original or try another public recipe link.' }, { status: 422 })
  }
}
