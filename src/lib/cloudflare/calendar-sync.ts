import { randomUUID } from 'node:crypto'
import type { CalendarSubscriptionActor } from '@/lib/calendar-subscription-access'
import type { SyncOptions } from '@/lib/calendar-import/sync'
import { CalendarSubscriptionSyncHeld, importWindow, type SyncResult } from '@/lib/calendar-import/sync-values'
import { fetchFeed, FeedFetchError } from '@/lib/calendar-import/fetch'
import { parseIcsFeed, IcsParseError, MAX_OCCURRENCES, type ImportedOccurrence } from '@/lib/calendar-import/parse'
import { DEFAULT_FAMILY_TIMEZONE } from '@/lib/calendar-import/timezone'
import { decryptSecret } from '@/lib/secret-box'
import { getD1Database, type D1Store } from './database'
import { d1WriteCheck, isD1WriteConflict } from './write-check'

type Source = { id: string; family_id: string; created_by: string; created_at: number; url_enc: string; etag: string | null; last_modified: string | null }
const SOURCE = `SELECT id,family_id,created_by,created_at,url_enc,etag,last_modified FROM "CalendarSubscription" WHERE id=?1 AND family_id=?2`
const AUTH = `EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
  WHERE u.id=?1 AND u.family_id=?2 AND u.role=?3 AND u.token_version=?4)`
const actorArgs = (actor: CalendarSubscriptionActor) => [actor.userId, actor.familyId, actor.role, actor.generation]
function validActor(actor: CalendarSubscriptionActor, familyId: string) {
  return actor.familyId === familyId && ['parent', 'teen'].includes(actor.role) && Number.isSafeInteger(actor.generation) && actor.generation >= 0
}
async function readSource(db: D1Store, id: string, familyId: string, actor?: CalendarSubscriptionActor): Promise<Source | null> {
  if (actor && !validActor(actor, familyId)) throw new CalendarSubscriptionSyncHeld('access')
  const session = db.withSession('first-primary')
  if (!actor) return session.prepare(SOURCE).bind(id, familyId).first<Source>()
  const result = await session.batch<Source>([
    session.prepare(`SELECT 1 WHERE ${AUTH}`).bind(...actorArgs(actor)),
    session.prepare(`${SOURCE} AND EXISTS (SELECT 1 FROM "User" u JOIN "Family" f ON f.id=u.family_id
      WHERE u.id=?3 AND u.family_id=?4 AND u.role=?5 AND u.token_version=?6)`)
      .bind(id, familyId, ...actorArgs(actor)),
  ])
  if (!result[0].results.length) throw new CalendarSubscriptionSyncHeld('access')
  return result[1].results[0] ?? null
}
type Status = { status: 'ok' | 'error'; error: string | null; now: number; validators?: { etag: string | null; lastModified: string | null } }
/** One bounded native batch, with admission and immutable-source assertions
 * before any event or status write. No callback transactions or compensation. */
export async function persistD1CalendarSync(db: D1Store, source: Source, actor: CalendarSubscriptionActor | undefined,
  status: Status, reconciliation?: { occurrences: ImportedOccurrence[]; window: { start: Date; end: Date } },
) {
  if (actor && !validActor(actor, source.family_id)) throw new CalendarSubscriptionSyncHeld('access')
  const session = db.withSession('first-primary')
  const statements = []
  if (actor) statements.push(d1WriteCheck(session, AUTH, actorArgs(actor)))
  statements.push(d1WriteCheck(session, `EXISTS (SELECT 1 FROM "CalendarSubscription" s JOIN "Family" f ON f.id=s.family_id
    WHERE s.id=?1 AND s.family_id=?2 AND s.url_enc=?3 AND s.created_by=?4 AND s.created_at=?5)`,
  [source.id, source.family_id, source.url_enc, source.created_by, source.created_at]))
  let deletedIndex = -1
  const updatedIndices: number[] = [], createdIndices: number[] = []
  if (reconciliation) {
    const { occurrences, window } = reconciliation
    if (occurrences.length > MAX_OCCURRENCES) throw new Error('Unbounded calendar import')
    const keys = new Set<string>()
    const rows = occurrences.map(occ => {
      const key = JSON.stringify([occ.uid, occ.occurrenceStart.getTime()])
      if (keys.has(key)) throw new Error('Ambiguous calendar occurrence')
      keys.add(key)
      return { id: randomUUID(), uid: occ.uid, occurrence: occ.occurrenceStart.getTime(), title: occ.title,
        description: occ.description, location: occ.location, start: occ.start.getTime(), end: occ.end.getTime() }
    })
    const identityChunks: string[] = []
    for (let offset = 0; offset < rows.length; offset += 100) identityChunks.push(JSON.stringify(rows.slice(offset, offset + 100).map(row => ({ uid: row.uid, occurrence: row.occurrence }))))
    if (!identityChunks.length) identityChunks.push('[]')
    const matches = `json_extract(j.value,'$.uid')=e.source_uid AND json_extract(j.value,'$.occurrence')=e.source_occurrence_start`
    const absentFromIncoming = identityChunks.map((_, i) => `NOT EXISTS (SELECT 1 FROM json_each(?${i + 5}) j WHERE ${matches})`).join(' AND ')
    deletedIndex = statements.length
    statements.push(session.prepare(`DELETE FROM "Event" AS e WHERE e.family_id=?1 AND e.source_subscription_id=?2
      AND ${absentFromIncoming}
      AND (e.source_uid IS NULL OR e.source_uid='' OR e.source_occurrence_start IS NULL OR (e.start_time>=?3 AND e.start_time<?4)) RETURNING id`)
      .bind(source.family_id, source.id, window.start.getTime(), window.end.getTime(), ...identityChunks))
    // Feed expansion can repeat a long description thousands of times. Keep
    // individual D1 values below its 2 MiB limit; the deletion set contains
    // identities only, and all bounded chunks still commit in one batch.
    for (let offset = 0; offset < rows.length; offset += 100) {
      const incoming = JSON.stringify(rows.slice(offset, offset + 100))
      updatedIndices.push(statements.length)
      statements.push(session.prepare(`UPDATE "Event" AS e SET
        (title,description,location,start_time,end_time)=(SELECT json_extract(j.value,'$.title'),json_extract(j.value,'$.description'),
          json_extract(j.value,'$.location'),json_extract(j.value,'$.start'),json_extract(j.value,'$.end') FROM json_each(?3) j WHERE ${matches}),
        updated_at=?4 WHERE e.family_id=?1 AND e.source_subscription_id=?2 AND EXISTS (SELECT 1 FROM json_each(?3) j WHERE ${matches}
          AND (e.title IS NOT json_extract(j.value,'$.title') OR e.description IS NOT json_extract(j.value,'$.description')
          OR e.location IS NOT json_extract(j.value,'$.location') OR e.start_time IS NOT json_extract(j.value,'$.start')
          OR e.end_time IS NOT json_extract(j.value,'$.end'))) RETURNING id`)
        .bind(source.family_id, source.id, incoming, status.now))
      createdIndices.push(statements.length)
      statements.push(session.prepare(`INSERT INTO "Event" (id,family_id,created_by,source_subscription_id,source_uid,source_occurrence_start,title,description,location,start_time,end_time,created_at,updated_at)
        SELECT json_extract(j.value,'$.id'),?1,?4,?2,json_extract(j.value,'$.uid'),json_extract(j.value,'$.occurrence'),json_extract(j.value,'$.title'),
          json_extract(j.value,'$.description'),json_extract(j.value,'$.location'),json_extract(j.value,'$.start'),json_extract(j.value,'$.end'),?5,?5
        FROM json_each(?3) j WHERE NOT EXISTS (SELECT 1 FROM "Event" e WHERE e.family_id=?1 AND e.source_subscription_id=?2 AND ${matches}) RETURNING id`)
        .bind(source.family_id, source.id, incoming, source.created_by, status.now))
    }
  }
  statements.push(session.prepare(`UPDATE "CalendarSubscription" SET last_fetched_at=?3,last_status=?4,last_error=?5,updated_at=?3
    ${status.validators ? ',etag=?6,last_modified=?7' : ''} WHERE id=?1 AND family_id=?2`)
    .bind(source.id, source.family_id, status.now, status.status, status.error,
      ...(status.validators ? [status.validators.etag, status.validators.lastModified] : [])))
  try {
    const results = await session.batch<{ id: string }>(statements)
    return reconciliation ? { deleted: results[deletedIndex].results.length, updated: updatedIndices.reduce((n, i) => n + results[i].results.length, 0),
      created: createdIndices.reduce((n, i) => n + results[i].results.length, 0) } : { deleted: 0, updated: 0, created: 0 }
  } catch (cause) {
    if (!isD1WriteConflict(cause)) throw cause
    // Classification only; the failed native batch has already rolled back.
    await readSource(db, source.id, source.family_id, actor)
    throw new CalendarSubscriptionSyncHeld('source')
  }
}
export async function syncD1CalendarSubscription(id: string, familyId: string, options: SyncOptions = {}, database?: D1Store): Promise<SyncResult | null> {
  const db = database ?? await getD1Database()
  const actor = options.actor ? Object.freeze({ ...options.actor }) : undefined
  const source = await readSource(db, id, familyId, actor)
  if (!source) return null
  const now = options.now ?? new Date()
  const errorResult = async (code: string, message: string): Promise<SyncResult> => {
    console.warn('[calendar-import] refresh failed', { subscriptionId: id, code })
    await persistD1CalendarSync(db, source, actor, { now: now.getTime(), status: 'error', error: message.slice(0, 200) })
    return { status: 'error', created: 0, updated: 0, deleted: 0, error: message }
  }
  const url = decryptSecret(source.url_enc)
  if (!url) return errorResult('url_unreadable', 'Saved calendar link could not be read. Remove and add it again.')
  let fetched
  try { fetched = await fetchFeed(url, { etag: source.etag, lastModified: source.last_modified, fetchImpl: options.fetchImpl, assertUrl: options.assertUrl }) }
  catch (cause) { return cause instanceof FeedFetchError ? errorResult(cause.code, cause.message) : errorResult('unknown', 'Could not refresh this calendar') }
  if (fetched.notModified) {
    await persistD1CalendarSync(db, source, actor, { now: now.getTime(), status: 'ok', error: null })
    return { status: 'not_modified', created: 0, updated: 0, deleted: 0 }
  }
  const window = importWindow(now)
  let parsed
  try { parsed = parseIcsFeed(fetched.body, { windowStart: window.start, windowEnd: window.end, defaultTimeZone: options.timeZone ?? DEFAULT_FAMILY_TIMEZONE }) }
  catch (cause) { return cause instanceof IcsParseError ? errorResult('invalid_ics', cause.message) : errorResult('parse_failed', 'Feed is not a valid calendar') }
  if (parsed.truncated) return errorResult('feed_too_large', 'Calendar feed is too large to refresh safely. Existing events were kept.')
  try {
    const counts = await persistD1CalendarSync(db, source, actor, { now: now.getTime(), status: 'ok', error: null,
      validators: { etag: fetched.etag, lastModified: fetched.lastModified } }, { occurrences: parsed.occurrences, window })
    return { status: 'ok', ...counts }
  } catch (cause) {
    if (cause instanceof CalendarSubscriptionSyncHeld) throw cause
    return errorResult('persist_failed', 'Could not save events from this calendar')
  }
}
