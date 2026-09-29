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

const OPEN = new Set(['pending', 'in_progress', 'overdue'])

export function isOpenStatus(status: string): boolean {
  return OPEN.has(status)
}

export function isDoneStatus(status: string): boolean {
  return status === 'completed' || status === 'verified'
}

function plural(n: number, one: string, many: string): string {
  return `${n} ${n === 1 ? one : many}`
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
export function parentSummary(chores: HomeChore[], members: HomeMember[], todayKey: string): string {
  const due = choresDueOn(chores, todayKey)
  const open = due.filter((c) => isOpenStatus(c.status))
  if (open.length === 0) {
    return due.length > 0 ? 'Every chore is done for today' : 'No chores today'
  }
  const counts = new Map<string, number>()
  for (const c of open) counts.set(c.assigneeId, (counts.get(c.assigneeId) ?? 0) + 1)
  const order = members.map((m) => m.id)
  const people = [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || rank(order, a[0]) - rank(order, b[0]))
    .map(([id, n]) => {
      const m = members.find((x) => x.id === id)
      return `${m ? firstName(m.name) : 'someone'} ${n}`
    })
  return `${plural(open.length, 'chore', 'chores')} left today · ${people.join(', ')}`
}

function rank(order: string[], id: string): number {
  const i = order.indexOf(id)
  return i === -1 ? Number.MAX_SAFE_INTEGER : i
}

/** The viewer's own sentence (teen, child, or a parent's own list). */
export function memberSummary(chores: HomeChore[], viewerId: string, todayKey: string): string {
  const mine = choresDueOn(chores, todayKey).filter((c) => c.assigneeId === viewerId)
  const open = mine.filter((c) => isOpenStatus(c.status)).length
  if (open > 0) return `You have ${plural(open, 'chore', 'chores')} left`
  return mine.length > 0 ? "You're done for today" : 'Nothing on your list today'
}

export function homeSummary(opts: {
  viewer: { id: string; role: string }
  chores: HomeChore[]
  members: HomeMember[]
  todayKey: string
}): string {
  return opts.viewer.role === 'parent'
    ? parentSummary(opts.chores, opts.members, opts.todayKey)
    : memberSummary(opts.chores, opts.viewer.id, opts.todayKey)
}
