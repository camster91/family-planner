/** @jest-environment jsdom */
import * as React from 'react'
import { render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { RoutineStacks, routineStacks } from '../RoutineStacks'
import type { Chore } from '@/types'

function step(id: string, order: number, extra: Partial<Chore> = {}) {
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
