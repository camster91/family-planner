import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { log } from '@/lib/logger'
import { importError, importJson } from '@/lib/event-import-http'
import { EVENT_IMPORT_FORBIDDEN_MESSAGE, canImportEvents } from '@/lib/event-import'
import { undoSchema, verifyUndoToken } from '@/lib/event-import-commit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/calendar/import-suggestions/undo `{ token }` (#270).
 *
 * Deletes the events of one import. The token comes from the commit route
 * and is an HMAC over the caller, household, event ids and commit time, so it
 * cannot be forged or pointed at other events (such as one made by hand with
 * `POST /api/events`, whose delete stays parent-only). 403
 * `UNDO_TOKEN_INVALID` for a tampered, malformed or another person's token;
 * 409 `UNDO_WINDOW_EXPIRED` after 10 minutes. The delete is still scoped to
 * the caller's household and events the caller created, never subscription
 * or provider imports. Safe to repeat: a second undo answers
 * `{ removedCount: 0 }`.
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
      return importError(400, 'INVALID_BODY', 'Send JSON with "token".')
    }
    const parsed = undoSchema.safeParse(body)
    if (!parsed.success) return importError(400, 'INVALID_BODY', 'Send the undo token from the import.')

    const familyId = auth.user.family_id
    const userId = auth.user.id
    const check = verifyUndoToken(parsed.data.token, { userId, familyId })
    if (!check.ok) {
      return check.reason === 'expired'
        ? importError(409, 'UNDO_WINDOW_EXPIRED', 'It is too late to undo this import. Delete the events one by one instead.')
        : importError(403, 'UNDO_TOKEN_INVALID', 'This undo is not valid.')
    }

    const removed = await prisma!.event.deleteMany({
      where: {
        id: { in: check.eventIds },
        family_id: familyId,
        created_by: userId,
        source_subscription_id: null,
        source_connection_id: null,
      },
    })
    log.info('event.import.undo', { requested: check.eventIds.length, removed: removed.count })
    return importJson({ removedCount: removed.count })
  } catch (err) {
    log.warn('event.import.undo.error', { name: err instanceof Error ? err.name : 'unknown' })
    return importError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
