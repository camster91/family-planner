import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { DEFAULT_USE_SOON_DAYS, USE_SOON_MAX_LIMIT, getUseSoonItems, parseDays } from '@/lib/inventory'
import { inventoryError, inventoryJson, todayFrom } from '@/lib/inventory-http'

export const dynamic = 'force-dynamic'

/**
 * GET /api/inventory/use-soon?days=3&today=&limit= (#263). Items that are
 * expired or expire within `days` (default 3), soonest first, with a text
 * label for each ("Best before was yesterday", "Use by today", "Best before in
 * 2 days"); a passed use-by day is never included (#158). Every
 * role may read. Board-safe fields only (`getUseSoonItems`).
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'inventory')
    if (gate) return gate

    const { searchParams } = new URL(request.url)
    const today = todayFrom(searchParams)
    if (today instanceof NextResponse) return today
    const days = parseDays(searchParams.get('days'), DEFAULT_USE_SOON_DAYS)
    if (days === null) return inventoryError(400, 'VALIDATION_ERROR', 'days must be a whole number from 0 to 365')
    const limitRaw = searchParams.get('limit')
    const limit = limitRaw === null ? 50 : Number(limitRaw)
    if (!Number.isInteger(limit) || limit < 1 || limit > USE_SOON_MAX_LIMIT) {
      return inventoryError(400, 'VALIDATION_ERROR', `limit must be 1-${USE_SOON_MAX_LIMIT}`)
    }

    const items = await getUseSoonItems(prisma!, auth.user.family_id, { today, days, limit })
    return inventoryJson({ days, items })
  } catch (err) {
    console.error('Error fetching use-soon items:', err instanceof Error ? err.message : 'unknown error')
    return inventoryError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
