'use client'

import * as React from 'react'
import Link from 'next/link'
import { Check, ChevronRight } from 'lucide-react'
import { useUndoToast } from '@/components/ui/toast'
import { BrandIllustration } from '@/components/ui/brand-illustration'
import { ILLUSTRATIONS } from '@/lib/brand-illustrations'
import { useOnboardingText } from '@/i18n/onboarding'
import { cn } from '@/lib/utils'
import { allStepsDone, type GetStartedSteps } from '@/app/dashboard/today/get-started-data'
import { getStartedStorageKey, useGetStartedHidden, writeVisibilityHidden } from './get-started-visibility'

export { getStartedStorageKey, useGetStartedHidden } from './get-started-visibility'

export interface GetStartedProps {
  viewer: { role: string }
  familyId: string
  steps: GetStartedSteps
}

/**
 * The parent's first steps on a new household's Today board: invite the
 * family, add a chore, add an event. Each step is ticked from real household
 * data (./get-started-data.ts). The card goes away once all three are done,
 * or when a parent presses Hide (with Undo).
 *
 * Hydration: the server cannot read localStorage, so the server render and
 * the first client render treat the card as not hidden; the stored choice
 * applies right after (useSyncExternalStore's server snapshot).
 */
export default function GetStarted({ viewer, familyId, steps }: GetStartedProps) {
  const text = useOnboardingText()
  const showUndo = useUndoToast()
  const stored = useGetStartedHidden(familyId)
  // Hidden for this visit even if storage refused the write.
  const [hiddenNow, setHiddenNow] = React.useState(false)
  const headingId = React.useId()

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
    <section aria-labelledby={headingId} data-testid="get-started" className="rounded-[var(--radius-lg)] border border-[var(--surface-separator)] bg-[var(--surface-elevated)] p-4 md:p-5">
      <div className="flex items-center gap-3">
        <BrandIllustration
          source={ILLUSTRATIONS.wovenGrove}
          className="woven-grove-art hidden h-auto w-16 shrink-0 rounded-[var(--radius-md)] sm:block"
        />
        <div className="min-w-0 flex-1">
          <h2 id={headingId} className="text-title-3 text-label-primary">
            {text('getStarted')}
          </h2>
          <p className="mt-1 text-subhead text-label-secondary" data-testid="get-started-progress">
            {text('setupProgress', { done: doneCount, total: rows.length })}
          </p>
        </div>
        <button
          type="button"
          onClick={hide}
          aria-label={text('setupHideLabel')}
          className="btn-plain -mr-2 -mt-1 min-h-[44px] min-w-[44px] shrink-0"
        >
          {text('setupHide')}
        </button>
      </div>

      <ol className="mt-3 grid gap-1 md:grid-cols-3 md:gap-3" aria-label={text('setupSteps')}>
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
    </section>
  )
}
