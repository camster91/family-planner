/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoutineStacks, routineStacks } from '../RoutineStacks'
import { I18nProvider } from '@/i18n'
import { toDateOnlyLocal } from '@/lib/dates'
import type { Chore } from '@/types'
import type { ChoreSubjectDTO } from '@/lib/chore-profile'

function step(id: string, order: number, extra: Partial<Chore> & { assignee?: { name: string } | null; subject?: ChoreSubjectDTO } = {}) {
  return { id, family_id: 'fixture', title: id, assigned_to: 'adult', due_date: '2026-10-09', points: 0, status: 'pending' as const, frequency: 'once' as const, difficulty: 'easy' as const, created_at: '2026-10-01', assignee: { name: 'Alex' }, routine: 'Evening reset', routine_order: order, ...extra }
}

it('keeps different members and dates apart while normalizing names and ordering steps', () => {
  const groups = routineStacks([step('second', 2), step('first', 1, { routine: ' evening   RESET ' }), step('teen', 1, { assigned_to: 'teen' }), step('tomorrow', 1, { due_date: '2026-10-10' })])
  expect(groups).toHaveLength(3)
  expect(groups[0].steps.map(s => s.id)).toEqual(['first', 'second'])
  expect(new Set(groups.map(g => g.key)).size).toBe(3)
})

it('uses durable stack identity when one occurrence spans different members', () => {
  const groups = routineStacks([
    step('adult-step', 1, { assigned_to: 'adult', routine_stack_id: 'stack-a' }),
    step('child-step', 2, { assigned_to: 'child', routine_stack_id: 'stack-a' }),
    step('other-stack', 1, { assigned_to: 'child', routine_stack_id: 'stack-b' }),
  ])
  expect(groups).toHaveLength(2)
  expect(groups[0].steps.map(s => s.id)).toEqual(['adult-step', 'child-step'])
  expect(groups[1].steps.map(s => s.id)).toEqual(['other-stack'])
})

it('keeps same-day cards stable when API results arrive in a different order', () => {
  const chores = [
    step('b-second', 2, { routine_stack_id: 'stack-b' }),
    step('a-second', 2, { routine_stack_id: 'stack-a' }),
    step('b-first', 1, { routine_stack_id: 'stack-b' }),
    step('a-first', 1, { routine_stack_id: 'stack-a' }),
    step('earlier', 1, { routine_stack_id: 'stack-z', due_date: '2026-10-08' }),
  ]
  const order = (input: typeof chores) => routineStacks(input).map(group => group.steps.map(chore => chore.id))
  expect(order(chores)).toEqual([['earlier'], ['a-first', 'a-second'], ['b-first', 'b-second']])
  expect(order([...chores].reverse())).toEqual(order(chores))
})

it('keeps legacy same-day member cards stable without inferring timing from labels', () => {
  const chores = [
    step('morning', 1, { assigned_to: 'teen', routine: 'Morning' }),
    step('evening', 1, { assigned_to: 'adult', routine: 'Evening' }),
  ]
  expect(routineStacks(chores).map(group => group.key)).toEqual(
    routineStacks([...chores].reverse()).map(group => group.key),
  )
})

it('keeps same-day email-free profiles in separate legacy routine buckets', () => {
  const chores = [
    step('profile-a-step', 1, {
      assigned_to: null as never,
      assigned_member_id: 'member-a',
      assignee: null,
      subject: { kind: 'profile' as const, memberId: 'member-a', name: 'Jamie', role: 'child' as const },
    }),
    step('profile-b-step', 1, {
      assigned_to: null as never,
      assigned_member_id: 'member-b',
      assignee: null,
      subject: { kind: 'profile' as const, memberId: 'member-b', name: 'Alex', role: 'child' as const },
    }),
  ]
  const groups = routineStacks(chores)
  expect(groups).toHaveLength(2)
  expect(new Set(groups.map(group => group.key)).size).toBe(2)
})

it('preserves suggested day order within a legacy member occurrence', () => {
  const chores = [step('evening', 1, { routine: 'Evening' }), step('morning', 1, { routine: 'Morning' })]
  expect(routineStacks(chores).map(group => group.name)).toEqual(['Morning', 'Evening'])
  expect(routineStacks([...chores].reverse()).map(group => group.name)).toEqual(['Morning', 'Evening'])
})

it('shows each durable step owner and routes durable Add step through the stack editor', () => {
  render(<RoutineStacks
    chores={[
      step('adult-step', 1, { assigned_to: 'adult', assignee: { name: 'Alex' }, routine_stack_id: 'stack-a' }),
      step('child-step', 2, { assigned_to: 'child', assignee: { name: 'Sam' }, routine_stack_id: 'stack-a' }),
    ]}
    userRole="parent"
    currentUserId="adult"
    familyId="family-a"
    locale="en-CA"
    onComplete={jest.fn()}
  />)

  const routine = screen.getByRole('heading', { name: 'Evening reset' }).closest('section')
  expect(routine).toBeTruthy()
  const rows = within(routine as HTMLElement).getAllByRole('listitem')
  expect(within(rows[0] as HTMLElement).getByText('Alex · Oct 9')).toBeTruthy()
  expect(within(rows[1] as HTMLElement).getByText('Sam · Oct 9')).toBeTruthy()
  expect(within(routine as HTMLElement).getByRole('link', { name: 'Add step' }).getAttribute('href')).toBe(
    '/dashboard/chores/routines?stack_id=stack-a&occurrence_date=2026-10-09',
  )
})

it('keeps one durable occurrence together when persisted labels differ', () => {
  const groups = routineStacks([
    step('second', 2, { routine_stack_id: 'stack-a', routine: 'Later label', assigned_to: 'child' }),
    step('first', 1, { routine_stack_id: 'stack-a', routine: 'Original label' }),
  ])
  expect(groups).toHaveLength(1)
  expect(groups[0].steps.map(s => s.id)).toEqual(['first', 'second'])
  expect(groups[0].key).toContain('"stack-a"')
})

it('shows progress, next step and all later steps without locking or marking them done', async () => {
  const complete = jest.fn()
  render(<RoutineStacks chores={[step('wash', 2), step('clear', 1, { status: 'verified' }), step('tidy', 3, { status: 'completed' }), step('prepare', 4)]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={complete} />)
  expect(screen.getByText('2 of 4 done · 1 checked')).toBeTruthy()
  expect(screen.getByText('Up next')).toBeTruthy()
  expect(screen.getByText('Done · awaiting check')).toBeTruthy()
  const list = screen.getByRole('list')
  expect(within(list).getAllByRole('listitem').map(n => n.textContent)).toEqual([expect.stringContaining('clear'), expect.stringContaining('wash'), expect.stringContaining('tidy'), expect.stringContaining('prepare')])
  await userEvent.click(screen.getByRole('button', { name: 'Complete prepare' }))
  expect(complete).toHaveBeenCalledWith('prepare')
  expect(screen.queryByRole('button', { name: 'Complete tidy' })).toBeNull()
})

it('allows an adult or teen to complete their own accessible steps without exposing parent edit controls', async () => {
  const complete = jest.fn()
  render(<RoutineStacks chores={[step('mine', 1), step('someone else', 2, { assigned_to: 'other' })]} userRole="teen" currentUserId="adult" locale="en-CA" onComplete={complete} />)
  await userEvent.click(screen.getByRole('button', { name: 'Complete mine' }))
  expect(complete).toHaveBeenCalledWith('mine')
  expect(screen.queryByRole('button', { name: 'Complete someone else' })).toBeNull()
  expect(screen.queryAllByRole('link')).toHaveLength(0)
})

it('keeps ungrouped chores visible and supplies an explicit empty state', () => {
  const { rerender } = render(<RoutineStacks chores={[step('standalone', 1, { routine: null })]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={jest.fn()} />)
  expect(within(screen.getByRole('region', { name: 'Other chores' })).getByText('1. standalone')).toBeTruthy()
  expect(screen.getByRole('link', { name: 'Edit standalone' }).getAttribute('href')).toBe('/dashboard/chores/edit?id=standalone')
  rerender(<RoutineStacks chores={[]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={jest.fn()} />)
  expect(screen.getByText(/No routines in this range/)).toBeTruthy()
})

it('keeps profile-only routine steps readable without exposing account mutations', () => {
  const profile = step('profile-step', 1, {
    assigned_to: null as never,
    assigned_member_id: 'member-no-email',
    assignee: null,
    subject: { kind: 'profile' as const, memberId: 'member-no-email', name: 'Jamie', role: 'child' as const },
  })
  render(<RoutineStacks chores={[profile]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={jest.fn()} />)
  expect(screen.getAllByText('Jamie · Oct 9')).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Complete profile-step' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Edit profile-step' })).toBeNull()
})

it('keeps an unreadable profile routine read-only without an account fallback', () => {
  const profile = step('missing-profile-step', 1, {
    assigned_to: null as never,
    assigned_member_id: 'profile-missing',
    assignee: null,
  })
  render(<RoutineStacks chores={[profile]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={jest.fn()} />)
  expect(screen.getAllByText(/That profile is no longer available/)).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Complete missing-profile-step' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Edit missing-profile-step' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Add step' })).toBeNull()
})

it('routes an active email-free profile Add step through a stable profile query', () => {
  const profile = step('profile-step', 1, {
    assigned_to: null as never,
    assigned_member_id: 'member-no-email',
    assignee: null,
    subject: { kind: 'profile' as const, memberId: 'member-no-email', name: 'Jamie', role: 'child' as const },
  })
  render(<RoutineStacks chores={[profile]} userRole="parent" currentUserId="adult" familyId="family-a" locale="en-CA" onComplete={jest.fn()} />)
  const href = screen.getByRole('link', { name: 'Add step' }).getAttribute('href')
  expect(href).toBeTruthy()
  const params = new URLSearchParams(href!.split('?')[1])
  expect(params.get('profile')).toBe('member-no-email')
  expect(params.get('member')).toBeNull()
})

it('keeps an erased profile routine read-only without an account fallback', () => {
  const profile = step('erased-profile-step', 1, {
    assigned_to: null as never,
    assigned_member_id: null,
    member_subject_erased: true,
    assignee: null,
  })
  render(<RoutineStacks chores={[profile]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={jest.fn()} />)
  expect(screen.getAllByText(/That profile is no longer available/)).toHaveLength(2)
  expect(screen.queryByRole('button', { name: 'Complete erased-profile-step' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Edit erased-profile-step' })).toBeNull()
  expect(screen.queryByRole('link', { name: 'Add step' })).toBeNull()
})

it('uses the viewer local day when an empty routine list opens the builder near midnight UTC', () => {
  const now = new Date('2026-10-12T01:30:00.000Z')
  jest.useFakeTimers().setSystemTime(now)
  try {
    render(<RoutineStacks chores={[]} userRole="parent" currentUserId="adult" familyId="family-a" locale="en-CA" onComplete={jest.fn()} />)
    expect(screen.getByRole('link', { name: /Build a routine/ }).getAttribute('href')).toBe(
      `/dashboard/chores/routines?occurrence_date=${toDateOnlyLocal(now)}`,
    )
  } finally {
    jest.useRealTimers()
  }
})


it('can focus on one next step without completing or deleting the other steps', async () => {
  const complete = jest.fn()
  render(<RoutineStacks chores={[step('first', 1), step('second', 2)]} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={complete} />)
  await userEvent.click(screen.getByRole('checkbox', { name: 'Focus on the next step' }))
  expect(screen.getByRole('button', { name: 'Complete first' })).toBeTruthy()
  expect(screen.queryByRole('button', { name: 'Complete second' })).toBeNull()
  expect(screen.getByText('0 of 2 done · 0 checked')).toBeTruthy()
  expect(complete).not.toHaveBeenCalled()
  await userEvent.click(screen.getByRole('checkbox', { name: 'Focus on the next step' }))
  expect(screen.getByRole('button', { name: 'Complete second' })).toBeTruthy()
})

it('identifies unstacked repeated chores by member and date and keeps each completion canonical', async () => {
  const complete = jest.fn()
  const chores = [step('one', 1, { title: 'Take out trash', routine: null, recurrence_id: 'series', due_date: '2026-10-09' }), step('two', 1, { title: 'Take out trash', routine: null, recurrence_id: 'series', due_date: '2026-10-16', assigned_to: 'teen', assignee: { name: 'Sam' } })]
  const { rerender } = render(<I18nProvider><RoutineStacks chores={chores} userRole="parent" currentUserId="adult" locale="en-CA" collapseRepeats onComplete={complete} /></I18nProvider>)
  const other = screen.getByRole('region', { name: 'Other chores' })
  expect(within(other).getByText('2 dates · Oct 9')).toBeTruthy()
  expect((other.querySelector('details') as HTMLDetailsElement).open).toBe(false)
  await userEvent.click(within(other).getByText('Expand to see dates and who does each chore'))
  expect(within(other).getByText('Alex · Oct 9')).toBeTruthy()
  expect(within(other).getByText('Sam · Oct 16')).toBeTruthy()
  await userEvent.click(within(other).getAllByRole('button', { name: 'Complete Take out trash' })[1])
  expect(complete).toHaveBeenCalledWith('two')
  rerender(<I18nProvider><RoutineStacks chores={chores} userRole="parent" currentUserId="adult" locale="en-CA" onComplete={complete} /></I18nProvider>)
  expect(within(other).getAllByRole('button', { name: 'Complete Take out trash' })).toHaveLength(2)
})
it('never merges unrelated series or standalone same-title chores and preserves member permissions', async () => {
  const chores = [step('one', 1, { title: 'Same', routine: null, recurrence_id: 'series-a' }), step('two', 1, { title: 'Same', routine: null, recurrence_id: 'series-b' }), step('three', 1, { title: 'Same', routine: null, assigned_to: 'someone-else' })]
  render(<I18nProvider locale="es"><RoutineStacks chores={chores} userRole="teen" currentUserId="adult" locale="es" collapseRepeats onComplete={jest.fn()} /></I18nProvider>)
  expect(screen.getAllByRole('button', { name: 'Complete Same' })).toHaveLength(2)
  expect(screen.queryAllByRole('link')).toHaveLength(0)
  expect(document.querySelectorAll('details')).toHaveLength(0)
})
