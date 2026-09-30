import { NextRequest } from 'next/server'
import { prisma } from '@/lib/prisma'
import { authenticateWithFamily } from '@/lib/api-auth'
import { featureGate } from '@/lib/feature-gate-server'
import { refusePairedDevice } from '@/lib/device-route'
import { idempotencyError, readIdempotencyKey, withIdempotency } from '@/lib/idempotency'
import { log } from '@/lib/logger'
import { importError } from '@/lib/event-import-http'
import { EVENT_IMPORT_FORBIDDEN_MESSAGE, canImportEvents } from '@/lib/event-import'
import {
  EVENT_IMPORT_COMMIT_ACTION,
  checkCommitRanges,
  commitImportedEvents,
  commitSchema,
} from '@/lib/event-import-commit'

export const dynamic = 'force-dynamic'

/**
 * POST /api/calendar/import-suggestions/commit `{ events: [...] }` (#270).
 *
 * Creates the reviewed events of one import in a single transaction and
 * returns `201 { eventIds, count, undoToken, undoExpiresAt }`. Each event uses
 * the field rules of `POST /api/events` (title, description, start_time,
 * end_time, location). `Idempotency-Key` is required, one per batch: a retry
 * after a lost response replays the stored result (`Idempotency-Replayed:
 * true`) and creates nothing. The undo token is the only way to undo the
 * batch (see the undo route).
 *
 * Guards as for suggestions: paired device 403 (before person auth), session,
 * `featureGate('calendar')`, parent or teen. Not behind the provider kill
 * switch: it creates ordinary events and never calls the provider.
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

    const { key, error: keyError } = readIdempotencyKey(request)
    if (keyError) return keyError
    if (!key) return idempotencyError('IDEMPOTENCY_KEY_REQUIRED')

    let body: unknown
    try {
      body = await request.json()
    } catch {
      return importError(400, 'INVALID_BODY', 'Send JSON with "events".')
    }
    const parsed = commitSchema.safeParse(body)
    if (!parsed.success) {
      const issue = parsed.error.issues[0]
      return importError(400, 'INVALID_BODY', issue ? issue.message : 'Invalid events.')
    }
    const rangeError = checkCommitRanges(parsed.data)
    if (rangeError) return importError(400, 'INVALID_BODY', rangeError)

    const actor = { id: auth.user.id, family_id: auth.user.family_id, name: auth.user.name }
    const response = await withIdempotency(
      prisma!,
      key,
      {
        scope: `user:${auth.user.id}`,
        familyId: auth.user.family_id,
        userId: auth.user.id,
        action: EVENT_IMPORT_COMMIT_ACTION,
      },
      parsed.data,
      // With a key, withIdempotency always holds a record, so recordId is set.
      ({ recordId }) => commitImportedEvents(prisma!, parsed.data, actor, recordId!)
    )
    response.headers.set('Cache-Control', 'private, no-store')
    log.info('event.import.commit', { events: parsed.data.events.length, status: response.status })
    return response
  } catch (err) {
    log.warn('event.import.commit.error', { name: err instanceof Error ? err.name : 'unknown' })
    return importError(500, 'INTERNAL_ERROR', 'Internal server error')
  }
}
