'use client'

import * as React from 'react'
import Link from 'next/link'
import { useRouter } from 'next/navigation'
import { ChevronRight } from 'lucide-react'
import { CheckboxRow } from '@/components/ui/checkbox-row'
import { useToast, useUndoToast } from '@/components/ui/toast'
import { cn } from '@/lib/utils'
import { toDateOnlyLocal } from '@/lib/dates'
import { setChoreDone } from '@/lib/chore-tick-client'
import {
  choresDueOn,
  homeSummary,
  isDoneStatus,
  isOpenStatus,
  type HomeChore,
  type HomeMember,
} from '@/lib/home-summary'

export interface HomeSummaryProps {
  viewer: { id: string; role: string }
  /** Household chores due around today (the server sends a window; the client picks the local day). */
  chores: HomeChore[]
  /** Household members, names only, for the parent sentence. */
  members: HomeMember[]
  /** Chores marked done and waiting for a parent to check (parents only; 0 otherwise). */
  toCheckCount: number
  /** Link to the full chores page, or null when the role cannot open it. */
  choresHref: string | null
}

/**
 * The personal part of the home screen (#268, #269): one true sentence about
 * today's chores and the viewer's own chores due today, tickable in place.
 *
 * A tick is optimistic: the row checks at once, the server is told, and an
 * Undo toast offers to reverse it (POST /api/chores/uncomplete). If the server
 * refuses, the row goes back and an error toast says why. A child's or teen's
 * completed chore waits for a parent to check it (status `completed` until a
 * parent verifies); a chore a parent already checked cannot be unticked here.
 *
 * Colour marks state only (the check); there are no decorative glyph tiles.
 */
export default function HomeSummary({ viewer, chores, members, toCheckCount, choresHref }: HomeSummaryProps) {
  const router = useRouter()
  const { addToast } = useToast()
  const showUndo = useUndoToast()
  // The viewer's local day. Unknown on the server, so the summary renders after mount.
  const [todayKey, setTodayKey] = React.useState<string | null>(null)
  // Optimistic statuses by chore id, layered over the server's.
  const [overrides, setOverrides] = React.useState<Record<string, string>>({})
  const busy = React.useRef(new Set<string>())

  React.useEffect(() => {
    setTodayKey(toDateOnlyLocal(new Date()))
  }, [])

  React.useEffect(() => {
    // A fresh server snapshot replaces the optimistic layer.
    setOverrides({})
  }, [chores])

  const effective = React.useMemo(
    () => chores.map((c) => (overrides[c.id] ? { ...c, status: overrides[c.id] } : c)),
    [chores, overrides]
  )

  const isParent = viewer.role === 'parent'
  const doneLabel = isParent ? 'Done' : 'Done · waiting for a parent to check'

  const setStatus = (id: string, status: string | null) =>
    setOverrides((prev) => {
      const next = { ...prev }
      if (status === null) delete next[id]
      else next[id] = status
      return next
    })

  const reopen = async (chore: HomeChore) => {
    if (busy.current.has(chore.id)) return
    busy.current.add(chore.id)
    setStatus(chore.id, 'pending')
    const result = await setChoreDone(chore.id, false)
    busy.current.delete(chore.id)
    if (!result.ok) {
      setStatus(chore.id, 'completed')
      addToast({ type: 'error', title: `Couldn't undo “${chore.title}”`, message: result.message })
      return
    }
    // Bring the rest of the page (the board's chores) up to date.
    router.refresh()
  }

  const complete = async (chore: HomeChore) => {
    if (busy.current.has(chore.id)) return
    busy.current.add(chore.id)
    setStatus(chore.id, 'completed')
    const result = await setChoreDone(chore.id, true)
    busy.current.delete(chore.id)
    if (!result.ok) {
      setStatus(chore.id, null)
      addToast({ type: 'error', title: `Couldn't mark “${chore.title}” done`, message: result.message })
      return
    }
    router.refresh()
    showUndo({
      title: `“${chore.title}” done`,
      message: isParent ? undefined : 'A parent will check it.',
      onUndo: () => void reopen(chore),
    })
  }

  if (!todayKey) {
    return (
      <section aria-label="Your chores" aria-busy="true" className="mb-5">
        <div className="h-16 rounded-[var(--radius-xl)] bg-[var(--surface-fill)]" />
      </section>
    )
  }

  const sentence = homeSummary({ viewer, chores: effective, members, todayKey })
  const mine = choresDueOn(effective, todayKey).filter((c) => c.assigneeId === viewer.id)
  // Open first, then done, each in the server's order.
  const rows = [...mine.filter((c) => isOpenStatus(c.status)), ...mine.filter((c) => isDoneStatus(c.status))]

  return (
    <section aria-label="Your chores" data-testid="home-summary" className="mb-5 card-apple p-4 md:p-5">
      <p role="status" data-testid="home-summary-sentence" className="text-title-3 text-label-primary">
        {sentence}
      </p>

      {rows.length > 0 && (
        <div className="mt-3 list-inset" data-testid="my-chores">
          {rows.map((chore, i) => {
            const done = isDoneStatus(chore.status)
            const checked = chore.status === 'verified'
            return (
              <CheckboxRow
                key={chore.id}
                checked={done}
                disabled={checked}
                wrap
                onChange={(next) => void (next ? complete(chore) : reopen(chore))}
                title={chore.title}
                subtitle={checked ? 'Checked by a parent' : done ? doneLabel : 'Due today'}
                className={cn(i < rows.length - 1 && 'border-b border-[var(--surface-separator)]')}
              />
            )
          })}
        </div>
      )}

      {(choresHref || (isParent && toCheckCount > 0)) && (
        <div className="mt-2 flex flex-wrap gap-x-4">
          {isParent && toCheckCount > 0 && choresHref && (
            <Link
              href={choresHref}
              className="inline-flex min-h-[44px] items-center gap-1 text-subhead font-medium text-[var(--accent-text)]"
            >
              {toCheckCount === 1 ? '1 chore to check' : `${toCheckCount} chores to check`}
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
          {choresHref && (
            <Link
              href={choresHref}
              className="inline-flex min-h-[44px] items-center gap-1 text-subhead font-medium text-[var(--accent-text)]"
            >
              All chores
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </Link>
          )}
        </div>
      )}
    </section>
  )
}
