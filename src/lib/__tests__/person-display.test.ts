import { choreSubjectKey, firstName, matchesPerson, personColor, personInitial, shortNames } from '../person-display'

describe('person display helpers', () => {
  it('shows first names and initials', () => {
    expect(firstName('Avery Fixture-A')).toBe('Avery')
    expect(firstName('  Mia  ')).toBe('Mia')
    expect(personInitial('élodie Martin')).toBe('É')
    expect(personInitial('')).toBe('?')
  })

  it('keeps full names only when two people share a first name', () => {
    const names = shortNames([
      { key: 'a', name: 'Sam One' },
      { key: 'b', name: 'sam Two' },
      { key: 'c', name: 'Riley Three' },
    ])
    expect([...names.values()]).toEqual(['Sam One', 'sam Two', 'Riley'])
  })

  it('accepts palette colours only', () => {
    expect(personColor('green')).toBe('green')
    expect(personColor('#00ff00')).toBeNull()
    expect(personColor(null)).toBeNull()
  })

  it('keys a chore by its profile subject first, then its account assignee', () => {
    expect(choreSubjectKey({ assigned_to: null, subject: { kind: 'profile', memberId: 'm1' } })).toBe('profile:m1')
    expect(choreSubjectKey({ assigned_to: 'u1' })).toBe('account:u1')
    expect(choreSubjectKey({ assigned_to: null, subject: { kind: 'account', accountId: 'u2' } })).toBe('account:u2')
    expect(choreSubjectKey({ assigned_to: null })).toBeNull()
  })

  it('shows every item for Everyone and only that person’s items otherwise', () => {
    expect(matchesPerson([], 'all')).toBe(true)
    expect(matchesPerson(['account:u1'], 'account:u1')).toBe(true)
    expect(matchesPerson(['account:u1'], 'profile:m1')).toBe(false)
    expect(matchesPerson([], 'profile:m1')).toBe(false)
  })
})
