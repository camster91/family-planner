import { mutateD1Event } from '../../../src/lib/cloudflare/event-mutations'
import { updateD1PersonEvent } from '../../../src/lib/cloudflare/event-update'
import { deleteD1EventFollowing } from '../../../src/lib/cloudflare/event-series-edit'
import { SERIES_COMPLETE, topUpD1EventSeries } from '../../../src/lib/cloudflare/event-series'
import { EVENT_REPEAT_READY_ENV, seriesEventId } from '../../../src/lib/event-series'
import { EVENT_PEOPLE_READY_ENV } from '../../../src/lib/event-participants'
import type { D1Store } from '../../../src/lib/cloudflare/database'
function check(value: unknown, label: string): asserts value { if (!value) throw new Error(label) }
const WEEK = 7 * 86_400_000
/** Repeating events on real workerd/D1: create, top-up on read, this/following edits and deletes. */
export async function testEventSeries(db: D1Store) {
  await db.prepare(`INSERT INTO "Family" (id,name,invite_code) VALUES ('series-a','Fixture','series-a'),('series-b','Other','series-b')`).run()
  await db.prepare(`INSERT INTO "User" (id,email,name,family_id,role,created_at) VALUES
    ('series-parent','series-parent@example.test','Parent','series-a','parent',1),
    ('series-teen','series-teen@example.test','Teen','series-a','teen',2),
    ('series-foreign','series-foreign@example.test','Foreign','series-b','parent',3)`).run()
  const actor = { userId: 'series-parent', familyId: 'series-a', role: 'parent', generation: 0, name: 'Parent' }
  const editor = { userId: 'series-parent', familyId: 'series-a', tokenVersion: 0 }
  const session = db.withSession('first-primary')
  const now = new Date('2026-01-05T12:00:00Z')
  const first = Date.parse('2026-01-05T14:00:00Z') // 9:00 Toronto, a Monday
  const base = { title: 'Swim', start_time: '2026-01-05T14:00:00Z', end_time: '2026-01-05T15:00:00Z', event_type: 'sports' as const }
  type Repeat = { every: 'day' | 'week' | '2weeks' | 'month' | 'year'; until?: string | null; time_zone: string }
  const create = (repeat: Repeat | undefined, key: string | null = null, extra: Record<string, unknown> = {}) =>
    mutateD1Event(actor, { kind: 'create', input: { ...base, ...extra, repeat } }, key, { database: db, now })
  type Row = { id: string; title: string; start_time: number; end_time: number; series_id: string | null; series_occurrence_start: number | null; series_detached: number }
  const rows = async (where = `family_id='series-a'`) => (await db.prepare(`SELECT id,title,start_time,end_time,series_id,series_occurrence_start,series_detached FROM "Event" WHERE ${where} ORDER BY start_time,id`).all<Row>()).results
  type Series = { id: string; every: string; until_day: string | null; anchor_start: number; generated_through: number; title: string }
  const seriesRows = async () => (await db.prepare(`SELECT id,every,until_day,anchor_start,generated_through,title FROM "EventSeries" WHERE family_id='series-a' ORDER BY anchor_start,id`).all<Series>()).results
  const wipe = async () => { await db.prepare(`DELETE FROM "Event" WHERE family_id='series-a'`).run(); await db.prepare(`DELETE FROM "EventSeries" WHERE family_id='series-a'`).run() }
  const TZ = 'America/Toronto'

  // Capability off: a repeat is refused before any write.
  process.env[EVENT_REPEAT_READY_ENV] = '0'
  const off = await create({ every: 'week', time_zone: TZ })
  check(off.status === 409 && (off.body as { code: string }).code === 'EVENT_REPEAT_UNSUPPORTED' && (await rows()).length === 0, 'off: repeat refused before any write')
  check(await topUpD1EventSeries(session, 'series-a', now) === 0, 'off: nothing tops up')
  process.env[EVENT_REPEAT_READY_ENV] = '1'
  process.env[EVENT_PEOPLE_READY_ENV] = '1'

  // Invalid repeats write nothing.
  for (const bad of [{ every: 'week' as const, time_zone: 'Mars/Olympus' }, { every: 'week' as const, time_zone: TZ, until: '2026-01-04' }]) {
    const refused = await create(bad)
    check(refused.status === 400 && (refused.body as { code: string }).code === 'EVENT_REPEAT_INVALID', 'invalid repeat refused')
  }
  check((await rows()).length === 0 && (await seriesRows()).length === 0, 'refused repeats write nothing')

  // Weekly with a person: one series, occurrences through the horizon, same wall-clock time, people on each.
  const made = await Promise.all(Array.from({ length: 4 }, () => create({ every: 'week', time_zone: TZ }, 'series-create-key', { participants: [{ kind: 'account', id: 'series-teen' }] })))
  const body = made[0].body as { event: { id: string; series_id: string; series_occurrence_start: string; participants: Array<{ id: string }> } }
  check(made.every(r => r.status === 200 && JSON.stringify(r.body) === JSON.stringify(made[0].body)) && made.filter(r => r.created).length === 1, 'create retries share one result')
  const [series] = await seriesRows()
  check((await seriesRows()).length === 1 && series.every === 'week' && series.anchor_start === first, 'one series')
  check(body.event.id === seriesEventId(series.id, first) && body.event.series_id === series.id && body.event.participants[0].id === 'series-teen', 'response is the first occurrence')
  let all = await rows()
  check(all.length === 18 && all.every((r, i) => r.series_id === series.id && r.series_occurrence_start === r.start_time && r.end_time - r.start_time === 3_600_000 && r.id === seriesEventId(series.id, r.start_time)
    && (i === 0 || r.start_time - all[i - 1].start_time === WEEK || r.start_time - all[i - 1].start_time === WEEK - 3_600_000)), 'weekly rows through the horizon, one hour each')
  check(all.some((r, i) => i > 0 && r.start_time - all[i - 1].start_time === WEEK - 3_600_000), 'spring-forward keeps 9:00 local (one week is an hour shorter in UTC)')
  check((await db.prepare(`SELECT count(*) AS n FROM "EventParticipant" WHERE family_id='series-a' AND user_id='series-teen'`).first<{ n: number }>())!.n === 18, 'the person is on every occurrence')
  check((await db.prepare(`SELECT count(*) AS n FROM "Activity" WHERE family_id='series-a'`).first<{ n: number }>())!.n === 1, 'one activity for the series')

  // Top-up on read: nothing to do now; later readers get later rows, once, even when two read at once.
  check(await topUpD1EventSeries(session, 'series-a', now) === 0 && (await rows()).length === 18, 'no top-up needed yet')
  const later = new Date(now.getTime() + 5 * WEEK)
  const written = await Promise.all([topUpD1EventSeries(session, 'series-a', later), topUpD1EventSeries(session, 'series-a', later)])
  all = await rows()
  check(written.some(n => n === 5) && all.length === 23 && new Set(all.map(r => r.id)).size === 23, 'top-up writes each new occurrence once')
  check((await db.prepare(`SELECT count(*) AS n FROM "EventParticipant" WHERE family_id='series-a'`).first<{ n: number }>())!.n === 23, 'new occurrences carry the people')
  // A far-looking reader (calendar range) extends further, bounded.
  await topUpD1EventSeries(session, 'series-a', later, later.getTime() + 300 * 86_400_000)
  check((await rows()).length > 40 && (await rows()).length < 70, 'range read tops up to the range')

  // Deleting one occurrence stays deleted after later top-ups.
  const gone = all[2]
  check((await mutateD1Event(actor, { kind: 'delete', eventId: gone.id }, null, { database: db })).status === 200, 'delete one occurrence')
  await topUpD1EventSeries(session, 'series-a', new Date(later.getTime() + 400 * 86_400_000))
  check(!(await rows()).some(r => r.id === gone.id), 'a deleted occurrence is not written again')

  // "This event" edits one row and marks it; "this and later" rewrites the rest.
  await wipe()
  await create({ every: 'week', time_zone: TZ })
  all = await rows()
  const [original] = await seriesRows()
  const one = await updateD1PersonEvent(editor, { eventId: all[5].id, title: 'Swim (bring goggles)' }, db)
  check(one.status === 200 && (await rows()).filter(r => r.title !== 'Swim').length === 1 && (await rows())[5].series_detached === 1, 'this-only edit changes and marks one row')
  const following = await updateD1PersonEvent(editor, { eventId: all[3].id, series_scope: 'following', title: 'Swim team', start_time: '2026-01-26T15:00:00Z' }, db)
  const after = await rows()
  check(following.status === 200 && (following.body as { event: { id: string; title: string } }).event.id === all[3].id, 'following keeps the edited event id')
  check(after.slice(0, 3).every(r => r.title === 'Swim' && r.series_id === original.id), 'earlier occurrences untouched')
  // The rewrite reaches the horizon from the real clock, so there are at least as many later rows as before.
  check(after.filter(r => r.title === 'Swim team').length >= all.length - 4 && after.filter(r => r.title === 'Swim team').every(r => r.end_time - r.start_time === 3_600_000)
    && !after.some(r => r.title === 'Swim' && r.start_time > all[3].start_time), 'later occurrences rewritten with the same length')
  const kept = after.find(r => r.title === 'Swim (bring goggles)')
  check(kept && kept.series_detached === 1 && kept.series_id === original.id, 'an individually changed later occurrence is left alone')
  const split = await seriesRows()
  check(split.length === 2 && split[0].id === original.id && split[0].until_day === '2026-01-25' && split[0].generated_through === SERIES_COMPLETE
    && split[1].title === 'Swim team' && split[1].anchor_start === Date.parse('2026-01-26T15:00:00Z'), 'old series ends the day before; new series starts at the edited event')
  check(after.filter(r => r.series_id === split[1].id).every(r => new Date(r.start_time).getUTCDay() === 1), 'moved repeats stay on the same weekday')
  await topUpD1EventSeries(session, 'series-a', new Date(Date.now() + 200 * 86_400_000))
  check((await rows()).filter(r => r.series_id === original.id && r.start_time > Date.parse('2026-01-26T00:00:00Z') && r.series_detached === 0).length === 0, 'the ended series writes nothing more')

  // Stop repeating from an occurrence on.
  const teamRows = (await rows()).filter(r => r.series_id === split[1].id)
  const stop = await updateD1PersonEvent(editor, { eventId: teamRows[2].id, series_scope: 'following', repeat: null }, db)
  const stopped = await rows()
  check(stop.status === 200 && stopped.find(r => r.id === teamRows[2].id)!.series_id === null
    && stopped.filter(r => r.series_id === split[1].id).length === 2, 'stop repeating: this event stands alone and later ones are gone')

  // Scope and authority.
  check((await updateD1PersonEvent(editor, { eventId: teamRows[2].id, series_scope: 'following', title: 'x' }, db)).status === 409, 'following on a one-off is refused')
  check((await updateD1PersonEvent({ ...editor, userId: 'series-teen' }, { eventId: teamRows[0].id, series_scope: 'following', title: 'x' }, db)).status === 403, 'teen cannot edit a series')
  check((await updateD1PersonEvent({ userId: 'series-foreign', familyId: 'series-b', tokenVersion: 0 }, { eventId: teamRows[0].id, series_scope: 'following', title: 'x' }, db)).status === 404, 'other household cannot reach it')
  check((await deleteD1EventFollowing({ userId: 'series-foreign', familyId: 'series-b', tokenVersion: 0 }, teamRows[0].id, db)).status === 404, 'other household cannot delete it')
  check((await rows()).find(r => r.id === teamRows[0].id)!.title === 'Swim team', 'refusals change nothing')

  // Delete this and later; deleting from the first occurrence removes the series.
  await wipe()
  await create({ every: 'day', time_zone: TZ, until: '2026-01-14' })
  all = await rows()
  check(all.length === 10 && (await seriesRows())[0].generated_through === SERIES_COMPLETE, 'a bounded series is written in full and marked complete')
  check((await deleteD1EventFollowing(editor, all[6].id, db)).status === 200 && (await rows()).length === 6 && (await seriesRows())[0].until_day === '2026-01-10', 'delete this and later')
  check((await deleteD1EventFollowing(editor, all[0].id, db)).status === 200 && (await rows()).length === 0 && (await seriesRows()).length === 0, 'delete from the first removes everything')

  // The database refuses an occurrence that points at another household's series.
  await create({ every: 'week', time_zone: TZ })
  const [mine] = await seriesRows()
  let refused = false
  try { await db.prepare(`INSERT INTO "Event" (id,family_id,title,start_time,end_time,created_by,series_id,series_occurrence_start) VALUES ('series-x','series-b','x',1,2,'series-foreign',?1,1)`).bind(mine.id).run() } catch { refused = true }
  check(refused, 'database guard: foreign series')
  await db.prepare(`DELETE FROM "Family" WHERE id='series-a'`).run()
  check((await db.prepare(`SELECT count(*) AS n FROM "EventSeries"`).first<{ n: number }>())!.n === 0, 'household deletion cascades series')
  delete process.env[EVENT_REPEAT_READY_ENV]; delete process.env[EVENT_PEOPLE_READY_ENV]
  return { offRefused: true, invalidRefused: true, createAtomic: true, wallClockAcrossDst: true, topUpIdempotent: true, deletedStaysDeleted: true,
    thisOnly: true, following: true, stopRepeating: true, scoped: true, deleteFollowing: true, databaseGuard: true }
}
