import {
  eventPeopleReady, EVENT_PEOPLE_READY_ENV, orderEventPeople, resolveHouseholdPeople, unknownEventPeople,
} from '@/lib/event-participants'
import { createEventSchema, updateEventSchema } from '@/lib/validations'

const rows = [
  { kind: 'account' as const, id: 'a', name: 'Avery', board_color: 'green' },
  { kind: 'account' as const, id: 'b', name: 'Blake', board_color: null },
  // Same id as an account on purpose: kinds never share a namespace.
  { kind: 'profile' as const, id: 'a', name: 'Kid', board_color: null },
]

describe('people on events: shared rules', () => {
  afterEach(() => { delete process.env[EVENT_PEOPLE_READY_ENV] })

  it('is off unless the capability is exactly "1"', () => {
    expect(eventPeopleReady()).toBe(false)
    for (const value of ['0', 'true', '', ' 1']) { process.env[EVENT_PEOPLE_READY_ENV] = value; expect(eventPeopleReady()).toBe(false) }
    process.env[EVENT_PEOPLE_READY_ENV] = '1'
    expect(eventPeopleReady()).toBe(true)
  })

  it('keeps household order, a chosen colour and distinct fallbacks', () => {
    const people = resolveHouseholdPeople(rows)
    expect([...people.keys()]).toEqual(['account:a', 'account:b', 'profile:a'])
    expect(people.get('account:a')).toEqual({ kind: 'account', id: 'a', name: 'Avery', color: 'green' })
    expect(new Set([...people.values()].map((p) => p.color)).size).toBe(3)
  })

  it('shows current members only, in household order, whatever order they were chosen in', () => {
    const people = resolveHouseholdPeople(rows)
    const refs = [{ kind: 'profile' as const, id: 'a' }, { kind: 'account' as const, id: 'gone' }, { kind: 'account' as const, id: 'b' }]
    expect(orderEventPeople(refs, people).map((p) => `${p.kind}:${p.id}`)).toEqual(['account:b', 'profile:a'])
    expect(unknownEventPeople(refs, people)).toEqual([{ kind: 'account', id: 'gone' }])
    expect(orderEventPeople([], people)).toEqual([])
  })
})

describe('people on events: request validation', () => {
  const base = { title: 'Dentist', start_time: '2026-11-20T14:00:00Z' }
  const person = (id: string, kind: 'account' | 'profile' = 'account') => ({ kind, id })

  it('accepts an optional list of identities and nothing else', () => {
    expect(createEventSchema.safeParse(base).success).toBe(true)
    expect(createEventSchema.safeParse({ ...base, participants: [] }).success).toBe(true)
    expect(createEventSchema.safeParse({ ...base, participants: [person('u1'), person('u1', 'profile')] }).success).toBe(true)
    expect(updateEventSchema.safeParse({ eventId: 'e1', participants: [person('u1')] }).success).toBe(true)
  })

  it.each([
    ['a duplicate person', [person('u1'), person('u1')]],
    ['an unknown kind', [{ kind: 'device', id: 'u1' }]],
    ['a client-supplied name or colour', [{ kind: 'account', id: 'u1', name: 'Mallory', color: 'red' }]],
    ['an unsafe id', [person('../etc')]],
    ['more than twelve people', Array.from({ length: 13 }, (_, i) => person(`u${i}`))],
    ['a non-array', 'u1'],
  ])('refuses %s', (_label, participants) => {
    expect(createEventSchema.safeParse({ ...base, participants }).success).toBe(false)
    expect(updateEventSchema.safeParse({ eventId: 'e1', participants }).success).toBe(false)
  })
})
