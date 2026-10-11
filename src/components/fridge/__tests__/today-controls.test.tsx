/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import TodayControls from '../TodayControls'
import type { BoardLinks } from '@/app/dashboard/today/today-board-data'
import { I18nProvider } from '@/i18n'
jest.mock('@/components/ui/use-display-locale', () => ({ useDisplayLocale: () => 'en-CA' }))
const links: BoardLinks = { calendar: '/dashboard/calendar', chores: '/dashboard/chores', meals: '/dashboard/meals', lists: '/dashboard/lists/groceries', features: '/dashboard/features' }
const refresh = jest.fn()
function mount(role='parent', online=true, choices=links) { return render(<TodayControls role={role} links={choices} onRefresh={refresh} online={online} />) }
beforeEach(() => refresh.mockClear())
it.each(['parent', 'teen'] as const)('%s gets the relative event-create route and separate grocery and all-list destinations', role => {
  mount(role)
  expect(screen.getByRole('link', {name:'Add event'})).toHaveAttribute('href','/dashboard/calendar/create')
  if (role === 'parent') {
    expect(screen.getByRole('link', {name:'Add chore'})).toHaveAttribute('href','/dashboard/chores/create')
  } else {
    expect(screen.queryByText('Add chore')).not.toBeInTheDocument()
    expect(screen.queryByText('Household features')).not.toBeInTheDocument()
  }
  expect(screen.getByRole('link', {name:'Groceries'})).toHaveAttribute('href','/dashboard/lists/groceries')
  expect(screen.getByRole('link', {name:'All lists'})).toHaveAttribute('href','/dashboard/lists')
})
it('does not offer event creation or parent-only actions to a child', () => {
  mount('child')
  expect(screen.queryByText('Add event')).not.toBeInTheDocument()
  expect(screen.queryByText('Add chore')).not.toBeInTheDocument()
  expect(screen.queryByText('Household features')).not.toBeInTheDocument()
})
it.each(['parent', 'teen', 'child'] as const)('does not offer event creation when the calendar link is absent for %s', role => {
  mount(role, true, {calendar:null, chores:null, meals:null, lists:null, features:null})
  expect(screen.queryByRole('link', {name:'Add event'})).not.toBeInTheDocument()
})
it('respects absent feature links', () => {
  mount('parent',true,{calendar:'/dashboard/calendar',chores:null,meals:null,lists:null,features:null})
  expect(screen.queryByRole('link',{name:'Groceries'})).not.toBeInTheDocument()
  expect(screen.queryByRole('link',{name:'Plan meals'})).not.toBeInTheDocument()
})
it('uses the typed Today dictionary for Spanish controls', () => {
  render(
    <I18nProvider locale="es">
      <TodayControls role="parent" links={links} onRefresh={refresh} online />
    </I18nProvider>,
  )
  expect(screen.getByRole('navigation', { name: 'Acciones rápidas de hoy' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Añadir evento' })).toBeInTheDocument()
  expect(screen.getByRole('link', { name: 'Alimentos' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Actualizar ahora' })).toBeInTheDocument()
})
it('refreshes, closes the disclosure and returns focus', () => {
  const {container}=mount()
  const details=container.querySelector('details')!
  details.open=true
  fireEvent.click(screen.getByRole('button',{name:'Refresh now'}))
  expect(refresh).toHaveBeenCalledTimes(1)
  expect(details.open).toBe(false)
  expect(container.querySelector('summary')).toHaveFocus()
})
it('disables refresh offline', () => {
  const {container}=mount('parent',false)
  container.querySelector('details')!.open=true
  expect(screen.getByRole('button',{name:'Refresh now'})).toBeDisabled()
  expect(screen.getByText('Reconnect to refresh.')).toBeInTheDocument()
})
it('dismisses on Escape and outside pointer', () => {
  const {container}=mount()
  const details=container.querySelector('details')!
  details.open=true
  fireEvent.keyDown(screen.getByRole('button',{name:'Refresh now'}),{key:'Escape'})
  expect(details.open).toBe(false)
  expect(container.querySelector('summary')).toHaveFocus()
  details.open=true
  fireEvent.pointerDown(document.body)
  expect(details.open).toBe(false)
})
