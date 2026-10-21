'use client'

import { useState, type ReactNode } from 'react'
import Link from 'next/link'
import { PreparationEntry } from '@/components/calendar/preparation/PreparationEntry'
import type { PreparationBacklinks } from '@/lib/event-preparation/discovery'
import { groupByRoutine, ROUTINE_ORDER_MAX } from '@/lib/routine-icons'
import { useTranslation } from '@/i18n'
import { useRoutineStackText } from '@/i18n/routine-stack'
import { useProfileSetupText, profileChorePauseMessage, profileChoreGroupPauseMessage } from '@/i18n/profile-setup'
import { groupChoreSeries } from '@/lib/chore-series-groups'
import { formatDateOnly, toDateOnlyLocal } from '@/lib/dates'
import { RoutineIcon } from './RoutineIcon'
import type { Chore } from '@/types'
import type { ChoreSubjectDTO, ProfileChoreActionAvailability } from '@/lib/chore-profile'

type Step = Chore & {
  assignee: { name: string } | null
  /** Safe display-only subject for an email-free household member. */
  subject?: ChoreSubjectDTO
  /** Per-row compatibility state for profile-only actions. */
  actionAvailability?: ProfileChoreActionAvailability
}

function legacySubjectKey(chore: Step) {
  if (chore.assigned_to) return ['account', chore.assigned_to]
  if (chore.assigned_member_id) return ['profile', chore.assigned_member_id]
  // A missing subject identity is not safe to merge with another row. This
  // keeps erased or malformed legacy rows visible without inventing an owner.
  return ['unassigned', chore.id]
}

/** Labels are not identities: keep members and occurrences separate. */
export function routineStacks(chores: Step[]) {
  const buckets = new Map<string, Step[]>()
  for (const chore of chores) {
    const key = chore.routine_stack_id
      ? JSON.stringify(['stack', chore.routine_stack_id, chore.due_date.slice(0, 10)])
      : JSON.stringify([...legacySubjectKey(chore), chore.due_date.slice(0, 10)])
    const bucket = buckets.get(key) ?? []
    bucket.push(chore)
    buckets.set(key, bucket)
  }
  // Stabilize occurrence/member order without replacing legacy day-order
  // labels inside each member bucket (Morning, After school, Evening, Bedtime).
  return [...buckets.entries()].sort(([aKey, a], [bKey, b]) =>
    a[0].due_date.slice(0, 10).localeCompare(b[0].due_date.slice(0, 10)) ||
    aKey.localeCompare(bKey)
  ).flatMap(([key, bucket]) => {
    // A persisted stack id is the identity. Its label may differ between
    // steps after a partial edit, so do not split it through label grouping.
    const durable = key.startsWith('["stack"')
    const groups = durable
      ? [{
          name: bucket[0].routine?.trim() || bucket[0].title,
          steps: [...bucket].sort((a, b) =>
            (a.routine_order ?? Number.MAX_SAFE_INTEGER) - (b.routine_order ?? Number.MAX_SAFE_INTEGER) || a.id.localeCompare(b.id)
          ),
        }]
      : groupByRoutine(bucket).routines
    return groups.map(group => ({ ...group, key: `${key}:${durable ? 'stack' : group.name.toLowerCase()}` }))
  })
}

const isDone = (chore: Step) => chore.status === 'completed' || chore.status === 'verified'

function isProfileOnlyStep(
  chore: Pick<Step, 'assigned_to' | 'assigned_member_id' | 'member_subject_erased'>,
) {
  return chore.assigned_to === null && (chore.assigned_member_id != null || chore.member_subject_erased === true)
}

export function RoutineStacks({ chores, userRole, currentUserId, familyId, locale, collapseRepeats = false, onComplete, renderOpenRow, showBuilder = true, preparationBacklinks = {} }: {
  preparationBacklinks?: PreparationBacklinks
  chores: Step[]
  userRole: string
  currentUserId: string
  familyId?: string
  locale: string
  collapseRepeats?: boolean
  onComplete: (id: string) => void
  /** Embedded overviews retain the canonical row actions and compatibility gates. */
  renderOpenRow?: (id: string) => ReactNode
  showBuilder?: boolean
}) {
  const { t } = useTranslation()
  const routineText = useRoutineStackText()
  const profileText = useProfileSetupText()
  const [focusNext, setFocusNext] = useState(false)
  const stacks = routineStacks(chores)
  const other = chores.filter(c => !c.routine?.trim() && !c.routine_stack_id)
  const editorDate = chores[0]?.due_date.slice(0, 10) ?? toDateOnlyLocal(new Date())
  const editorHref = `/dashboard/chores/routines?${new URLSearchParams({ occurrence_date: editorDate })}`
  const renderStep = (chore: Step, next: boolean, context = false) => {
    const done = isDone(chore)
    const profileOnly = isProfileOnlyStep(chore)
    // Parent rows keep their existing sheets/Undo; other account roles retain
    // this component's own-step-only controls. Profile callbacks remain disabled.
    if (!done && renderOpenRow && (userRole === 'parent' || profileOnly)) return <li key={chore.id}>{renderOpenRow(chore.id)}</li>
    const profilePaused = chore.actionAvailability?.state === 'paused'
    const profileUnavailable = profileOnly && chore.subject?.kind !== 'profile'
    const canComplete = !profileOnly && (userRole === 'parent' || chore.assigned_to === currentUserId)
    return (
      <li key={chore.id} className="flex flex-wrap items-center gap-3 py-3 border-b border-[var(--surface-separator)] last:border-0">
        <RoutineIcon icon={chore.icon ?? null} className="h-8 w-8 shrink-0 text-label-primary" />
        <div className="flex-1 min-w-[120px] [overflow-wrap:anywhere]">
          <p className="text-body text-label-primary">{chore.routine_order ? `${chore.routine_order}. ` : ''}{chore.title}</p>
          {context && <p className="text-footnote text-label-secondary">{profileUnavailable ? profileText('profileTargetRefresh') : chore.subject?.name ?? chore.assignee?.name ?? t('routineViews.unassigned')} · {formatDateOnly(chore.due_date, undefined, locale)}</p>}
          <p className="text-footnote text-label-secondary">{profilePaused ? profileText(profileChorePauseMessage(chore.actionAvailability)) : chore.status === 'verified' ? routineText('checked') : done ? routineText('doneWaiting') : next ? routineText('upNext') : routineText('toDo')}</p>
        </div>
        {userRole === 'parent' && preparationBacklinks[chore.id] && <PreparationEntry eventId={preparationBacklinks[chore.id]} backlink />}
        {!done && canComplete && <button type="button" onClick={() => onComplete(chore.id)} className="btn-filled min-h-[44px]" aria-label={routineText('completeStep', { title: chore.title })}>{routineText('doneAction')}</button>}
        {userRole === 'parent' && !profileOnly && <Link href={`/dashboard/chores/edit?id=${encodeURIComponent(chore.id)}`} className="text-footnote text-label-secondary min-h-[44px] inline-flex items-center px-2 underline" aria-label={routineText('editStep', { title: chore.title })}>{routineText('editAction')}</Link>}
      </li>
    )
  }
  return (
    <div className="space-y-4" role="region" aria-label={routineText('stacksLabel')}>
      {stacks.length > 0 && <label className="flex items-center gap-3 min-h-[44px] text-body text-label-primary"><input type="checkbox" checked={focusNext} onChange={e => setFocusNext(e.target.checked)} />{routineText('focusNext')}</label>}
      {showBuilder && userRole === 'parent' && familyId && <Link href={editorHref} className="inline-flex min-h-[44px] items-center rounded-xl bg-[var(--accent-fill)] px-4 text-body font-medium text-white">{routineText('build')}</Link>}
      {stacks.length === 0 && <p className="text-body text-label-secondary">{routineText('noRoutines')}</p>}
      {stacks.map(stack => {
        const done = stack.steps.filter(isDone).length
        const checked = stack.steps.filter(c => c.status === 'verified').length
        const next = stack.steps.find(c => !isDone(c))?.id
        const lastOrder = Math.max(0, ...stack.steps.map(c => c.routine_order ?? 0))
        const durableStackId = stack.steps.find(c => c.routine_stack_id)?.routine_stack_id ?? null
        const profileOnly = stack.steps.some(isProfileOnlyStep)
        const profileUnavailable = profileOnly && stack.steps.every(c => c.subject?.kind !== 'profile')
        const profilePaused = stack.steps.some(c => c.actionAvailability?.state === 'paused')
        const firstStep = stack.steps[0]
        const addStepParams = new URLSearchParams({
          routine: stack.name,
          step: String(lastOrder + 1),
          date: firstStep.due_date.slice(0, 10),
        })
        if (firstStep.assigned_to) addStepParams.set('member', firstStep.assigned_to)
        else if (firstStep.assigned_member_id) addStepParams.set('profile', firstStep.assigned_member_id)
        const addStepHref = durableStackId
          ? `/dashboard/chores/routines?${new URLSearchParams({ stack_id: durableStackId, occurrence_date: firstStep.due_date.slice(0, 10) })}`
          : `/dashboard/chores/create?${addStepParams}`
        return <section key={stack.key} className="rounded-[var(--radius-xl)] bg-[var(--surface-elevated)] p-4" aria-label={`${stack.name} · ${profileUnavailable ? profileText('profileTargetRefresh') : stack.steps[0].subject?.name ?? stack.steps[0].assignee?.name ?? t('routineViews.unassigned')} · ${formatDateOnly(stack.steps[0].due_date, undefined, locale)}`}>
          <h2 className="text-title-3 text-label-primary [overflow-wrap:anywhere]">{stack.name}</h2>
          <p className="text-footnote text-label-secondary">{profileUnavailable ? profileText('profileTargetRefresh') : stack.steps[0].subject?.name ?? stack.steps[0].assignee?.name ?? t('routineViews.unassigned')} · {formatDateOnly(stack.steps[0].due_date, undefined, locale)}</p>
          <p className="text-footnote text-label-secondary mt-2" aria-live="polite">{routineText('progress', { done, total: stack.steps.length, checked })}</p>
          {profilePaused && <p className="text-footnote text-label-secondary mt-2" role="status">{profileText(profileChoreGroupPauseMessage(stack.steps))}</p>}
          <ol>{stack.steps.filter(c => !focusNext || c.id === next).map(c => renderStep(c, c.id === next, true))}</ol>
          {focusNext && !next && <p className="text-footnote text-label-secondary mt-2">{routineText(checked < done ? 'allDoneWaiting' : 'allDoneChecked')}</p>}
          {userRole === 'parent' && (!profileOnly || (!profileUnavailable && !profilePaused)) && <div className="flex flex-wrap items-center gap-3">
            {familyId && durableStackId && <Link className="inline-flex min-h-[44px] items-center text-[var(--accent)] underline text-body" href={`/dashboard/chores/routines?${new URLSearchParams({ stack_id: durableStackId, occurrence_date: stack.steps[0].due_date.slice(0, 10) })}`}>{routineText('edit')}</Link>}
            {familyId && lastOrder < ROUTINE_ORDER_MAX && <Link className="inline-flex items-center min-h-[44px] text-[var(--accent)] underline text-body" href={addStepHref}>{routineText('addStep')}</Link>}
          </div>}
        </section>
      })}
      {other.length > 0 && <section className="list-inset px-4" aria-label={routineText('otherChores')}><h2 className="section-header">{routineText('otherChores')}</h2><ul>{(collapseRepeats ? groupChoreSeries(other) : other.map(c => ({ key: c.id, steps: [c], repeating: false }))).map(group => {
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
