// One true summary sentence for the home screen (#268).
import { homeSummary, memberSummary, parentSummary, type HomeChore } from '../home-summary'

const TODAY = '2026-01-05'
const members = [
  { id: 'p', name: 'Pat Parent' },
  { id: 'c', name: 'Casey Kid' },
  { id: 't', name: 'Taylor Teen' },
]

let n = 0
function chore(assigneeId: string, status: string, dueDay = TODAY): HomeChore {
  n += 1
  return { id: `ch${n}`, title: `Chore ${n}`, dueDay, status, assigneeId }
}

describe('parentSummary', () => {
  it('counts open household chores due today, by person, most first', () => {
    const chores = [
      chore('t', 'pending'),
      chore('c', 'pending'),
      chore('c', 'in_progress'),
      chore('c', 'completed'),
      chore('p', 'verified'),
      chore('c', 'pending', '2026-01-04'), // yesterday: not today's count
      chore('t', 'pending', '2026-01-06'), // tomorrow
    ]
    expect(parentSummary(chores, members, TODAY)).toBe('3 chores left today · Casey 2, Taylor 1')
  })

  it('uses the singular and breaks ties in household order', () => {
    expect(parentSummary([chore('t', 'pending')], members, TODAY)).toBe('1 chore left today · Taylor 1')
    expect(parentSummary([chore('t', 'pending'), chore('c', 'overdue')], members, TODAY)).toBe(
      '2 chores left today · Casey 1, Taylor 1'
    )
  })

  it('says everything is done, or that there is nothing today — never both', () => {
    expect(parentSummary([chore('c', 'completed'), chore('t', 'verified')], members, TODAY)).toBe(
      'Every chore is done for today'
    )
    expect(parentSummary([], members, TODAY)).toBe('No chores today')
    expect(parentSummary([chore('c', 'pending', '2026-01-06')], members, TODAY)).toBe('No chores today')
  })

  it('counts a chore for someone no longer listed without inventing a name', () => {
    expect(parentSummary([chore('gone', 'pending')], members, TODAY)).toBe('1 chore left today · someone 1')
  })
})

describe('memberSummary', () => {
  it("speaks about the viewer's own chores only", () => {
    const chores = [chore('c', 'pending'), chore('c', 'pending'), chore('t', 'pending'), chore('c', 'completed')]
    expect(memberSummary(chores, 'c', TODAY)).toBe('You have 2 chores left')
    expect(memberSummary(chores, 't', TODAY)).toBe('You have 1 chore left')
  })

  it("is done when everything due today is ticked, and quiet when nothing was due", () => {
    expect(memberSummary([chore('c', 'completed'), chore('t', 'pending')], 'c', TODAY)).toBe("You're done for today")
    expect(memberSummary([chore('t', 'pending')], 'c', TODAY)).toBe('Nothing on your list today')
  })
})

describe('homeSummary', () => {
  it('picks the household sentence for a parent and the own sentence for everyone else', () => {
    const chores = [chore('c', 'pending'), chore('t', 'pending')]
    expect(homeSummary({ viewer: { id: 'p', role: 'parent' }, chores, members, todayKey: TODAY })).toBe(
      '2 chores left today · Casey 1, Taylor 1'
    )
    expect(homeSummary({ viewer: { id: 't', role: 'teen' }, chores, members, todayKey: TODAY })).toBe(
      'You have 1 chore left'
    )
    expect(homeSummary({ viewer: { id: 'c', role: 'child' }, chores, members, todayKey: TODAY })).toBe(
      'You have 1 chore left'
    )
  })
})
