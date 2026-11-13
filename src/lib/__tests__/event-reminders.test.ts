import { EVENT_REMINDERS_READY_ENV, eventRemindersReady, reminderIsFor, reminderText, reminderTimeZone } from '../event-reminders'

describe('event reminder rules', () => {
  afterEach(() => { delete process.env[EVENT_REMINDERS_READY_ENV] })
  it('is on only for exactly "1"', () => {
    for (const value of [undefined, '', '0', 'true', ' 1']) {
      if (value === undefined) delete process.env[EVENT_REMINDERS_READY_ENV]; else process.env[EVENT_REMINDERS_READY_ENV] = value
      expect(eventRemindersReady()).toBe(false)
    }
    process.env[EVENT_REMINDERS_READY_ENV] = '1'
    expect(eventRemindersReady()).toBe(true)
  })
  it('takes the first real zone and refuses made-up or oversized ones', () => {
    expect(reminderTimeZone('America/Toronto', 'Europe/Paris')).toBe('America/Toronto')
    expect(reminderTimeZone('Mars/Olympus', null, 'Europe/Paris')).toBe('Europe/Paris')
    expect(reminderTimeZone(null, undefined, '')).toBeNull()
    expect(reminderTimeZone('A'.repeat(65))).toBeNull()
  })
  it('reminds the whole family when nobody is named, else the people named', () => {
    const teen = { id: 'teen', role: 'teen' }, parent = { id: 'parent', role: 'parent' }
    expect(reminderIsFor(teen, [])).toBe(true)
    expect(reminderIsFor(teen, [{ user_id: 'teen', member_id: null }])).toBe(true)
    expect(reminderIsFor(teen, [{ user_id: 'parent', member_id: null }])).toBe(false)
    // A person without an account cannot be reminded; a parent is, for them.
    expect(reminderIsFor(parent, [{ user_id: null, member_id: 'kid' }])).toBe(true)
    expect(reminderIsFor(teen, [{ user_id: null, member_id: 'kid' }])).toBe(false)
    expect(reminderIsFor(parent, [{ user_id: 'teen', member_id: null }])).toBe(false)
  })
  it('writes the local day and time, and trims a long title', () => {
    const now = Date.parse('2026-03-07T20:00:00Z') // 3 PM Toronto, the day before clocks change
    expect(reminderText({ title: '  Swim   lesson ', start: Date.parse('2026-03-07T23:30:00Z') }, 'America/Toronto', now))
      .toEqual({ title: 'Coming up: Swim lesson', message: 'Today at 6:30 PM' })
    expect(reminderText({ title: 'Brunch', start: Date.parse('2026-03-08T14:00:00Z') }, 'America/Toronto', now).message).toBe('Tomorrow at 10:00 AM')
    // The same instant is already tomorrow further east.
    expect(reminderText({ title: 'Call', start: Date.parse('2026-03-07T23:30:00Z') }, 'Europe/Paris', now).message).toBe('Tomorrow at 12:30 AM')
    const long = reminderText({ title: 'x'.repeat(300), start: now + 1 }, 'UTC', now).title
    expect(long).toHaveLength('Coming up: '.length + 120)
    expect(long.endsWith('…')).toBe(true)
  })
})
