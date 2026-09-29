import { NextRequest, NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { checkRateLimit } from '@/lib/rate-limit-db'
import { loadTodayBoard } from '@/app/dashboard/today/board-snapshot'

export const dynamic = 'force-dynamic'

/** Per member: about one check every 3 s, far above the board's 25 s poll (two tabs, fast wake-ups). */
const BOARD_VERSION_LIMIT = 1200
const BOARD_VERSION_WINDOW_MS = 60 * 60 * 1000

const NO_STORE = { 'Cache-Control': 'private, no-store' }

/**
 * GET /api/family/board-version (#271): the change version of the Today board
 * the caller would see, `{ version }` and nothing else. The board polls it
 * while visible and re-fetches only when it differs from the version it
 * shows. Every role (parent, teen, child) of a household may read it, like
 * the board itself; the version is computed with the caller's role and only
 * from the caller's household. Person sessions only: a paired tablet cookie
 * is not a session (401) and uses GET /api/device/today/version instead.
 */
export async function GET(request: NextRequest) {
  try {
    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const limit = await checkRateLimit(`board-version:${auth.user.id}`, BOARD_VERSION_LIMIT, BOARD_VERSION_WINDOW_MS)
    if (!limit.allowed) {
      return NextResponse.json(
        { error: 'Too many requests' },
        {
          status: 429,
          headers: { ...NO_STORE, 'Retry-After': String(Math.max(1, Math.ceil(limit.retryAfterMs / 1000))) },
        }
      )
    }

    const board = await loadTodayBoard(prisma!, { familyId: auth.user.family_id, role: auth.user.role })
    return NextResponse.json({ version: board.version }, { headers: NO_STORE })
  } catch (error) {
    console.error('Board version error:', error instanceof Error ? error.message : error)
    return NextResponse.json({ error: 'Could not check for changes' }, { status: 500, headers: NO_STORE })
  }
}
