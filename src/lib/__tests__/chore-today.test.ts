// One rule for "today" lists and counts (owner decision 2026-11-19): due today,
// or still open and overdue. Done chores from earlier days never come back.
import {
  belongsToToday,
  isOpenChoreStatus,
  isOverdueChore,
  OPEN_CHORE_STATUSES,
} from '../chore-today'

const TODAY = '2026-11-19'

describe('chore-today', () => {
  it('treats pending, in progress and overdue as open', () => {
    expect(OPEN_CHORE_STATUSES).toEqual(['pending', 'in_progress', 'overdue'])
    for (const status of ['pending', 'in_progress', 'overdue']) expect(isOpenChoreStatus(status)).toBe(true)
    for (const status of ['completed', 'verified', 'approved', '']) expect(isOpenChoreStatus(status)).toBe(false)
  })

  it('marks an open chore from an earlier day overdue ("Mow the lawn", 3 days ago)', () => {
    expect(isOverdueChore('2026-11-16', 'overdue', TODAY)).toBe(true)
    expect(isOverdueChore('2026-11-18', 'pending', TODAY)).toBe(true)
    expect(isOverdueChore('2026-11-19', 'pending', TODAY)).toBe(false)
    expect(isOverdueChore('2026-11-16', 'completed', TODAY)).toBe(false)
  })

  it("keeps today's chores whatever their status, adds overdue open ones, and nothing later", () => {
    expect(belongsToToday('2026-11-19', 'verified', TODAY)).toBe(true)
    expect(belongsToToday('2026-11-19', 'pending', TODAY)).toBe(true)
    expect(belongsToToday('2026-11-16', 'overdue', TODAY)).toBe(true)
    expect(belongsToToday('2026-11-16', 'verified', TODAY)).toBe(false)
    expect(belongsToToday('2026-11-20', 'pending', TODAY)).toBe(false)
  })
})
