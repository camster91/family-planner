'use client'

import { useState } from 'react'
import Link from 'next/link'
import { groupByRoutine, ROUTINE_ORDER_MAX } from '@/lib/routine-icons'
import { useTranslation } from '@/i18n'
import { groupChoreSeries } from '@/lib/chore-series-groups'
import { formatDateOnly } from '@/lib/dates'
import { RoutineIcon } from './RoutineIcon'
import type { Chore } from '@/types'

type Step = Chore & { assignee: { name: string } | null }

/** Labels are not identities: keep members and occurrences separate. */
export function routineStacks(chores: Step[]) {
  const buckets = new Map<string, Step[]>()
  for (const chore of chores) {
    const key = JSON.stringify([chore.assigned_to, chore.due_date.slice(0, 10)])
    const bucket = buckets.get(key) ?? []
    bucket.push(chore)
    buckets.set(key, bucket)
  }
  return [...buckets.entries()].flatMap(([key, chores]) =>
    groupByRoutine(chores).routines.map(group => ({ ...group, key: `${key}:${group.name.toLowerCase()}` }))
  ).sort((a, b) => a.steps[0].due_date.localeCompare(b.steps[0].due_date))
}

const isDone = (chore: Step) => chore.status === 'completed' || chore.status === 'verified'

export function RoutineStacks({ chores, userRole, currentUserId, locale, collapseRepeats = false, onComplete }: {
  chores: Step[]
  userRole: string
  currentUserId: string
  locale: string
  collapseRepeats?: boolean
  onComplete: (id: string) => void
}) {
  const { t } = useTranslation()
  const [focusNext, setFocusNext] = useState(false)
  const stacks = routineStacks(chores)
  const other = chores.filter(c => !c.routine?.trim())
  const renderStep = (chore: Step, next: boolean, context = false) => {
    const done = isDone(chore)
    const canComplete = userRole === 'parent' || chore.assigned_to === currentUserId
    return (
      <li key={chore.id} className="flex flex-wrap items-center gap-3 py-3 border-b border-[var(--surface-separator)] last:border-0">
        <RoutineIcon icon={chore.icon ?? null} className="h-8 w-8 shrink-0 text-label-primary" />
        <div className="flex-1 min-w-[120px] [overflow-wrap:anywhere]">
          <p className="text-body text-label-primary">{chore.routine_order ? `${chore.routine_order}. ` : ''}{chore.title}</p>
          {context && <p className="text-footnote text-label-secondary">{chore.assignee?.name ?? t('routineViews.unassigned')} · {formatDateOnly(chore.due_date, undefined, locale)}</p>}
          <p className="text-footnote text-label-secondary">{chore.status === 'verified' ? 'Checked' : done ? 'Done · awaiting check' : next ? 'Up next' : 'To do'}</p>
        </div>
        {!done && canComplete && <button type="button" onClick={() => onComplete(chore.id)} className="btn-filled min-h-[44px]" aria-label={`Complete ${chore.title}`}>Done</button>}
        {userRole === 'parent' && <Link href={`/dashboard/chores/edit?id=${encodeURIComponent(chore.id)}`} className="text-footnote text-label-secondary min-h-[44px] inline-flex items-center px-2 underline" aria-label={`Edit ${chore.title}`}>Edit</Link>}
      </li>
    )
  }
  return (
    <div className="space-y-4" aria-label="Routine stacks">
      {stacks.length > 0 && <label className="flex items-center gap-3 min-h-[44px] text-body text-label-primary"><input type="checkbox" checked={focusNext} onChange={e => setFocusNext(e.target.checked)} />Focus on the next step</label>}
      {stacks.length === 0 && <p className="text-body text-label-secondary">No routines in this range. Give related chores the same routine name and step numbers to stack them.</p>}
      {stacks.map(stack => {
        const done = stack.steps.filter(isDone).length
        const checked = stack.steps.filter(c => c.status === 'verified').length
        const next = stack.steps.find(c => !isDone(c))?.id
        const lastOrder = Math.max(0, ...stack.steps.map(c => c.routine_order ?? 0))
        return <section key={stack.key} className="rounded-[var(--radius-xl)] bg-[var(--surface-elevated)] p-4" aria-label={`${stack.name} · ${stack.steps[0].assignee?.name ?? 'Unassigned'} · ${formatDateOnly(stack.steps[0].due_date, undefined, locale)}`}>
          <h2 className="text-title-3 text-label-primary [overflow-wrap:anywhere]">{stack.name}</h2>
          <p className="text-footnote text-label-secondary">{stack.steps[0].assignee?.name ?? 'Unassigned'} · {formatDateOnly(stack.steps[0].due_date, undefined, locale)}</p>
          <p className="text-footnote text-label-secondary mt-2" aria-live="polite">{done} of {stack.steps.length} done · {checked} checked</p>
          <ol>{stack.steps.filter(c => !focusNext || c.id === next).map(c => renderStep(c, c.id === next))}</ol>
          {focusNext && !next && <p className="text-footnote text-label-secondary mt-2">All steps done{checked < done ? " · some awaiting check" : " and checked"}.</p>}
          {userRole === 'parent' && lastOrder < ROUTINE_ORDER_MAX && <Link className="inline-flex items-center min-h-[44px] text-[var(--accent)] underline text-body" href={`/dashboard/chores/create?${new URLSearchParams({ routine: stack.name, step: String(lastOrder + 1), member: stack.steps[0].assigned_to, date: stack.steps[0].due_date.slice(0, 10) })}`}>Add step</Link>}
        </section>
      })}
      {other.length > 0 && <section className="list-inset px-4" aria-label="Other chores"><h2 className="section-header">Other chores</h2><ul>{(collapseRepeats ? groupChoreSeries(other) : other.map(c => ({ key: c.id, steps: [c], repeating: false }))).map(group => {
        if (!group.repeating || group.steps.length < 2) return renderStep(group.steps[0], false, true)
        return <li key={group.key} className="border-b border-[var(--surface-separator)] last:border-0">
          <details>
            <summary className="min-h-[44px] py-3 cursor-pointer text-label-primary [overflow-wrap:anywhere] focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--accent)]">
              <span className="text-body font-medium">{group.steps[0].title}</span>
              <span className="block text-footnote text-label-secondary">{t('routineViews.dates', { count: group.steps.length })} · {formatDateOnly(group.steps[0].due_date, undefined, locale)}</span>
              <span className="block text-footnote text-label-secondary">{t('routineViews.expand')}</span>
            </summary>
            <ul>{group.steps.map(c => renderStep(c, false, true))}</ul>
          </details>
        </li>
      })}</ul></section>}
    </div>
  )
}
