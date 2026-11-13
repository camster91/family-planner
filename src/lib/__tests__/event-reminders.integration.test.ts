// In-app event reminders against disposable Postgres: written once on an inbox read, private, and never replayed.
import { assertFixtureTargetAllowed } from '@/lib/fixtures/guard'
import { EVENT_REMINDERS_READY_ENV } from '@/lib/event-reminders'
import { EVENT_PEOPLE_READY_ENV } from '@/lib/event-participants'
export {}
const dbSuite = process.env.RUN_DB_INTEGRATION === '1' ? describe : describe.skip
jest.setTimeout(60000)
dbSuite('event reminders (Postgres)', () => {
  let db: NonNullable<typeof import('@/lib/prisma').prisma>
  let write: typeof import('@/lib/event-reminders-db').writeDueEventReminders
  const A = 'remind-pg-family-a', B = 'remind-pg-family-b'
  const P = 'remind-pg-parent', T = 'remind-pg-teen', F = 'remind-pg-foreign', KID = 'remind-pg-kid'
  const TZ = 'America/Toronto', HOUR = 3_600_000
  const now = new Date('2026-06-10T16:00:00.000Z') // noon in Toronto
  const parent = { userId: P, generation: 0 }, teen = { userId: T, generation: 0 }, foreign = { userId: F, generation: 0 }
  const event = (id: string, startsInMs: number, title = 'Swim', family = A, by = P) => db.event.create({ data: {
    id, family_id: family, title, created_by: by, start_time: new Date(now.getTime() + startsInMs), end_time: new Date(now.getTime() + startsInMs + HOUR) } })
  const inbox = (userId: string) => db.notification.findMany({ where: { user_id: userId }, orderBy: [{ created_at: 'asc' }, { id: 'asc' }] })
  const clean = async () => {
    await db.notification.deleteMany({ where: { user_id: { in: [P, T, F] } } })
    await db.family.deleteMany({ where: { id: { in: [A, B] } } })
    await db.user.deleteMany({ where: { id: { in: [P, T, F] } } })
  }
  beforeAll(async () => {
    assertFixtureTargetAllowed(process.env)
    db = (await import('@/lib/prisma')).prisma!
    write = (await import('@/lib/event-reminders-db')).writeDueEventReminders
    await clean()
    await db.family.createMany({ data: [{ id: A, name: 'Remind A', invite_code: A }, { id: B, name: 'Remind B', invite_code: B }] })
    await db.user.createMany({ data: [
      { id: P, email: 'remind-pg-parent@example.test', name: 'Parent', role: 'parent', family_id: A },
      { id: T, email: 'remind-pg-teen@example.test', name: 'Teen', role: 'teen', family_id: A },
      { id: F, email: 'remind-pg-foreign@example.test', name: 'Foreign', role: 'parent', family_id: B },
    ] })
    await db.householdMember.create({ data: { id: KID, family_id: A, name: 'Kid', role: 'child' } })
  })
  beforeEach(async () => {
    process.env[EVENT_REMINDERS_READY_ENV] = '1'
    process.env[EVENT_PEOPLE_READY_ENV] = '1'
    await db.event.deleteMany({ where: { family_id: { in: [A, B] } } })
    await db.notification.deleteMany({ where: { user_id: { in: [P, T, F] } } })
    await db.user.updateMany({ where: { id: { in: [P, T, F] } }, data: { notify_events: true, quiet_hours_time_zone: null, morning_summary_time_zone: null } })
  })
  afterAll(async () => {
    delete process.env[EVENT_REMINDERS_READY_ENV]; delete process.env[EVENT_PEOPLE_READY_ENV]
    if (!db) return
    await clean()
    await db.$disconnect()
  })

  it('writes nothing when the capability is off, the zone is unknown or the session is stale', async () => {
    await event('remind-pg-e1', 2 * HOUR)
    process.env[EVENT_REMINDERS_READY_ENV] = '0'
    expect(await write(db, parent, TZ, now)).toBe(0)
    process.env[EVENT_REMINDERS_READY_ENV] = '1'
    expect(await write(db, parent, 'Mars/Olympus', now)).toBe(0)
    expect(await write(db, parent, null, now)).toBe(0)
    expect(await write(db, { userId: P, generation: 7 }, TZ, now)).toBe(0)
    expect(await inbox(P)).toHaveLength(0)
    expect(await db.eventReminder.count({ where: { family_id: A } })).toBe(0)
    // A saved zone stands in when the browser sends none.
    await db.user.update({ where: { id: P }, data: { quiet_hours_time_zone: 'Europe/Paris' } })
    expect(await write(db, parent, null, now)).toBe(1)
    expect((await inbox(P))[0].message).toBe('Today at 8:00 PM')
  })

  it('reminds once for an event starting within a day, in local time, with a link to it', async () => {
    await event('remind-pg-soon', 2 * HOUR, '  Swim   lesson ')
    await event('remind-pg-tomorrow', 20 * HOUR, 'Brunch')
    await event('remind-pg-later', 25 * HOUR, 'Too far')
    await event('remind-pg-started', -HOUR / 2, 'Already on')
    expect(await write(db, parent, TZ, now)).toBe(2)
    expect((await inbox(P)).map(({ title, message, type, read, action_url }) => ({ title, message, type, read, action_url }))).toEqual([
      { title: 'Coming up: Swim lesson', message: 'Today at 2:00 PM', type: 'event', read: false, action_url: '/dashboard/calendar?focus=remind-pg-soon' },
      { title: 'Coming up: Brunch', message: 'Tomorrow at 8:00 AM', type: 'event', read: false, action_url: '/dashboard/calendar?focus=remind-pg-tomorrow' },
    ])
    // Read again, at once and in a race: nothing new. Each account has its own.
    expect(await Promise.all([write(db, parent, TZ, now), write(db, parent, TZ, now)])).toEqual([0, 0])
    expect(await write(db, teen, TZ, now)).toBe(2)
    expect(await inbox(P)).toHaveLength(2)
    // An hour later the far event is due; the others are not written again.
    expect(await write(db, parent, TZ, new Date(now.getTime() + HOUR))).toBe(1)
    expect((await inbox(P)).map((row) => row.title)).toContain('Coming up: Too far')
  })

  it('a deleted or muted reminder never comes back', async () => {
    await event('remind-pg-gone', 2 * HOUR)
    expect(await write(db, parent, TZ, now)).toBe(1)
    await db.notification.deleteMany({ where: { user_id: P } })
    expect(await write(db, parent, TZ, now)).toBe(0)
    expect(await inbox(P)).toHaveLength(0)
    await db.user.update({ where: { id: T }, data: { notify_events: false } })
    expect(await write(db, teen, TZ, now)).toBe(0)
    expect(await db.eventReminder.count({ where: { user_id: T } })).toBe(1)
    await db.user.update({ where: { id: T }, data: { notify_events: true } })
    expect(await write(db, teen, TZ, now)).toBe(0)
    expect(await inbox(T)).toHaveLength(0)
    // Deleting the event removes its proof with it.
    await db.event.delete({ where: { id: 'remind-pg-gone' } })
    expect(await db.eventReminder.count({ where: { family_id: A } })).toBe(0)
  })

  it('follows who the event is for; a parent stands in for a person without an account', async () => {
    await event('remind-pg-teen-only', 2 * HOUR, 'Band')
    await event('remind-pg-kid-only', 3 * HOUR, 'Checkup')
    await db.eventParticipant.createMany({ data: [
      { event_id: 'remind-pg-teen-only', family_id: A, user_id: T }, { event_id: 'remind-pg-kid-only', family_id: A, member_id: KID } ] })
    expect(await write(db, parent, TZ, now)).toBe(1)
    expect(await write(db, teen, TZ, now)).toBe(1)
    expect((await inbox(P)).map((row) => row.title)).toEqual(['Coming up: Checkup'])
    expect((await inbox(T)).map((row) => row.title)).toEqual(['Coming up: Band'])
    // With people off, every event is the whole family's.
    process.env[EVENT_PEOPLE_READY_ENV] = '0'
    expect(await write(db, parent, TZ, now)).toBe(1)
    expect((await inbox(P)).map((row) => row.title).sort()).toEqual(['Coming up: Band', 'Coming up: Checkup'])
  })

  it('never crosses households, and the database refuses a foreign account', async () => {
    await event('remind-pg-private', 2 * HOUR, 'PRIVATE A EVENT')
    expect(await write(db, foreign, TZ, now)).toBe(0)
    expect(await inbox(F)).toHaveLength(0)
    await event('remind-pg-b', 2 * HOUR, 'B event', B, F)
    expect(await write(db, foreign, TZ, now)).toBe(1)
    expect(await write(db, parent, TZ, now)).toBe(1)
    expect((await inbox(P)).map((row) => row.title)).toEqual(['Coming up: PRIVATE A EVENT'])
    expect((await inbox(F)).map((row) => row.title)).toEqual(['Coming up: B event'])
    await expect(db.eventReminder.create({ data: { event_id: 'remind-pg-private', family_id: A, user_id: F } })).rejects.toThrow()
    await expect(db.eventReminder.updateMany({ where: { user_id: P }, data: { user_id: T } })).rejects.toThrow()
  })

  it('writes at most ten per read and the rest on the next', async () => {
    for (let i = 0; i < 12; i++) await event(`remind-pg-many-${String(i).padStart(2, '0')}`, (i + 1) * HOUR, `Event ${i}`)
    expect(await write(db, parent, TZ, now)).toBe(10)
    expect(await write(db, parent, TZ, now)).toBe(2)
    expect(await inbox(P)).toHaveLength(12)
  })
})
