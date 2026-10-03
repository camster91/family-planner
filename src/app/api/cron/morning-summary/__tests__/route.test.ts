// POST /api/cron/morning-summary (O-38) against the two-household fake
// database: fail-closed auth like the recurring-chores cron, opt-in only,
// once per person per local day (retries and double calls send nothing more),
// quiet hours hold it, an unverified address gets in-app only, one household's
// failure does not stop the other, and neither household's content reaches
// the other. Mail sending is mocked.

jest.mock('next/server', () => require('@/__tests__/helpers/two-household').nextServerMock)
jest.mock('@/lib/prisma', () => ({
  prisma: require('@/__tests__/helpers/two-household').fakePrisma,
}))
jest.mock('@/lib/mail', () => {
  const actual = jest.requireActual('@/lib/mail')
  return {
    ...actual,
    sendMail: jest.fn(async () => undefined),
    isMailConfigured: jest.fn(() => true),
  }
})

import { POST } from '../route'
import { db, fakePrisma, FAMILY_A, FAMILY_B, FOREIGN, USER_IDS, type UserKey } from '@/__tests__/helpers/two-household'
import { isMailConfigured, sendMail } from '@/lib/mail'

const send = sendMail as jest.Mock
const mailConfigured = isMailConfigured as jest.Mock
const SECRET = 'cron-secret-value-for-tests'
const SAVED = process.env.CRON_SECRET
const TZ = 'America/Toronto'
// 06:45 in Toronto (EDT, UTC-4) on Saturday 2026-10-03.
const MORNING = new Date('2026-10-03T10:45:00Z')
const DAY = '2026-10-03'
const UTC_MIDNIGHT = new Date(`${DAY}T00:00:00Z`)

function post(opts: { secret?: string | null; tz?: string } = {}): Promise<any> {
  const url = new URL('http://localhost/api/cron/morning-summary')
  if (opts.tz !== undefined) url.searchParams.set('tz', opts.tz)
  const headers = new Headers()
  const secret = opts.secret === undefined ? SECRET : opts.secret
  if (secret !== null) headers.set('x-cron-secret', secret)
  return POST({
    method: 'POST',
    url: url.toString(),
    nextUrl: url,
    headers,
  } as any)
}

function optIn(who: UserKey, extra: Record<string, unknown> = {}) {
  Object.assign(db.find('user', USER_IDS[who])!, {
    morning_summary_enabled: true,
    morning_summary_time_zone: TZ,
    ...extra,
  })
}

function notifications(who?: UserKey) {
  return db.rows('notification').filter((n) => n.type === 'summary' && (!who || n.user_id === USER_IDS[who]))
}

function mailTo(who: UserKey) {
  return send.mock.calls.map((c) => c[0]).filter((m) => m.to === `${USER_IDS[who]}@example.test`)
}

/** Today's rows in both households; household B's text carries FOREIGN. */
function seedToday() {
  db.rows('chore').push(
    {
      id: 'ms-chore-a1',
      family_id: FAMILY_A,
      title: 'Feed the <cat> & dog',
      assigned_to: 'child-a',
      due_date: UTC_MIDNIGHT,
      status: 'pending',
      created_at: UTC_MIDNIGHT,
      created_by: 'parent-a',
    },
    {
      id: 'ms-chore-a2',
      family_id: FAMILY_A,
      title: 'Make bed',
      assigned_to: 'teen-a',
      due_date: UTC_MIDNIGHT,
      status: 'pending',
      created_at: UTC_MIDNIGHT,
      created_by: 'parent-a',
    },
    {
      id: 'ms-chore-a3',
      family_id: FAMILY_A,
      title: 'Waiting check',
      assigned_to: 'child-a',
      due_date: UTC_MIDNIGHT,
      status: 'completed',
      created_at: UTC_MIDNIGHT,
      created_by: 'parent-a',
    },
    {
      id: 'ms-chore-b1',
      family_id: FAMILY_B,
      title: `${FOREIGN} chore`,
      assigned_to: 'child-b',
      due_date: UTC_MIDNIGHT,
      status: 'pending',
      created_at: UTC_MIDNIGHT,
      created_by: 'parent-b',
    }
  )
  db.rows('event').push(
    {
      id: 'ms-event-a',
      family_id: FAMILY_A,
      title: 'Dentist',
      start_time: new Date('2026-10-03T19:00:00Z'),
      end_time: new Date('2026-10-03T20:00:00Z'),
      location: 'Secret clinic address',
      description: 'private note',
      created_by: 'parent-a',
      is_task: false,
      created_at: UTC_MIDNIGHT,
    },
    {
      id: 'ms-event-b',
      family_id: FAMILY_B,
      title: `${FOREIGN} game`,
      start_time: new Date('2026-10-03T17:00:00Z'),
      end_time: new Date('2026-10-03T18:00:00Z'),
      location: null,
      description: null,
      created_by: 'parent-b',
      is_task: false,
      created_at: UTC_MIDNIGHT,
    }
  )
  db.rows('familyMeal').push(
    {
      id: 'ms-meal-a',
      family_id: FAMILY_A,
      date: UTC_MIDNIGHT,
      meal_type: 'dinner',
      recipe_name: 'Tacos',
      notes: 'private meal note',
      cook_id: null,
      created_by: 'parent-a',
      created_at: UTC_MIDNIGHT,
      recipe_id: null,
    },
    {
      id: 'ms-meal-b',
      family_id: FAMILY_B,
      date: UTC_MIDNIGHT,
      meal_type: 'dinner',
      recipe_name: `${FOREIGN} stew`,
      notes: null,
      cook_id: null,
      created_by: 'parent-b',
      created_at: UTC_MIDNIGHT,
      recipe_id: null,
    }
  )
}

let logged: string[] = []

beforeEach(() => {
  db.reset()
  send.mockReset()
  send.mockResolvedValue(undefined)
  mailConfigured.mockReturnValue(true)
  process.env.CRON_SECRET = SECRET
  jest.useFakeTimers({
    doNotFake: ['nextTick', 'setImmediate', 'queueMicrotask', 'setTimeout', 'setInterval'],
  })
  jest.setSystemTime(MORNING)
  logged = []
  for (const level of ['log', 'info', 'warn', 'error'] as const) {
    jest.spyOn(console, level).mockImplementation((...args: unknown[]) => {
      logged.push(args.map((a) => (a instanceof Error ? `${a.name}:${a.message}` : String(a))).join(' '))
    })
  }
})

afterEach(() => {
  jest.useRealTimers()
  jest.restoreAllMocks()
})

afterAll(() => {
  if (SAVED === undefined) delete process.env.CRON_SECRET
  else process.env.CRON_SECRET = SAVED
})

describe('POST /api/cron/morning-summary: auth (fail closed)', () => {
  it('500 when CRON_SECRET is unset, reading and sending nothing', async () => {
    delete process.env.CRON_SECRET
    optIn('parentA')
    const res = await post()
    expect(res.status).toBe(500)
    expect(await res.json()).toEqual({ error: 'Cron not configured' })
    expect(db.writes).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it.each([
    ['missing', null],
    ['wrong', 'wrong-secret-value-for-tests'],
    ['a prefix', SECRET.slice(0, 10)],
    ['empty', ''],
  ])('401 with a %s secret, sending nothing and never echoing the secret', async (_label, secret) => {
    optIn('parentA')
    const res = await post({ secret })
    expect(res.status).toBe(401)
    expect(JSON.stringify(await res.json())).not.toContain(SECRET)
    expect(db.writes).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('400 for an unknown fallback time zone', async () => {
    const res = await post({ tz: 'Mars/Olympus' })
    expect(res.status).toBe(400)
    expect(db.writes).toHaveLength(0)
  })
})

describe('POST /api/cron/morning-summary: sending', () => {
  it('sends nothing to anyone who has not opted in (the default)', async () => {
    seedToday()
    const res = await post()
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.sent).toEqual({ inApp: 0, email: 0 })
    expect(notifications()).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
    expect(db.writes).toHaveLength(0)
  })

  it('sends each opted-in person their own summary, in-app and by email, with role rules', async () => {
    seedToday()
    optIn('parentA')
    optIn('childA')
    const res = await post()
    const body = await res.json()
    expect(body).toMatchObject({
      success: true,
      households: { processed: 1, failed: 0 },
      sent: { inApp: 2, email: 2 },
      failedRecipients: 0,
      truncated: false,
    })

    const [childNote] = notifications('childA')
    expect(childNote).toMatchObject({
      type: 'summary',
      title: 'Your morning summary',
      action_url: '/dashboard/today',
    })
    expect(childNote.message).toBe('Today: 1 chore (Feed the <cat> & dog), Dentist at 3pm, Tacos for dinner.')
    const [parentNote] = notifications('parentA')
    // The parent's own chores (none), family events, dinner and the check count; never the kids' chore titles.
    expect(parentNote.message).toBe('Today: Dentist at 3pm, Tacos for dinner, 1 chore to check.')
    expect(notifications('teenA')).toHaveLength(0)

    const [childMail] = mailTo('childA')
    expect(childMail.subject).toBe('Your day: Saturday, October 3')
    // Escaped in HTML, plain in text.
    expect(childMail.html).toContain('Feed the &lt;cat&gt; &amp; dog')
    expect(childMail.html).not.toContain('<cat>')
    expect(childMail.text).toContain('Your 1 chore: Feed the <cat> & dog')
    // Children have no Settings page: their off switch is in the user menu.
    expect(childMail.text).toContain('Turn this off in the menu under your name → Notifications')
    const [parentMail] = mailTo('parentA')
    expect(parentMail.text).toContain('Turn this off in Settings → Notifications: https://')
    expect(parentMail.text).toMatch(/\/dashboard\/settings$/)
    expect(parentMail.html).toContain('/dashboard/settings')

    // Never the event location/description or the meal note.
    for (const m of [childMail, parentMail]) {
      for (const field of [m.html, m.text]) {
        expect(field).not.toMatch(/Secret clinic|private note|private meal note/)
      }
    }
    // Both claimed today.
    expect(db.find('user', USER_IDS.childA)!.morning_summary_sent_on).toBe(DAY)
    expect(db.find('user', USER_IDS.parentA)!.morning_summary_sent_on).toBe(DAY)
  })

  it('is idempotent: a retried or double call the same local day sends nothing more', async () => {
    seedToday()
    optIn('parentA')
    optIn('childA')
    await post()
    const [second, third] = await Promise.all([post(), post()])
    for (const res of [second, third]) {
      const body = await res.json()
      expect(body.sent).toEqual({ inApp: 0, email: 0 })
      expect(body.skipped.alreadySent).toBe(2)
    }
    expect(notifications()).toHaveLength(2)
    expect(send).toHaveBeenCalledTimes(2)

    // The next local day is a new day.
    jest.setSystemTime(new Date('2026-10-04T10:45:00Z'))
    db.rows('chore').push({
      id: 'ms-chore-next',
      family_id: FAMILY_A,
      title: 'Water plants',
      assigned_to: 'child-a',
      due_date: new Date('2026-10-04T00:00:00Z'),
      status: 'pending',
      created_at: UTC_MIDNIGHT,
      created_by: 'parent-a',
    })
    const body = await (await post()).json()
    expect(body.sent.inApp).toBe(2)
    expect(notifications('childA').map((n) => n.message)).toContain('Today: 1 chore (Water plants).')
    // The chore waiting for a check still waits, so the parent hears about it again.
    expect(notifications('parentA').map((n) => n.message)).toContain('Today: 1 chore to check.')
    expect(db.find('user', USER_IDS.childA)!.morning_summary_sent_on).toBe('2026-10-04')
  })

  it('claims the day before sending, so two overlapping runs cannot both send', async () => {
    seedToday()
    optIn('childA')
    const updateMany = jest.spyOn(fakePrisma.user, 'updateMany')
    await Promise.all([post(), post()])
    expect(notifications('childA')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
    const claims = updateMany.mock.calls.map((c: any) => c[0])
    expect(claims.length).toBeGreaterThanOrEqual(1)
    expect(claims[0].where).toMatchObject({
      id: USER_IDS.childA,
      morning_summary_enabled: true,
    })
  })

  it('sends nothing when the person has nothing today, and does not claim the day', async () => {
    optIn('teenA') // household A has no rows for today
    const body = await (await post()).json()
    expect(body.skipped.nothingToday).toBe(1)
    expect(notifications()).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
    expect(db.find('user', USER_IDS.teenA)!.morning_summary_sent_on).toBeNull()
  })

  it('an unverified address gets the in-app summary only', async () => {
    seedToday()
    optIn('teenA', { email_verified: false })
    const body = await (await post()).json()
    expect(body.sent).toEqual({ inApp: 1, email: 0 })
    expect(body.skipped.noEmail).toBe(1)
    expect(notifications('teenA')[0].message).toBe('Today: 1 chore (Make bed), Dentist at 3pm, Tacos for dinner.')
    expect(send).not.toHaveBeenCalled()
  })

  it('without mail configured, in-app only and nothing logged with the content', async () => {
    seedToday()
    mailConfigured.mockReturnValue(false)
    optIn('childA')
    const body = await (await post()).json()
    expect(body.sent).toEqual({ inApp: 1, email: 0 })
    expect(send).not.toHaveBeenCalled()
    expect(logged.join('\n')).not.toContain('Feed the')
  })

  it('quiet hours hold the whole summary without claiming the day; a later run sends it', async () => {
    seedToday()
    optIn('childA', {
      quiet_hours_enabled: true,
      quiet_hours_start: '21:00',
      quiet_hours_end: '07:00',
      quiet_hours_time_zone: TZ,
    })
    const early = await (await post()).json()
    expect(early.skipped.quietHours).toBe(1)
    expect(notifications()).toHaveLength(0)
    expect(send).not.toHaveBeenCalled()
    expect(db.find('user', USER_IDS.childA)!.morning_summary_sent_on).toBeNull()

    jest.setSystemTime(new Date('2026-10-03T11:15:00Z')) // 07:15 in Toronto
    const later = await (await post()).json()
    expect(later.sent).toEqual({ inApp: 1, email: 1 })
  })

  it("uses the person's saved zone; the operator's tz only for people without one", async () => {
    seedToday()
    // Auckland: 10:45Z on Oct 3 is 11:45pm Oct 3 there (NZDT starts Sep 27, UTC+13).
    optIn('childA', { morning_summary_time_zone: 'Pacific/Auckland' })
    optIn('teenA', { morning_summary_time_zone: null })
    await post({ tz: 'Pacific/Kiritimati' }) // UTC+14: already Oct 4 for the teen
    // Still Oct 3 in Auckland: the Oct 3 chore and dinner; the dentist (8am Oct 4 there) is tomorrow.
    expect(db.find('user', USER_IDS.childA)!.morning_summary_sent_on).toBe(DAY)
    expect(notifications('childA')[0].message).toBe('Today: 1 chore (Feed the <cat> & dog), Tacos for dinner.')
    // Already Oct 4 for the teen: the dentist is at 9am there; Oct 3 chores and dinner are yesterday.
    expect(db.find('user', USER_IDS.teenA)!.morning_summary_sent_on).toBe('2026-10-04')
    expect(notifications('teenA')[0].message).toBe('Today: Dentist at 9am.')
  })

  it('keeps households apart, and one household failing does not stop the other', async () => {
    seedToday()
    optIn('childA')
    optIn('childB')
    optIn('parentB')
    const real = fakePrisma.familyMeal.findMany
    jest.spyOn(fakePrisma.familyMeal, 'findMany').mockImplementation(async (args: any) => {
      if (args.where.family_id === FAMILY_B) throw new Error('database hiccup')
      return real(args)
    })
    const body = await (await post()).json()
    expect(body).toMatchObject({
      success: false,
      households: { processed: 1, failed: 1 },
      sent: { inApp: 1, email: 1 },
    })
    expect(notifications('childA')).toHaveLength(1)
    expect(notifications('childB')).toHaveLength(0)
    // B was not claimed, so the next run (once B recovers) sends it.
    expect(db.find('user', USER_IDS.childB)!.morning_summary_sent_on).toBeNull()

    jest.restoreAllMocks()
    send.mockResolvedValue(undefined)
    const next = await (await post()).json()
    expect(next.sent.inApp).toBe(2)
    const childB = notifications('childB')[0].message
    expect(childB).toContain(FOREIGN)
    // A's summary never carries B's text, and B's never A's.
    expect(notifications('childA')[0].message).not.toContain(FOREIGN)
    expect(childB).not.toMatch(/Dentist|Tacos|Feed the/)
    for (const m of send.mock.calls.map((c) => c[0])) {
      const isA = m.to.startsWith('child-a') || m.to.startsWith('parent-a')
      if (isA) expect(`${m.html}${m.text}`).not.toContain(FOREIGN)
      else expect(`${m.html}${m.text}`).not.toMatch(/Dentist|Tacos/)
    }
  })

  it('an email failure is counted, not retried, and never sends twice', async () => {
    seedToday()
    optIn('childA')
    send.mockRejectedValueOnce(new Error('Mailgun failed (500)'))
    const first = await (await post()).json()
    expect(first).toMatchObject({
      success: false,
      failedRecipients: 1,
      sent: { inApp: 1, email: 0 },
    })
    const second = await (await post()).json()
    expect(second.sent).toEqual({ inApp: 0, email: 0 })
    expect(notifications('childA')).toHaveLength(1)
    expect(send).toHaveBeenCalledTimes(1)
  })

  it('never logs the secret, addresses or summary text', async () => {
    seedToday()
    optIn('childA')
    send.mockRejectedValueOnce(new Error('boom'))
    await post()
    await post({ secret: 'wrong-secret-value-for-tests' })
    const all = logged.join('\n')
    expect(all).not.toContain(SECRET)
    expect(all).not.toContain('child-a@example.test')
    expect(all).not.toContain('Feed the')
  })
})
