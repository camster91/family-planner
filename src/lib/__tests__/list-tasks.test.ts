import { LIST_TASKS_READY_ENV, dueState, isDueDay, isTaskListType, listTasksReady, nextTaskRow } from '../list-tasks'
import { listTaskViews } from '../list-tasks-db'
import type { EventPerson } from '../event-participants'

describe('to-do rules', () => {
  afterEach(() => { delete process.env[LIST_TASKS_READY_ENV] })
  it('is on only for exactly "1"', () => {
    for (const value of ['', '0', 'true', ' 1']) { process.env[LIST_TASKS_READY_ENV] = value; expect(listTasksReady()).toBe(false) }
    delete process.env[LIST_TASKS_READY_ENV]
    expect(listTasksReady()).toBe(false)
    process.env[LIST_TASKS_READY_ENV] = '1'
    expect(listTasksReady()).toBe(true)
  })
  it('grocery and shopping lists take no owner or due date', () => {
    expect(['todo', 'custom', 'wishlist', 'meal_plan'].every(isTaskListType)).toBe(true)
    expect(['grocery', 'shopping'].some(isTaskListType)).toBe(false)
  })
  it('accepts only real calendar days', () => {
    expect(['2026-01-09', '2028-02-29'].every(isDueDay)).toBe(true)
    expect(['2026-02-30', '2027-02-29', '2026-1-9', '2026-01-09T00:00:00Z', '', null, 20260109].some(isDueDay)).toBe(false)
  })
  it('compares a due day with the reader\'s today', () => {
    expect(dueState('2026-01-08', '2026-01-09')).toBe('overdue')
    expect(dueState('2026-01-09', '2026-01-09')).toBe('today')
    expect(dueState('2026-01-10', '2026-01-09')).toBe('upcoming')
  })
  it('applies a change: left out is unchanged, null clears, nothing left means no row', () => {
    const current = { user_id: 'u1', member_id: null, due_day: '2026-01-09' }
    expect(nextTaskRow(null, { itemId: 'i', due: '2026-01-09' })).toEqual({ user_id: null, member_id: null, due_day: '2026-01-09' })
    expect(nextTaskRow(current, { itemId: 'i', due: null })).toEqual({ user_id: 'u1', member_id: null, due_day: null })
    expect(nextTaskRow(current, { itemId: 'i', owner: { kind: 'profile', id: 'm1' } })).toEqual({ user_id: null, member_id: 'm1', due_day: '2026-01-09' })
    expect(nextTaskRow(current, { itemId: 'i', owner: null })).toEqual({ user_id: null, member_id: null, due_day: '2026-01-09' })
    expect(nextTaskRow(current, { itemId: 'i', owner: null, due: null })).toBeNull()
    expect(nextTaskRow(null, { itemId: 'i', owner: null })).toBeNull()
  })
  it('shows an owner only while they are in the household, and keeps the due day', () => {
    const people = new Map<string, EventPerson>([['account:u1', { kind: 'account', id: 'u1', name: 'Avery', color: 'green' }]])
    const views = listTaskViews([
      { item_id: 'a', user_id: 'u1', member_id: null, due_day: null },
      { item_id: 'b', user_id: 'gone', member_id: null, due_day: '2026-01-09' },
      { item_id: 'c', user_id: null, member_id: 'archived', due_day: null },
    ], people)
    expect(views.get('a')).toEqual({ owner: { kind: 'account', id: 'u1', name: 'Avery', color: 'green' }, due: null })
    expect(views.get('b')).toEqual({ owner: null, due: '2026-01-09' })
    expect(views.has('c')).toBe(false)
  })
})
