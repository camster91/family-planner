import { NextRequest } from 'next/server'
import { z } from 'zod'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { log } from '@/lib/logger'
import { importError, importJson } from '@/lib/event-import-http'
import {
  EVENT_IMPORT_FORBIDDEN_MESSAGE,
  EVENT_IMPORT_MAX_SUGGESTIONS,
  EVENT_IMPORT_UNDO_WINDOW_MS,
  canImportEvents,
} from '@/lib/event-import'

export const dynamic = 'force-dynamic'

const undoSchema = z
  .object({
    eventIds: z.array(z.string().trim().min(1).max(128)).min(1).max(EVENT_IMPORT_MAX_SUGGESTIONS),
  })
  .strict()

/**
 * POST /api/calendar/import-suggestions/undo `{ eventIds }` (#270).
 *
 * Deletes events the caller just added from an import: only events of the
 * caller's household, created by the caller, within the last 10 minutes, and
 * never imported (subscription/provider) events. Any other delete stays
 * parent-only (`DELETE /api/events`); this lets a teen take back their own
 * import like the grocery undo (O-5).
 *
 * All-or-nothing on permission: 403 `UNDO_NOT_ALLOWED` when any id is another
 * member's event (or an imported one), 409 `UNDO_WINDOW_EXPIRED` when any is
 * older than the window. Ids that do not exist or belong to another household
 * are skipped identically, so a retry after a successful undo answers 200
 * `{ removedCount: 0 }` and nothing reveals another household's ids.
 *
 * Deliberately not behind the provider kill switch: undoing what was just
 * added never calls the provider.
 */
export async function POST(request: NextRequest) {
  try {
    const deviceRefusal = await refusePairedDevice(request)
    if (deviceRefusal) return deviceRefusal

    const [auth, error] = await authenticateWithFamily(request)
    if (error) return error

    const gate = await featureGate(auth.user.family_id, 'calendar')
    if (gate) return gate

    if (!canImportEvents(auth.user.role)) {
      return importError(403, 'EVENT_IMPORT_FORBIDDEN', EVENT_IMPORT_FORBIDDEN_MESSAGE)
    }

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return importError(400, 'INVALID_BODY', 'Send JSON with "eventIds".')
    }
    const parsed = undoSchema.safeParse(body)
    if (!parsed.success) return importError(400, 'INVALID_BODY', 'Send the ids of the events to remove.')
    const ids = [...new Set(parsed.data.eventIds)]

    const familyId = auth.user.family_id
    const userId = auth.user.id
    const rows: Array<{
      id: string
      created_by: string
      created_at: Date
      source_subscription_id: string | null
      source_connection_id: string | null
    }> = await prisma!.event.findMany({
      where: { id: { in: ids }, family_id: familyId },
      select: { id: true, created_by: true, created_at: true, source_subscription_id: true, source_connection_id: true },
    })

    if (rows.some((r) => r.created_by !== userId || r.source_subscription_id || r.source_connection_id)) {
      return importError(403, 'UNDO_NOT_ALLOWED', 'You can only undo events you just added.')
    }
    const cutoff = new Date(Date.now() - EVENT_IMPORT_UNDO_WINDOW_MS)
    if (rows.some((r) => r.created_at.getTime() < cutoff.getTime())) {
      return importError(409, 'UNDO_WINDOW_EXPIRED', 'It is too late to undo this import. Delete the events one by one instead.')
    }

    const removed =
      rows.length === 0
        ? { count: 0 }
        : await prisma!.event.deleteMany({
            where: {
              id: { in: rows.map((r) => r.id) },
              family_id: familyId,
              created_by: userId,
              created_at: { gte: cutoff },
              source_subscription_id: null,
              source_connection_id: null,
            },
          })
    log.info('event.import.undo', { userId, requested: ids.length, removed: removed.count })
    return importJson({ removedCount: removed.count })
  } catch (err) {
    log.warn('event.import.undo.error', { name: err instanceof Error ? err.name : 'unknown' })
    return importError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
