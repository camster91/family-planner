/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoutineStacks, routineStacks } from '../RoutineStacks'
import { I18nProvider } from '@/i18n'
import type { Chore } from '@/types'

function step(id: string, order: number, extra: Partial<Chore> & { assignee?: { name: string } | null } = {}) {
  return { id, family_id: 'fixture', title: id, assigned_to: 'adult', due_date: '2026-10-09', points: 0, status: 'pending' as const, frequency: 'once' as const, difficulty: 'easy' as const, created_at: '2026-10-01', assignee: { name: 'Alex' }, routine: 'Evening reset', routine_order: order, ...extra }
}

it('keeps different members and dates apart while normalizing names and ordering steps', () => {
  const groups = routineStacks([step('second', 2), step('first', 1, { routine: ' evening   RESET ' }), step('teen', 1, { assigned_to: 'teen' }), step('tomorrow', 1, { due_date: '2026-10-10' })])
  expect(groups).toHaveLength(3)
  expect(groups[0].steps.map(s => s.id)).toEqual(['first', 'second'])
  expect(new Set(groups.map(g => g.key)).size).toBe(3)
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
