'use client'

import * as React from 'react'
import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RoutineIcon } from '@/components/chores/RoutineIcon'
import type { RoutineGroup } from '@/lib/routine-icons'

export interface RoutineStep {
  id: string
  title: string
  status: string
  icon?: string | null
  routine?: string | null
  routine_order?: number | null
}

export interface KidRoutinesProps {
  /** Today's routines, already grouped and ordered (`groupByRoutine`). */
  routines: RoutineGroup<RoutineStep>[]
  /** Chores ticked on this page and not yet undone. */
  tickedIds: ReadonlySet<string>
  onComplete: (choreId: string) => void
}

type StepState = 'todo' | 'next' | 'waiting' | 'checked'

function baseDone(status: string) {
  return status === 'completed' || status === 'verified'
}

/**
 * Picture routines on the kid home (#272). Each routine is an ordered list of
 * big picture cards. Pre-reader friendly: the one next step across all of
 * today's routines is outlined, raised and marked with an arrow badge and the
 * word "Next", so a child who cannot read yet still knows what to do; a done
 * step shows a large tick and the word "Done" (never colour alone). One tap
 * completes a step through the kid home's usual flow (Undo toast, a parent
 * checks it).
 */
export default function KidRoutines({ routines, tickedIds, onComplete }: KidRoutinesProps) {
  // Routine names are free text, so headings get ids from position, not name:
  // "After school" and "After-school" (or two non-Latin names) stay distinct.
  const idPrefix = React.useId()
  const stateOf = (step: RoutineStep): Exclude<StepState, 'next'> => {
    if (step.status === 'verified') return 'checked'
    if (baseDone(step.status) || tickedIds.has(step.id)) return 'waiting'
    return 'todo'
  }

  // The single next step: the first open step of the first routine (in day
  // order) that still has one.
  let nextId: string | null = null
  for (const r of routines) {
    const open = r.steps.find((s) => stateOf(s) === 'todo')
    if (open) {
      nextId = open.id
      break
    }
  }

  return (
    <div className="space-y-6" data-testid="kid-routines">
      {routines.map((routine, routineIndex) => {
        const total = routine.steps.length
        const doneCount = routine.steps.filter((s) => stateOf(s) !== 'todo').length
        const allDone = doneCount === total
        const headingId = `${idPrefix}-routine-${routineIndex}`
        return (
          <section key={routine.name} aria-labelledby={headingId} data-testid="kid-routine">
            <div className="flex items-baseline justify-between gap-3 mb-2 px-1">
              <h2 id={headingId} className="text-title-2 font-semibold text-label-primary break-words min-w-0">
                {routine.name}
              </h2>
              <p className="text-subhead text-label-secondary shrink-0" data-testid="routine-progress">
                {allDone ? 'All done' : `${doneCount} of ${total} done`}
              </p>
            </div>
            <ol className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
              {routine.steps.map((step, i) => {
                const base = stateOf(step)
                const state: StepState = step.id === nextId ? 'next' : base
                const done = state === 'waiting' || state === 'checked'
                const spoken = [
                  step.title,
                  `step ${i + 1} of ${total}`,
                  state === 'next'
                    ? 'next step'
                    : state === 'waiting'
                      ? 'done, waiting for a parent to check'
                      : state === 'checked'
                        ? 'done, checked by a parent'
                        : null,
                ]
                  .filter(Boolean)
                  .join(', ')
                return (
                  <li key={step.id} className="min-w-0">
                    <button
                      type="button"
                      onClick={() => onComplete(step.id)}
                      disabled={done}
                      aria-label={spoken}
                      aria-current={state === 'next' ? 'step' : undefined}
                      data-testid="routine-step"
                      data-state={state}
                      className={cn(
                        'relative flex w-full min-h-[168px] flex-col items-center justify-start gap-2 rounded-[var(--radius-lg,16px)] border-2 px-2 pb-3 pt-4 text-center transition-colors duration-200',
                        'focus-visible:outline focus-visible:outline-[3px] focus-visible:outline-offset-2 focus-visible:outline-[var(--accent)]',
                        state === 'next' &&
                          'border-[var(--accent)] bg-[var(--accent-tint)] shadow-lg ring-4 ring-[var(--accent-tint)] active:bg-[var(--surface-fill-secondary)]',
                        state === 'todo' &&
                          'border-[var(--surface-separator)] bg-[var(--surface-elevated)] active:bg-[var(--surface-fill-secondary)]',
                        done && 'border-[var(--success)] bg-[var(--success-tint)]'
                      )}
                    >
                      {state === 'next' && (
                        <span
                          className="absolute -top-3 left-1/2 -translate-x-1/2 inline-flex items-center gap-1 rounded-full bg-[var(--accent-fill)] px-3 py-0.5 text-footnote font-semibold text-white shadow"
                          aria-hidden
                        >
                          <svg viewBox="0 0 12 12" className="h-3 w-3" fill="currentColor" aria-hidden>
                            <path d="M6 11 1 5h3V1h4v4h3z" />
                          </svg>
                          Next
                        </span>
                      )}
                      <span className="relative" aria-hidden>
                        <RoutineIcon
                          icon={step.icon}
                          className={cn(
                            'h-24 w-24',
                            state === 'next' ? 'text-[var(--accent)]' : done ? 'text-label-secondary' : 'text-label-primary'
                          )}
                        />
                        {done && (
                          <span className="absolute -bottom-1 -right-2 flex h-10 w-10 items-center justify-center rounded-full border-2 border-white bg-success text-white shadow">
                            <Check className="h-6 w-6" strokeWidth={3} />
                          </span>
                        )}
                      </span>
                      <span
                        className={cn(
                          'text-body font-semibold leading-tight break-words max-w-full text-label-primary'
                        )}
                        aria-hidden
                      >
                        {step.title}
                      </span>
                      {done && (
                        <span className="text-footnote font-semibold text-label-primary" aria-hidden>
                          Done
                        </span>
                      )}
                    </button>
                  </li>
                )
              })}
            </ol>
          </section>
        )
      })}
    </div>
  )
}
