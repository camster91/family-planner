/**
 * Home summary (#268): one true sentence about today's chores for the person
 * looking at the home screen, and the chores they can tick there.
 *
 * Before, the home card counted the whole household ("0 of 3 done · 3
 * pending") right above an empty state about the viewer's own list ("All done
 * for today!"), which contradicted itself. Now:
 *   - a parent reads the household: "3 chores left today · Casey 2, Taylor 1";
 *   - everyone else reads their own list: "You have 2 chores left" or
 *     "You're done for today".
 *
 * "Today" is the viewer's local calendar day (the server cannot know it), and
 * only chores due today count, like the Today board: no overdue pile-up, no
 * shaming (BRAND.md).
 */

export type HomeChoreStatus = 'pending' | 'in_progress' | 'overdue' | 'completed' | 'verified' | string

export interface HomeChore {
  id: string
  title: string
  /** `YYYY-MM-DD`: the UTC calendar day of the stored date-only due date. */
  dueDay: string
  status: HomeChoreStatus
  assigneeId: string
}

export interface HomeMember {
  id: string
  name: string
}

/**
 * Presentation copy for the personal Today summary. The helper keeps an
 * English default for existing callers; mounted UI passes the active locale's
 * typed copy without translating canonical chore titles or member names.
 */
export interface HomeSummaryPresentationMessages {
  sectionLabel: string
  done: string
  doneWaiting: string
  checkedByParent: string
  dueToday: string
  toCheck: (count: number) => string
  allChores: string
  everyChoreDoneToday: string
  noChoresToday: string
  assigneeFallback: string
  choresLeftToday: (count: number, people: string) => string
  choresLeft: (count: number) => string
  doneForToday: string
  nothingOnListToday: string
  undoTitle: (title: string) => string
  undoMessage: string
  completeErrorTitle: (title: string) => string
  undoErrorTitle: (title: string) => string
}

const OPEN = new Set(['pending', 'in_progress', 'overdue'])

export function isOpenStatus(status: string): boolean {
  return OPEN.has(status)
}

export function isDoneStatus(status: string): boolean {
  return status === 'completed' || status === 'verified'
}

export const defaultHomeSummaryMessages: HomeSummaryPresentationMessages = {
  sectionLabel: 'Your chores',
  done: 'Done',
  doneWaiting: 'Done · waiting for a parent to check',
  checkedByParent: 'Checked by a parent',
  dueToday: 'Due today',
  toCheck: (count) => `${count} ${count === 1 ? 'chore' : 'chores'} to check`,
  allChores: 'All chores',
  everyChoreDoneToday: 'Every chore is done for today',
  noChoresToday: 'No chores today',
  assigneeFallback: 'someone',
  choresLeftToday: (count, people) =>
    `${count} ${count === 1 ? 'chore' : 'chores'} left today · ${people}`,
  choresLeft: (count) => `You have ${count} ${count === 1 ? 'chore' : 'chores'} left`,
  doneForToday: "You're done for today",
  nothingOnListToday: 'Nothing on your list today',
  undoTitle: (title) => `“${title}” done`,
  undoMessage: 'A parent will check it.',
  completeErrorTitle: (title) => `Couldn't mark “${title}” done`,
  undoErrorTitle: (title) => `Couldn't undo “${title}”`,
}

function firstName(name: string): string {
  return name.trim().split(/\s+/)[0] || name
}

/** Chores due on `todayKey` (the viewer's local `YYYY-MM-DD`). */
export function choresDueOn(chores: HomeChore[], todayKey: string): HomeChore[] {
  return chores.filter((c) => c.dueDay === todayKey)
}

/**
 * Household sentence for a parent. People are listed by how much they have
 * left (most first), then in household order; a chore whose assignee is not in
 * `members` counts under "someone".
 */
export function parentSummary(
  chores: HomeChore[],
  members: HomeMember[],
  todayKey: string,
  messages: HomeSummaryPresentationMessages = defaultHomeSummaryMessages,
): string {
  const due = choresDueOn(chores, todayKey)
  const open = due.filter((c) => isOpenStatus(c.status))
  if (open.length === 0) {
    return due.length > 0 ? messages.everyChoreDoneToday : messages.noChoresToday
  }
  const counts = new Map<string, number>()
  for (const c of open) counts.set(c.assigneeId, (counts.get(c.assigneeId) ?? 0) + 1)
  const order = members.map((m) => m.id)
  const people = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || rank(order, a[0]) - rank(order, b[0]))
    .map(([id, n]) => {
      const m = members.find((x) => x.id === id)
      return `${m ? firstName(m.name) : messages.assigneeFallback} ${n}`
    })
  return messages.choresLeftToday(open.length, people.join(', '))
}

function rank(order: string[], id: string): number {
  const i = order.indexOf(id)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** The viewer's own sentence (teen, child, or a parent's own list). */
export function memberSummary(
  chores: HomeChore[],
  viewerId: string,
  todayKey: string,
  messages: HomeSummaryPresentationMessages = defaultHomeSummaryMessages,
): string {
  const mine = choresDueOn(chores, todayKey).filter((c) => c.assigneeId === viewerId)
  const open = mine.filter((c) => isOpenStatus(c.status)).length
  if (open > 0) return messages.choresLeft(open)
  return mine.length > 0 ? messages.doneForToday : messages.nothingOnListToday
}

export function homeSummary(opts: {
  viewer: { id: string; role: string }
  chores: HomeChore[]
  members: HomeMember[]
  todayKey: string
  messages?: HomeSummaryPresentationMessages
}): string {
  return opts.viewer.role === 'parent'
    ? parentSummary(opts.chores, opts.members, opts.todayKey, opts.messages)
    : memberSummary(opts.chores, opts.viewer.id, opts.todayKey, opts.messages)
}
