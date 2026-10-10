/** @jest-environment jsdom */
import '@testing-library/jest-dom'
import * as React from 'react'
import { fireEvent, render, screen } from '@testing-library/react'
import SettingsDisclosure from '../SettingsDisclosure'

const scroll = jest.fn()
beforeEach(() => {
  scroll.mockClear()
  HTMLElement.prototype.scrollIntoView = scroll
  window.history.replaceState({}, '', '/dashboard/settings')
})
afterEach(() => window.history.replaceState({}, '', '/dashboard/settings'))

it('opens the correct deep-linked section when it mounts after profile loading', () => {
  window.history.replaceState({}, '', '/dashboard/settings#calendar-subscriptions')
  const view = render(<p>Loading profile</p>)
  view.rerender(<><SettingsDisclosure id="calendar-sync" title="Connected"><p>Provider setup</p></SettingsDisclosure><SettingsDisclosure id="calendar-subscriptions" title="Subscribed"><p>Calendar link setup</p></SettingsDisclosure></>)
  expect(screen.getByText('Subscribed').closest('details')).toHaveAttribute('open')
  expect(screen.getByText('Connected').closest('details')).not.toHaveAttribute('open')
  expect(scroll).toHaveBeenCalledTimes(1)
  expect(scroll).toHaveBeenCalledWith({ block: 'start' })
})
it('opens on a same-page hash change and removes the listener on unmount', () => {
  const view = render(<SettingsDisclosure id="calendar-sync" title="Connected"><p>Provider setup</p></SettingsDisclosure>)
  expect(screen.getByText('Connected').closest('details')).not.toHaveAttribute('open')
  window.history.replaceState({}, '', '/dashboard/settings#calendar-sync')
  fireEvent(window, new Event('hashchange'))
  expect(screen.getByText('Connected').closest('details')).toHaveAttribute('open')
  expect(scroll).toHaveBeenCalledTimes(1)
  view.unmount()
  fireEvent(window, new Event('hashchange'))
  expect(scroll).toHaveBeenCalledTimes(1)
})
