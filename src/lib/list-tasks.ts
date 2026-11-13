// To-dos (default-off): who a list item is for and when it is due. Kept in a
// side table (ListItemTask) so every existing list read and write is
// unchanged. Dependency-light: the list page imports this in the browser.
import type { EventPerson, EventPersonRef } from './event-participants'

export const LIST_TASKS_READY_ENV = 'FAMILY_LIST_TASKS_READY'
export const listTasksReady = () => process.env[LIST_TASKS_READY_ENV] === '1'

/** What a client sees for one item: its owner as they are in the household now, and its due day. */
export type ListItemTaskView = { owner: EventPerson | null; due: string | null }
/** A change to one item's task. A field left out is unchanged; null clears it. */
export type ListItemTaskInput = { itemId: string; owner?: EventPersonRef | null; due?: string | null }

export const LIST_TASKS_UNSUPPORTED = { status: 409, body: { error: 'To-do owners and due dates are not available yet.', code: 'LIST_TASKS_UNSUPPORTED' } } as const
export const LIST_TASK_INVALID = { status: 400, body: { error: 'Choose a person in this household and a real date.', code: 'LIST_TASK_INVALID' } } as const
export const LIST_TASK_GROCERY = { status: 409, body: { error: 'Grocery and shopping lists do not have owners or due dates.', code: 'LIST_TASK_GROCERY' } } as const

/** Grocery and shopping lists are for buying, not doing: they take no owner or due date. */
export const isTaskListType = (type: string | null | undefined) => type !== 'grocery' && type !== 'shopping'

const DAY = /^(\d{4})-(\d{2})-(\d{2})$/
/** A real calendar day written YYYY-MM-DD. A due date is a day, not an instant, so it has no time zone. */
export function isDueDay(value: unknown): value is string {
  if (typeof value !== 'string') return false
  const match = DAY.exec(value)
  if (!match) return false
  const [y, m, d] = [Number(match[1]), Number(match[2]), Number(match[3])]
  const date = new Date(Date.UTC(y, m - 1, d))
  return y >= 1970 && y <= 2200 && date.getUTCFullYear() === y && date.getUTCMonth() === m - 1 && date.getUTCDate() === d
}
/** How a due day stands against the reader's own "today" (YYYY-MM-DD). */
export function dueState(due: string, today: string): 'overdue' | 'today' | 'upcoming' {
  return due < today ? 'overdue' : due === today ? 'today' : 'upcoming'
}
/** The stored row after applying a change, or null when nothing is left to store. */
export function nextTaskRow(current: { user_id: string | null; member_id: string | null; due_day: string | null } | null, input: ListItemTaskInput) {
  const owner = input.owner === undefined
    ? { user_id: current?.user_id ?? null, member_id: current?.member_id ?? null }
    : input.owner === null ? { user_id: null, member_id: null }
      : input.owner.kind === 'account' ? { user_id: input.owner.id, member_id: null } : { user_id: null, member_id: input.owner.id }
  const due_day = input.due === undefined ? current?.due_day ?? null : input.due
  return owner.user_id === null && owner.member_id === null && due_day === null ? null : { ...owner, due_day }
}
