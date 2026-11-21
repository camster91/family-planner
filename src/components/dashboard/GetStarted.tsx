'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, ChevronDown, ChevronRight } from 'lucide-react'
import { useUndoToast } from '@/components/ui/toast'
import { useGetStartedText } from '@/i18n/get-started'
import { cn } from '@/lib/utils'
import { allStepsDone, type GetStartedSteps } from '@/app/dashboard/today/get-started-data'
import { getStartedStorageKey, useGetStartedHidden, writeVisibilityHidden } from './get-started-visibility'

export { getStartedStorageKey, useGetStartedHidden } from './get-started-visibility'

export interface GetStartedProps {
  viewer: { role: string }
  familyId: string
  steps: GetStartedSteps
  /**
   * Decorative art beside the opened steps, rendered on the server
   * (GetStartedArt) so the illustration registry stays out of this lazy chunk.
   */
  art?: React.ReactNode
}

/**
 * The parent's first steps on a new household's Today board: invite the
 * family, add a chore, add an event, connect a calendar. Each step is ticked
 * from real household data (./get-started-data.ts). The card goes away once
 * all four are done,
 * or when a parent presses Hide (with Undo).
 *
 * Hydration: the server cannot read localStorage, so the server render and
 * the first client render treat the card as not hidden; the stored choice
 * applies right after (useSyncExternalStore's server snapshot).
 */
export default function GetStarted({ viewer, familyId, steps, art }: GetStartedProps) {
  const text = useGetStartedText()
  const showUndo = useUndoToast()
  const stored = useGetStartedHidden(familyId)
  // Hidden for this visit even if storage refused the write.
  const [hiddenNow, setHiddenNow] = React.useState(false)
  const headingId = React.useId()
  const stepsId = React.useId()
  // The steps stay folded until asked for; the line alone says how far along.
  const [open, setOpen] = React.useState(false)

  if (viewer.role !== 'parent' || allStepsDone(steps) || stored || hiddenNow) return null

  const rows = [
    {
      key: 'invite',
      title: text('setupInviteTitle'),
      hint: text('setupInviteHint'),
      href: '/dashboard/family/invite',
      done: steps.invited,
    },
    {
      key: 'chore',
      title: text('setupChoreTitle'),
      hint: text('setupChoreHint'),
      href: '/dashboard/chores/create',
      done: steps.hasChore,
    },
    {
      key: 'event',
      title: text('setupEventTitle'),
      hint: text('setupEventHint'),
      href: '/dashboard/calendar/create',
      done: steps.hasEvent,
    },
    {
      key: 'calendar',
      title: text('setupCalendarTitle'),
      hint: text('setupCalendarHint'),
      // The existing subscriptions section; two-way sync sits right below it.
      href: '/dashboard/settings#calendar-subscriptions',
      done: steps.hasCalendar,
    },
  ]
  const doneCount = rows.filter((r) => r.done).length

  const hide = () => {
    setHiddenNow(true)
    writeVisibilityHidden(getStartedStorageKey(familyId), true)
    showUndo({
      title: text('setupHidden'),
      onUndo: () => {
        writeVisibilityHidden(getStartedStorageKey(familyId), false)
        setHiddenNow(false)
      },
    })
  }

  return (
    <section aria-labelledby={headingId} data-testid="get-started" className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)]">
      <div className="flex items-center gap-1 pl-4 pr-2">
        <h2 className="min-w-0 flex-1">
          <button
            type="button"
            aria-expanded={open}
            aria-controls={stepsId}
            data-testid="get-started-toggle"
            onClick={() => setOpen((value) => !value)}
            className="flex min-h-[48px] w-full items-center gap-2 rounded-[var(--radius-md)] text-left active:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--accent-fill)]"
          >
            <span className="flex min-w-0 flex-wrap items-baseline gap-x-2">
              <span id={headingId} className="text-[17px] font-semibold leading-tight text-label-primary">
                {text('getStarted')}
              </span>
              <span className="text-subhead text-label-secondary" data-testid="get-started-progress">
                {text('setupProgress', { done: doneCount, total: rows.length })}
              </span>
            </span>
            <ChevronDown
              className={cn('h-5 w-5 shrink-0 text-label-secondary motion-safe:transition-transform', open && 'rotate-180')}
              aria-hidden="true"
            />
          </button>
        </h2>
        <button
          type="button"
          onClick={hide}
          aria-label={text('setupHideLabel')}
          className="btn-plain min-h-[44px] min-w-[44px] shrink-0"
        >
          {text('setupHide')}
        </button>
      </div>

      <div id={stepsId} hidden={!open} className={cn('items-center gap-3 px-2 pb-2 md:px-3 md:pb-3', open && 'flex')}>
      {art}
      <ol className="grid min-w-0 flex-1 gap-1 md:grid-cols-2 md:gap-3 xl:grid-cols-4" aria-label={text('setupSteps')}>
        {rows.map((row) => (
          <li key={row.key} data-testid={`get-started-${row.key}`}>
            <Link
              href={row.href}
              className="flex min-h-[56px] items-center gap-3 rounded-[var(--radius-md)] px-2 py-2 active:bg-[var(--surface-fill)] focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-[var(--accent-fill)]"
            >
              <span
                aria-hidden="true"
                className={cn(
                  'flex h-6 w-6 shrink-0 items-center justify-center rounded-full border-[1.5px]',
                  row.done ? 'border-success bg-success' : 'border-label-tertiary'
                )}
              >
                {row.done && <Check className="h-3.5 w-3.5 text-white" strokeWidth={3} />}
              </span>
              <span className="min-w-0 flex-1">
                {!row.done && <span className="sr-only">{text('setupTodo')}</span>}
                <span
                  className={cn('block break-words text-body', row.done ? 'text-label-secondary' : 'text-label-primary')}
                >
                  {row.title}
                </span>
                <span className="block break-words text-footnote text-label-secondary">
                  {row.done ? text('setupDone') : row.hint}
                </span>
              </span>
              <ChevronRight className="h-4 w-4 shrink-0 text-label-tertiary" aria-hidden="true" />
            </Link>
          </li>
        ))}
      </ol>
      </div>
    </section>
  )
}
